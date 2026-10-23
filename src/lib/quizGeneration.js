export { ACTIVE_STATUSES, isConfirmedPublication } from '../../supabase/functions/_shared/quizValidation.js'
export const PROGRESS_LABELS = {
  idle: 'Choose a session and select its lesson PDF.',
  uploading: 'Submitting lesson text...',
  extracting: 'Processing PDF...',
  structuring: 'Preparing Lesson Content...',
  generating: 'Generating Quiz Questions...',
  validating: 'Validating and Saving Questions...',
  publishing: 'Validating and Saving Questions...',
  completed: 'Quiz Generated Successfully',
  failed: 'Quiz Generation Failed',
}
export async function uploadAndProcess({ file, bankId, requestId, api, extract, onJob, onStatus }) {
  onStatus('extracting')
  const { text, pageCount } = await extract(file)
  onStatus('uploading')
  const job = await api.submitGenerationText({ bankId, requestId, sourceText: text, fileBytes: file.size, pageCount })
  onJob(job)
  return job
}

