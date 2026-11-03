import { Link } from 'react-router-dom'
import { getCohortAttempt, listCohortAttempts, listCohortQuestions, listCohortStudents } from '../lib/adminApi.js'
import useResource from '../lib/useResource.js'
import { percent } from '../lib/format.js'
import LoadingPanel from './LoadingPanel.jsx'
import ErrorPanel from './ErrorPanel.jsx'
import EmptyState from './EmptyState.jsx'
import ScoreBadge from './ScoreBadge.jsx'
import StatCard from './StatCard.jsx'

export function colomboDate(value) {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
function Resource({ resource, children }) {
  if (resource.error) return <ErrorPanel error={resource.error} retry={resource.retry} />
  if (!resource.data) return <LoadingPanel />
  return children(resource.data)
}
function Pagination({ total, page, update }) {
  return <div className="cohort-pagination" aria-label="Pagination"><span>{total} records · Page {page + 1} of {Math.max(1, Math.ceil(total / 25))}</span>
    <button className="secondary-button" disabled={page === 0} onClick={() => update({ page: page - 1 })}>Previous</button>
    <button className="secondary-button" disabled={(page + 1) * 25 >= total} onClick={() => update({ page: page + 1 })}>Next</button></div>
}
export function Overview({ data }) {
  const o = data.overview
  const metrics = [['Batch students',o.total_students],['Quiz attempts',o.total_attempts],['Completed / submitted',o.completed_attempts],['Average score',percent(o.average_score)],['Highest score',percent(o.best_score)],['Members who attempted',o.students_attempted]]
  return <><div className="admin-stat-grid">{metrics.map(([label,value]) => <StatCard key={label} label={label} value={value ?? 0} />)}</div></>
}
export function Sessions({ sessions, href }) {
  if (!sessions.length) return <EmptyState title="No assigned sessions" />
  return <div className="session-analytics-grid">{sessions.map(s => <article className="session-analytic-card" key={s.batch_id}>
    <div><span className="pill">{s.published ? 'Published' : 'Unpublished'}</span><h3><Link className="strong-link" to={href({tab:'sessions',session:s.batch_id,page:null})}>{s.session_name}</Link></h3><p>{colomboDate(s.unlock_at)}</p></div>
    <dl className="cohort-session-metrics">{[['Attempts',s.total_attempts],['Completed',s.completed_attempts],['Students attempted',s.students_attempted],['Average',percent(s.average_score)]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="filter-row"><Link className="table-action" to={href({tab:'attempts',session:s.batch_id,page:null})}>Attempts</Link></div>
  </article>)}</div>
}
export function Students({ scope, params, update, href }) {
  const page = Number(params.get('page') || 0), search = params.get('search') || '', studentId = params.get('student') || null
  const args = {...scope,search,studentId,offset:page*25}
  const resource = useResource(JSON.stringify(args), () => listCohortStudents(args))
  return <>{!studentId && <label className="cohort-search">Search name, phone or student ID<input className="search-input" value={search} onChange={e=>update({search:e.target.value,page:null})} /></label>}
    <Resource resource={resource}>{data => <>
      {!data.rows.length ? <EmptyState title="No cohort students found" message="No matching membership was found for this cohort." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Student</th><th>Phone</th><th>Age</th><th>Attempts</th><th>Sessions attempted</th><th>Not attempted</th><th>Average</th><th>Best</th><th>Latest attempt (Colombo)</th><th>Completion</th></tr></thead><tbody>{data.rows.map(s=><tr key={s.id}><td><Link className="strong-link" to={href({student:s.id,search:null,page:null})}>{s.username}</Link></td><td>{s.phone || '?'}</td><td>{s.age ?? '?'}</td><td>{s.attempts}</td><td>{s.sessions_attempted}</td><td>{s.sessions_not_attempted}</td><td><ScoreBadge score={s.average_score}/></td><td>{percent(s.best_score)}</td><td>{s.latest_attempt_at?colomboDate(s.latest_attempt_at):'No attempts'}</td><td>{s.completion_status.replaceAll('_',' ')}</td></tr>)}</tbody></table></div>}
      {!studentId && <Pagination total={data.total} page={page} update={update}/>}
      {studentId && data.rows.length>0 && <section><h3>Student history for this module and cohort</h3><Attempts scope={scope} params={params} update={update} href={href} studentId={studentId}/></section>}
    </>}</Resource></>
}
export function Attempts({ scope, params, update, href, studentId=null, resultsOnly=false }) {
  const page=Number(params.get(studentId?'historyPage':'page')||0),search=studentId?'':params.get('search')||'',status=params.get('status')||'',sort=params.get('sort')||'submitted_desc'
  const args={...scope,search,sessionId:params.get('session'),status,sort,studentId,resultsOnly,offset:page*25}
  const resource=useResource(JSON.stringify(args),()=>listCohortAttempts(args))
  const change=patch=>update({...patch,page:null,historyPage:null})
  return <><div className="filter-row cohort-filters">
    {!studentId && <label>Search name, phone or student ID<input className="search-input" value={search} onChange={e=>change({search:e.target.value})}/></label>}
    <label>Attempt status<select className="filter-select" value={status} onChange={e=>change({status:e.target.value})}><option value="">All statuses</option>{(resultsOnly?['completed','submitted']:['completed','submitted','pending','in_progress']).map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label>
    
  </div><Resource resource={resource}>{data=><>
    {!data.rows.length?<EmptyState title={resultsOnly?'No quiz results':'No quiz attempts'} message="No matching attempts are mapped to this module and cohort."/>:<div className="table-wrap"><table className="data-table"><thead><tr><th>Student</th><th>Session</th><th>Questions</th><th>Correct</th><th>Score</th><th>Status</th><th>Started (Colombo)</th><th>Submitted (Colombo)</th><th/></tr></thead><tbody>{data.rows.map(a=><tr key={a.id}><td>{a.username}</td><td>{a.session_name}</td><td>{a.total_questions??'—'}</td><td>{a.correct_count??'—'}</td><td>{['completed','submitted'].includes(a.status)?<ScoreBadge score={a.score}/>:'—'}</td><td>{a.status}</td><td>{a.started_at?colomboDate(a.started_at):'—'}</td><td>{a.submitted_at?colomboDate(a.submitted_at):'—'}</td><td><Link className="table-action" to={href({attempt:a.id})}>Review answers</Link></td></tr>)}</tbody></table></div>}
    <Pagination total={data.total} page={page} update={patch=>update(studentId?{historyPage:patch.page}:patch)}/>
  </>}</Resource></>
}
export function Questions({ scope, params, update }) {
  const page=Number(params.get('page')||0),args={...scope,sessionId:params.get('session'),offset:page*25}
  const resource=useResource(JSON.stringify(args),()=>listCohortQuestions(args))
  return <Resource resource={resource}>{data=><>{!data.rows.length?<EmptyState title="No questions in these sessions"/>:<div className="answer-review-list">{data.rows.map(q=><article className="answer-review-card" key={q.id}><div className="question-meta"><span>{q.session_name}</span><span>{q.topic||'General'}</span><span>{q.difficulty||'Unspecified'}</span></div><h3>{q.question_text}</h3><Options question={q}/></article>)}</div>}<Pagination total={data.total} page={page} update={update}/></>}</Resource>
}
function Options({question:q}) {
  return <ul className="cohort-options">{['a','b','c','d'].map(key=><li key={key} className={String(q.correct_option).toLowerCase()===key?'is-correct-option':''}><strong>{key.toUpperCase()}.</strong> {q[`option_${key}`]} {String(q.selected_option).toLowerCase()===key&&<span className="pill">Student selected</span>} {String(q.correct_option).toLowerCase()===key&&<span className="pill">Correct answer</span>}</li>)}</ul>
}
export function AttemptReview({scope,attemptId}) {
  const resource=useResource(JSON.stringify([scope,attemptId]),()=>getCohortAttempt(scope.moduleName,scope.cohortId,attemptId))
  return <Resource resource={resource}>{data=><><h2>{data.attempt.session_name} · {data.attempt.username}</h2><p>Status: {data.attempt.status} · {data.attempt.correct_count??'—'} / {data.attempt.total_questions??'—'} correct</p>{!data.questions.length&&<EmptyState title="No answer records"/>}<div className="answer-review-list">{data.questions.map((q,i)=><article className="answer-review-card" key={`${q.question_id}-${i}`}><h3>{q.question_number||i+1}. {q.question_text}</h3><p>{q.selected_option?(q.is_correct?'Correct':'Incorrect'):'Not answered'}</p><Options question={q}/>{q.explanation&&<p><strong>Explanation:</strong> {q.explanation}</p>}</article>)}</div></>}</Resource>
}
