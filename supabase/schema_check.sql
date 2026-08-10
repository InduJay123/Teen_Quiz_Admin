-- Run this first if admin_dashboard.sql reports a missing column/table.
-- Send the result back for an exact compatibility patch.

select table_name, ordinal_position, column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name in (
    'profiles',
    'quiz_batches',
    'quiz_attempts',
    'quiz_attempt_questions',
    'quiz_bank_questions'
  )
order by table_name, ordinal_position;
