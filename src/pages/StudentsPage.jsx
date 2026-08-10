import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listStudents } from '../lib/adminApi.js'
import { formatDate, percent } from '../lib/format.js'
import PageHeader from '../components/PageHeader.jsx'
import ScoreBadge from '../components/ScoreBadge.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'
import EmptyState from '../components/EmptyState.jsx'

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try { setError(null); setResult(await listStudents({ search, limit: 100, offset: 0 })) } catch (e) { setError(e) }
  }, [search])
  useEffect(() => { const t = setTimeout(load, 220); return () => clearTimeout(t) }, [load])

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Students" title="Student Performance" description="Open a student to review their module-by-module progress and every quiz attempt." actions={<input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username…" />} />
      {error ? <ErrorPanel error={error} retry={load} /> : !result ? <LoadingPanel /> : (
        <section className="panel-card">
          <div className="section-heading"><div><span className="eyebrow">Directory</span><h2>{result.total || 0} students</h2></div></div>
          {!result.rows?.length ? <EmptyState title="No students found" message="Try a different search term." /> : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Student</th><th>Age</th><th>Phone</th><th>Attempts</th><th>Average</th><th>Best</th><th>Latest attempt</th><th /></tr></thead>
              <tbody>{result.rows.map((s) => <tr key={s.id}>
                <td><div className="student-cell"><div className="avatar avatar--small">{String(s.username || 'S').slice(0,1).toUpperCase()}</div><div><strong>{s.username || 'Student'}</strong><span>{s.id?.slice(0,8)}</span></div></div></td>
                <td>{s.age ?? '—'}</td><td>{s.phone || '—'}</td><td>{s.attempts || 0}</td><td><ScoreBadge score={s.average_score} /></td><td>{percent(s.best_score)}</td><td>{formatDate(s.latest_attempt_at)}</td><td><Link className="table-action" to={`/students/${s.id}`}>Open</Link></td>
              </tr>)}</tbody>
            </table></div>
          )}
        </section>
      )}
    </div>
  )
}
