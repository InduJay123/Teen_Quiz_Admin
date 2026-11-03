import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Isolated fixtures use the user-verified schema, including SMALLINT cohorts.
const db = new PGlite()
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const rpc = async (name, args = []) => (await db.query(
  `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args,
)).rows[0].result
const migration = await readFile(new URL('../supabase/migrations/202611030001_module_cohorts.sql', import.meta.url), 'utf8')
const originalSql = await readFile(new URL('../supabase/admin_dashboard.sql', import.meta.url), 'utf8')
const unchanged = ['admin_list_modules()', 'admin_get_module(text)', 'admin_score(jsonb)', 'admin_attempt_status(jsonb)', 'admin_attempt_time(jsonb)']
const definitions = async () => (await db.query('select pg_get_functiondef(signature::regprocedure) as definition from unnest($1::text[]) signature', [unchanged])).rows
let originalDefinitions, originalModules
const publicCalls = [
  ['admin_list_cohort_modules', []], ['admin_get_module_cohorts', ['Marketing']], ['admin_get_module', ['Marketing', 1]],
  ['admin_list_cohort_students', ['Marketing', 1]], ['admin_list_cohort_attempts', ['Marketing', 1]],
  ['admin_list_cohort_questions', ['Marketing', 1]], ['admin_get_cohort_attempt', ['Marketing', 1, uid(201)]],
]

before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    create table public.admin_users(user_id uuid primary key, is_active boolean);
    create table public.student_cohorts(id smallint primary key, display_name text, status text, start_date date);
    create table public.quiz_batches(id uuid primary key,module_name text,session_name text,session_date date,status text,bank_size_target integer,question_count_per_student integer);
    create table public.student_cohort_schedules(cohort_id smallint references student_cohorts,quiz_batch_id uuid,unlock_at timestamptz,published boolean,session_number integer,module_number integer);
    create table public.student_profiles(user_id uuid primary key references auth.users,cohort_id smallint references student_cohorts,username text,username_normalized text,phone text,age smallint);
    create table public.quiz_attempts(id uuid primary key,student_id uuid,batch_id uuid,status text,total_questions integer,correct_answers integer,score_percentage numeric,started_at timestamptz,submitted_at timestamptz);
    create table public.quiz_attempt_cohorts(attempt_id uuid,cohort_id smallint,quiz_batch_id uuid,student_id uuid,is_active boolean);
    create table public.quiz_bank_questions(id uuid primary key,batch_id uuid,question_text text,option_a text,option_b text,option_c text,option_d text,correct_option text,topic text,difficulty text,explanation text);
    create table public.quiz_attempt_questions(attempt_id uuid,question_id uuid,selected_option text,is_correct boolean,question_number integer);
    insert into auth.users values ('${uid(900)}'),('${uid(901)}'),('${uid(101)}'),('${uid(102)}'),('${uid(103)}');
    insert into admin_users values ('${uid(900)}',true),('${uid(901)}',false);
    set request.jwt.claim.sub='${uid(900)}';
  `)
  // Exercise the real checked-in normalization/auth helpers, not test stubs.
  for (const name of ['admin_is_current_user', 'admin_require_access', 'admin_score', 'admin_correct_count', 'admin_total_questions', 'admin_attempt_status', 'admin_attempt_time', 'admin_list_modules', 'admin_get_module']) {
    const match = originalSql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))
    assert.ok(match, `Missing baseline function ${name}`)
    await db.exec(match[0])
  }
  await db.exec(`
    insert into student_cohorts values (1,'Batch 1','active','2026-01-01'),(2,'Batch 2','active','2026-02-01'),(3,'Batch 3','active','2026-03-01'),(9,'Weekend cohort','active','2026-04-01');
    insert into quiz_batches values
      ('${uid(1)}','Marketing','Session 1','2026-10-01','ready',30,10),
      ('${uid(2)}','Marketing','Session 1','2026-10-02','ready',20,10),
      ('${uid(3)}','Finance','Session 1','2026-10-03','ready',20,10);
    insert into student_cohort_schedules values
      (1,'${uid(1)}','2026-11-03T20:00:00Z',true,1,1),(1,'${uid(2)}','2026-11-10T20:00:00Z',false,2,1),
      (2,'${uid(1)}','2026-11-20T20:00:00Z',true,1,1),(3,'${uid(1)}','2026-11-25T20:00:00Z',false,1,1),
      (9,'${uid(2)}','2026-12-01T20:00:00Z',false,2,1),(1,'${uid(3)}','2026-11-03T20:00:00Z',true,1,2);
    insert into student_profiles values
      ('${uid(101)}',1,'Amaya','amaya','0771111111',14),
      ('${uid(102)}',2,'Bimal','bimal','0772222222',15),
      ('${uid(103)}',null,'No cohort','no cohort',null,null);
    insert into quiz_attempts values
      ('${uid(201)}','${uid(101)}','${uid(1)}','completed',10,8,80,'2026-11-04T01:00Z','2026-11-04T01:05Z'),
      ('${uid(202)}','${uid(101)}','${uid(1)}','submitted',10,10,100,'2026-11-21T01:00Z','2026-11-21T01:05Z'),
      ('${uid(203)}','${uid(102)}','${uid(1)}','in_progress',10,0,0,'2026-11-21T01:00Z',null),
      ('${uid(204)}','${uid(101)}','${uid(1)}','completed',10,1,10,'2026-11-01T01:00Z','2026-11-01T01:05Z'),
      ('${uid(205)}','${uid(101)}','${uid(3)}','completed',10,2,20,'2026-11-01T01:00Z','2026-11-01T01:05Z'),
      ('${uid(206)}','${uid(101)}','${uid(2)}','completed',10,6,60,'2026-11-11T01:00Z','2026-11-11T01:05Z');
    insert into quiz_attempt_cohorts values
      ('${uid(201)}',1,'${uid(1)}','${uid(101)}',false),('${uid(201)}',1,'${uid(1)}','${uid(101)}',false),
      ('${uid(202)}',2,'${uid(1)}','${uid(101)}',false),('${uid(203)}',2,'${uid(1)}','${uid(102)}',true),
      ('${uid(205)}',1,'${uid(3)}','${uid(101)}',false),('${uid(206)}',1,'${uid(2)}','${uid(101)}',false),
      -- Corrupt mappings: correct attempt ID but mismatched student or session.
      ('${uid(204)}',1,'${uid(1)}','${uid(102)}',true),('${uid(204)}',1,'${uid(2)}','${uid(101)}',true);
    insert into quiz_bank_questions values
      ('${uid(301)}','${uid(1)}','Marketing Q1','A','B','C','D','A','Brand','easy','Because A'),
      ('${uid(302)}','${uid(2)}','Marketing Q2','A','B','C','D','B','Brand','medium',null),
      ('${uid(303)}','${uid(3)}','Finance Q','A','B','C','D','C','Money','easy',null);
    insert into quiz_attempt_questions values ('${uid(201)}','${uid(301)}','A',true,1),('${uid(205)}','${uid(303)}','B',false,1);
  `)
  // RLS is enabled with no policies/direct grants, as on protected admin data.
  for (const table of ['admin_users','student_cohorts','student_profiles','student_cohort_schedules','quiz_batches','quiz_attempts','quiz_attempt_cohorts','quiz_bank_questions','quiz_attempt_questions']) {
    await db.exec(`alter table public.${table} enable row level security; revoke all on public.${table} from public,anon,authenticated;`)
  }
  originalDefinitions = await definitions()
  originalModules = await rpc('admin_list_modules')
  await db.exec(migration)
})
after(() => db.close())

test('global module functions and shared helpers remain byte-for-byte unchanged', async () => {
  assert.deepEqual(await definitions(), originalDefinitions)
  assert.deepEqual(await rpc('admin_list_modules'), originalModules)
})
test('new catalog and cohort directory use schedules, including empty Batch 3', async () => {
  const m = (await rpc('admin_list_cohort_modules')).find(m => m.module_name === 'Marketing')
  assert.equal(m.cohort_count, 4); assert.equal(m.session_count, 2); assert.equal(m.question_count, 2)
  const d = await rpc('admin_get_module_cohorts', ['Marketing'])
  assert.deepEqual(d.cohorts.map(c => c.id), [1, 2, 3, 9])
  assert.equal(d.cohorts[2].display_name, 'Batch 3')
})
test('profile membership and authoritative historical attribution stay separate', async () => {
  const a = await rpc('admin_get_module', ['Marketing', 1]), b = await rpc('admin_get_module', ['Marketing', 2])
  assert.equal(a.overview.total_students, 1); assert.equal(a.overview.total_attempts, 2); assert.equal(a.overview.average_score, 70)
  assert.equal(b.overview.total_students, 1); assert.equal(b.overview.total_attempts, 2); assert.equal(b.overview.average_score, 100)
  assert.equal(b.overview.students_attempted, 1); assert.equal(b.overview.pending_attempts, 1)
  assert.equal(a.sessions[0].total_attempts, 1); assert.equal(a.sessions[0].question_count, 1); assert.equal(a.sessions[0].bank_size_target, 30)
  assert.equal(a.sessions[0].session_date, '2026-11-04'); assert.equal(b.sessions[0].session_date, '2026-11-21')
  assert.equal(a.sessions[0].session_number, 1)
})
test('Batch 3 with no students or attempts retains sessions and zero statistics', async () => {
  const { overview: o, sessions } = await rpc('admin_get_module', ['Marketing', 3])
  for (const key of ['total_students','total_attempts','average_score','best_score','students_attempted','students_not_attempted']) assert.equal(o[key], 0)
  assert.equal(sessions.length, 1); assert.equal(sessions[0].question_count, 1)
  assert.equal((await rpc('admin_list_cohort_students', ['Marketing', 3])).total, 0)
  assert.equal((await rpc('admin_list_cohort_attempts', ['Marketing', 3])).total, 0)
})
test('student records use verified profile fields and server-side search/pagination', async () => {
  const a = await rpc('admin_list_cohort_students', ['Marketing', 1]), b = await rpc('admin_list_cohort_students', ['Marketing', 2])
  assert.deepEqual(a.rows.map(s => s.id), [uid(101)]); assert.deepEqual(b.rows.map(s => s.id), [uid(102)])
  assert.equal(a.rows[0].username, 'Amaya'); assert.equal(a.rows[0].phone, '0771111111'); assert.equal(a.rows[0].age, 14)
  assert.equal(a.rows[0].attempts, 2); assert.equal(a.rows[0].sessions_attempted, 2); assert.equal(b.rows[0].average_score, 0)
  assert.equal((await rpc('admin_list_cohort_students', ['Marketing', 1, ' AMA '])).total, 1)
  assert.equal((await rpc('admin_list_cohort_students', ['Marketing', 2, '077222'])).total, 1)
  assert.equal((await rpc('admin_list_cohort_students', ['Marketing', 1, 'Bimal'])).total, 0)
  assert.equal((await rpc('admin_list_cohort_students', ['Marketing', 1, '', 1, 1])).rows.length, 0)
  assert.equal((await rpc('admin_list_cohort_students', ['Marketing', 1, '', 25, 0, uid(102)])).total, 0)
})
test('attempt results filter/search/page in SQL and preserve inactive history', async () => {
  const args = ['Marketing', 1, '', null, null, 'score_asc', 1, 0, null, false]
  const first = await rpc('admin_list_cohort_attempts', args)
  assert.equal(first.total, 2); assert.equal(first.rows[0].id, uid(206))
  args[7] = 1; assert.equal((await rpc('admin_list_cohort_attempts', args)).rows[0].id, uid(201))
  assert.equal((await rpc('admin_list_cohort_attempts', ['Marketing', 1, '', uid(1)])).total, 1)
  assert.equal((await rpc('admin_list_cohort_attempts', ['Marketing', 2, 'BIM'])).total, 1)
  assert.equal((await rpc('admin_list_cohort_attempts', ['Marketing', 2, '077111'])).total, 1)
  assert.equal((await rpc('admin_list_cohort_attempts', ['Marketing', 1, '', uid(3)])).total, 0)
  const results = await rpc('admin_list_cohort_attempts', ['Marketing', 2, '', null, null, 'submitted_desc', 25, 0, null, true])
  assert.equal(results.total, 1); assert.equal(results.rows[0].id, uid(202))
  assert.equal(results.rows[0].username, 'Amaya'); assert.equal(results.rows[0].score, 100)
  assert.equal(results.rows[0].started_at, '2026-11-21T01:00:00+00:00')
  assert.equal(results.rows[0].submitted_at, '2026-11-21T01:05:00+00:00')
  await assert.rejects(rpc('admin_list_cohort_attempts', ['Marketing', 1, '', null, null, 'unsafe']), /invalid_sort/)
})
test('question banks share original records without crossing assigned session boundaries', async () => {
  assert.equal((await rpc('admin_list_cohort_questions', ['Marketing', 1])).total, 2)
  assert.deepEqual((await rpc('admin_list_cohort_questions', ['Marketing', 2])).rows.map(q => q.id), [uid(301)])
  assert.equal((await rpc('admin_list_cohort_questions', ['Marketing', 2, uid(2)])).total, 0)
})
test('answer review validates matching cohort, student and quiz_batch_id', async () => {
  const r = await rpc('admin_get_cohort_attempt', ['Marketing', 1, uid(201)])
  assert.equal(r.attempt.username, 'Amaya'); assert.equal(r.questions[0].selected_option, 'A'); assert.equal(r.questions[0].explanation, 'Because A')
  await assert.rejects(rpc('admin_get_cohort_attempt', ['Marketing', 2, uid(201)]), /attempt_not_found/)
  await assert.rejects(rpc('admin_get_cohort_attempt', ['Marketing', 1, uid(204)]), /attempt_not_found/)
  await assert.rejects(rpc('admin_get_module', ['Finance', 2]), /module_cohort_not_found/)
})
test('authenticated admins can use RPCs while direct RLS-protected table reads stay denied', async () => {
  await db.exec('set role authenticated')
  try {
    for (const [name, args] of publicCalls) assert.ok(await rpc(name, args))
    await assert.rejects(db.query('select * from public.student_profiles'), /permission denied/)
    await assert.rejects(db.query('select * from public.quiz_bank_questions'), /permission denied/)
    await assert.rejects(rpc('admin_cohort_member_ids', [1]), /permission denied/)
    await assert.rejects(rpc('admin_cohort_attempt_rows', ['Marketing', 1]), /permission denied/)
  } finally { await db.exec('reset role') }
})
test('anonymous, inactive-admin and ordinary student identities cannot use admin RPCs', async () => {
  for (const identity of ['', uid(901), uid(101)]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [identity])
    await db.exec('set role authenticated')
    try { for (const [name, args] of publicCalls) await assert.rejects(rpc(name, args), /admin_access_required/) }
    finally { await db.exec('reset role') }
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(900)])
  await db.exec('set role anon')
  try { for (const [name, args] of publicCalls) await assert.rejects(rpc(name, args), /permission denied/) }
  finally { await db.exec('reset role') }
})
test('reapplying the migration is safe and still leaves global functions unchanged', async () => {
  await db.exec(migration)
  assert.deepEqual(await definitions(), originalDefinitions)
  assert.deepEqual(await rpc('admin_list_modules'), originalModules)
})
