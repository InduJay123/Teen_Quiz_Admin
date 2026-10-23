import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import {
  validatePdfDocument, validatePdfEnvelope, validateExtractedText, validateLessonPlan,
  validateQuestionSet, validateQuestion, isConfirmedPublication, RUNTIME_QUIZ_SIZE,
} from '../supabase/functions/_shared/quizValidation.js'
import { uploadAndProcess } from '../src/lib/quizGeneration.js'

const source = 'A business budget records expected income and expenditure to help a business plan its resources.'
function questions() {
  return Array.from({ length: 30 }, (_, index) => ({
    question_text: `What does lesson example ${index} illustrate about budgeting?`,
    option_a: 'Planning income and expenditure', option_b: 'Ignoring all costs', option_c: 'Removing records', option_d: 'Guaranteeing profits',
    correct_option: 'A', topic: 'Budgeting', difficulty: index < 12 ? 'easy' : index < 24 ? 'medium' : 'hard',
    source_quote: source, embedding: Array.from({ length: 1536 }, (_, dimension) => dimension === index ? 1 : 0),
  }))
}

test('valid PDF is parsed; runtime stays at ten', async () => {
  const document = await PDFDocument.create(); document.addPage().drawText(source)
  assert.equal((await validatePdfDocument(await document.save(), PDFDocument)).page_count, 1)
  assert.equal(RUNTIME_QUIZ_SIZE, 10)
})
test('empty, spoofed, truncated and corrupt PDF uploads are rejected', async () => {
  for (const content of ['', '<html>fake.pdf</html>', '%PDF-1.7 junk', '%PDF-1.7 junk %%EOF']) {
    await assert.rejects(validatePdfDocument(new TextEncoder().encode(content), PDFDocument))
  }
  assert.throws(() => validatePdfEnvelope(new Uint8Array(20), 10), /exceeds/)
})
test('encrypted parser response fails explicitly', async () => {
  await assert.rejects(validatePdfDocument(new TextEncoder().encode('%PDF-1.7 encrypted %%EOF'), {
    load: async () => { throw new Error('Input document is encrypted') },
  }), /Encrypted PDFs/)
})
test('scanned, unreadable and oversized extracted content fails safely', () => {
  assert.throws(() => validateExtractedText(''), /OCR/)
  assert.throws(() => validateExtractedText('\uFFFD'.repeat(300)), /unreadable/)
  assert.throws(() => validateExtractedText('a'.repeat(120001)), /processing limit/)
  assert.equal(validateExtractedText(source.repeat(4)), source.repeat(4))
})
test('lesson validation uses trusted module/session/schedule and targets', () => {
  const session = { module_name: 'Finance', session_name: 'Session 1', session_date: '2026-10-24' }
  const lesson = validateLessonPlan({ module_name: 'AI invention', bank_size: 50, lesson_plan: {
    learning_objectives: ['Understand budgeting'], blocks: [{ topic: 'Budget', content: source, examples: [] }],
    checkpoint_quiz: { focus_questions: ['What is a budget?'] },
  } }, session)
  assert.equal(lesson.module_name, 'Finance'); assert.equal(lesson.session_date, session.session_date)
  assert.equal(lesson.bank_size, 30); assert.equal(lesson.runtime_quiz_size, 10)
  assert.throws(() => validateLessonPlan({}, session), /Invalid lesson/)
})
test('exact count and 12/12/6 distribution are validated', () => {
  assert.deepEqual(validateQuestionSet(questions(), source).distribution, { easy: 12, medium: 12, hard: 6 })
  assert.throws(() => validateQuestionSet(questions().slice(1), source), /Exactly 30/)
  const wrong = questions(); wrong[0].difficulty = 'hard'
  assert.throws(() => validateQuestionSet(wrong, source), /distribution/)
})
test('correct answer, distinct options, metadata and source evidence are required', () => {
  const base = questions()[0]
  for (const patch of [{ correct_option: 'A,B' }, { topic: '' }, { option_b: base.option_a }, { difficulty: 'advanced' }, { source_quote: 'Invented evidence absent from the uploaded PDF.' }]) {
    assert.throws(() => validateQuestion({ ...base, ...patch }, source))
  }
})
test('exact and embedding-near duplicates are rejected', () => {
  const exact = questions(); exact[1].question_text = exact[0].question_text.toUpperCase()
  assert.throws(() => validateQuestionSet(exact, source), /Duplicate/)
  const semantic = questions(); semantic[1].embedding = semantic[0].embedding
  assert.throws(() => validateQuestionSet(semantic, source), /Semantically duplicate/)
  const invalid = questions(); invalid[0].embedding = [NaN]
  assert.throws(() => validateQuestionSet(invalid, source), /embedding/)
})
test('neither webhook acceptance nor failed generation is publication success', () => {
  const confirmed = { status: 'completed', actual_question_count: 30, published_question_count: 30, completed_at: '2026-10-22', publication_id: 'receipt' }
  assert.equal(isConfirmedPublication(confirmed), true)
  for (const incomplete of [{ status: 'completed' }, { ...confirmed, status: 'failed' }, { ...confirmed, publication_id: null }, { ...confirmed, published_question_count: 29 }]) {
    assert.equal(isConfirmedPublication(incomplete), false)
  }
})
test('one submission extracts locally then submits text, never the PDF', async () => {
  const calls = []; const job = { job_id: 'test', status: 'extracting' }
  const api = {
    submitGenerationText: async (payload) => { calls.push('submit'); assert.equal(payload.sourceText, source); assert.ok(!('file' in payload)); return job },
  }
  const result = await uploadAndProcess({ file: { size: 20 }, bankId: 'bank', requestId: 'key', api, onJob: () => {}, onStatus: () => {},
    extract: async () => { calls.push('extract'); return { text: source, pageCount: 1 } } })
  assert.deepEqual(calls, ['extract', 'submit']); assert.equal(result.status, 'extracting')
})
