import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDashboard } from '../lib/adminApi.js'
import { formatDate, percent, titleFromKey } from '../lib/format.js'
import PageHeader from '../components/PageHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import ScoreBadge from '../components/ScoreBadge.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'
import PerformanceOverview from "../components/dashboard/PerformanceOverview";
import { useNavigate } from "react-router-dom";

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try { setError(null); setData(await getDashboard()) } catch (e) { setError(e) }
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <ErrorPanel error={error} retry={load} />
  if (!data) return <LoadingPanel text="Loading dashboard…" />

  const maxBucket = Math.max(...(data.score_distribution || []).map((b) => Number(b.count || 0)), 1)

  return (
    <div className="page-stack">
      <div className="admin-stat-grid">
        <StatCard label="Students" value={data.total_students ?? 0} note="Registered student profiles" tone="violet" />
        <StatCard label="Quiz attempts" value={data.total_attempts ?? 0} note={`${data.completed_attempts ?? 0} completed`} tone="blue" />
        <StatCard label="Average score" value={percent(data.average_score)} note="Across completed attempts" tone="green" />
        <StatCard label="Completion rate" value={percent(data.completion_rate)} note="Completed vs started" tone="yellow" />
      </div>

      <PerformanceOverview
        modules={data?.module_performance || []}
        distribution={data?.score_distribution || []}
        onViewModules={() => navigate("/modules")}
      />

      <section className="panel-card">
        <div className="section-heading"><div><span className="eyebrow">Latest activity</span><h2>Recent attempts</h2></div><Link to="/attempts">All attempts →</Link></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Student</th><th>Module</th><th>Session</th><th>Score</th><th>Questions</th><th>Date</th><th /></tr></thead>
            <tbody>
              {(data.recent_attempts || []).map((a) => (
                <tr key={a.id}>
                  <td><Link className="strong-link" to={`/students/${a.student_id}`}>{a.username || 'Student'}</Link></td>
                  <td>{a.module_title || titleFromKey(a.module_name)}</td>
                  <td>{a.session_name || '—'}</td>
                  <td><ScoreBadge score={a.score} /></td>
                  <td>{a.correct_count ?? '—'} / {a.total_questions ?? 10}</td>
                  <td>{formatDate(a.created_at || a.completed_at)}</td>
                  <td><Link className="table-action" to={`/attempts/${a.id}`}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
