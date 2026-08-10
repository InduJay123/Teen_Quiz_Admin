import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAttempt } from '../lib/adminApi.js'
import { formatDate, percent, titleFromKey } from '../lib/format.js'
import PageHeader from '../components/PageHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import ScoreBadge from '../components/ScoreBadge.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'

function optionText(q, key) {
  return q?.[`option_${String(key || '').toLowerCase()}`] || 'Not answered'
}

export default function AttemptDetailsPage() {
  const { attemptId } = useParams(); const [data, setData] = useState(null); const [error, setError] = useState(null); const [filter, setFilter] = useState('all')
  const load = useCallback(async () => { try { setError(null); setData(await getAttempt(attemptId)) } catch(e) { setError(e) } }, [attemptId])
  useEffect(() => { load() }, [load])
  const questions = useMemo(() => (data?.questions || []).filter((q) => filter === 'all' || (filter === 'correct' ? q.is_correct : !q.is_correct)), [data, filter])
  if (error) return <ErrorPanel error={error} retry={load}/>
  if (!data) return <LoadingPanel text="Loading answer review…" />
  const a = data.attempt || {}
  const total = Number(a.total_questions || data.questions?.length || 0); const correct = Number(a.correct_count ?? data.questions?.filter((q)=>q.is_correct).length ?? 0)
  return <div className="page-stack">
    <PageHeader eyebrow="Answer review" title={`${a.username || 'Student'} · ${a.session_name || 'Quiz'}`} description={`${a.module_title || titleFromKey(a.module_name)} · ${formatDate(a.created_at || a.completed_at)}`} actions={<Link className="secondary-button" to="/attempts">← Attempts</Link>} />
    <div className="attempt-summary-card panel-card"><div className="attempt-score-circle"><strong>{Math.round(Number(a.score || 0))}%</strong><span>score</span></div><div className="attempt-summary-copy"><span className="eyebrow">Result</span><h2>{correct} of {total} correct</h2><p>Inspect every selected option next to the correct answer.</p></div><ScoreBadge score={a.score}/></div>
    <div className="admin-stat-grid compact-stats"><StatCard label="Correct" value={correct} tone="green"/><StatCard label="Incorrect" value={Math.max(0,total-correct)} tone="red"/><StatCard label="Questions" value={total} tone="blue"/><StatCard label="Score" value={percent(a.score)} tone="yellow"/></div>
    <section className="panel-card"><div className="section-heading"><div className="segmented"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>All</button><button className={filter==='correct'?'active':''} onClick={()=>setFilter('correct')}>Correct</button><button className={filter==='wrong'?'active':''} onClick={()=>setFilter('wrong')}>Incorrect</button></div></div>
      <div className="answer-review-list">{questions.map((q, i) => <article className={`answer-review-card ${q.is_correct ? 'is-correct' : 'is-wrong'}`} key={q.question_id || `${q.question_number}-${i}`}><div className="answer-review-top"><div className="question-number">{String(q.question_number || i+1).padStart(2,'0')}</div><div className="answer-question"><div className="question-meta"><span>{q.topic || 'General'}</span><span>{q.difficulty || '—'}</span></div><h3>{q.question_text}</h3></div><span className={`answer-result ${q.is_correct?'correct':'wrong'}`}>{q.is_correct ? 'Correct' : 'Incorrect'}</span></div><div className="answer-comparison"><div className={`answer-box ${q.is_correct ? 'answer-box--correct' : 'answer-box--wrong'}`}><span>Student answer</span><strong><b>{q.selected_option || '—'}</b>{optionText(q, q.selected_option)}</strong></div><div className="answer-box answer-box--correct"><span>Correct answer</span><strong><b>{q.correct_option}</b>{optionText(q, q.correct_option)}</strong></div></div></article>)}</div>
    </section>
  </div>
}
