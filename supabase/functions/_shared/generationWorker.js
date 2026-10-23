import { GenerationError, requireUuid } from './quizValidation.js'
import { readLimitedJson, isMissingSetup, SETUP_MESSAGE } from './generationHandler.js'

// No document content crosses the worker API: it is loaded privately through
// RPCs and returned only to the server-side model call, never to n8n/browser.
export function createGenerationWorker({ secret, rpc, ai, dispatch }) {
  return async (request) => {
    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)
    if (!secret || request.headers.get('X-Quiz-Worker-Secret') !== secret) return respond({ error: 'Worker authentication required.' }, 401)
    let jobId; let stepStarted = false
    try {
      const body = await readLimitedJson(request, 4096)
      if (body.action === 'sweep') {
        const pending = await rpc('quiz_generation_pending')
        for (const id of pending) {
          if (await rpc('quiz_generation_dispatch', { p_job: id })) {
            try { await dispatch(id) } catch { /* next scheduled run retries */ }
          }
        }
        return respond({ ok: true })
      }
      jobId = requireUuid(body.job_id)
      if (body.action === 'claim') {
        const claim = await rpc('quiz_generation_claim', { p_job: jobId, p_execution: body.execution_id })
        return respond(claim || { job_id: jobId, claimed: false })
      }
      if (body.action === 'fail') {
        await rpc('quiz_generation_fail_worker', { p_job: jobId, p_execution: body.execution_id })
        return respond({ job_id: jobId, ok: true })
      }
      const token = requireUuid(body.token)
      const step = body.action
      if (!['structuring', 'generating', 'validating', 'publishing'].includes(step)) throw new GenerationError('Unknown processing stage.')
      // Publication itself is transactional and idempotent, including lost replies.
      if (step === 'publishing') return respond(await rpc('quiz_generation_publish', { p_job: jobId, p_token: token }))
      const job = await rpc('quiz_generation_begin_step', { p_job: jobId, p_token: token, p_step: step })
      stepStarted = true
      if (step === 'validating') {
        const result = await ai.validate(job)
        await rpc('quiz_generation_stage', { p_job: jobId, p_token: token, p_questions: result.questions, p_review: result.review })
      } else {
        const result = step === 'structuring' ? await ai.structure(job) : await ai.generate(job)
        await rpc('quiz_generation_commit_step', { p_job: jobId, p_token: token, p_step: step, p_result: result })
      }
      return respond({ job_id: jobId, token, ok: true })
    } catch (error) {
      // Do not let invalid/duplicate tokens fail another worker's valid job.
      if (jobId && stepStarted) {
        try { await rpc('quiz_generation_fail', { p_job: jobId, p_reason: error instanceof GenerationError ? error.message : 'AI processing or database save failed. No questions were published.' }) } catch { /* cron still expires and clears text */ }
      }
      const message = isMissingSetup(error) ? SETUP_MESSAGE : error instanceof GenerationError ? error.message : 'Worker operation failed. Check configuration; no partial bank was published.'
      return respond({ error: message, job_id: jobId }, error instanceof GenerationError ? error.status : 500)
    }
  }
}
