import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listModules } from '../lib/adminApi.js'
import { formatDate, titleFromKey } from '../lib/format.js'
import PageHeader from '../components/PageHeader.jsx'
import ScoreBadge from '../components/ScoreBadge.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'

export default function ModulesPage() {
  const [data, setData] = useState(null); const [error, setError] = useState(null)
  const load = useCallback(async () => { try { setError(null); setData(await listModules()) } catch (e) { setError(e) } }, [])
  useEffect(() => { load() }, [load])
  if (error) return <ErrorPanel error={error} retry={load} />
  if (!data) return <LoadingPanel text="Loading modules…" />
  return <div className="page-stack">
    <PageHeader eyebrow="Modules" title="Module Analytics" description="Compare attempts, participation and average scores across the Teen Master of Business modules." />
    <div className="module-overview-grid">{data.map((m, i) => <Link className="module-overview-card" to={`/modules/${encodeURIComponent(m.module_name)}`} key={m.module_name}>
      <div className="module-number">{String(i + 1).padStart(2,'0')}</div>
      <div className="module-overview-title"><span>{m.session_count || 0} sessions</span><h2>{m.module_title || titleFromKey(m.module_name)}</h2></div>
      <div className="module-overview-score"><ScoreBadge score={m.average_score} /><span>average</span></div>
      <div className="mini-stats module-card-stats"><div><span>Students</span><strong>{m.students_attempted || 0}</strong></div><div><span>Attempts</span><strong>{m.total_attempts || 0}</strong></div><div><span>Best</span><strong>{Math.round(Number(m.best_score || 0))}%</strong></div></div>
      <small>Latest activity {formatDate(m.latest_attempt_at)}</small>
    </Link>)}</div>
  </div>
}
