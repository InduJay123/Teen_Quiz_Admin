import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/adminApi.js'
import { ACTIVE_STATUSES, isConfirmedPublication, PROGRESS_LABELS, uploadAndProcess } from '../lib/quizGeneration.js'
import PageHeader from '../components/PageHeader.jsx'
import '../styles/quiz-generator.css'

export default function QuizGeneratorPage() {
  const [choices, setChoices] = useState(null)
  const [module, setModule] = useState('')
  const [bankId, setBankId] = useState('')
  const [file, setFile] = useState(null)
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [localStatus, setLocalStatus] = useState('idle')
  const submitting = useRef(false)
  const requestId = useRef(null)
  const mounted = useRef(true)
  const fileInput = useRef(null)

  useEffect(() => {
    mounted.current = true
    let timer; let cancelled = false
    async function restore() {
      try {
        const options = await api.getGenerationChoices()
        if (cancelled) return
        setChoices(options); setLoading(false); setConnectionError('')
        const recent = await api.getRecentGenerationJob()
        if (cancelled) return
        setJob(recent)
        if (recent && ACTIVE_STATUSES.includes(recent.status)) {
          setModule(recent.session_context.module_name); setBankId(recent.bank_id)
        }
      } catch (e) {
        if (cancelled) return
        setConnectionError(e.message)
        timer = setTimeout(restore, 10000)
      }
    }
    restore()
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.includes(job.status)) return
    let cancelled = false; let timer
    async function poll() {
      try {
        const next = await api.getGenerationJob(job.job_id)
        if (cancelled) return
        setJob(next); setConnectionError('')
        if (!ACTIVE_STATUSES.includes(next.status)) {
          requestId.current = null
          const options = await api.getGenerationChoices()
          if (!cancelled) setChoices(options)
          return
        }
      } catch (e) { if (!cancelled) setConnectionError(e.message) }
      if (!cancelled) timer = setTimeout(poll, 4000)
    }
    timer = setTimeout(poll, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [job?.job_id, job?.status])

  const modules = useMemo(() => [...new Map((choices?.sessions || []).map((session) => [session.module_name, session.module_title])).entries()], [choices])
  const sessions = (choices?.sessions || []).filter((session) => session.module_name === module)
  const selected = sessions.find((session) => session.bank_id === bankId)
  const active = busy || ACTIVE_STATUSES.includes(job?.status)
  const status = busy ? localStatus : job?.status || localStatus
  const completed = isConfirmedPublication(job)
  const canProcess = !loading && !active && choices?.configuration?.enabled && selected?.eligible && file

  async function submit(event) {
    event.preventDefault()
    if (!canProcess || submitting.current) return
    submitting.current = true; setBusy(true); setJob(null); setError(''); setLocalStatus('extracting')
    if (!requestId.current) requestId.current = crypto.randomUUID()
    try {
      const { extractLessonPdf } = await import('../lib/pdfExtraction.js')
      await uploadAndProcess({ file, bankId, requestId: requestId.current, api,
        extract: (input) => extractLessonPdf(input, choices.configuration.max_pdf_bytes),
        onStatus: (next) => { if (mounted.current) setLocalStatus(next) }, onJob: (next) => {
        if (mounted.current) { setJob(next); setLocalStatus(next.status) }
      } })
      if (mounted.current) { setFile(null); if (fileInput.current) fileInput.current.value = '' }
    } catch (e) {
      if (mounted.current) { setError(e.message); setLocalStatus('idle') }
      // Recover reservations even if the prepare response was lost. The database
      // remains authoritative; a network error never means generation failed.
      try { const recent = await api.getRecentGenerationJob(); if (mounted.current && recent?.bank_id === bankId) setJob(recent) } catch { /* polling/reload can recover */ }
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <div className="page-stack">
    <PageHeader eyebrow="AI Quiz Generator" title="Create a quiz from a lesson PDF" description="The PDF is read in your browser. Only its extracted lesson text is submitted." />
    {connectionError && <div className="notice generator-warning" role="status">{connectionError} Checking again automatically.</div>}
    {choices && !choices.configuration.enabled && <div className="notice generator-warning" role="status">{choices.configuration.reason}</div>}
    <form className="panel-card generator-form" onSubmit={submit} aria-busy={active}>
      <div className="generator-fields">
        <label className="field-label"><span>Module</span><select className="filter-select" value={module} disabled={active || loading} onChange={(event) => {
          setModule(event.target.value); setBankId(''); requestId.current = null
        }} required><option value="">Select a module</option>{modules.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
        <label className="field-label"><span>Session</span><select className="filter-select" value={bankId} disabled={active || !module || loading} onChange={(event) => {
          setBankId(event.target.value); requestId.current = null
        }} required><option value="">Select a session</option>{sessions.map((session) => <option key={session.bank_id} value={session.bank_id}>
          {session.session_name}{session.session_date ? ` · ${session.session_date}` : ''}{session.eligible ? '' : ' · unavailable'}
        </option>)}</select></label>
      </div>
      {selected?.unavailable_reason && <p role="status" className="generator-warning">{selected.unavailable_reason}</p>}
      <label className="field-label generator-upload"><span id="lesson-pdf-label">Lesson PDF</span><input aria-labelledby="lesson-pdf-label" aria-describedby="lesson-pdf-help" ref={fileInput} type="file" accept="application/pdf,.pdf" disabled={active || loading} onChange={(event) => {
        setFile(event.target.files?.[0] || null); requestId.current = null; setError('')
      }} /><small id="lesson-pdf-help">Text-based PDF, up to {Math.floor((choices?.configuration?.max_pdf_bytes || 20971520) / 1024 / 1024)} MB. The PDF stays in your browser. Encrypted or scanned PDFs are not supported.</small></label>
      <div className="generator-footer"><p>12 easy · 12 medium · 6 hard<br /><small>Students receive 10 questions per attempt when their session unlocks.</small></p>
        <button type="submit" className="primary-button" disabled={!canProcess}>{active ? 'Processing...' : 'Upload & Process'}</button></div>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {(job || busy) && <section className={`panel-card generator-progress ${completed ? 'generator-completed' : ''}`} aria-live="polite" aria-atomic="true">
      <h2>{completed ? 'Quiz Generated Successfully' : status === 'completed' ? 'Publication confirmation is incomplete' : PROGRESS_LABELS[status]}</h2>
      {completed ? <p>30 questions generated and saved. Students will receive 10 questions per attempt when the session unlocks.</p>
        : job?.status === 'failed' ? <p role="alert">{job.error_reason || 'The generation job failed. No question bank was published.'}</p>
        : <><p>{job?.session_context?.module_name} {job?.session_context?.session_name}</p>
          <p>{job?.actual_question_count || 0} / 30 questions prepared.</p>
          <p>You may refresh this page. Processing status is saved securely.</p></>}
      {job && <small>Job reference: {job.job_id}</small>}
    </section>}
  </div>
}
