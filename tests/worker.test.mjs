import test from 'node:test'
import assert from 'node:assert/strict'
import { createGenerationWorker } from '../supabase/functions/_shared/generationWorker.js'
import { createQuizAi } from '../supabase/functions/_shared/quizAi.js'
import { GenerationError } from '../supabase/functions/_shared/quizValidation.js'
const jobId='22222222-2222-4222-8222-222222222222',token='33333333-3333-4333-8333-333333333333'
const source='A budget records expected income and expenditure, helping a business plan how to use its available resources. '.repeat(5)
const questions=Array.from({length:30},(_,i)=>({question_text:'How does example '+i+' illustrate a budgeting decision?',option_a:'Plan income and costs',option_b:'Ignore costs',option_c:'Destroy records',option_d:'Guarantee profit',correct_option:'A',topic:'Budgets',difficulty:i<12?'easy':i<24?'medium':'hard',source_quote:'A budget records expected income and expenditure, helping a business plan how to use its available resources.'}))
const lesson={lesson_plan:{learning_objectives:['Plan a budget'],blocks:[{topic:'Budget',content:source,examples:[]}],checkpoint_quiz:{focus_questions:['What is a budget?']}}}
const reviews=Array.from({length:30},(_,index)=>({index,supported:true,one_correct_answer:true,accurate:true}))
function modelFixture({badReview=false,refusal=false}={}) {
 const calls=[]
 const ai=createQuizAi({key:'test-only',model:'configured-model',fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body})
  if(url.endsWith('/embeddings'))return Response.json({data:questions.map((_,index)=>({index,embedding:Array.from({length:1536},(_,n)=>n===index?1:0)}))})
  if(refusal)return Response.json({status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]})
  const result=body.text.format.name==='lesson_plan'?lesson:body.text.format.name==='quiz_questions'?{questions}:{reviews:reviews.map(r=>({...r,accurate:!badReview}))}
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]})
 }})
 return {ai,calls}
}
function workerFixture(options={}) {
 const {ai,calls}=modelFixture(options);const dbCalls=[]
 const job={job_id:jobId,status:'extracting',source_text:source,session_context:{module_name:'Finance',session_name:'Session 1',session_date:'2026-10-24'}}
 const worker=createGenerationWorker({secret:'worker-test',ai,dispatch:async()=>{},rpc:async(name,args)=>{
  dbCalls.push(name)
  if(name==='quiz_generation_claim'){if(job.status!=='extracting')return null;job.status='structuring';return {job_id:jobId,token,claimed:true}}
  if(name==='quiz_generation_begin_step'){if(args.p_token!==token)throw new GenerationError('Invalid token',403);return job}
  if(name==='quiz_generation_commit_step'){if(args.p_step==='structuring'){job.lesson_plan=args.p_result;job.status='generating'}else{job.generated_questions=args.p_result;job.status='validating'}}
  if(name==='quiz_generation_stage'){assert.equal(args.p_questions.length,30);job.status='publishing'}
  if(name==='quiz_generation_publish'){job.status='completed';return {job_id:jobId,status:'completed',published_question_count:30}}
  if(name==='quiz_generation_fail'){job.status='failed';job.source_text=null;job.generated_questions=null;job.lesson_plan=null}
 }})
 const request=(action,extra={},secret='worker-test')=>worker(new Request('http://worker.test',{method:'POST',headers:{'X-Quiz-Worker-Secret':secret},body:JSON.stringify({action,job_id:jobId,token,execution_id:'execution',...extra})}))
 return {request,job,calls,dbCalls}
}
test('automatic worker path structures, generates, reviews, embeds, stages and publishes without exposing document content',async()=>{
 const f=workerFixture()
 for(const step of ['claim','structuring','generating','validating','publishing']){
  const response=await f.request(step);assert.equal(response.status,200)
  const result=await response.json();assert.ok(!JSON.stringify(result).includes('expected income'))
 }
 assert.equal(f.job.status,'completed');assert.equal(f.calls.length,4)
 for(const call of f.calls.filter(c=>c.url.endsWith('/responses'))){assert.equal(call.body.store,false);assert.equal(call.body.text.format.strict,true)}
 assert.equal(f.calls.at(-1).body.model,'text-embedding-3-small')
 assert.equal((await(await f.request('claim')).json()).claimed,false)
})
test('incorrect AI review fails and clears temporary data without publication',async()=>{
 const f=workerFixture({badReview:true})
 for(const step of ['claim','structuring','generating'])await f.request(step)
 assert.equal((await f.request('validating')).status,400)
 assert.equal(f.job.source_text,null);assert.equal(f.job.status,'failed');assert.ok(!f.dbCalls.includes('quiz_generation_publish'))
})
test('worker secret and token checks prevent unauthorized model requests or failing another job',async()=>{
 const f=workerFixture()
 assert.equal((await f.request('claim',{},'bad-secret')).status,401)
 await f.request('claim')
 assert.equal((await f.request('structuring',{token:'44444444-4444-4444-8444-444444444444'})).status,403)
 assert.equal(f.calls.length,0);assert.ok(!f.dbCalls.includes('quiz_generation_fail'))
})
test('model refusal becomes durable failure, not success',async()=>{
 const f=workerFixture({refusal:true});await f.request('claim')
 assert.equal((await f.request('structuring')).status,400)
 assert.equal(f.job.status,'failed')
})
