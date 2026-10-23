import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
const db = new PGlite({ extensions: { vector } })
await db.exec(
"create extension vector; create role anon; create role authenticated; create role service_role; create schema auth;" +
"create table auth.users(id uuid primary key); create table admin_users(user_id uuid primary key,is_active boolean);" +
"create table quiz_batches(id uuid primary key,module_name text,session_name text,session_date date,status text default 'generating',bank_size_target integer default 50,question_count_per_student integer default 10,completed_at timestamptz);" +
"create type difficulty_level as enum ('easy','medium','hard');" +
"create table quiz_bank_questions(id uuid primary key default gen_random_uuid(),batch_id uuid references quiz_batches,question_text text not null,option_a text not null,option_b text not null,option_c text not null,option_d text not null,correct_option text not null,topic text not null,difficulty difficulty_level not null,embedding vector(1536));" +
"create table quiz_attempts(id uuid primary key default gen_random_uuid(),batch_id uuid references quiz_batches,score integer default 70);" +
"create table student_cohorts(id int primary key,name text); create table student_cohort_schedules(cohort_id int,bank_id uuid,unlock_date date); create table quiz_attempt_cohorts(attempt_id uuid,cohort_id int);" +
"create function save_quiz_question() returns text language sql as $$ select 'legacy function unchanged' $$;"
)
const admin = '11111111-1111-4111-8111-111111111111'
const other = '55555555-5555-4555-8555-555555555555'
const bank = '33333333-3333-4333-8333-333333333333'
const history = '66666666-6666-4666-8666-666666666666'
const request = '44444444-4444-4444-8444-444444444444'
const source = 'A business budget records expected income and expenditure to help a business plan its resources. '.repeat(5).trim()
await db.query('insert into auth.users values ($1),($2)',[admin,other])
await db.exec('insert into admin_users select id,true from auth.users')
await db.query("insert into quiz_batches(id,module_name,session_name,session_date,status) values($1,'Finance','Session 1','2026-10-24','generating'),($2,'Finance','Session 2','2026-10-25','completed')",[bank,history])
await db.query("insert into quiz_bank_questions(batch_id,question_text,option_a,option_b,option_c,option_d,correct_option,topic,difficulty) values($1,'Historical question','A','B','C','D','A','History','easy')",[history])
await db.query("insert into quiz_attempts(batch_id) values($1)",[history])
await db.exec("insert into student_cohorts values(1,'Batch 1'),(2,'Batch 2'),(3,'Coming Soon')")
await db.query("insert into student_cohort_schedules values(1,$1,'2026-10-25'),(2,$1,'2026-11-25')",[history])
await db.exec("insert into quiz_attempt_cohorts select id,1 from quiz_attempts")
const snapshots = async () => {
  const rows = []
  for (const table of ['student_cohorts','student_cohort_schedules','quiz_attempt_cohorts']) rows.push((await db.query('select * from '+table)).rows)
  for (const [table,field] of [['quiz_batches','id'],['quiz_bank_questions','batch_id'],['quiz_attempts','batch_id']]) rows.push((await db.query('select * from '+table+' where '+field+'=$1',[history])).rows)
  rows.push((await db.query("select pg_get_functiondef('save_quiz_question()'::regprocedure)")).rows)
  return rows
}
const before = await snapshots()
const migration = await readFile(new URL('../supabase/migrations/202610220001_quiz_generation_foundation.sql',import.meta.url),'utf8')
await db.exec(migration)
after(()=>db.close())
const call = async (name,args=[]) => (await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result
const submit = (key=request,who=admin) => call('quiz_generation_submit',[who,bank,key,source,1000,2])
function questions() {
 return Array.from({length:30},(_,i)=>({
  question_text:'What does budgeting example '+i+' teach?',option_a:'Plan costs',option_b:'Ignore spending',option_c:'Destroy records',option_d:'Guarantee profit',
  correct_option:'A',topic:'Budgets',difficulty:i<12?'easy':i<24?'medium':'hard',source_quote:'A business budget records expected income and expenditure to help a business plan its resources.',
  embedding:Array.from({length:1536},(_,d)=>d===i?1:0)
 }))
}
const review=Array.from({length:30},(_,index)=>({index,supported:true,one_correct_answer:true,accurate:true}))
let job, claim
async function stageReady(key=request) {
 job=await submit(key)
 claim=await call('quiz_generation_claim',[job.job_id,'execution-'+key])
 await call('quiz_generation_begin_step',[job.job_id,claim.token,'structuring'])
 await call('quiz_generation_commit_step',[job.job_id,claim.token,'structuring',JSON.stringify({
  module_name:'Finance',session_name:'Session 1',session_date:'2026-10-24',bank_size:30,runtime_quiz_size:10,lesson_plan:{learning_objectives:['Budgeting']}
 })])
 await call('quiz_generation_begin_step',[job.job_id,claim.token,'generating'])
 await call('quiz_generation_commit_step',[job.job_id,claim.token,'generating',JSON.stringify(questions())])
 await call('quiz_generation_begin_step',[job.job_id,claim.token,'validating'])
}
test('migration applies without changing historical rows or legacy save function',async()=>{
 assert.deepEqual(await snapshots(),before)
 assert.doesNotMatch(migration,/storage\.(objects|buckets)/)
})
test('migration can safely rerun',async()=>{await db.exec(migration);assert.deepEqual(await snapshots(),before)})
test('cleanup readiness fails closed; generating-default empty bank needs explicit reservation',async()=>{
 await assert.rejects(submit(),/not enabled/)
 await db.exec('update quiz_generation_config set enabled=true,cleanup_ready=true')
 await assert.rejects(submit(),/reservation/)
 await assert.rejects(call('quiz_generation_reserve_bank',[bank,admin,false]),/legacy execution/)
 await assert.rejects(call('quiz_generation_reserve_bank',[history,admin,true]),/already in use/)
 await call('quiz_generation_reserve_bank',[bank,admin,true])
 assert.equal((await call('quiz_generation_eligibility'))[bank].eligible,true)
})
test('reservation blocks legacy writes, deletes, resets and premature student attempts',async()=>{
 await assert.rejects(db.query("update quiz_batches set status='generating' where id=$1",[bank]),/legacy writes/)
 await assert.rejects(db.query("insert into quiz_bank_questions(batch_id,question_text,option_a,option_b,option_c,option_d,correct_option,topic,difficulty) values($1,'Legacy','a','b','c','d','A','topic','easy')",[bank]),/legacy writes/)
 await assert.rejects(db.query('delete from quiz_batches where id=$1',[bank]),/legacy writes/)
 await assert.rejects(db.query('insert into quiz_attempts(batch_id) values($1)',[bank]),/not published/)
})
test('browser and service cannot call operator reservation or read source directly',async()=>{
 await db.exec('set role authenticated')
 try {await assert.rejects(db.query('select * from quiz_generation_jobs'),/permission/);await assert.rejects(submit(),/permission/)}
 finally {await db.exec('reset role')}
 await db.exec('set role service_role')
 try {await assert.rejects(call('quiz_generation_reserve_bank',[bank,admin,true]),/permission/);await assert.rejects(db.query('select source_text from quiz_generation_jobs'),/permission/)}
 finally {await db.exec('reset role')}
})
test('submit authorization, text limits, idempotency and competing jobs',async()=>{
 await assert.rejects(submit(request,'99999999-9999-4999-8999-999999999999'),/administrator/)
 await assert.rejects(call('quiz_generation_submit',[admin,bank,request,'short',1000,1]),/Invalid/)
 job=await submit()
 assert.equal((await submit()).job_id,job.job_id)
 await assert.rejects(submit('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other),/already active/)
 await assert.rejects(call('quiz_generation_submit',[admin,bank,request,source+' changed',1000,1]),/Idempotency/)
 assert.ok(!('source_text' in job))
 assert.equal(await call('quiz_generation_dispatch',[job.job_id]),true)
 assert.equal(await call('quiz_generation_dispatch',[job.job_id]),false)
})
test('worker claims once, cannot skip steps or forge a token; failure clears source',async()=>{
 claim=await call('quiz_generation_claim',[job.job_id,'first'])
 assert.equal(await call('quiz_generation_claim',[job.job_id,'second']),null)
 await assert.rejects(call('quiz_generation_begin_step',[job.job_id,request,'structuring']),/lease/)
 await assert.rejects(call('quiz_generation_publish',[job.job_id,claim.token]),/not validated/)
 await call('quiz_generation_fail_worker',[job.job_id,'wrong-execution'])
 assert.equal((await call('quiz_generation_public_job',[job.job_id])).status,'structuring')
 await call('quiz_generation_fail_worker',[job.job_id,'first'])
 assert.equal((await db.query('select source_text from quiz_generation_jobs where job_id=$1',[job.job_id])).rows[0].source_text,null)
})
test('staging rejects incomplete count, wrong distribution, malformed embedding, duplicate, unsupported evidence and failed review atomically',async()=>{
 await stageReady('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
 const invalid=[]
 invalid.push(questions().slice(1))
 const dist=questions();dist[0].difficulty='hard';invalid.push(dist)
 const embed=questions();embed[0].embedding=[1,2];invalid.push(embed)
 const duplicate=questions();duplicate[1].embedding=duplicate[0].embedding;invalid.push(duplicate)
 const exact=questions();exact[1].question_text=exact[0].question_text.toUpperCase();invalid.push(exact)
 const unsupported=questions();unsupported[0].source_quote='This supporting quote is invented outside the lesson.';invalid.push(unsupported)
 for(const items of invalid) {
  await assert.rejects(call('quiz_generation_stage',[job.job_id,claim.token,JSON.stringify(items),JSON.stringify(review)]))
  assert.equal(Number((await db.query('select count(*) n from quiz_generation_draft_questions')).rows[0].n),0)
 }
 const rejected=structuredClone(review);rejected[0].accurate=false
 await assert.rejects(call('quiz_generation_stage',[job.job_id,claim.token,JSON.stringify(questions()),JSON.stringify(rejected)]),/validation failed/)
 await call('quiz_generation_stage',[job.job_id,claim.token,JSON.stringify(questions()),JSON.stringify(review)])
 assert.equal((await call('quiz_generation_public_job',[job.job_id])).status,'publishing')
})
test('an insertion error rolls back the entire publication and completion',async()=>{
 await db.exec("create function test_reject_question() returns trigger language plpgsql as $$ begin if new.question_text like '%example 15 %' then raise exception 'simulated database failure'; end if; return new; end; $$; create trigger test_reject before insert on quiz_bank_questions for each row execute function test_reject_question();")
 await assert.rejects(call('quiz_generation_publish',[job.job_id,claim.token]),/simulated database failure/)
 assert.equal(Number((await db.query('select count(*) n from quiz_bank_questions where batch_id=$1',[bank])).rows[0].n),0)
 assert.equal((await call('quiz_generation_public_job',[job.job_id])).status,'publishing')
 await db.exec('drop trigger test_reject on quiz_bank_questions; drop function test_reject_question()')
})
test('atomic publication inserts 30 pgvector questions, 12/12/6; sets runtime 10 and clears source/drafts',async()=>{
 const receipt=await call('quiz_generation_publish',[job.job_id,claim.token])
 assert.equal(receipt.status,'completed');assert.equal(receipt.published_question_count,30)
 const rows=(await db.query('select difficulty,count(*)::int n from quiz_bank_questions where batch_id=$1 group by difficulty order by difficulty',[bank])).rows
 assert.deepEqual(Object.fromEntries(rows.map(r=>[r.difficulty,r.n])),{easy:12,medium:12,hard:6})
 assert.equal((await db.query('select vector_dims(embedding) n from quiz_bank_questions where batch_id=$1 limit 1',[bank])).rows[0].n,1536)
 const batch=(await db.query('select * from quiz_batches where id=$1',[bank])).rows[0]
 assert.equal(batch.bank_size_target,30);assert.equal(batch.question_count_per_student,10);assert.equal(batch.status,'completed')
 const content=(await db.query('select source_text,lesson_plan,generated_questions from quiz_generation_jobs where job_id=$1',[job.job_id])).rows[0]
 assert.deepEqual(content,{source_text:null,lesson_plan:null,generated_questions:null})
 assert.equal(Number((await db.query('select count(*) n from quiz_generation_draft_questions')).rows[0].n),0)
 assert.equal((await call('quiz_generation_publish',[job.job_id,claim.token])).publication_id,receipt.publication_id)
 await assert.rejects(submit('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),/already in use/)
 await db.query('insert into quiz_attempts(batch_id) values($1)',[bank])
 await assert.rejects(db.query('delete from quiz_bank_questions where batch_id=$1',[bank]),/legacy writes/)
 assert.deepEqual(await snapshots(),before)
})
test('expired jobs cannot advance and are cleared without browser activity',async()=>{
 const second='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 await db.query("insert into quiz_batches(id,module_name,session_name,session_date) values($1,'Finance','Session 3','2026-11-01')",[second])
 await call('quiz_generation_reserve_bank',[second,admin,true])
 const expired=await call('quiz_generation_submit',[admin,second,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',source,1000,2])
 const token=await call('quiz_generation_claim',[expired.job_id,'expire'])
 await db.query("update quiz_generation_jobs set expires_at=now()-interval '1 second' where job_id=$1",[expired.job_id])
 assert.equal(await call('quiz_generation_expire'),1)
 await assert.rejects(call('quiz_generation_begin_step',[expired.job_id,token.token,'structuring']),/lease/)
 assert.equal((await db.query('select source_text from quiz_generation_jobs where job_id=$1',[expired.job_id])).rows[0].source_text,null)
 assert.deepEqual(await snapshots(),before)
})


