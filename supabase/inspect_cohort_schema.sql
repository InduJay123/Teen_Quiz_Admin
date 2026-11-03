-- READ ONLY. Run in the Supabase SQL editor and return all result sets.
-- No student records, credentials, or quiz content are selected.
select table_name, ordinal_position, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

select con.conrelid::regclass as source_table, con.conname,
       con.confrelid::regclass as referenced_table,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_namespace n on n.oid = con.connamespace
where n.nspname = 'public' and con.contype in ('f', 'p', 'u')
order by source_table::text, con.conname;

select p.oid::regprocedure as signature, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (p.proname like 'admin_%' or p.proname ilike '%cohort%' or p.proname ilike '%attempt%')
order by p.proname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public'
order by tablename, policyname;

select event_object_table, trigger_name, action_statement
from information_schema.triggers where trigger_schema = 'public'
order by event_object_table, trigger_name;
