import { writeFileSync } from 'node:fs'

// Arguments are non-secret credential ID and project reference, never the key.
const credentialId = process.argv[2]
const projectRef = process.argv[3] || 'YOUR_PROJECT_REF'
if (credentialId && !/^[a-zA-Z0-9_-]{1,64}$/.test(credentialId)) throw new Error('Supply an n8n credential ID, never a key')
if (!/^[a-zA-Z0-9_-]+$/.test(projectRef)) throw new Error('Invalid project reference')
const credential = { name: 'Teen Academy Supabase Integration', ...(credentialId ? { id: credentialId } : {}) }
const endpoint = `https://${projectRef}.supabase.co/functions/v1/quiz-generation-worker`
const nodes = []
const connections = {}
function add(name, type, version, parameters, position, extra = {}) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  nodes.push({ id, name, type, typeVersion: version, position, parameters, ...extra })
  return name
}
function connect(from, to, output = 0) {
  const main = (connections[from] ||= { main: [] }).main
  while (main.length <= output) main.push([])
  main[output].push({ node: to, type: 'main', index: 0 })
}
function http(name, body, x, y, errors = true) {
  return add(name, 'n8n-nodes-base.httpRequest', 4.4, {
    method: 'POST', url: endpoint, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: body,
    options: { timeout: 240000, response: { response: { responseFormat: 'json' } }, redirect: { redirect: { followRedirects: false } } },
  }, [x, y], errors ? { onError: 'continueErrorOutput', retryOnFail: false } : { retryOnFail: false })
}
add('Authenticated Job Webhook', 'n8n-nodes-base.webhook', 2.1, {
  httpMethod: 'POST', path: 'teen-academy-automatic-quiz', authentication: 'headerAuth', responseMode: 'onReceived',
  options: { responseCode: { values: { responseCode: 'customCode', customCode: 202 } }, responseData: '{"accepted":true}' },
}, [0, 0], { webhookId: 'teen-academy-automatic-quiz' })
http('Claim Job', '={{ JSON.stringify({ action: "claim", job_id: $json.body.job_id, execution_id: String($execution.id) }) }}', 240, 0)
add('Job Claimed', 'n8n-nodes-base.if', 2.3, {
  conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: 'claimed', leftValue: '={{ $json.claimed }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  options: {},
}, [480, 0])
const stages = [['Structure Lesson', 'structuring'], ['Generate 30 Questions', 'generating'], ['Validate and Stage', 'validating'], ['Publish Atomically', 'publishing']]
for (const [index, [name, action]] of stages.entries()) {
  http(name, '={{ JSON.stringify({ action: "' + action + '", job_id: $json.job_id, token: $json.token }) }}', 720 + index * 240, 0)
}
http('Record Failure', '={{ JSON.stringify({ action: "fail", job_id: $("Authenticated Job Webhook").first().json.body.job_id, execution_id: String($execution.id) }) }}', 960, 260, false)
connect('Authenticated Job Webhook', 'Claim Job')
connect('Claim Job', 'Job Claimed'); connect('Claim Job', 'Record Failure', 1)
connect('Job Claimed', stages[0][0], 0)
for (let index = 0; index < stages.length; index++) {
  if (index + 1 < stages.length) connect(stages[index][0], stages[index + 1][0])
  connect(stages[index][0], 'Record Failure', 1)
}
add('Retry Pending Jobs', 'n8n-nodes-base.scheduleTrigger', 1.3, { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, [0, 480])
http('Dispatch Pending Jobs', '{"action":"sweep"}', 240, 480, false)
connect('Retry Pending Jobs', 'Dispatch Pending Jobs')
const workflow = {
  name: 'Teen Academy Automatic PDF Quiz Generator', active: false, nodes, connections,
  settings: { executionOrder: 'v1', executionTimeout: 900, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false },
  pinData: {}, tags: [],
}
for (const node of nodes) {
  if (['n8n-nodes-base.httpRequest', 'n8n-nodes-base.webhook'].includes(node.type)) {
    node.credentials = { httpHeaderAuth: { ...credential } }
  }
}
writeFileSync(new URL('./workflows/Teen_Academy_Automatic_PDF_Quiz_Generator.json', import.meta.url), JSON.stringify(workflow, null, 2) + '\n')
