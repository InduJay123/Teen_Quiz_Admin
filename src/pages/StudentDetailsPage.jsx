import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getStudent } from '../lib/adminApi.js'
import { formatDate, percent, titleFromKey } from '../lib/format.js'
import PageHeader from '../components/PageHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import ScoreBadge from '../components/ScoreBadge.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'

export default function StudentDetailsPage() {
  const { studentId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => { try { setError(null); setData(await getStudent(studentId)) } catch (e) { setError(e) } }, [studentId])
  useEffect(() => { load() }, [load])
  if (error) return <ErrorPanel error={error} retry={load} />
  if (!data) return <LoadingPanel text="Loading student…" />
  const s = data.profile || {}
  const summary = data.summary || s

  return <div className="page-stack">
    <PageHeader eyebrow="Student profile" title={s.username || 'Student'} description={`Age ${s.age ?? '—'} · ${s.phone || 'No phone'} · Student ID ${String(s.id || '').slice(0,8)}`} actions={<Link className="secondary-button" to="/students">← Students</Link>} />
    <div className="admin-stat-grid">
      <StatCard label="Total attempts" value={summary.attempts || 0} note={`${summary.completed_attempts || 0} completed`} />
      <StatCard label="Average score" value={percent(summary.average_score)} tone="blue" />
      <StatCard label="Best score" value={percent(summary.best_score)} tone="green" />
      <StatCard label="Last activity" value={summary.latest_attempt_at ? formatDate(summary.latest_attempt_at).split(',')[0] : '—'} tone="yellow" />
    </div>

    <section className="panel-card">
      <div className="section-heading"><div><span className="eyebrow">Modules</span><h2>Performance by module</h2></div></div>
      <div className="module-analytics-grid">{(data.module_stats || []).map((m) => <div className="module-analytic-card" key={m.module_name}>
        <div className="module-card-head"><div><span>{m.session_count || 0} sessions</span><h3>{m.module_title || titleFromKey(m.module_name)}</h3></div><ScoreBadge score={m.average_score} /></div>
        <div className="mini-stats"><div><span>Attempts</span><strong>{m.attempts || m.total_attempts || 0}</strong></div><div><span>Latest</span><strong>{percent(m.latest_score)}</strong></div><div><span>Best</span><strong>{percent(m.best_score)}</strong></div></div>
      </div>)}</div>
    </section>

    <section className="panel-card">
      <div className="section-heading"><div><span className="eyebrow">History</span><h2>Quiz attempts</h2></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Module</th><th>Session</th><th>Score</th><th>Correct</th><th>Status</th><th>Date</th><th /></tr></thead><tbody>
        {(data.attempts || []).map((a) => <tr key={a.id}><td>{a.module_title || titleFromKey(a.module_name)}</td><td>{a.session_name || '—'}</td><td><ScoreBadge score={a.score} /></td><td>{a.correct_count ?? '—'} / {a.total_questions ?? 10}</td><td><span className={`status-pill status-${a.status || 'completed'}`}>{a.status || 'completed'}</span></td><td>{formatDate(a.created_at)}</td><td><Link className="table-action" to={`/attempts/${a.id}`}>Answers</Link></td></tr>)}
      </tbody></table></div>
    </section>
  </div>
}
