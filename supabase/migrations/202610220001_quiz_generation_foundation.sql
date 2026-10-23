-- Text-only replacement for the not-yet-installed foundation. No Storage DDL.
-- Existing save_quiz_question() and student-facing functions stay unchanged.
begin;
do $$ declare missing text; vs text; begin
  select string_agg(c.t||'.'||c.c,', ') into missing from (values
    ('quiz_batches','id'),('quiz_batches','module_name'),('quiz_batches','session_name'),('quiz_batches','session_date'),
    ('quiz_batches','status'),('quiz_batches','bank_size_target'),('quiz_batches','question_count_per_student'),('quiz_batches','completed_at'),
    ('quiz_bank_questions','id'),('quiz_bank_questions','batch_id'),('quiz_bank_questions','question_text'),
    ('quiz_bank_questions','option_a'),('quiz_bank_questions','option_b'),('quiz_bank_questions','option_c'),('quiz_bank_questions','option_d'),
    ('quiz_bank_questions','correct_option'),('quiz_bank_questions','topic'),('quiz_bank_questions','difficulty'),('quiz_bank_questions','embedding'),
    ('quiz_attempts','id'),('quiz_attempts','batch_id'),('admin_users','user_id'),('admin_users','is_active')
  ) c(t,c) where not exists(select 1 from information_schema.columns i where i.table_schema='public' and i.table_name=c.t and i.column_name=c.c);
  if missing is not null then raise exception 'Missing production schema dependencies: %',missing; end if;
  select n.nspname into vs from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector';
  if vs is null or vs not in ('public','extensions') then raise exception 'Enable pgvector in public or extensions first'; end if;
  if not exists(select 1 from pg_attribute a join pg_type t on t.oid=a.atttypid where a.attrelid='public.quiz_bank_questions'::regclass
    and a.attname='embedding' and t.typname='vector' and a.atttypmod in (-1,1536)) then raise exception 'Bank embedding must be vector or vector(1536)'; end if;
end; $$;

set local search_path=public,extensions,pg_temp;

create table if not exists public.quiz_generation_config (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false,
  max_pdf_bytes integer not null default 20971520 check(max_pdf_bytes between 1024 and 20971520),
  disabled_reason text not null default 'Automatic generation is not enabled.',cleanup_ready boolean not null default false
);
alter table public.quiz_generation_config add column if not exists cleanup_ready boolean not null default false;
insert into public.quiz_generation_config(singleton) values(true) on conflict do nothing;
create table if not exists public.quiz_generation_reserved_banks (
  bank_id uuid primary key references public.quiz_batches(id),administrator_id uuid not null references auth.users(id),reserved_at timestamptz not null default now()
);
create table if not exists public.quiz_generation_jobs (
  job_id uuid primary key default gen_random_uuid(),bank_id uuid not null references public.quiz_batches(id),administrator_id uuid not null references auth.users(id),
  request_id uuid not null,status text not null default 'extracting' check(status in ('extracting','structuring','generating','validating','publishing','completed','failed')),
  session_context jsonb not null,source_text text,source_hash text not null,file_bytes integer not null check(file_bytes between 1 and 20971520),
  page_count integer not null check(page_count between 1 and 200),lesson_plan jsonb,generated_questions jsonb,review_passed boolean not null default false,step_running text,
  requested_question_count integer not null default 30 check(requested_question_count=30),runtime_quiz_size integer not null default 10 check(runtime_quiz_size=10),
  required_distribution jsonb not null default '{"easy":12,"medium":12,"hard":6}' check(required_distribution='{"easy":12,"medium":12,"hard":6}'::jsonb),
  actual_question_count integer not null default 0 check(actual_question_count between 0 and 30),published_question_count integer not null default 0 check(published_question_count in (0,30)),
  publication_id uuid unique,error_reason text,n8n_execution_reference text,worker_token uuid,dispatch_lease_until timestamptz,dispatch_attempts integer not null default 0,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '2 hours',completed_at timestamptz,
  unique(administrator_id,request_id),
  check((status='completed' and actual_question_count=30 and published_question_count=30 and publication_id is not null and completed_at is not null and error_reason is null)
    or (status<>'completed' and published_question_count=0 and publication_id is null and completed_at is null)),check(status<>'failed' or error_reason is not null)
);
-- Also tolerate an older partially installed local foundation. Old path fields
-- become optional and are never read or written by the new pipeline.
alter table public.quiz_generation_jobs add column if not exists source_text text;
alter table public.quiz_generation_jobs add column if not exists source_hash text;
alter table public.quiz_generation_jobs add column if not exists file_bytes integer;
alter table public.quiz_generation_jobs add column if not exists page_count integer;
alter table public.quiz_generation_jobs add column if not exists generated_questions jsonb;
alter table public.quiz_generation_jobs add column if not exists review_passed boolean not null default false;
alter table public.quiz_generation_jobs add column if not exists step_running text;
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='quiz_generation_jobs' and column_name='storage_path') then
    alter table public.quiz_generation_jobs alter column storage_path drop not null;
    alter table public.quiz_generation_jobs alter column upload_size drop not null;
  end if;
end; $$;
create unique index if not exists quiz_generation_one_active_bank on public.quiz_generation_jobs(bank_id) where status not in ('completed','failed');
create unique index if not exists quiz_generation_one_active_admin on public.quiz_generation_jobs(administrator_id) where status not in ('completed','failed');
create index if not exists quiz_generation_jobs_recent on public.quiz_generation_jobs(administrator_id,created_at desc);
create table if not exists public.quiz_generation_draft_questions (
  draft_id uuid primary key default gen_random_uuid(),job_id uuid not null references public.quiz_generation_jobs(job_id),
  question_text text not null check(length(trim(question_text)) between 1 and 4000),
  option_a text not null check(length(trim(option_a)) between 1 and 4000),option_b text not null check(length(trim(option_b)) between 1 and 4000),
  option_c text not null check(length(trim(option_c)) between 1 and 4000),option_d text not null check(length(trim(option_d)) between 1 and 4000),
  correct_option text not null check(correct_option in ('A','B','C','D')),topic text not null check(length(trim(topic)) between 1 and 300),
  difficulty text not null check(difficulty in ('easy','medium','hard')),source_quote text not null check(length(trim(source_quote)) between 20 and 4000),
  embedding double precision[] not null check(cardinality(embedding)=1536),normalized_question text not null,created_at timestamptz not null default now(),unique(job_id,normalized_question)
);
alter table public.quiz_generation_config enable row level security;
alter table public.quiz_generation_jobs enable row level security;
alter table public.quiz_generation_draft_questions enable row level security;
alter table public.quiz_generation_reserved_banks enable row level security;
revoke all on public.quiz_generation_config,public.quiz_generation_jobs,public.quiz_generation_draft_questions,public.quiz_generation_reserved_banks from public,anon,authenticated,service_role;
grant select(job_id,administrator_id,status,created_at) on public.quiz_generation_jobs to service_role;

create or replace function public.quiz_generation_require_admin(p_admin uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if not exists(select 1 from public.admin_users where user_id=p_admin and is_active) then raise exception 'Active administrator access required' using errcode='42501'; end if;
end; $$;
create or replace function public.quiz_generation_readiness()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('enabled',enabled and cleanup_ready,'reason',case when not cleanup_ready then 'Temporary text cleanup schedule is not installed.'
    when not enabled then disabled_reason else null end,'max_pdf_bytes',max_pdf_bytes) from public.quiz_generation_config where singleton;
$$;
create or replace function public.quiz_generation_eligibility()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_object_agg(r.bank_id,jsonb_build_object('eligible',not exists(select 1 from public.quiz_generation_jobs j where j.bank_id=r.bank_id and j.status not in ('failed','completed')),
    'reason',case when exists(select 1 from public.quiz_generation_jobs j where j.bank_id=r.bank_id and j.status not in ('failed','completed')) then 'A generation job is already active.' else null end)),'{}'::jsonb)
  from public.quiz_generation_reserved_banks r;
$$;

-- Database-owner-only enrollment after operator excludes this bank from legacy
-- runs. Locks wait for existing writers; guards reject later legacy writes.
create or replace function public.quiz_generation_reserve_bank(p_bank uuid,p_admin uuid,p_legacy_quiesced boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare b public.quiz_batches; begin
  perform public.quiz_generation_require_admin(p_admin);
  if p_legacy_quiesced is distinct from true then raise exception 'GEN:Confirm this session has no active legacy execution and is excluded from future legacy runs before reserving it.'; end if;
  lock table public.quiz_batches,public.quiz_bank_questions,public.quiz_attempts in share row exclusive mode;
  select * into b from public.quiz_batches where id=p_bank for update;
  if not found then raise exception 'GEN:Session not found.'; end if;
  if b.status::text='completed' or exists(select 1 from public.quiz_bank_questions where batch_id=p_bank) or exists(select 1 from public.quiz_attempts where batch_id=p_bank)
    then raise exception 'GEN:Existing question bank is already in use.'; end if;
  if exists(select 1 from public.quiz_generation_jobs where bank_id=p_bank and status not in ('completed','failed')) then raise exception 'GEN:A generation job is already active.'; end if;
  insert into public.quiz_generation_reserved_banks(bank_id,administrator_id) values(p_bank,p_admin) on conflict do nothing;
end; $$;

create or replace function public.quiz_generation_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare bank uuid; old_bank uuid; state text; permit boolean; begin
  if tg_table_name='quiz_batches' then
    bank:=case when tg_op='DELETE' then old.id else new.id end;
    if tg_op='UPDATE' then old_bank:=old.id; end if;
  else
    bank:=case when tg_op='DELETE' then old.batch_id else new.batch_id end;
    if tg_op='UPDATE' then old_bank:=old.batch_id; end if;
  end if;
  if tg_table_name='quiz_attempts' then
    select status::text into state from public.quiz_batches where id=bank for share;
    if exists(select 1 from public.quiz_generation_reserved_banks where bank_id=bank) and state<>'completed' then raise exception 'GEN:This question bank is not published yet.'; end if;
    return new;
  end if;
  if exists(select 1 from public.quiz_generation_reserved_banks where bank_id in (bank,old_bank)) then
    select exists(select 1 from public.quiz_generation_jobs j where j.job_id::text=current_setting('quiz_generation.publication_job',true)
      and j.worker_token::text=current_setting('quiz_generation.publication_token',true) and j.bank_id=bank and j.status='publishing') into permit;
    if not permit or tg_op='DELETE' or (old_bank is not null and old_bank<>bank) then raise exception 'GEN:This bank is reserved for atomic publication; legacy writes are blocked.'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists quiz_generation_bank_guard on public.quiz_batches;
create trigger quiz_generation_bank_guard before update or delete on public.quiz_batches for each row execute function public.quiz_generation_guard();
drop trigger if exists quiz_generation_question_guard on public.quiz_bank_questions;
create trigger quiz_generation_question_guard before insert or update or delete on public.quiz_bank_questions for each row execute function public.quiz_generation_guard();
drop trigger if exists quiz_generation_attempt_guard on public.quiz_attempts;
create trigger quiz_generation_attempt_guard before insert on public.quiz_attempts for each row execute function public.quiz_generation_guard();

create or replace function public.quiz_generation_public_job(p_job uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('job_id',job_id,'bank_id',bank_id,'status',status,'session_context',session_context,'actual_question_count',actual_question_count,
    'published_question_count',published_question_count,'publication_id',publication_id,'error_reason',error_reason,'created_at',created_at,'updated_at',updated_at,'completed_at',completed_at,'expires_at',expires_at)
  from public.quiz_generation_jobs where job_id=p_job;
$$;
create or replace function public.quiz_generation_submit(p_admin uuid,p_bank uuid,p_request uuid,p_text text,p_file_bytes integer,p_pages integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ declare j public.quiz_generation_jobs; b public.quiz_batches; fingerprint text; begin
  perform public.quiz_generation_require_admin(p_admin);
  if p_text is null or length(regexp_replace(p_text,'[[:space:]]','','g'))<200 or length(p_text)>120000 or octet_length(p_text)>480000
    or p_file_bytes is null or p_file_bytes not between 1 and (select max_pdf_bytes from public.quiz_generation_config where singleton)
    or p_pages is null or p_pages not between 1 and 200 or p_request is null then raise exception 'GEN:Invalid or oversized lesson text.'; end if;
  fingerprint:=encode(sha256(convert_to(p_text,'UTF8')),'hex');
  perform 1 from public.admin_users where user_id=p_admin for update;
  select * into j from public.quiz_generation_jobs where administrator_id=p_admin and request_id=p_request;
  if found then
    if j.bank_id<>p_bank or j.source_hash<>fingerprint then raise exception 'GEN:Idempotency key belongs to another lesson.'; end if;
    return public.quiz_generation_public_job(j.job_id);
  end if;
  if not coalesce((public.quiz_generation_readiness()->>'enabled')::boolean,false) then raise exception 'GEN:Generator setup or cleanup schedule is not enabled.'; end if;
  select * into b from public.quiz_batches where id=p_bank for update;
  if not found then raise exception 'GEN:Session not found.'; end if;
  if not exists(select 1 from public.quiz_generation_reserved_banks where bank_id=p_bank) then raise exception 'GEN:Session requires exclusive automatic-generator reservation.'; end if;
  if b.status::text='completed' or exists(select 1 from public.quiz_bank_questions where batch_id=p_bank) or exists(select 1 from public.quiz_attempts where batch_id=p_bank)
    then raise exception 'GEN:Existing question bank is already in use.'; end if;
  if exists(select 1 from public.quiz_generation_jobs where (bank_id=p_bank or administrator_id=p_admin) and status not in ('completed','failed')) then raise exception 'GEN:A generation job is already active.'; end if;
  insert into public.quiz_generation_jobs(bank_id,administrator_id,request_id,status,session_context,source_text,source_hash,file_bytes,page_count)
  values(p_bank,p_admin,p_request,'extracting',jsonb_build_object('bank_id',b.id,'module_name',b.module_name,'session_name',b.session_name,
    'session_date',b.session_date,'bank_size',30,'runtime_quiz_size',10),p_text,fingerprint,p_file_bytes,p_pages) returning * into j;
  return public.quiz_generation_public_job(j.job_id);
end; $$;
create or replace function public.quiz_generation_dispatch(p_job uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$ begin
  update public.quiz_generation_jobs set dispatch_lease_until=now()+interval '30 seconds',dispatch_attempts=dispatch_attempts+1,updated_at=now()
  where job_id=p_job and status='extracting' and worker_token is null and expires_at>now() and (dispatch_lease_until is null or dispatch_lease_until<now());
  return found;
end; $$;
create or replace function public.quiz_generation_claim(p_job uuid,p_execution text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ declare j public.quiz_generation_jobs; begin
  if p_execution is null or length(p_execution) not between 1 and 200 then raise exception 'GEN:Invalid execution reference.'; end if;
  select * into j from public.quiz_generation_jobs where job_id=p_job for update;
  if not found or j.status<>'extracting' or j.worker_token is not null or j.expires_at<=now() then return null; end if;
  perform public.quiz_generation_require_admin(j.administrator_id);
  update public.quiz_generation_jobs set worker_token=gen_random_uuid(),n8n_execution_reference=p_execution,status='structuring',updated_at=now() where job_id=p_job returning * into j;
  return jsonb_build_object('job_id',j.job_id,'token',j.worker_token,'claimed',true);
end; $$;
create or replace function public.quiz_generation_worker(p_job uuid,p_token uuid)
returns public.quiz_generation_jobs language plpgsql security definer set search_path=public,pg_temp as $$ declare j public.quiz_generation_jobs; begin
  select * into j from public.quiz_generation_jobs where job_id=p_job for update;
  if not found or p_token is null or j.worker_token is distinct from p_token or j.expires_at<=now() or j.status in ('failed','completed') then raise exception 'GEN:Job lease is invalid, expired, or finished.'; end if;
  perform public.quiz_generation_require_admin(j.administrator_id);
  return j;
end; $$;
create or replace function public.quiz_generation_begin_step(p_job uuid,p_token uuid,p_step text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ declare j public.quiz_generation_jobs; begin
  j:=public.quiz_generation_worker(p_job,p_token);
  if p_step is null or p_step not in ('structuring','generating','validating','publishing') or j.status<>p_step then raise exception 'GEN:Unexpected processing stage.'; end if;
  if j.step_running is not null then raise exception 'GEN:This processing step is already running.'; end if;
  update public.quiz_generation_jobs set step_running=p_step,updated_at=now() where job_id=p_job;
  return to_jsonb(j);
end; $$;
create or replace function public.quiz_generation_commit_step(p_job uuid,p_token uuid,p_step text,p_result jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare j public.quiz_generation_jobs; begin
  j:=public.quiz_generation_worker(p_job,p_token);
  if j.status<>p_step or j.step_running is distinct from p_step then raise exception 'GEN:Unexpected processing stage.'; end if;
  if p_step='structuring' then
    if p_result is null or jsonb_typeof(p_result->'lesson_plan') is distinct from 'object'
      or p_result->>'module_name' is distinct from j.session_context->>'module_name' or p_result->>'session_name' is distinct from j.session_context->>'session_name'
      or p_result->>'session_date' is distinct from j.session_context->>'session_date' or p_result->>'bank_size' is distinct from '30' or p_result->>'runtime_quiz_size' is distinct from '10'
      then raise exception 'GEN:Invalid lesson content.'; end if;
    update public.quiz_generation_jobs set lesson_plan=p_result,status='generating',step_running=null,updated_at=now() where job_id=p_job;
  elsif p_step='generating' then
    if jsonb_typeof(p_result) is distinct from 'array' or jsonb_array_length(p_result)<>30 then raise exception 'GEN:AI generation incomplete.'; end if;
    update public.quiz_generation_jobs set generated_questions=p_result,status='validating',step_running=null,updated_at=now() where job_id=p_job;
  else raise exception 'GEN:Unsupported processing stage.'; end if;
end; $$;

create or replace function public.quiz_generation_vector(p_values double precision[])
returns vector language plpgsql immutable set search_path=public,extensions,pg_temp as $$ begin
  if p_values is null or array_ndims(p_values)<>1 or cardinality(p_values)<>1536
    or exists(select 1 from unnest(p_values) x where x is null or x='NaN'::float8 or abs(x)>1e10)
    or (select sum(x*x) from unnest(p_values) x)=0 then raise exception 'GEN:Invalid embedding.'; end if;
  return p_values::vector(1536);
end; $$;
create or replace function public.quiz_generation_normalize(p_text text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select trim(regexp_replace(lower(normalize(p_text,NFKC)),'[^[:alnum:]]+',' ','g'));
$$;
create or replace function public.quiz_generation_validate_drafts(p_job uuid)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$ declare source text; begin
  select regexp_replace(normalize(source_text,NFKC),'[[:space:]]+',' ','g') into source from public.quiz_generation_jobs where job_id=p_job;
  if source is null then raise exception 'GEN:Lesson source is unavailable.'; end if;
  if (select count(*) from public.quiz_generation_draft_questions where job_id=p_job)<>30
    or (select count(*) from public.quiz_generation_draft_questions where job_id=p_job and difficulty='easy')<>12
    or (select count(*) from public.quiz_generation_draft_questions where job_id=p_job and difficulty='medium')<>12
    or (select count(*) from public.quiz_generation_draft_questions where job_id=p_job and difficulty='hard')<>6 then raise exception 'GEN:Expected exactly 30 questions with 12/12/6 difficulty distribution.'; end if;
  if exists(select 1 from public.quiz_generation_draft_questions d where job_id=p_job and
    (position(regexp_replace(normalize(d.source_quote,NFKC),'[[:space:]]+',' ','g') in source)=0 or
     (select count(distinct public.quiz_generation_normalize(x)) from unnest(array[d.option_a,d.option_b,d.option_c,d.option_d]) x)<>4))
    then raise exception 'GEN:Invalid source evidence or answer options.'; end if;
  perform public.quiz_generation_vector(embedding) from public.quiz_generation_draft_questions where job_id=p_job;
  if exists(select 1 from public.quiz_generation_draft_questions a join public.quiz_generation_draft_questions b
    on a.job_id=b.job_id and a.draft_id<b.draft_id where a.job_id=p_job and
      (public.quiz_generation_normalize(a.question_text)=public.quiz_generation_normalize(b.question_text)
       or 1-(public.quiz_generation_vector(a.embedding)<=>public.quiz_generation_vector(b.embedding))>=0.88))
    then raise exception 'GEN:Duplicate or semantically similar questions (threshold 0.88).'; end if;
end; $$;
create or replace function public.quiz_generation_stage(p_job uuid,p_token uuid,p_questions jsonb,p_review jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare j public.quiz_generation_jobs; q jsonb; review_count integer; begin
  j:=public.quiz_generation_worker(p_job,p_token);
  if j.status<>'validating' or j.step_running is distinct from 'validating' then raise exception 'GEN:Unexpected validation stage.'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)<>30
    or jsonb_typeof(p_review) is distinct from 'array' or jsonb_array_length(p_review)<>30 then raise exception 'GEN:AI validation incomplete.'; end if;
  select count(distinct (r->>'index')::int) into review_count from jsonb_array_elements(p_review) r
    where (r->>'index')::int between 0 and 29 and r->>'supported'='true' and r->>'one_correct_answer'='true' and r->>'accurate'='true';
  if review_count<>30 then raise exception 'GEN:Automatic source and answer validation failed.'; end if;
  if exists(select 1 from public.quiz_generation_draft_questions where job_id=p_job) then raise exception 'GEN:Drafts already staged.'; end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    insert into public.quiz_generation_draft_questions(job_id,question_text,option_a,option_b,option_c,option_d,correct_option,topic,difficulty,source_quote,embedding,normalized_question)
    values(p_job,q->>'question_text',q->>'option_a',q->>'option_b',q->>'option_c',q->>'option_d',q->>'correct_option',q->>'topic',q->>'difficulty',q->>'source_quote',
      array(select jsonb_array_elements_text(q->'embedding')::float8),public.quiz_generation_normalize(q->>'question_text'));
  end loop;
  perform public.quiz_generation_validate_drafts(p_job);
  update public.quiz_generation_jobs set status='publishing',step_running=null,review_passed=true,actual_question_count=30,generated_questions=null,updated_at=now() where job_id=p_job;
end; $$;
create or replace function public.quiz_generation_publish(p_job uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$ declare j public.quiz_generation_jobs; b public.quiz_batches; inserted integer; begin
  select * into j from public.quiz_generation_jobs where job_id=p_job for update;
  if not found or p_token is null or j.worker_token is distinct from p_token then raise exception 'GEN:Invalid publication token.'; end if;
  perform public.quiz_generation_require_admin(j.administrator_id);
  if j.status='completed' then return public.quiz_generation_public_job(p_job); end if;
  if j.expires_at<=now() or j.status<>'publishing' or not j.review_passed then raise exception 'GEN:Job is not validated for publication.'; end if;
  -- Attempt INSERT guard takes FOR SHARE on this same row, preventing races.
  select * into b from public.quiz_batches where id=j.bank_id for update;
  if not exists(select 1 from public.quiz_generation_reserved_banks where bank_id=j.bank_id) then raise exception 'GEN:Bank reservation is missing.'; end if;
  if b.status::text='completed' or exists(select 1 from public.quiz_bank_questions where batch_id=j.bank_id)
    or exists(select 1 from public.quiz_attempts where batch_id=j.bank_id) then raise exception 'GEN:Existing question bank is already in use.'; end if;
  if j.session_context->>'module_name' is distinct from b.module_name::text or j.session_context->>'session_name' is distinct from b.session_name::text
    or j.session_context->>'session_date' is distinct from b.session_date::text then raise exception 'GEN:Session metadata changed.'; end if;
  perform public.quiz_generation_validate_drafts(p_job);
  perform set_config('quiz_generation.publication_job',p_job::text,true);
  perform set_config('quiz_generation.publication_token',p_token::text,true);
  -- Destination enum/domain types are respected, including pgvector conversion.
  insert into public.quiz_bank_questions(batch_id,question_text,option_a,option_b,option_c,option_d,correct_option,topic,difficulty,embedding)
  select r.batch_id,r.question_text,r.option_a,r.option_b,r.option_c,r.option_d,r.correct_option,r.topic,r.difficulty,r.embedding
  from public.quiz_generation_draft_questions d cross join lateral jsonb_populate_record(null::public.quiz_bank_questions,jsonb_build_object(
    'batch_id',j.bank_id,'question_text',d.question_text,'option_a',d.option_a,'option_b',d.option_b,'option_c',d.option_c,'option_d',d.option_d,
    'correct_option',d.correct_option,'topic',d.topic,'difficulty',d.difficulty,'embedding',public.quiz_generation_vector(d.embedding)::text)) r where d.job_id=p_job;
  get diagnostics inserted=row_count;
  if inserted<>30 or (select count(*) from public.quiz_bank_questions where batch_id=j.bank_id)<>30
    or (select count(*) from public.quiz_bank_questions where batch_id=j.bank_id and difficulty::text='easy')<>12
    or (select count(*) from public.quiz_bank_questions where batch_id=j.bank_id and difficulty::text='medium')<>12
    or (select count(*) from public.quiz_bank_questions where batch_id=j.bank_id and difficulty::text='hard')<>6 then raise exception 'GEN:Database publication count mismatch.'; end if;
  update public.quiz_batches set bank_size_target=30,question_count_per_student=10,status='completed',completed_at=now() where id=j.bank_id;
  update public.quiz_generation_jobs set status='completed',publication_id=gen_random_uuid(),published_question_count=30,
    actual_question_count=30,completed_at=now(),updated_at=now(),step_running=null,error_reason=null where job_id=p_job;
  perform set_config('quiz_generation.publication_job','',true);
  perform set_config('quiz_generation.publication_token','',true);
  return public.quiz_generation_public_job(p_job);
end; $$;
-- Erase temporary source, lesson JSON, candidate questions and drafts on every
-- terminal transition. Only published questions and non-content audit remain.
create or replace function public.quiz_generation_clear_source()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if new.status in ('completed','failed') then
    new.source_text:=null; new.lesson_plan:=null; new.generated_questions:=null; new.step_running:=null;
    if new.status='failed' then new.worker_token:=null; end if;
  end if;
  return new;
end; $$;
create or replace function public.quiz_generation_clear_drafts()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if new.status in ('completed','failed') then delete from public.quiz_generation_draft_questions where job_id=new.job_id; end if;
  return new;
end; $$;
drop trigger if exists quiz_generation_clear_source on public.quiz_generation_jobs;
create trigger quiz_generation_clear_source before insert or update on public.quiz_generation_jobs for each row execute function public.quiz_generation_clear_source();
drop trigger if exists quiz_generation_clear_drafts on public.quiz_generation_jobs;
create trigger quiz_generation_clear_drafts after insert or update on public.quiz_generation_jobs for each row execute function public.quiz_generation_clear_drafts();
create or replace function public.quiz_generation_fail_worker(p_job uuid,p_execution text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
  update public.quiz_generation_jobs set status='failed',error_reason='Automatic generation failed. No questions were published.',updated_at=now()
  where job_id=p_job and n8n_execution_reference=p_execution and status not in ('completed','failed');
end; $$;
create or replace function public.quiz_generation_fail(p_job uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
  update public.quiz_generation_jobs set status='failed',error_reason=left(p_reason,500),updated_at=now() where job_id=p_job and status not in ('completed','failed');
end; $$;
create or replace function public.quiz_generation_expire()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$ declare affected integer; begin
  update public.quiz_generation_jobs set status='failed',error_reason='Processing expired. No questions were published. Please submit again.',updated_at=now()
  where status not in ('completed','failed') and expires_at<=now();
  get diagnostics affected=row_count;
  return affected;
end; $$;
create or replace function public.quiz_generation_pending()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ begin
  perform public.quiz_generation_expire();
  return coalesce((select jsonb_agg(job_id) from (select job_id from public.quiz_generation_jobs where status='extracting'
    and expires_at>now() and worker_token is null order by created_at limit 10) j),'[]'::jsonb);
end; $$;
drop function if exists public.quiz_generation_prepare(uuid,uuid,uuid,integer);
drop function if exists public.quiz_generation_choices(uuid);
drop function if exists public.quiz_generation_advance(uuid,uuid,text,text,jsonb);
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,16)='quiz_generation_'
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end; $$;
grant execute on function public.quiz_generation_readiness(),public.quiz_generation_eligibility(),public.quiz_generation_public_job(uuid),
  public.quiz_generation_submit(uuid,uuid,uuid,text,integer,integer),public.quiz_generation_dispatch(uuid),public.quiz_generation_claim(uuid,text),
  public.quiz_generation_begin_step(uuid,uuid,text),public.quiz_generation_commit_step(uuid,uuid,text,jsonb),public.quiz_generation_stage(uuid,uuid,jsonb,jsonb),
  public.quiz_generation_publish(uuid,uuid),public.quiz_generation_fail_worker(uuid,text),public.quiz_generation_fail(uuid,text),public.quiz_generation_expire(),public.quiz_generation_pending() to service_role;
-- reserve_bank stays database-owner only, not browser or n8n accessible.
notify pgrst,'reload schema';
commit;
