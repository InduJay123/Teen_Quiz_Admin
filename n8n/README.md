# Automatic PDF-to-quiz generator

Implemented locally; not deployed or tested against production. The PDF stays in the browser. PDF.js extracts every page and submits text to the authenticated Edge Function. n8n receives identifiers only and orchestrates the private worker, which structures lesson content, generates questions, independently reviews source support, creates embeddings and publishes atomically.

## Installation order

1. Back up and inspect the production schema in a staging copy. The foundation checks the supplied production columns and pgvector dimensions. Run the isolated tests below and verify actual student RPC integration in staging. Original workflow exports and full student RPC definitions were unavailable; neither original workflow nor `save_quiz_question()` was modified.
2. Review/apply `supabase/migrations/202610220001_quiz_generation_foundation.sql`. This replaces the foundation the user reports was never successfully installed. If a different version was already recorded as applied, reconcile migration history and use a reviewed forward migration instead of silently editing deployed history.
3. Enable Supabase Cron (`pg_cron`), then apply `202610230002_quiz_generation_cleanup.sql`. The generator remains disabled until cleanup is configured and an operator enables it. No Storage bucket is required or created.
4. Set server secrets listed below and deploy both functions. Do not put secrets in frontend variables.
5. Import/configure/activate the n8n workflow, reserve an unused session, then enable the feature.

## Secrets and deployment

Use Supabase Dashboard > Edge Functions > Secrets, or `supabase secrets set --env-file <private-server-env-file> --project-ref <project-ref>`. The file format is in `supabase/functions/.env.example`; keep the populated file untracked.

- `QUIZ_ADMIN_ORIGIN`: comma-separated exact production origins; retain every existing origin when updating. `http://localhost:5174` is also allowed explicitly; no wildcard.
- `QUIZ_N8N_WEBHOOK_URL`: activated workflow's production HTTPS webhook URL.
- `QUIZ_N8N_WEBHOOK_SECRET`: incoming n8n header-auth secret.
- `QUIZ_WORKER_SECRET`: separate random outbound worker header-auth secret.
- `OPENAI_API_KEY`: server only.
- `QUIZ_OPENAI_MODEL`: Responses API model supporting strict JSON schema outputs.
- `QUIZ_OPENAI_REVIEW_MODEL`: optional separate review model; defaults to generation model.
- Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

From the project directory (replace project-ref with your verified project):

```powershell
supabase functions deploy quiz-generation --project-ref <project-ref>
supabase functions deploy quiz-generation-worker --project-ref <project-ref>
```

`config.toml` disables gateway JWT checks for these functions: the admin function verifies the JWT and active `admin_users` membership itself; the worker requires its separate secret. Do not remove these application checks.

## Exact n8n import steps

1. Open Workflows > Add workflow > menu > Import from file.
2. Select `n8n/workflows/Teen_Academy_Automatic_PDF_Quiz_Generator.json`.
3. Replace `YOUR_PROJECT_REF` in every HTTP Request URL with your Supabase project reference.
4. Create a Header Auth credential with name `X-Quiz-Webhook-Secret` and value matching `QUIZ_N8N_WEBHOOK_SECRET`. Select it on **Authenticated Job Webhook**.
5. Create another Header Auth credential named `X-Quiz-Worker-Secret`, matching `QUIZ_WORKER_SECRET`. Select it on ALL HTTP Request nodes, including failure and scheduled retry nodes.
6. Save and activate/publish the new workflow. Copy its production webhook URL into `QUIZ_N8N_WEBHOOK_URL`. Keep execution-payload persistence disabled as exported.
7. Verify the one-minute scheduled retry branch is active. It recovers accepted but undelivered jobs without a browser remaining open.

No workflow IDs or tool IDs need configuration. The existing live-saving tool is intentionally not called: it bypasses staging. The new backend provides embedding, validation, staging and publication. HTTP Request 4.5, Webhook 2.1, If 2.3 and Schedule Trigger 1.4 parameters were checked against available n8n node definitions; verify support on your instance before activation. This is not evidence of an actual import or execution.

## Safely reserve an empty session

Completed banks and banks with questions or attempts are always rejected. The existing default `generating` status is not sufficient evidence that a bank is unused.

First exclude the selected bank from all legacy generator inputs and confirm no legacy execution is running for it. Then, as database owner, using verified existing UUIDs:

```sql
select public.quiz_generation_reserve_bank('BANK_UUID'::uuid, 'ACTIVE_ADMIN_UUID'::uuid, true);
update public.quiz_generation_config set enabled=true where singleton;
```

The final boolean explicitly attests that legacy processing has been quiesced. Reservation locks the relevant tables, verifies emptiness, and installs protection against subsequent legacy writes/reset/deletes to reserved banks. It does not alter session dates, cohort schedules or historical targets. The RPC is deliberately unavailable to browser and service-role callers. There is no automatic session creation based on cohort dates.

## Verification and recovery

Run locally:

```powershell
npm ci
npm test
npm run build
```

In staging, select a reserved unused bank, select a text PDF and click Upload & Process once. Refresh during processing and confirm polling resumes. Confirm exactly 30 saved questions and distribution:

```sql
select difficulty, count(*) from public.quiz_bank_questions
where batch_id = 'BANK_UUID'::uuid group by difficulty;
select status, bank_size_target, question_count_per_student, completed_at
from public.quiz_batches where id = 'BANK_UUID'::uuid;
```

Expected 12 easy, 12 medium, 6 hard; completed, 30, 10. Success requires the database publication receipt. Check real student attempt creation returns 10 questions and existing cohort access rules still apply. Test concurrent requests from separate staging connections; the in-process database test is not a real multi-connection contention test.

Failed jobs never publish. Fix the reported cause and resubmit to the same still-empty reserved bank; this creates a fresh job. Claimed interrupted jobs expire within two hours and the minute cron clears them; do not manually restart a claimed model step. Unclaimed jobs are retried by n8n's scheduled branch. A successful publication retry returns the same receipt.

PDF limit: 20 MiB; 200 pages; extracted text at most 120,000 characters/480,000 UTF-8 bytes; request body 768 KiB. Oversized, encrypted, corrupt and image-only documents fail explicitly. OCR is not configured; provide a readable text PDF. No silent truncation.

Source text, structured lesson context, generated candidates and drafts are cleared on completion/failure/expiration. n8n only handles identifiers/tokens; OpenAI requests use `store:false`. Row cleanup does not erase database backups/WAL or override provider retention policies. Set those policies separately if immediate physical erasure is required. Published questions retain supporting content only as question text/options; source quotes are validation-only drafts.

Independent AI review plus evidence checks reduces unsupported answers but cannot guarantee factual correctness. Verify model quality on representative lessons before production activation.

## Rollback

Disable new submissions with `update public.quiz_generation_config set enabled=false where singleton;`, deactivate the new n8n workflow, and let active jobs finish or expire before removing worker access. Keep the cleanup cron running until all temporary source rows are cleared. Restore the prior frontend/Edge deployments if needed. Do not drop tables, remove reservation guards, rewrite historical banks or delete successfully published questions as an automatic rollback. Original workflows remain untouched, but must continue excluding reserved banks.
