import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getModuleCohorts, getModuleCohort } from '../lib/adminApi.js'
import { titleFromKey } from '../lib/format.js'
import useResource from '../lib/useResource.js'
import PageHeader from '../components/PageHeader.jsx'
import LoadingPanel from '../components/LoadingPanel.jsx'
import ErrorPanel from '../components/ErrorPanel.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { Overview, Sessions, Students, Attempts, Questions, AttemptReview } from '../components/CohortContent.jsx'
import '../styles/cohorts.css'

const tabs=[['overview','Overview'],['sessions','Sessions'],['students','Students'],['results','Quiz Results'],['attempts','Quiz Attempts']]
export default function ModuleDetailsPage() {
  const {moduleName}=useParams() // React Router already decodes route parameters.
  const [params,setParams]=useSearchParams()
  const resource=useResource(moduleName,()=>getModuleCohorts(moduleName)),selected=params.get('cohort')
  useEffect(()=>{if(!selected&&resource.data?.cohorts.length)setParams({cohort:String(resource.data.cohorts[0].id),tab:'overview'},{replace:true})},[selected,resource.data,setParams])
  if(resource.error)return <ErrorPanel error={resource.error} retry={resource.retry}/>
  if(!resource.data)return <LoadingPanel text="Loading module cohorts…"/>
  const cohort=resource.data.cohorts.find(c=>String(c.id)===selected)
  return <div className="page-stack"><nav className="cohort-breadcrumb" aria-label="Breadcrumb"><Link to="/dashboard">Dashboard</Link> / <Link to="/modules">Modules</Link> / {titleFromKey(moduleName)}{cohort&&` / ${cohort.display_name}`}</nav>
    <PageHeader eyebrow="Module analytics" title={titleFromKey(moduleName)} description="Select a student cohort to review its scheduled sessions, participation and results." actions={<Link className="secondary-button" to="/modules">← Modules</Link>}/>
    {!resource.data.cohorts.length?<EmptyState title="No cohorts assigned" message="This module has no cohort schedules yet."/>:<><div className="cohort-selector" aria-label="Available cohorts">{resource.data.cohorts.map(c=><button key={c.id} aria-pressed={c.id===cohort?.id} className={c.id===cohort?.id?'primary-button':'secondary-button'} onClick={()=>setParams({cohort:String(c.id),tab:'overview'})}>{c.display_name}</button>)}</div>{cohort?<CohortDetail key={`${moduleName}:${cohort.id}`} moduleName={moduleName} cohort={cohort} params={params} setParams={setParams}/>:<EmptyState title="Cohort unavailable" message="Select a cohort assigned to this module."/>}</>}
  </div>
}
function CohortDetail({moduleName,cohort,params,setParams}) {
  const scope={moduleName,cohortId:cohort.id},resource=useResource(JSON.stringify(scope),()=>getModuleCohort(moduleName,cohort.id))
  const patchParams=patch=>{const next=new URLSearchParams(params);Object.entries(patch).forEach(([key,value])=>value==null||value===''?next.delete(key):next.set(key,String(value)));return next}
  const update=patch=>setParams(patchParams(patch)),href=patch=>`?${patchParams(patch)}`
  if(resource.error)return <ErrorPanel error={resource.error} retry={resource.retry}/>
  if(!resource.data)return <LoadingPanel text={`Loading ${cohort.display_name}…`}/>
  const data=resource.data,tab=params.get('tab')||'overview',sessionId=params.get('session'),session=data.sessions.find(s=>s.batch_id===sessionId)
  const pages=['page','historyPage'].map(key=>params.get(key)).filter(x=>x!==null)
  const invalidPage=pages.some(x=>!/^\d+$/.test(x)||!Number.isSafeInteger(Number(x))||Number(x)>1000000)
  return <><nav className="cohort-tabs" aria-label="Cohort sections">{tabs.map(([key,label])=><Link key={key} aria-current={tab===key?'page':undefined} className={tab===key?'active':''} to={`?${new URLSearchParams({cohort:String(cohort.id),tab:key})}`}>{label}</Link>)}</nav>
    <section className="panel-card cohort-content">
      {!tabs.some(([key])=>key===tab)?<EmptyState title="Unknown section"/>:sessionId&&!session?<EmptyState title="Session unavailable for this cohort" message="Select another section to clear this session filter."/>:invalidPage?<ErrorPanel error={new Error('Invalid page number.')} retry={()=>update({page:null,historyPage:null})}/>:params.get('attempt')?<><Link className="table-action" to={href({attempt:null})}>← Back to list</Link><AttemptReview scope={scope} attemptId={params.get('attempt')}/></>:<>
        <div className="section-heading"><h2>{cohort.display_name} · {tabs.find(([key])=>key===tab)[1]}</h2>{['sessions','results','attempts','questions'].includes(tab)}</div>
        {params.get('student')&&<Link className="table-action" to={href({student:null,page:null,historyPage:null,search:null})}>← All students</Link>}
        {tab==='overview'&&<Overview data={data}/>}{tab==='sessions'&&<Sessions sessions={session?[session]:data.sessions} href={href}/>}{tab==='students'&&<Students scope={scope} params={params} update={update} href={href}/>}{['results','attempts'].includes(tab)&&<Attempts scope={scope} params={params} update={update} href={href} resultsOnly={tab==='results'}/>}{tab==='questions'&&<Questions scope={scope} params={params} update={update}/>}
      </>}
    </section></>
}
