import { GenerationError, requireUuid, validateExtractedText, validateUploadSize } from './quizValidation.js'
import { parseAdminOrigins, corsHeaders } from './cors.js'

export const MAX_REQUEST_BYTES = 768 * 1024
export const isMissingSetup = (error) => ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)
export const SETUP_MESSAGE = 'Generator database setup is not installed. Apply the text-only generation migrations and reload the Supabase schema cache. Existing sessions are still available.'

export async function readLimitedJson(request, maxBytes = MAX_REQUEST_BYTES) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new GenerationError('Lesson request exceeds the allowed size.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new GenerationError('Request body is required.')
  const chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new GenerationError('Lesson request exceeds the allowed size.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const buffer = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch { throw new GenerationError('Invalid JSON request.') }
}

export function createGenerationHandler({ authenticate, db, dispatch, origin, configured }) {
  const allowedOrigins = parseAdminOrigins(origin)
  async function owned(id, user) {
    requireUuid(id)
    const job = await db.getJob(id)
    if (!job || job.administrator_id !== user.id) throw new GenerationError('Job not found.', 404)
    return job
  }
  async function dispatchJob(job) {
    if (!configured || job.status !== 'extracting') return
    if (await db.rpc('quiz_generation_dispatch', { p_job: job.job_id })) {
      try { await dispatch(job.job_id) } catch { /* Ambiguous timeout: durable lease permits safe retry. */ }
    }
  }
  return async (request) => {
    const origin = request.headers.get('origin')
    const headers = corsHeaders(origin, allowedOrigins)
    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers })
    if (origin !== null && !allowedOrigins.has(origin)) return respond({ error: 'Origin is not allowed.' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)
    try {
      const user = await authenticate(request.headers.get('authorization'))
      if (!user) throw new GenerationError('Sign in to continue.', 401)
      await db.requireAdmin(user.id)
      const body = await readLimitedJson(request)
      if (body.action === 'choices') {
        const result = await db.loadChoices()
        if (!configured) result.configuration = { ...result.configuration, enabled: false,
          reason: result.configuration.reason || 'Generator server secrets are not configured.' }
        return respond(result)
      }
      try { await db.rpc('quiz_generation_expire') } catch (error) {
        if (body.action === 'recent' && isMissingSetup(error)) return respond(null)
        throw error
      }
      switch (body.action) {
        case 'submit': {
          if (!configured) throw new GenerationError('Generator server secrets are not configured.', 503)
          requireUuid(body.bank_id); requireUuid(body.request_id)
          validateUploadSize(body.file_bytes)
          if (!Number.isInteger(body.page_count) || body.page_count < 1 || body.page_count > 200) throw new GenerationError('Invalid PDF page count.')
          const text = validateExtractedText(body.source_text)
          const job = await db.rpc('quiz_generation_submit', { p_admin: user.id, p_bank: body.bank_id,
            p_request: body.request_id, p_text: text, p_file_bytes: body.file_bytes, p_pages: body.page_count })
          await dispatchJob(job)
          return respond(await db.rpc('quiz_generation_public_job', { p_job: job.job_id }), 202)
        }
        case 'status': {
          const job = await owned(body.job_id, user)
          await dispatchJob(job)
          return respond(await db.rpc('quiz_generation_public_job', { p_job: job.job_id }))
        }
        case 'recent': {
          const job = await db.latestJob(user.id)
          if (!job) return respond(null)
          await dispatchJob(job)
          return respond(await db.rpc('quiz_generation_public_job', { p_job: job.job_id }))
        }
        default: throw new GenerationError('Unknown action.')
      }
    } catch (error) {
      if (isMissingSetup(error)) return respond({ error: SETUP_MESSAGE, code: 'GENERATOR_SETUP_REQUIRED' }, 503)
      if (error instanceof GenerationError) return respond({ error: error.message }, error.status)
      console.error('quiz-generation request failed', { code: error.code || 'internal' })
      return respond({ error: 'Generation service could not complete this request. Check server configuration and try again.' }, 500)
    }
  }
}

