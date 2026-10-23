// Retain the existing QUIZ_ADMIN_ORIGIN secret, accepting either its original
// single value or a comma-separated list. Local Vite is explicitly allowed.
export function parseAdminOrigins(configuredOrigins = '') {
  const allowed = new Set(['http://localhost:5174'])
  for (const entry of configuredOrigins.split(',')) {
    const value = entry.trim()
    if (!value) continue
    try {
      const url = new URL(value)
      // Origins only: never wildcard, userinfo, paths, query strings or fragments.
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) continue
      allowed.add(url.origin)
    } catch { /* Invalid configuration must never broaden browser access. */ }
  }
  return allowed
}

export function corsHeaders(requestOrigin, allowedOrigins) {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...(allowedOrigins.has(requestOrigin) ? { 'Access-Control-Allow-Origin': requestOrigin } : {}),
  }
}
