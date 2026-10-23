export const QUESTION_COUNT = 30
export const RUNTIME_QUIZ_SIZE = 10
export const DISTRIBUTION = Object.freeze({ easy: 12, medium: 12, hard: 6 })
export const MAX_PDF_BYTES = 20 * 1024 * 1024
export const ACTIVE_STATUSES = ['uploading', 'extracting', 'structuring', 'generating', 'validating', 'publishing']
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class GenerationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export function requireUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new GenerationError('Invalid job or session identifier.')
  return value
}

export function validateUploadSize(size, maxBytes = MAX_PDF_BYTES) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new GenerationError('The PDF is empty.')
  if (size > maxBytes) throw new GenerationError(`The PDF exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB upload limit.`)
}

// Header checks are only an early rejection; the server must also parse the document.
export function validatePdfEnvelope(bytes, maxBytes = MAX_PDF_BYTES) {
  validateUploadSize(bytes.byteLength, maxBytes)
  const decoder = new TextDecoder('latin1')
  if (!/^%PDF-(1\.[0-7]|2\.0)/.test(decoder.decode(bytes.slice(0, 8)))) {
    throw new GenerationError('The uploaded file is not a supported PDF.')
  }
  if (!decoder.decode(bytes.slice(-4096)).includes('%%EOF')) throw new GenerationError('The PDF is corrupt or incomplete.')
}

export async function validatePdfDocument(bytes, PDFDocument, maxBytes = MAX_PDF_BYTES) {
  validatePdfEnvelope(bytes, maxBytes)
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false })
    if (pdf.isEncrypted) throw new Error('encrypted')
    if (pdf.getPageCount() < 1) throw new Error('empty')
    if (pdf.getPageCount() > 200) throw new Error('page_limit')
    return { page_count: pdf.getPageCount() }
  } catch (error) {
    if (/encrypt/i.test(error.message)) throw new GenerationError('Encrypted PDFs are not supported. Upload an unencrypted lesson PDF.')
    if (error.message === 'page_limit') throw new GenerationError('The PDF exceeds the 200-page processing limit.')
    throw new GenerationError('The PDF is empty, corrupt, or unsupported.')
  }
}

export function validateExtractedText(text) {
  if (typeof text === 'string' && (text.includes('\u0000') || new TextEncoder().encode(text).length > 480000)) throw new GenerationError('Lesson text contains invalid characters or exceeds the byte limit.')
  if (typeof text !== 'string' || text.replace(/\s/g, '').length < 200) {
    throw new GenerationError('PDF text could not be extracted. Scanned PDFs require OCR, which is not configured.')
  }
  if (text.length > 120000) throw new GenerationError('The lesson text exceeds the processing limit. Upload a shorter lesson PDF.')
  if ((text.match(/\uFFFD/g) || []).length > text.length * 0.01) throw new GenerationError('PDF text is unreadable.')
  return text.trim()
}

function nonEmpty(value, name, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new GenerationError(`Invalid ${name}.`)
  return value.trim()
}

function textList(value, name) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new GenerationError(`Invalid ${name}.`)
  return value.map((item) => nonEmpty(item, name))
}

// Trusted identifiers/schedule always overwrite model metadata. Blocks are a NEW
// contract pending inspection of the original Lesson Plan Sessions node.
export function validateLessonPlan(model, session) {
  const plan = model?.lesson_plan
  if (!plan || !Array.isArray(plan.blocks) || !plan.blocks.length || plan.blocks.length > 100) throw new GenerationError('Invalid lesson content.')
  return {
    module_name: session.module_name,
    session_name: session.session_name,
    session_date: session.session_date,
    target_audience: 'Teen Academy students',
    bank_size: QUESTION_COUNT,
    runtime_quiz_size: RUNTIME_QUIZ_SIZE,
    lesson_plan: {
      learning_objectives: textList(plan.learning_objectives, 'learning objectives'),
      blocks: plan.blocks.map((block) => ({
        topic: nonEmpty(block.topic, 'topic', 300),
        content: nonEmpty(block.content, 'block content', 12000),
        examples: Array.isArray(block.examples) ? block.examples.map((example) => nonEmpty(example, 'example')) : [],
      })),
      checkpoint_quiz: { focus_questions: textList(plan.checkpoint_quiz?.focus_questions, 'focus questions') },
    },
  }
}

export function normalizeQuestion(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function validateQuestion(question, sourceText) {
  const result = {}
  for (const field of ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'topic', 'source_quote']) {
    result[field] = nonEmpty(question?.[field], field, field === 'topic' ? 300 : 4000)
  }
  if (!['A', 'B', 'C', 'D'].includes(question.correct_option)) throw new GenerationError('Exactly one correct option (A, B, C, or D) is required.')
  if (!Object.hasOwn(DISTRIBUTION, question.difficulty)) throw new GenerationError('Invalid difficulty.')
  if (new Set(['a', 'b', 'c', 'd'].map((letter) => normalizeQuestion(result[`option_${letter}`]))).size !== 4) {
    throw new GenerationError('Answer options must be distinct.')
  }
  const normalizeSource = (text) => text.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!sourceText || result.source_quote.length < 20 || !normalizeSource(sourceText).includes(normalizeSource(result.source_quote))) {
    throw new GenerationError('Question source evidence is missing from the PDF.')
  }
  return { ...result, correct_option: question.correct_option, difficulty: question.difficulty }
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 1536 || b.length !== 1536 || ![...a, ...b].every(Number.isFinite)) {
    throw new GenerationError('Invalid text-embedding-3-small embedding.')
  }
  let dot = 0; let aa = 0; let bb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 }
  if (!aa || !bb) throw new GenerationError('Invalid zero embedding.')
  return dot / Math.sqrt(aa * bb)
}

export function validateQuestionSet(questions, sourceText, similarityThreshold = 0.88) {
  if (!Array.isArray(questions) || questions.length !== QUESTION_COUNT) throw new GenerationError('Exactly 30 valid questions are required.')
  const validated = questions.map((question) => validateQuestion(question, sourceText))
  const seen = new Set(); const counts = { easy: 0, medium: 0, hard: 0 }
  validated.forEach((question, index) => {
    const key = normalizeQuestion(question.question_text)
    if (seen.has(key)) throw new GenerationError('Duplicate questions were generated.')
    seen.add(key); counts[question.difficulty]++
    cosineSimilarity(questions[index].embedding, questions[index].embedding)
    for (let other = 0; other < index; other++) {
      if (cosineSimilarity(questions[index].embedding, questions[other].embedding) >= similarityThreshold) {
        throw new GenerationError('Semantically duplicate questions were generated.')
      }
    }
  })
  if (Object.keys(counts).some((key) => counts[key] !== DISTRIBUTION[key])) throw new GenerationError('Incorrect difficulty distribution: 12 easy, 12 medium, and 6 hard required.')
  return { questions: validated, count: QUESTION_COUNT, distribution: counts }
}

export function isConfirmedPublication(job) {
  return job?.status === 'completed' && job.actual_question_count === QUESTION_COUNT &&
    job.published_question_count === QUESTION_COUNT && Boolean(job.completed_at) && Boolean(job.publication_id)
}
