-- Teen Academy Quiz Admin Dashboard
-- Secure read-only admin RPC layer for the React frontend.
--
-- Expected core tables from the Teen Quiz student application:
--   public.profiles(id, ...)
--   public.quiz_batches(id, module_name, session_name, session_date, ...)
--   public.quiz_attempts(id, student_id, batch_id, ...)
--   public.quiz_attempt_questions(attempt_id, bank_question_id, ...)
--   public.quiz_bank_questions(id, question_text, option_a..d, correct_option, ...)
--
-- Optional attempt columns are read through to_jsonb(), so score/score_percent,
-- correct_count, total_questions, status and timestamps can vary slightly.
-- If your attempt-question FK is named question_id instead of bank_question_id,
-- replace aq.bank_question_id with aq.question_id in admin_get_attempt and
-- admin_get_module below.

begin;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- No browser table reads are required. The frontend uses the RPC functions below.
revoke all on table public.admin_users from anon, authenticated;

create or replace function public.admin_is_current_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.is_active = true
  );
$$;

create or replace function public.admin_require_access()
returns void
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.admin_is_current_user() then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_score(p_row jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(
    nullif(p_row->>'score_percent', '')::numeric,
    case
      when coalesce(nullif(p_row->>'total_questions','')::numeric, 0) > 0
       and nullif(p_row->>'correct_count','') is not null
      then round((p_row->>'correct_count')::numeric * 100 / (p_row->>'total_questions')::numeric, 2)
      else null
    end,
    nullif(p_row->>'score', '')::numeric,
    0
  );
$$;

create or replace function public.admin_correct_count(p_row jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(
    nullif(p_row->>'correct_count', '')::integer,
    nullif(p_row->>'correct_answers', '')::integer,
    0
  );
$$;

create or replace function public.admin_total_questions(p_row jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(
    nullif(p_row->>'total_questions', '')::integer,
    nullif(p_row->>'question_count', '')::integer,
    10
  );
$$;

create or replace function public.admin_attempt_status(p_row jsonb)
returns text
language sql
immutable
as $$
  select coalesce(nullif(p_row->>'status',''), 'completed');
$$;

create or replace function public.admin_attempt_time(p_row jsonb)
returns timestamptz
language sql
immutable
as $$
  select coalesce(
    nullif(p_row->>'completed_at','')::timestamptz,
    nullif(p_row->>'submitted_at','')::timestamptz,
    nullif(p_row->>'created_at','')::timestamptz
  );
$$;

create or replace function public.admin_profile_username(p_row jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(p_row->>'username',''),
    nullif(p_row->>'display_name',''),
    nullif(p_row->>'name',''),
    'Student'
  );
$$;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.admin_require_access();

  with attempt_rows as (
    select
      a.id,
      a.student_id,
      a.batch_id,
      public.admin_score(to_jsonb(a)) as score,
      public.admin_correct_count(to_jsonb(a)) as correct_count,
      public.admin_total_questions(to_jsonb(a)) as total_questions,
      public.admin_attempt_status(to_jsonb(a)) as status,
      public.admin_attempt_time(to_jsonb(a)) as attempt_at
    from public.quiz_attempts a
  ),
  dashboard as (
    select
      (select count(*) from public.profiles)::integer as total_students,
      (select count(*) from attempt_rows)::integer as total_attempts,
      (select count(*) from attempt_rows where status = 'completed')::integer as completed_attempts,
      coalesce((select round(avg(score), 1) from attempt_rows where status = 'completed'), 0) as average_score
  )
  select jsonb_build_object(
    'total_students', d.total_students,
    'total_attempts', d.total_attempts,
    'completed_attempts', d.completed_attempts,
    'average_score', d.average_score,
    'completion_rate', case when d.total_attempts = 0 then 0 else round(d.completed_attempts::numeric * 100 / d.total_attempts, 1) end,
    'recent_attempts', coalesce((
      select jsonb_agg(x.obj order by x.attempt_at desc)
      from (
        select
          ar.attempt_at,
          jsonb_build_object(
            'id', ar.id,
            'student_id', ar.student_id,
            'username', public.admin_profile_username(to_jsonb(p)),
            'module_name', b.module_name,
            'module_title', coalesce(to_jsonb(b)->>'module_title', replace(b.module_name, '_', ' ')),
            'session_name', b.session_name,
            'score', ar.score,
            'correct_count', ar.correct_count,
            'total_questions', ar.total_questions,
            'status', ar.status,
            'created_at', ar.attempt_at
          ) as obj
        from attempt_rows ar
        left join public.profiles p on p.id = ar.student_id
        left join public.quiz_batches b on b.id = ar.batch_id
        order by ar.attempt_at desc nulls last
        limit 12
      ) x
    ), '[]'::jsonb),
    'module_performance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module_name', q.module_name,
        'module_title', q.module_title,
        'session_count', q.session_count,
        'students_attempted', q.students_attempted,
        'total_attempts', q.total_attempts,
        'average_score', q.average_score,
        'best_score', q.best_score,
        'latest_attempt_at', q.latest_attempt_at
      ) order by q.module_name)
      from (
        select
          b.module_name,
          coalesce(max(to_jsonb(b)->>'module_title'), replace(b.module_name, '_', ' ')) as module_title,
          count(distinct b.id)::integer as session_count,
          count(distinct ar.student_id)::integer as students_attempted,
          count(ar.id)::integer as total_attempts,
          coalesce(round(avg(ar.score), 1), 0) as average_score,
          coalesce(max(ar.score), 0) as best_score,
          max(ar.attempt_at) as latest_attempt_at
        from public.quiz_batches b
        left join attempt_rows ar on ar.batch_id = b.id and ar.status = 'completed'
        group by b.module_name
      ) q
    ), '[]'::jsonb),
    'score_distribution', jsonb_build_array(
      jsonb_build_object('label','0–39','count',(select count(*) from attempt_rows where status='completed' and score < 40)),
      jsonb_build_object('label','40–59','count',(select count(*) from attempt_rows where status='completed' and score >= 40 and score < 60)),
      jsonb_build_object('label','60–79','count',(select count(*) from attempt_rows where status='completed' and score >= 60 and score < 80)),
      jsonb_build_object('label','80–100','count',(select count(*) from attempt_rows where status='completed' and score >= 80))
    )
  ) into v_result
  from dashboard d;

  return v_result;
end;
$$;

create or replace function public.admin_list_students(
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_search text := lower(trim(coalesce(p_search,'')));
begin
  perform public.admin_require_access();

  with student_rows as (
    select
      p.id,
      public.admin_profile_username(to_jsonb(p)) as username,
      coalesce(nullif(to_jsonb(p)->>'age','')::integer, nullif(to_jsonb(p)->>'student_age','')::integer) as age,
      coalesce(to_jsonb(p)->>'phone', to_jsonb(p)->>'phone_number') as phone,
      count(a.id)::integer as attempts,
      count(a.id) filter (where public.admin_attempt_status(to_jsonb(a))='completed')::integer as completed_attempts,
      coalesce(round(avg(public.admin_score(to_jsonb(a))) filter (where public.admin_attempt_status(to_jsonb(a))='completed'),1),0) as average_score,
      coalesce(max(public.admin_score(to_jsonb(a))) filter (where public.admin_attempt_status(to_jsonb(a))='completed'),0) as best_score,
      max(public.admin_attempt_time(to_jsonb(a))) as latest_attempt_at
    from public.profiles p
    left join public.quiz_attempts a on a.student_id = p.id
    group by p.id, to_jsonb(p)
  ), filtered as (
    select * from student_rows
    where v_search = '' or lower(username) like '%' || v_search || '%' or coalesce(phone,'') like '%' || p_search || '%'
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.username) from (select * from filtered order by username limit greatest(1,least(p_limit,200)) offset greatest(p_offset,0)) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_get_student(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.admin_require_access();

  with ar as (
    select a.*, public.admin_score(to_jsonb(a)) score_value,
      public.admin_correct_count(to_jsonb(a)) correct_value,
      public.admin_total_questions(to_jsonb(a)) total_value,
      public.admin_attempt_status(to_jsonb(a)) status_value,
      public.admin_attempt_time(to_jsonb(a)) attempt_at
    from public.quiz_attempts a
    where a.student_id = p_student_id
  )
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'username', public.admin_profile_username(to_jsonb(p)),
      'age', coalesce(nullif(to_jsonb(p)->>'age','')::integer, nullif(to_jsonb(p)->>'student_age','')::integer),
      'phone', coalesce(to_jsonb(p)->>'phone', to_jsonb(p)->>'phone_number'),
      'created_at', to_jsonb(p)->>'created_at'
    ),
    'summary', jsonb_build_object(
      'attempts', (select count(*) from ar),
      'completed_attempts', (select count(*) from ar where status_value='completed'),
      'average_score', coalesce((select round(avg(score_value),1) from ar where status_value='completed'),0),
      'best_score', coalesce((select max(score_value) from ar where status_value='completed'),0),
      'latest_attempt_at', (select max(attempt_at) from ar)
    ),
    'module_stats', coalesce((
      select jsonb_agg(to_jsonb(ms) order by ms.module_name)
      from (
        select
          b.module_name,
          coalesce(max(to_jsonb(b)->>'module_title'), replace(b.module_name,'_',' ')) as module_title,
          count(distinct b.id)::integer as session_count,
          count(ar.id)::integer as attempts,
          coalesce(round(avg(ar.score_value),1),0) as average_score,
          coalesce(max(ar.score_value),0) as best_score,
          (array_agg(ar.score_value order by ar.attempt_at desc nulls last))[1] as latest_score
        from ar
        join public.quiz_batches b on b.id = ar.batch_id
        where ar.status_value='completed'
        group by b.module_name
      ) ms
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ar.id,
        'student_id', p_student_id,
        'username', public.admin_profile_username(to_jsonb(p)),
        'module_name', b.module_name,
        'module_title', coalesce(to_jsonb(b)->>'module_title', replace(b.module_name,'_',' ')),
        'session_name', b.session_name,
        'score', ar.score_value,
        'correct_count', ar.correct_value,
        'total_questions', ar.total_value,
        'status', ar.status_value,
        'created_at', ar.attempt_at
      ) order by ar.attempt_at desc nulls last)
      from ar left join public.quiz_batches b on b.id=ar.batch_id
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  where p.id = p_student_id;

  if v_result is null then raise exception 'student_not_found'; end if;
  return v_result;
end;
$$;

create or replace function public.admin_list_modules()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.first_session_date nulls last, x.module_name),'[]'::jsonb)
  into v_result
  from (
    select
      b.module_name,
      coalesce(max(to_jsonb(b)->>'module_title'), replace(b.module_name,'_',' ')) as module_title,
      count(distinct b.id)::integer as session_count,
      count(distinct a.student_id)::integer as students_attempted,
      count(a.id)::integer as total_attempts,
      coalesce(round(avg(public.admin_score(to_jsonb(a))) filter (where public.admin_attempt_status(to_jsonb(a))='completed'),1),0) as average_score,
      coalesce(max(public.admin_score(to_jsonb(a))) filter (where public.admin_attempt_status(to_jsonb(a))='completed'),0) as best_score,
      max(public.admin_attempt_time(to_jsonb(a))) as latest_attempt_at,
      min(b.session_date) as first_session_date
    from public.quiz_batches b
    left join public.quiz_attempts a on a.batch_id=b.id
    group by b.module_name
  ) x;
  return v_result;
end;
$$;

create or replace function public.admin_get_module(p_module_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();

  with batches as (select * from public.quiz_batches where module_name=p_module_name),
  attempts as (
    select a.*, public.admin_score(to_jsonb(a)) score_value,
      public.admin_attempt_status(to_jsonb(a)) status_value,
      public.admin_attempt_time(to_jsonb(a)) attempt_at
    from public.quiz_attempts a join batches b on b.id=a.batch_id
  )
  select jsonb_build_object(
    'module', jsonb_build_object(
      'module_name', p_module_name,
      'module_title', coalesce((select max(to_jsonb(b)->>'module_title') from batches b), replace(p_module_name,'_',' ')),
      'session_count', (select count(*) from batches),
      'students_attempted', (select count(distinct student_id) from attempts),
      'total_attempts', (select count(*) from attempts),
      'average_score', coalesce((select round(avg(score_value),1) from attempts where status_value='completed'),0),
      'best_score', coalesce((select max(score_value) from attempts where status_value='completed'),0)
    ),
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.session_date nulls last)
      from (
        select
          b.id as batch_id,
          b.session_name,
          to_jsonb(b)->>'session_title' as session_title,
          b.session_date,
          count(distinct a.student_id)::integer as students_attempted,
          count(a.id)::integer as total_attempts,
          coalesce(round(avg(public.admin_score(to_jsonb(a))) filter (where public.admin_attempt_status(to_jsonb(a))='completed'),1),0) as average_score
        from batches b
        left join public.quiz_attempts a on a.batch_id=b.id
        group by b.id,b.session_name,b.session_date,to_jsonb(b)
      ) s
    ),'[]'::jsonb),
    'hardest_questions', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.incorrect_rate desc, h.attempts desc)
      from (
        select
          q.id as question_id,
          q.question_text,
          q.topic,
          q.difficulty,
          count(aq.attempt_id)::integer as attempts,
          count(*) filter (where aq.is_correct=false)::integer as incorrect_count,
          case when count(aq.attempt_id)=0 then 0 else round(count(*) filter (where aq.is_correct=false)::numeric*100/count(aq.attempt_id),1) end as incorrect_rate
        from public.quiz_bank_questions q
        join batches b on b.id=q.batch_id
        left join public.quiz_attempt_questions aq on aq.bank_question_id=q.id
        group by q.id,q.question_text,q.topic,q.difficulty
        having count(aq.attempt_id)>0
        order by incorrect_rate desc, attempts desc
        limit 10
      ) h
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_list_attempts(
  p_search text default '',
  p_module_name text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare v_result jsonb; v_search text:=lower(trim(coalesce(p_search,'')));
begin
  perform public.admin_require_access();
  with rows as (
    select
      a.id, a.student_id,
      public.admin_profile_username(to_jsonb(p)) as username,
      b.module_name,
      coalesce(to_jsonb(b)->>'module_title',replace(b.module_name,'_',' ')) as module_title,
      b.session_name,
      public.admin_score(to_jsonb(a)) as score,
      public.admin_correct_count(to_jsonb(a)) as correct_count,
      public.admin_total_questions(to_jsonb(a)) as total_questions,
      public.admin_attempt_status(to_jsonb(a)) as status,
      public.admin_attempt_time(to_jsonb(a)) as created_at
    from public.quiz_attempts a
    left join public.profiles p on p.id=a.student_id
    left join public.quiz_batches b on b.id=a.batch_id
    where (p_module_name is null or p_module_name='' or b.module_name=p_module_name)
  ), filtered as (
    select * from rows where v_search='' or lower(username) like '%'||v_search||'%'
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc nulls last) from (select * from filtered order by created_at desc nulls last limit greatest(1,least(p_limit,200)) offset greatest(p_offset,0)) x),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_get_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.admin_require_access();
  select jsonb_build_object(
    'attempt', jsonb_build_object(
      'id',a.id,
      'student_id',a.student_id,
      'username',public.admin_profile_username(to_jsonb(p)),
      'module_name',b.module_name,
      'module_title',coalesce(to_jsonb(b)->>'module_title',replace(b.module_name,'_',' ')),
      'session_name',b.session_name,
      'score',public.admin_score(to_jsonb(a)),
      'correct_count',coalesce(nullif(to_jsonb(a)->>'correct_count','')::integer,(select count(*) from public.quiz_attempt_questions x where x.attempt_id=a.id and x.is_correct=true)),
      'total_questions',coalesce(nullif(to_jsonb(a)->>'total_questions','')::integer,(select count(*) from public.quiz_attempt_questions x where x.attempt_id=a.id)),
      'status',public.admin_attempt_status(to_jsonb(a)),
      'created_at',public.admin_attempt_time(to_jsonb(a))
    ),
    'questions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id',q.id,
        'question_number',nullif(to_jsonb(aq)->>'question_number','')::integer,
        'question_text',q.question_text,
        'option_a',q.option_a,
        'option_b',q.option_b,
        'option_c',q.option_c,
        'option_d',q.option_d,
        'selected_option',aq.selected_option,
        'correct_option',q.correct_option,
        'is_correct',aq.is_correct,
        'topic',q.topic,
        'difficulty',q.difficulty,
        'answered_at',to_jsonb(aq)->>'answered_at'
      ) order by coalesce(nullif(to_jsonb(aq)->>'question_number','')::integer,9999),aq.id)
      from public.quiz_attempt_questions aq
      join public.quiz_bank_questions q on q.id=aq.bank_question_id
      where aq.attempt_id=a.id
    ),'[]'::jsonb)
  ) into v_result
  from public.quiz_attempts a
  left join public.profiles p on p.id=a.student_id
  left join public.quiz_batches b on b.id=a.batch_id
  where a.id=p_attempt_id;

  if v_result is null then raise exception 'attempt_not_found'; end if;
  return v_result;
end;
$$;

-- Browser access: authenticated admins only, enforced again inside every RPC.
revoke all on function public.admin_is_current_user() from public, anon;
revoke all on function public.admin_dashboard_stats() from public, anon;
revoke all on function public.admin_list_students(text,integer,integer) from public, anon;
revoke all on function public.admin_get_student(uuid) from public, anon;
revoke all on function public.admin_list_modules() from public, anon;
revoke all on function public.admin_get_module(text) from public, anon;
revoke all on function public.admin_list_attempts(text,text,integer,integer) from public, anon;
revoke all on function public.admin_get_attempt(uuid) from public, anon;

grant execute on function public.admin_is_current_user() to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_list_students(text,integer,integer) to authenticated;
grant execute on function public.admin_get_student(uuid) to authenticated;
grant execute on function public.admin_list_modules() to authenticated;
grant execute on function public.admin_get_module(text) to authenticated;
grant execute on function public.admin_list_attempts(text,text,integer,integer) to authenticated;
grant execute on function public.admin_get_attempt(uuid) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- ONE-TIME ADMIN SETUP (run separately after creating the admin Auth user)
-- ---------------------------------------------------------------------------
-- insert into public.admin_users(user_id, display_name)
-- values ('PASTE_ADMIN_AUTH_USER_UUID'::uuid, 'Teen Academy Admin')
-- on conflict (user_id) do update set is_active=true, display_name=excluded.display_name;
--
-- notify pgrst, 'reload schema';
