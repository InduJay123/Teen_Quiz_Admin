import { createClient } from 'npm:@supabase/supabase-js@2.55.0'
import { createGenerationHandler } from '../_shared/generationHandler.js'
import { generationDatabase } from '../_shared/generationDatabase.js'

const url = Deno.env.get('SUPABASE_URL')!
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options)
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, options)
const webhook = Deno.env.get('QUIZ_N8N_WEBHOOK_URL') || ''
const secret = Deno.env.get('QUIZ_N8N_WEBHOOK_SECRET') || ''
const origin = Deno.env.get('QUIZ_ADMIN_ORIGIN') || ''

Deno.serve(createGenerationHandler({
  origin,
  configured: Boolean(origin && secret && /^https:\/\//.test(webhook)),
  db: generationDatabase(service),
  authenticate: async (authorization: string | null) => {
    if (!authorization?.startsWith('Bearer ')) return null
    const { data, error } = await auth.auth.getUser(authorization.slice(7))
    return error ? null : data.user
  },
  dispatch: async (jobId: string) => {
    const response = await fetch(webhook, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Quiz-Webhook-Secret': secret },
      body: JSON.stringify({ job_id: jobId }),
    })
    await response.body?.cancel()
    if (!response.ok) throw new Error('Workflow dispatch was not acknowledged')
  },
}))

