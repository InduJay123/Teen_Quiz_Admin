import { createClient } from 'npm:@supabase/supabase-js@2.55.0'
import { generationDatabase } from '../_shared/generationDatabase.js'
import { createGenerationWorker } from '../_shared/generationWorker.js'
import { createQuizAi } from '../_shared/quizAi.js'

const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const model = Deno.env.get('QUIZ_OPENAI_MODEL') || ''
const key = Deno.env.get('OPENAI_API_KEY') || ''
const ai = createQuizAi({ key, model, reviewModel: Deno.env.get('QUIZ_OPENAI_REVIEW_MODEL') || model })
Deno.serve(createGenerationWorker({
  // This credential is never supplied to React. AI configuration is checked
  // separately so expiry/redispatch still works during a model outage.
  secret: Deno.env.get('QUIZ_WORKER_SECRET') || '',
  rpc: generationDatabase(service).rpc,
  ai,
  dispatch: async (jobId: string) => {
    const url = Deno.env.get('QUIZ_N8N_WEBHOOK_URL') || ''
    if (!url.startsWith('https://')) throw new Error('HTTPS webhook required')
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Quiz-Webhook-Secret': Deno.env.get('QUIZ_N8N_WEBHOOK_SECRET') || '' },
      body: JSON.stringify({ job_id: jobId }),
    })
    await response.body?.cancel()
    if (!response.ok) throw new Error('Dispatch failed')
  },
}))
