-- Mandatory cleanup independent of browsers/n8n. Enable pg_cron first.
begin;
do $$ begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise exception 'Enable pg_cron before installing the generator cleanup schedule';
  end if;
end; $$;
select cron.schedule('teen-quiz-generation-expiry','* * * * *','select public.quiz_generation_expire()');
update public.quiz_generation_config set cleanup_ready=true where singleton;
commit;
