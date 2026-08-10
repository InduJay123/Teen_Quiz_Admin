import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getModule } from '../lib/adminApi.js'
import { percent, titleFromKey } from '../lib/format.js'
import PageHeader from '../components/PageHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import ScoreBadge from '../components/ScoreBadge.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'

export default function ModuleDetailsPage() {
  const { moduleName } = useParams(); const decoded = decodeURIComponent(moduleName)
  const [data, setData] = useState(null); const [error, setError] = useState(null)
  const load = useCallback(async () => { try { setError(null); setData(await getModule(decoded)) } catch (e) { setError(e) } }, [decoded])
  useEffect(() => { load() }, [load])
  if (error) return <ErrorPanel error={error} retry={load} />
  if (!data) return <LoadingPanel text="Loading module analytics…" />
  const m = data.module || {}
  return <div className="page-stack">
    <PageHeader eyebrow="Module analytics" title={m.module_title || titleFromKey(decoded)} description="Session-level participation and questions students find most difficult." actions={<Link className="secondary-button" to="/modules">← Modules</Link>} />
    <div className="admin-stat-grid">
      <StatCard label="Sessions" value={m.session_count || data.sessions?.length || 0} />
      <StatCard label="Students attempted" value={m.students_attempted || 0} tone="blue" />
      <StatCard label="Total attempts" value={m.total_attempts || 0} tone="yellow" />
      <StatCard label="Average score" value={percent(m.average_score)} tone="green" />
    </div>
    <section className="panel-card"><div className="section-heading"><div><span className="eyebrow">Sessions</span><h2>Session performance</h2></div></div><div className="session-analytics-grid">{(data.sessions || []).map((s) => <div className="session-analytic-card" key={s.batch_id}><div><span className="pill">{s.session_name || 'Session'}</span><h3>{s.session_title || s.session_name}</h3><p>{s.session_date || 'No date'}</p></div><ScoreBadge score={s.average_score} /><div className="mini-stats"><div><span>Students</span><strong>{s.students_attempted || 0}</strong></div><div><span>Attempts</span><strong>{s.total_attempts || 0}</strong></div></div></div>)}</div></section>
    <section className="panel-card"><div className="section-heading"><div><span className="eyebrow">Question insight</span><h2>Most missed questions</h2></div></div><div className="question-insight-list">{(data.hardest_questions || []).map((q, i) => <div className="question-insight" key={`${q.question_text}-${i}`}><div className="question-insight__rank">{i + 1}</div><div><strong>{q.question_text}</strong><span>{q.topic || 'General'} · {q.difficulty || '—'} · {q.incorrect_count || 0} incorrect of {q.attempts || 0}</span></div><span className="miss-rate">{percent(q.incorrect_rate)} missed</span></div>)}</div></section>
  </div>
}
