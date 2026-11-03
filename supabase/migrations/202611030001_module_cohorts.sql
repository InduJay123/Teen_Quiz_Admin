-- REVIEW BEFORE APPLYING: additive, read-only cohort admin RPC layer.
-- Uses the user-verified student_profiles/cohort schema.
-- Does not replace global admin RPCs, change RLS, or write student/quiz data.
-- Apply as the same trusted owner as existing admin SECURITY DEFINER functions.
-- See ../COHORT_SETUP.md for manual deployment and verification instructions.
begin;

do $$
begin
  if to_regprocedure('public.admin_require_access()') is null
     or to_regprocedure('public.admin_score(jsonb)') is null
     or to_regprocedure('public.admin_attempt_status(jsonb)') is null
     or to_regprocedure('public.admin_attempt_time(jsonb)') is null then
    raise exception 'Install the existing admin authorization and normalization helpers first';
  end if;
  if exists (select 1 from public.student_cohort_schedules
             group by cohort_id, quiz_batch_id having count(*) > 1) then
    raise exception 'Duplicate cohort/session schedules require review before installing cohort analytics';
  end if;
end;
$$;

-- Verified membership: one profile per account. No student/enrolment inference.
create or replace function public.admin_cohort_member_ids(p_cohort_id integer)
returns setof uuid language plpgsql stable security definer
set search_path to 'pg_catalog', 'public' as $$
begin
  perform public.admin_require_access();
  return query
  select distinct sp.user_id from public.student_profiles sp
  where sp.cohort_id = p_cohort_id and sp.user_id is not null;
end;
$$;

-- Shared scope validator. Invalid selections never fall back to all cohorts.
create or replace function public.admin_require_module_cohort(p_module_name text, p_cohort_id integer)
returns void language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.admin_require_access();
  if p_module_name is null or p_cohort_id is null or not exists (
    select 1 from public.student_cohort_schedules s
    join public.quiz_batches b on b.id = s.quiz_batch_id
    join public.student_cohorts c on c.id = s.cohort_id
    where b.module_name = p_module_name and c.id = p_cohort_id
  ) then raise exception 'module_cohort_not_found' using errcode = '22023'; end if;
end;
$$;

-- EXISTS preserves one row per attempt even with duplicate mapping rows.
-- Unmapped or inconsistent historical attempts are excluded, never inferred.
-- is_active is intentionally NOT a history filter; inactive mappings retain attribution.
create or replace function public.admin_cohort_attempt_rows(p_module_name text, p_cohort_id integer)
returns table(id uuid, student_id uuid, batch_id uuid, session_name text,
  username text, score numeric, correct_count integer, total_questions integer,
  status text, started_at timestamptz, submitted_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.admin_require_access();
  perform public.admin_require_module_cohort(p_module_name, p_cohort_id);
  return query
  select a.id, a.student_id, a.batch_id, b.session_name,
    coalesce(nullif(p.username, ''), a.student_id::text),
    -- Alias verified fields for older admin_score implementations without changing
    -- the shared helper or its global consumers.
    public.admin_score(to_jsonb(a) || jsonb_build_object(
      'score_percent', a.score_percentage, 'correct_count', a.correct_answers)),
    a.correct_answers::integer, a.total_questions::integer,
    public.admin_attempt_status(to_jsonb(a)),
    -- Narrow timestamp projections preserve distinct started/submitted columns
    -- while supporting admin_attempt_time's existing created_at fallback.
    public.admin_attempt_time(jsonb_build_object('started_at',a.started_at,'created_at',a.started_at)),
    public.admin_attempt_time(jsonb_build_object('submitted_at',a.submitted_at,'created_at',a.submitted_at))
  from public.quiz_attempts a join public.quiz_batches b on b.id = a.batch_id
  left join public.student_profiles p on p.user_id = a.student_id
  where b.module_name = p_module_name
    and exists (select 1 from public.student_cohort_schedules s
                where s.cohort_id = p_cohort_id and s.quiz_batch_id = a.batch_id)
    and exists (select 1 from public.quiz_attempt_cohorts c
                where c.cohort_id = p_cohort_id and c.attempt_id = a.id
                  and c.student_id = a.student_id and c.quiz_batch_id = a.batch_id);
end;
$$;

-- Separate catalog: leave admin_list_modules() and admin_get_module(text) untouched.
create or replace function public.admin_list_cohort_modules()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  with modules as (
    select b.module_name, replace(b.module_name, '_', ' ') as module_title,
      count(*) as session_count,
      case when count(distinct b.status) = 1 then min(b.status) else 'mixed' end as status,
      (select count(distinct s.cohort_id) from public.student_cohort_schedules s
       join public.quiz_batches x on x.id = s.quiz_batch_id
       join public.student_cohorts c on c.id = s.cohort_id
       where x.module_name = b.module_name) as cohort_count,
      (select count(*) from public.quiz_bank_questions q
       join public.quiz_batches x on x.id = q.batch_id
       where x.module_name = b.module_name) as question_count
    from public.quiz_batches b group by b.module_name
  ) select coalesce(jsonb_agg(to_jsonb(m) order by m.module_name), '[]'::jsonb)
    into v_result from modules m;
  return v_result;
end;
$$;

create or replace function public.admin_get_module_cohorts(p_module_name text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  if not exists(select 1 from public.quiz_batches where module_name = p_module_name)
    then raise exception 'module_not_found'; end if;
  select jsonb_build_object('module_name', p_module_name, 'cohorts',
    coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'display_name',c.display_name,'status',c.status,'start_date',c.start_date) order by c.id)
      from public.student_cohorts c where exists (
        select 1 from public.student_cohort_schedules s
        join public.quiz_batches b on b.id = s.quiz_batch_id
        where s.cohort_id = c.id and b.module_name = p_module_name)), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

-- Two-argument overload leaves the existing global module RPC intact.
create or replace function public.admin_get_module(p_module_name text, p_cohort_id integer)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  perform public.admin_require_module_cohort(p_module_name, p_cohort_id);
  with members as materialized (
    select distinct m as student_id from public.admin_cohort_member_ids(p_cohort_id) m
  ), ar as materialized (
    select * from public.admin_cohort_attempt_rows(p_module_name, p_cohort_id)
  ), sessions as (
    select b.id as batch_id, b.session_name, b.status,
      s.unlock_at, (s.unlock_at at time zone 'Asia/Colombo')::date as session_date,
      s.published, s.session_number, s.module_number, b.bank_size_target, b.question_count_per_student,
      (select count(*) from public.quiz_bank_questions q where q.batch_id = b.id) as question_count,
      count(a.id) as total_attempts,
      count(a.id) filter(where a.status in ('completed', 'submitted')) as completed_attempts,
      count(distinct a.student_id) as students_attempted,
      coalesce(round(avg(a.score) filter(where a.status in ('completed', 'submitted')), 1), 0) as average_score,
      coalesce(max(a.score) filter(where a.status in ('completed', 'submitted')), 0) as best_score
    from public.student_cohort_schedules s join public.quiz_batches b on b.id = s.quiz_batch_id
    left join ar a on a.batch_id = b.id
    where s.cohort_id = p_cohort_id and b.module_name = p_module_name
    group by b.id, b.session_name, b.status, b.bank_size_target, b.question_count_per_student, s.unlock_at, s.published, s.session_number, s.module_number
  )
  select jsonb_build_object(
    'cohort_id', p_cohort_id, 'module_name', p_module_name,
    'overview', jsonb_build_object(
      'total_students', (select count(*) from members),
      'session_count', (select count(*) from sessions),
      'question_count', coalesce((select sum(question_count) from sessions), 0),
      'total_attempts', (select count(*) from ar),
      'completed_attempts', (select count(*) from ar where status in ('completed', 'submitted')),
      'pending_attempts', (select count(*) from ar where status in ('pending', 'in_progress', 'started')),
      'average_score', coalesce((select round(avg(score),1) from ar where status in ('completed', 'submitted')), 0),
      'best_score', coalesce((select max(score) from ar where status in ('completed', 'submitted')), 0),
      'students_attempted', (select count(*) from members m where exists(select 1 from ar a where a.student_id = m.student_id)),
      'students_not_attempted', (select count(*) from members m where not exists(select 1 from ar a where a.student_id = m.student_id))
    ),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.unlock_at nulls last, s.batch_id) from sessions s), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_list_cohort_students(
  p_module_name text, p_cohort_id integer, p_search text default '',
  p_limit integer default 25, p_offset integer default 0, p_student_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  perform public.admin_require_module_cohort(p_module_name, p_cohort_id);
  with members as (select distinct m as student_id from public.admin_cohort_member_ids(p_cohort_id) m),
  ar as materialized (select * from public.admin_cohort_attempt_rows(p_module_name, p_cohort_id)),
  assigned as (select count(distinct s.quiz_batch_id) as n from public.student_cohort_schedules s
    join public.quiz_batches b on b.id = s.quiz_batch_id
    where s.cohort_id = p_cohort_id and b.module_name = p_module_name),
  rows as (
    select m.student_id as id,
      coalesce(nullif(p.username, ''), m.student_id::text) as username,
      p.phone, p.age,
      count(a.id) as attempts, count(distinct a.batch_id) as sessions_attempted,
      (select n from assigned) - count(distinct a.batch_id) as sessions_not_attempted,
      count(distinct a.batch_id) filter(where a.status in ('completed','submitted')) as sessions_completed,
      coalesce(round(avg(a.score) filter(where a.status in ('completed','submitted')),1),0) as average_score,
      coalesce(max(a.score) filter(where a.status in ('completed','submitted')),0) as best_score,
      max(coalesce(a.submitted_at,a.started_at)) as latest_attempt_at,
      case when (select n from assigned) = count(distinct a.batch_id) filter(where a.status in ('completed','submitted')) then 'completed'
        when count(a.id) > 0 then 'in_progress' else 'not_started' end as completion_status
    from members m join public.student_profiles p on p.user_id = m.student_id
    left join ar a on a.student_id = m.student_id
    where (p_student_id is null or m.student_id = p_student_id)
      and (coalesce(trim(p_search),'') = ''
        or p.username ilike '%' || trim(p_search) || '%'
        or p.username_normalized ilike '%' || trim(p_search) || '%'
        or p.phone ilike '%' || trim(p_search) || '%'
        or m.student_id::text ilike '%' || trim(p_search) || '%')
    group by m.student_id, p.username, p.phone, p.age
  ) select jsonb_build_object('total',(select count(*) from rows),
      'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.username,x.id) from
        (select * from rows order by username,id limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0)) x),'[]'::jsonb))
    into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_list_cohort_attempts(
  p_module_name text, p_cohort_id integer, p_search text default '', p_batch_id uuid default null,
  p_status text default null, p_sort text default 'submitted_desc', p_limit integer default 25,
  p_offset integer default 0, p_student_id uuid default null, p_results_only boolean default false)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  perform public.admin_require_module_cohort(p_module_name, p_cohort_id);
  if p_sort not in ('score_asc','score_desc','submitted_asc','submitted_desc') or p_sort is null
    then raise exception 'invalid_sort'; end if;
  with filtered as (
    select a.*, p_cohort_id as cohort_id from public.admin_cohort_attempt_rows(p_module_name, p_cohort_id) a
    where (p_batch_id is null or a.batch_id = p_batch_id)
      and (p_student_id is null or a.student_id = p_student_id)
      and (p_status is null or p_status = '' or a.status = p_status)
      and (not coalesce(p_results_only,false) or a.status in ('completed','submitted'))
      and (coalesce(trim(p_search),'') = ''
        or a.username ilike '%' || trim(p_search) || '%'
        or a.student_id::text ilike '%' || trim(p_search) || '%'
        or exists (select 1 from public.student_profiles p where p.user_id = a.student_id
          and (p.phone ilike '%' || trim(p_search) || '%'
            or p.username_normalized ilike '%' || trim(p_search) || '%')))
  ), page as (
    select *, row_number() over(order by
      case when p_sort='score_asc' then score end asc nulls last,
      case when p_sort='score_desc' then score end desc nulls last,
      case when p_sort='submitted_asc' then submitted_at end asc nulls last,
      case when p_sort='submitted_desc' then submitted_at end desc nulls last, id) as ordinal
    from filtered
    order by ordinal limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0)
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) - 'ordinal' order by ordinal) from page p),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_list_cohort_questions(
  p_module_name text, p_cohort_id integer, p_batch_id uuid default null,
  p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  perform public.admin_require_module_cohort(p_module_name, p_cohort_id);
  with rows as (
    select q.id, q.batch_id, b.session_name, q.question_text, q.topic, q.difficulty,
      q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option
    from public.quiz_bank_questions q join public.quiz_batches b on b.id = q.batch_id
    where b.module_name = p_module_name and (p_batch_id is null or b.id = p_batch_id)
      and exists(select 1 from public.student_cohort_schedules s where s.cohort_id = p_cohort_id and s.quiz_batch_id = b.id)
  ) select jsonb_build_object('total',(select count(*) from rows), 'rows',coalesce(
    (select jsonb_agg(to_jsonb(x) order by x.batch_id,x.id) from
      (select * from rows order by batch_id,id limit greatest(1,least(coalesce(p_limit,25),100)) offset greatest(coalesce(p_offset,0),0)) x),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_get_cohort_attempt(p_module_name text, p_cohort_id integer, p_attempt_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_attempt jsonb; v_questions jsonb;
begin
  perform public.admin_require_access();
  perform public.admin_require_module_cohort(p_module_name, p_cohort_id);
  select to_jsonb(a) || jsonb_build_object('cohort_id',p_cohort_id,'module_name',p_module_name)
    into v_attempt from public.admin_cohort_attempt_rows(p_module_name,p_cohort_id) a where a.id=p_attempt_id;
  if v_attempt is null then raise exception 'attempt_not_found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'question_id',q.id,'question_text',q.question_text,'option_a',q.option_a,'option_b',q.option_b,
    'option_c',q.option_c,'option_d',q.option_d,'correct_option',q.correct_option,
    'selected_option',to_jsonb(aq)->>'selected_option','is_correct',to_jsonb(aq)->'is_correct',
    'topic',q.topic,'difficulty',q.difficulty,'explanation',to_jsonb(q)->>'explanation',
    'question_number',to_jsonb(aq)->'question_number'
  ) order by nullif(to_jsonb(aq)->>'question_number','')::integer nulls last,q.id),'[]'::jsonb)
  into v_questions from public.quiz_attempt_questions aq
  join public.quiz_bank_questions q on q.id=aq.question_id
  where aq.attempt_id=p_attempt_id and q.batch_id=(v_attempt->>'batch_id')::uuid;
  return jsonb_build_object('attempt',v_attempt,'questions',v_questions);
end;
$$;

revoke all on function public.admin_require_module_cohort(text,integer) from public,anon,authenticated;
revoke all on function public.admin_cohort_member_ids(integer) from public,anon,authenticated;
revoke all on function public.admin_cohort_attempt_rows(text,integer) from public,anon,authenticated;
revoke all on function public.admin_list_cohort_modules() from public,anon;
revoke all on function public.admin_get_module_cohorts(text) from public,anon;
revoke all on function public.admin_get_module(text,integer) from public,anon;
revoke all on function public.admin_list_cohort_students(text,integer,text,integer,integer,uuid) from public,anon;
revoke all on function public.admin_list_cohort_attempts(text,integer,text,uuid,text,text,integer,integer,uuid,boolean) from public,anon;
revoke all on function public.admin_list_cohort_questions(text,integer,uuid,integer,integer) from public,anon;
revoke all on function public.admin_get_cohort_attempt(text,integer,uuid) from public,anon;
grant execute on function public.admin_list_cohort_modules() to authenticated;
grant execute on function public.admin_get_module_cohorts(text) to authenticated;
grant execute on function public.admin_get_module(text,integer) to authenticated;
grant execute on function public.admin_list_cohort_students(text,integer,text,integer,integer,uuid) to authenticated;
grant execute on function public.admin_list_cohort_attempts(text,integer,text,uuid,text,text,integer,integer,uuid,boolean) to authenticated;
grant execute on function public.admin_list_cohort_questions(text,integer,uuid,integer,integer) to authenticated;
grant execute on function public.admin_get_cohort_attempt(text,integer,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
