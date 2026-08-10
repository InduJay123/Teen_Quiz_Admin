import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listAttempts, listModules } from '../lib/adminApi.js'
import { formatDate, titleFromKey } from '../lib/format.js'
import PageHeader from '../components/PageHeader.jsx'
import ScoreBadge from '../components/ScoreBadge.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'

export default function AttemptsPage() {
  const [search, setSearch] = useState(''); const [module, setModule] = useState(''); const [data, setData] = useState(null); const [modules, setModules] = useState([]); const [error, setError] = useState(null)
  const load = useCallback(async () => { try { setError(null); const [a, m] = await Promise.all([listAttempts({ search, module, limit: 100 }), listModules()]); setData(a); setModules(m) } catch (e) { setError(e) } }, [search, module])
  useEffect(() => { const t = setTimeout(load, 220); return () => clearTimeout(t) }, [load])
  return <div className="page-stack"><PageHeader eyebrow="Attempts" title="Quiz Attempt History" description="Filter attempts and open any attempt to inspect each answer." actions={<div className="filter-row"><input className="search-input" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search student…"/><select className="filter-select" value={module} onChange={(e)=>setModule(e.target.value)}><option value="">All modules</option>{modules.map((m)=><option key={m.module_name} value={m.module_name}>{m.module_title || titleFromKey(m.module_name)}</option>)}</select></div>} />
    {error ? <ErrorPanel error={error} retry={load}/> : !data ? <LoadingPanel/> : <section className="panel-card"><div className="section-heading"><div><h2>{data.total || 0} attempts</h2></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Student</th><th>Module</th><th>Session</th><th>Score</th><th>Correct</th><th>Status</th><th>Date</th><th/></tr></thead><tbody>{(data.rows||[]).map((a)=><tr key={a.id}><td><Link className="strong-link" to={`/students/${a.student_id}`}>{a.username || 'Student'}</Link></td><td>{a.module_title || titleFromKey(a.module_name)}</td><td>{a.session_name || '—'}</td><td><ScoreBadge score={a.score}/></td><td>{a.correct_count ?? '—'} / {a.total_questions ?? 10}</td><td><span className={`status-pill status-${a.status || 'completed'}`}>{a.status || 'completed'}</span></td><td>{formatDate(a.created_at)}</td><td><Link className="table-action" to={`/attempts/${a.id}`}>Review</Link></td></tr>)}</tbody></table></div></section>}
  </div>
}
