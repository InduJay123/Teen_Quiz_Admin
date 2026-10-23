import test from 'node:test'
import assert from 'node:assert/strict'
import { createGenerationHandler } from '../supabase/functions/_shared/generationHandler.js'
import { GenerationError } from '../supabase/functions/_shared/quizValidation.js'
import { parseAdminOrigins } from '../supabase/functions/_shared/cors.js'

const local = 'http://localhost:5174'
const production = 'https://admin.example.com'
const secondary = 'https://staff.example.com'

function fixture({ origin = production, signedIn = true, admin = true, dbError = false } = {}) {
  const calls = []
  const handle = createGenerationHandler({
    origin, configured: true,
    authenticate: async () => { calls.push('auth'); return signedIn ? { id: 'admin' } : null },
    db: {
      requireAdmin: async () => {
        calls.push('quiz_generation_require_admin')
        if (!admin) throw new GenerationError('Active administrator access required.', 403)
      },
      rpc: async (name) => {
        calls.push(name)
        if (dbError === 'unexpected') throw new Error('Unexpected database error')
        if (dbError) throw new GenerationError('Service unavailable.', 503)
        if (name === 'quiz_generation_require_admin' && !admin) throw new GenerationError('Active administrator access required.', 403)
      },
      latestJob: async () => null,
    },
  })
  const request = (requestOrigin, method = 'OPTIONS', body = { action: 'recent' }) => handle(new Request('http://edge.test', {
    method,
    headers: {
      ...(requestOrigin === null ? {} : { Origin: requestOrigin }),
      ...(method === 'OPTIONS' ? {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
      } : { 'Content-Type': 'application/json' }),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  }))
  return { request, calls }
}

function assertCors(response, origin) {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
  assert.equal(response.headers.get('Vary'), 'Origin')
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type')
}

test('localhost preflight works with unset, production-only and multi-origin secrets', async () => {
  for (const origin of ['', production, ` ${production}/, ${secondary}, ${local} `]) {
    const f = fixture({ origin, signedIn: false })
    const response = await f.request(local)
    assert.equal(response.status, 204); assertCors(response, local)
    assert.equal(await response.text(), ''); assert.deepEqual(f.calls, [])
  }
})
test('existing production origins remain allowed and responses echo the caller only', async () => {
  const f = fixture({ origin: `${production}, ${secondary}` })
  const origins = [production, secondary, local, production]
  const responses = await Promise.all(origins.map((origin) => f.request(origin)))
  responses.forEach((response, index) => { assert.equal(response.status, 204); assertCors(response, origins[index]) })
})
test('unlisted origins, lookalikes, null and other localhost ports are rejected', async () => {
  const f = fixture()
  for (const origin of ['https://attacker.test', `${production}.attacker.test`, 'null', 'http://localhost:5173', 'http://127.0.0.1:5174']) {
    const response = await f.request(origin)
    assert.equal(response.status, 403); assertCors(response, null)
    assert.equal((await response.json()).error, 'Origin is not allowed.')
  }
  assert.deepEqual(f.calls, [])
})
test('wildcard and malformed configuration do not broaden the allowlist', () => {
  assert.deepEqual([...parseAdminOrigins('*, null, https://*.example.com, https://user:pass@example.com, https://example.com/path, https://example.com/?x=y')], [local])
})
test('allowed-origin POST success includes CORS and still checks admin authorization', async () => {
  const f = fixture(); const response = await f.request(local, 'POST')
  assert.equal(response.status, 200); assertCors(response, local)
  assert.deepEqual(f.calls.slice(0, 2), ['auth', 'quiz_generation_require_admin'])
})
test('authentication, authorization, validation and service errors include matching CORS', async () => {
  for (const [options, body, expected] of [
    [{ signedIn: false }, { action: 'recent' }, 401],
    [{ admin: false }, { action: 'recent' }, 403],
    [{}, { action: 'unknown' }, 400],
    [{ dbError: true }, { action: 'recent' }, 503],
  ]) {
    const response = await fixture(options).request(production, 'POST', body)
    assert.equal(response.status, expected); assertCors(response, production)
  }
})
test('unsupported methods have CORS; requests without Origin still need authentication', async () => {
  const response = await fixture().request(local, 'GET')
  assert.equal(response.status, 405); assertCors(response, local)
  const noOrigin = await fixture({ signedIn: false }).request(null, 'POST')
  assert.equal(noOrigin.status, 401); assertCors(noOrigin, null)
})

test('unexpected server errors also preserve matching CORS headers', async (t) => {
  t.mock.method(console, 'error', () => {})
  const response = await fixture({ dbError: 'unexpected' }).request(local, 'POST')
  assert.equal(response.status, 500); assertCors(response, local)
  assert.doesNotMatch(await response.text(), /Unexpected database error/)
})
