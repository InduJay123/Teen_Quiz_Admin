-- READ ONLY. Run manually in the intended Supabase SQL editor and provide the
-- output for review. No data rows, keys, or credentials are requested.
select table_name, column_name, data_type, udt_schema, udt_name, is_nullable, column_default
from information_schema.columns where table_schema = 'public' and table_name in
 ('quiz_batches','quiz_bank_questions','quiz_attempts','quiz_attempt_questions','admin_users',
  'student_cohorts','student_cohort_schedules','quiz_attempt_cohorts')
order by table_name, ordinal_position;

select c.conrelid::regclass as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid in
 ('public.quiz_batches'::regclass,'public.quiz_bank_questions'::regclass,'public.quiz_attempts'::regclass,'public.quiz_attempt_questions'::regclass);

select p.oid::regprocedure as function_signature, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and
 (p.proname = 'save_quiz_question' or p.prosrc ilike '%quiz_bank_questions%' or p.prosrc ilike '%quiz_attempt_questions%');

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where (schemaname = 'public' and tablename in ('quiz_batches','quiz_bank_questions','quiz_attempts'))
 or (schemaname = 'storage' and tablename = 'objects');

select tgrelid::regclass as table_name, tgname, pg_get_triggerdef(oid) as definition
from pg_trigger where not tgisinternal and tgrelid in
 ('public.quiz_batches'::regclass,'public.quiz_bank_questions'::regclass,'public.quiz_attempts'::regclass);
