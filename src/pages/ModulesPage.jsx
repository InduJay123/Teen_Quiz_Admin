import { Link } from 'react-router-dom'
import { listCohortModules } from '../lib/adminApi.js'
import { titleFromKey } from '../lib/format.js'
import useResource from '../lib/useResource.js'
import PageHeader from '../components/PageHeader.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'
import EmptyState from '../components/EmptyState.jsx'
export default function ModulesPage() {
  const {data,error,retry}=useResource('modules',listCohortModules)
  if(error)return <ErrorPanel error={error} retry={retry}/>
  if(!data)return <LoadingPanel text="Loading modules…"/>
  return <div className="page-stack"><PageHeader eyebrow="Modules" title="Modules by Cohort" description="Open a module, then select a cohort to view its sessions, students and quiz results."/>
    {!data.length&&<EmptyState title="No modules available"/>}<div className="module-overview-grid">{data.map((m,i)=><Link className="module-overview-card" to={`/modules/${encodeURIComponent(m.module_name)}`} key={m.module_name}><div className="module-number">{String(i+1).padStart(2,'0')}</div><div className="module-overview-title"><span>{m.session_count||0} sessions</span><h2>{m.module_title||titleFromKey(m.module_name)}</h2></div><div className="mini-stats module-card-stats"><div><span>Cohorts</span><strong>{m.cohort_count??'—'}</strong></div><div><span>Questions</span><strong>{m.question_count??'—'}</strong></div><div><span>Status</span><strong>{m.status||'—'}</strong></div></div><small>View cohorts →</small></Link>)}</div></div>
}
