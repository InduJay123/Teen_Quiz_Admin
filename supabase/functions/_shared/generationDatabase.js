import { GenerationError, MAX_PDF_BYTES } from './quizValidation.js'
import { isMissingSetup, SETUP_MESSAGE } from './generationHandler.js'

export function generationDatabase(service) {
  async function rpc(name, args = {}) {
    const { data, error } = await service.rpc(name, args)
    if (error) {
      if (error.code === '42501') throw new GenerationError('Active administrator access required.', 403)
      if (error.code === 'P0001' && error.message.startsWith('GEN:')) throw new GenerationError(error.message.slice(4), 409)
      throw error
    }
    return data
  }
  async function count(table, bankId) {
    const { count, error } = await service.from(table).select('id', { count: 'exact', head: true }).eq('batch_id', bankId)
    if (error) throw error
    return count
  }
  return {
    rpc,
    async requireAdmin(id) {
      const { data, error } = await service.from('admin_users').select('user_id').eq('user_id', id).eq('is_active', true).maybeSingle()
      if (error) throw error
      if (!data) throw new GenerationError('Active administrator access required.', 403)
    },
    async loadChoices() {
      const batches = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await service.from('quiz_batches').select('id,module_name,session_name,session_date,status').order('id').range(from, from + 999)
        if (error) throw error
        batches.push(...data)
        if (data.length < 1000) break
      }
      let configuration = { enabled: false, max_pdf_bytes: MAX_PDF_BYTES, reason: SETUP_MESSAGE }
      let eligibility = {}
      try {
        configuration = await rpc('quiz_generation_readiness')
        eligibility = await rpc('quiz_generation_eligibility')
      } catch (error) {
        configuration = { ...configuration, enabled: false, reason: isMissingSetup(error) ? SETUP_MESSAGE : 'Generator readiness could not be verified. Sessions remain visible; processing is disabled.' }
      }
      const sessions = []
      for (let i = 0; i < batches.length; i += 10) {
        sessions.push(...await Promise.all(batches.slice(i, i + 10).map(async (batch) => {
          let reason = eligibility[batch.id]?.reason || 'Requires exclusive automatic-generator reservation.'
          let safe = false
          try {
            const [questions, attempts] = await Promise.all([count('quiz_bank_questions', batch.id), count('quiz_attempts', batch.id)])
            if (questions || attempts || batch.status === 'completed') reason = 'Already in use: completed bank, saved questions or student attempts.'
            else { safe = eligibility[batch.id]?.eligible === true; if (safe) reason = null }
          } catch { reason = 'Question/attempt safety checks are unavailable.' }
          return { bank_id: batch.id, module_name: batch.module_name, module_title: batch.module_name,
            session_name: batch.session_name, session_date: batch.session_date, status: batch.status, eligible: safe, unavailable_reason: reason }
        })))
      }
      return { configuration, sessions }
    },
    async getJob(id) {
      const { data, error } = await service.from('quiz_generation_jobs').select('job_id,administrator_id,status').eq('job_id', id).maybeSingle()
      if (error) throw error
      return data
    },
    async latestJob(admin) {
      const { data, error } = await service.from('quiz_generation_jobs').select('job_id,administrator_id,status').eq('administrator_id', admin)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  }
}
