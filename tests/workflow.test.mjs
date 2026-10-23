import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const workflow=JSON.parse(await readFile(new URL('../n8n/workflows/Teen_Academy_Automatic_PDF_Quiz_Generator.json',import.meta.url),'utf8'))
test('n8n export has unique IDs, connected nodes and valid expression references',()=>{
 const names=new Set(workflow.nodes.map(n=>n.name))
 assert.equal(names.size,workflow.nodes.length);assert.equal(new Set(workflow.nodes.map(n=>n.id)).size,workflow.nodes.length)
 for(const [from,outputs] of Object.entries(workflow.connections)){
  assert.ok(names.has(from))
  for(const group of outputs.main)for(const target of group)assert.ok(names.has(target.node))
 }
 for(const node of workflow.nodes)for(const match of JSON.stringify(node.parameters).matchAll(/\$\(\\"([^"\\]+)\\"\)/g))assert.ok(names.has(match[1]))
 const hook=workflow.nodes.find(n=>n.type==='n8n-nodes-base.webhook')
 assert.equal(hook.parameters.authentication,'headerAuth');assert.equal(hook.parameters.responseMode,'onReceived')
 for(const node of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest'))assert.equal(node.parameters.genericAuthType,'httpHeaderAuth')
 assert.equal(workflow.settings.saveDataErrorExecution,'none');assert.equal(workflow.active,false)
 assert.ok(!workflow.nodes.some(n=>n.type==='n8n-nodes-base.manualTrigger'))
})
test('every AI/publication HTTP failure routes to persistent failure handling',()=>{
 for(const name of ['Claim Job','Structure Lesson','Generate 30 Questions','Validate and Stage','Publish Atomically']){
  assert.equal(workflow.connections[name].main[1][0].node,'Record Failure')
 }
})
test('one private credential reference covers seven HTTP nodes and authenticated webhook on n8n 2.28.6',()=>{
 const http=workflow.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest')
 assert.equal(http.length,7)
 const authenticated=workflow.nodes.filter(n=>n.credentials)
 assert.equal(authenticated.length,8)
 for(const node of authenticated)assert.deepEqual(node.credentials,{httpHeaderAuth:{name:'Teen Academy Supabase Integration'}})
 for(const node of http){assert.equal(node.typeVersion,4.4);assert.equal(node.parameters.authentication,'genericCredentialType');assert.equal(node.parameters.headerParameters,undefined)}
 assert.equal(workflow.nodes.find(n=>n.type==='n8n-nodes-base.scheduleTrigger').typeVersion,1.3)
 assert.equal(workflow.settings.saveManualExecutions,false)
 assert.equal(workflow.settings.saveExecutionProgress,false)
 assert.equal(workflow.settings.saveDataSuccessExecution,'none')
})
