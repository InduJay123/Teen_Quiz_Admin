import test from 'node:test'
import assert from 'node:assert/strict'
import { createGenerationHandler, readLimitedJson } from '../supabase/functions/_shared/generationHandler.js'
import { generationDatabase } from '../supabase/functions/_shared/generationDatabase.js'
import { GenerationError } from '../supabase/functions/_shared/quizValidation.js'
const admin='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222',bank='33333333-3333-4333-8333-333333333333'
const source='A business budget records expected income and expenditure. '.repeat(8)
const submit={action:'submit',bank_id:bank,request_id:'44444444-4444-4444-8444-444444444444',source_text:source,file_bytes:1000,page_count:2}
function fixture({signedIn=true,isAdmin=true,missing=false,dispatchFails=false}={}) {
 let job=null,claimed=false;const calls=[]
 const handler=createGenerationHandler({
  origin:'http://localhost:5174',configured:true,
  authenticate:async()=>signedIn?{id:admin}:null,
  db:{
   requireAdmin:async()=>{calls.push('admin');if(!isAdmin)throw new GenerationError('Admin required',403)},
   loadChoices:async()=>({configuration:{enabled:false,reason:'Migration required'},sessions:[{bank_id:bank}]}),
   getJob:async()=>job,latestJob:async()=>job,
   rpc:async(name,args)=>{
    calls.push(name)
    if(missing)throw Object.assign(new Error('missing function'),{code:'PGRST202'})
    if(name==='quiz_generation_submit'){job||={job_id:jobId,administrator_id:admin,status:'extracting'};assert.equal(args.p_text,source.trim());return job}
    if(name==='quiz_generation_dispatch'){if(claimed)return false;claimed=true;return true}
    if(name==='quiz_generation_public_job')return {job_id:jobId,status:job.status}
   },
  },
  dispatch:async()=>{calls.push('dispatch');if(dispatchFails)throw new Error('timeout')},
 })
 return {calls,request:body=>handler(new Request('http://edge.test',{method:'POST',headers:{Origin:'http://localhost:5174'},body:JSON.stringify(body)}))}
}
test('no authentication/non-admin cannot submit text',async()=>{
 for(const [opts,code] of [[{signedIn:false},401],[{isAdmin:false},403]])assert.equal((await fixture(opts).request(submit)).status,code)
})
test('choices load despite all new RPCs missing; recent is empty and submit returns useful 503',async()=>{
 const f=fixture({missing:true})
 const choices=await(await f.request({action:'choices'})).json()
 assert.equal(choices.sessions[0].bank_id,bank);assert.ok(!f.calls.includes('quiz_generation_expire'))
 assert.equal(await(await f.request({action:'recent'})).json(),null)
 const response=await f.request(submit);assert.equal(response.status,503);assert.match((await response.json()).error,/database setup/)
})
test('text submission is idempotent, dispatch once, and HTTP 202 never means publication',async()=>{
 const f=fixture()
 const results=await Promise.all([f.request(submit),f.request(submit)])
 assert.deepEqual(results.map(r=>r.status),[202,202])
 assert.equal(f.calls.filter(c=>c==='dispatch').length,1)
 assert.equal((await results[0].json()).status,'extracting')
 assert.equal((await(await f.request({action:'recent'})).json()).job_id,jobId)
})
test('invalid and oversized text fails before job creation',async()=>{
 for(const text of ['', 'short','a'.repeat(120001),'a\u0000'.repeat(300)]){
  const f=fixture();assert.equal((await f.request({...submit,source_text:text})).status,400);assert.ok(!f.calls.includes('quiz_generation_submit'))
 }
 const request=new Request('http://edge.test',{method:'POST',body:JSON.stringify({text:'x'.repeat(100)})})
 await assert.rejects(readLimitedJson(request,50),/exceeds/)
})
test('lost webhook reply retains durable pending job',async()=>{
 const f=fixture({dispatchFails:true});const result=await(await f.request(submit)).json()
 assert.equal(result.status,'extracting')
})
test('production table choices load directly and show completion reason when RPCs are absent',async()=>{
 const tables=[]
 const service={
  rpc:async()=>({error:{code:'PGRST202'}}),
  from(table){
   tables.push(table)
   return { select:(_columns,opts)=>{
    const query={eq:()=>query,order:()=>query,range:async()=>({data:[{id:bank,module_name:'Finance',session_name:'Session 1',status:'completed'}]}),
     maybeSingle:async()=>({data:{user_id:admin}}),
     then:resolve=>resolve({count:opts?.head?1:0})}
    return query
   }}
  },
 }
 const db=generationDatabase(service);await db.requireAdmin(admin)
 const result=await db.loadChoices()
 assert.equal(result.sessions[0].module_name,'Finance');assert.equal(result.configuration.enabled,false)
 assert.match(result.sessions[0].unavailable_reason,/Already in use/)
 assert.ok(tables.includes('quiz_batches'));assert.ok(tables.includes('admin_users'))
})

