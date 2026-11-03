-- READ ONLY: run after applying the reviewed migration.
-- Public RPCs: authenticated_execute=true, anon_execute=false.
-- Internal helpers: both false. All functions: security_definer=true.
with expected(signature, internal) as (values
  ('public.admin_cohort_member_ids(integer)', true),
  ('public.admin_require_module_cohort(text,integer)', true),
  ('public.admin_cohort_attempt_rows(text,integer)', true),
  ('public.admin_list_cohort_modules()', false),
  ('public.admin_get_module_cohorts(text)', false),
  ('public.admin_get_module(text,integer)', false),
  ('public.admin_list_cohort_students(text,integer,text,integer,integer,uuid)', false),
  ('public.admin_list_cohort_attempts(text,integer,text,uuid,text,text,integer,integer,uuid,boolean)', false),
  ('public.admin_list_cohort_questions(text,integer,uuid,integer,integer)', false),
  ('public.admin_get_cohort_attempt(text,integer,uuid)', false)
)
select e.signature, e.internal, p.oid is not null as installed,
  pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  p.proargnames as parameter_names
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
order by e.internal desc, e.signature;

-- These original global functions must still exist. Their definitions and grants
-- should match your pre-migration snapshot.
select p.oid::regprocedure as signature, pg_get_functiondef(p.oid) as definition,
       p.proacl as grants
from pg_proc p where p.oid in (
  to_regprocedure('public.admin_list_modules()'),
  to_regprocedure('public.admin_get_module(text)')
);
