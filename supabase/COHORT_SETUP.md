# Cohort dashboard integration and manual deployment

The integration is complete against the user-verified schema. The SQL has been exercised in isolated PostgreSQL fixtures; the React UI and RPC parameter contracts have been tested. Production SQL has not been executed, the application has not been deployed, and nothing has been pushed to GitHub.

## Database contract and attribution

- Cohort membership comes exclusively from `student_profiles.cohort_id`. The private `admin_cohort_member_ids(integer)` function returns distinct, non-null `user_id` values and checks `admin_require_access()`.
- Student display/search uses `student_profiles.username`, `username_normalized`, `phone`, and `age`. Missing usernames fall back to the actual student UUID, not fabricated data.
- Attempt attribution comes from `quiz_attempt_cohorts`. Its `attempt_id`, `student_id`, and `quiz_batch_id` must all match the attempt. Membership is never used to guess historical attribution. `EXISTS` prevents duplicate mappings from multiplying results.
- `is_active` is deliberately not used to filter history: a valid inactive mapping retains its cohort attribution. Pending and completed attempts are distinguished by `admin_attempt_status()`. If the application later defines inactive mappings as revoked attribution rather than historical state, that policy must be changed explicitly; it is not inferred here.
- Attempts must also belong to the selected module and a session scheduled for the selected cohort. Unmapped or inconsistent mappings are excluded without changing production records.
- Current membership and historical attempts are separate: a former member's correctly mapped attempt can appear in cohort history, while the Students tab contains only current profile members. Overview participation intersects current members with scoped attempts.
- Session dates come from `student_cohort_schedules.unlock_at AT TIME ZONE 'Asia/Colombo'`. The UI formats timestamps in Colombo time. The base `quiz_batches.session_date` is not used for cohort dates.
- Questions remain shared by `quiz_bank_questions.batch_id`; no records are copied. Session question counts and targets are separate. Counts do not multiply when cohorts share a session.
- Cohorts are selected through schedules, independently of profiles/attempts, so an assigned Batch 3 remains visible with zero students and attempts.
- Completed/submitted attempts contribute to average/highest scores. Pending/in-progress/started attempts have a separate count. Empty aggregates return zero. Results lists completed/submitted attempts; Attempts lists all statuses.

## Functions and compatibility

Review and apply **only** `migrations/202611030001_module_cohorts.sql`. It is a single transaction that creates/replaces the cohort functions and their grants. It does not change tables, RLS policies, quiz-taking functions, generation workflows, or student data.

| Function | Purpose |
| --- | --- |
| `admin_cohort_member_ids(integer)` | Internal profile membership adapter. |
| `admin_require_module_cohort(text, integer)` | Internal scope and authorization check. |
| `admin_cohort_attempt_rows(text, integer)` | Internal validated attempt relation. |
| `admin_list_cohort_modules()` | Separate metadata catalog for the cohort Modules page, avoiding per-module requests. |
| `admin_get_module_cohorts(text)` | Assigned cohort selector, including empty cohorts. |
| `admin_get_module(text, integer)` | Cohort overview and session summaries. |
| `admin_list_cohort_students(text, integer, text, integer, integer, uuid)` | Searchable, paginated current-member progress and student summary. |
| `admin_list_cohort_attempts(text, integer, text, uuid, text, text, integer, integer, uuid, boolean)` | Filtered/paginated results and history. |
| `admin_list_cohort_questions(text, integer, uuid, integer, integer)` | Paginated assigned-session bank. |
| `admin_get_cohort_attempt(text, integer, uuid)` | Validated attempt and full answer review. |

`admin_list_modules()` and the one-argument `admin_get_module(text)` are not replaced or re-granted. The existing global dashboard, students, attempts, and answer-review RPC calls remain unchanged. The extra catalog RPC supplies the new module-card fields without changing the global contract.

All public cohort RPCs explicitly call `admin_require_access()`. Internal helpers have EXECUTE revoked from PUBLIC, anon, and authenticated. Authenticated users can execute the public cohort RPCs but still must pass the administrator check. Functions run as their trusted database owner with a fixed search path; table references are schema-qualified. There are no new direct browser table grants. Existing table RLS stays enabled and unchanged.

`admin_score()`, `admin_attempt_status()` and `admin_attempt_time()` remain unchanged and are reused. The cohort query supplies `score_percent`/`correct_count` aliases alongside verified attempt fields so the checked-in legacy score helper also works. Separate started/submitted JSON projections supply `created_at` aliases for the existing timestamp helper, keeping those two timestamps distinct without changing global helper semantics.

Lists filter, sort, count and paginate in PostgreSQL. The UI uses 25 rows; RPC limits are capped at 100. Stable ID tie-breakers prevent unstable pages. Search supports names, normalized usernames, phone numbers and UUID identifiers. An invalid scope never falls back to global data.

## Frontend

The existing `/modules/:moduleName` route persists cohort, section, session, search, sort, page, student, and attempt selection in query parameters. Refreshing a link preserves scope. Switching cohorts clears old selections; keyed request state prevents stale responses from restoring another cohort's data.

Every cohort section calls real Supabase RPCs through the existing client and auth session. No cohort demo fixtures or placeholder records are used. Set `VITE_DEMO_MODE=false` for this feature. The existing global demo mode is preserved; cohort views explain that a configured database is required when it is enabled.

## Exact manual deployment sequence

These instructions are for the operator to review and execute. None were run against production by the assistant.

1. Make the reviewed source change set available in `/opt/Teen_Quiz_Admin` using your normal release process. This work has not been pushed, so pulling the current remote alone will not necessarily include it. Keep the previous frontend release/image available for rollback.

2. Confirm the existing server `.env` contains the correct project URL and a valid **publishable/anon** key, and sets `VITE_DEMO_MODE=false`. Keep service-role credentials out of frontend variables. An earlier metadata check returned `Invalid API key`; connectivity was not re-tested during this integration turn. Vite embeds these values at build time, so fix them before building.

3. Validate the reviewed source on the server (or in your release build environment):

   ```bash
   cd /opt/Teen_Quiz_Admin
   npm ci
   npm test
   npm run build
   ```

4. Review the final migration file. In Supabase SQL Editor, select the intended project and the same trusted role that owns the existing admin SECURITY DEFINER functions (normally `postgres`). Inspect the existing helper owners first:

   ```sql
   select p.oid::regprocedure as signature,
          pg_get_userbyid(p.proowner) as owner,
          p.prosecdef as security_definer,
          p.proconfig
   from pg_proc p
   where p.oid in (
     'public.admin_require_access()'::regprocedure,
     'public.admin_score(jsonb)'::regprocedure,
     'public.admin_attempt_status(jsonb)'::regprocedure,
     'public.admin_attempt_time(jsonb)'::regprocedure
   );
   ```

   Save the current function definitions/grants through your usual database backup/review process. **Do not rerun `admin_dashboard.sql`: it is a legacy base installer and is not part of this rollout.**

5. Apply the entire reviewed contents of `supabase/migrations/202611030001_module_cohorts.sql` in one SQL Editor execution, first in staging and then in production only after approval. It already includes `BEGIN`, `COMMIT`, and `NOTIFY pgrst, 'reload schema'`. Do not execute isolated fragments. Missing shared helpers or duplicate cohort/session schedules cause a transaction failure and require investigation; do not delete data to bypass the check. If applying manually, record the filename and release in your migration ledger. Do not separately run an automatic `supabase db push` over the same rollout without reconciling history.

6. Run `supabase/verify_cohort_install.sql` in the SQL Editor. It is read-only and shows function signatures, owners, security modes, search paths, and permissions. Every public cohort RPC should show authenticated access and no anon access. Internal helpers should show neither. All functions should have the expected trusted owner and SECURITY DEFINER enabled. If a pre-existing function has a different owner, stop and review that ownership instead of granting browser table access.

7. After the SQL is approved, applied, and verified, build and replace only the existing frontend service using the repository's Docker Compose definition:

   ```bash
   cd /opt/Teen_Quiz_Admin
   docker compose build teen-quiz-admin
   docker compose up -d --no-deps teen-quiz-admin
   docker compose ps teen-quiz-admin
   curl --fail --silent --show-error http://127.0.0.1:8086/ > /dev/null
   ```

   This uses the existing nginx container and loopback port 8086. Keep your current external reverse-proxy configuration. A plain `npm run build` alone does not update the running Docker container.

8. Sign in through the deployed UI with an active admin account. Check the existing global dashboard/student/attempt pages, then open a module and each assigned cohort. Verify Batch 3 remains selectable without students, Colombo schedule dates, session targets/counts, profile name/phone/age, search, pagination, results, student history, and answer options. Refresh a URL containing cohort/session selection. Confirm a non-admin account cannot access the RPCs. Inspect real query timings before considering additional indexes; the migration creates none blindly.

9. If rollout fails, restore the previous frontend image/release through your usual deployment mechanism. The new RPCs can remain installed because global RPCs are unchanged; no destructive database rollback is required. Investigate the failed check before retrying deployment.

## Validation and limits

- `npm run build`: passed.
- `npm test`: 37 tests passed (11 PostgreSQL tests, 26 UI/API/auth tests).
- The PostgreSQL tests use the real checked-in auth/normalization helpers and the verified table contract. They verify SMALLINT cohorts, profile membership, historical attribution, mismatched student/session mappings, duplicate mapping rows, empty Batch 3, shared question banks, Colombo midnight rollover, pagination/search, answer review, grant enforcement under actual database roles, unchanged global function definitions, and migration reapplication.
- Tests enable RLS and deny direct table access while exercising authorized SECURITY DEFINER calls. They do not replace a live check of your deployed policies, owners and helper definitions.
- No separate TypeScript/type-check command exists in this JavaScript project.
- Remaining rollout work is manual SQL application, valid environment configuration, and live smoke testing. No schema membership adapter is missing anymore.

## Files changed in this integration pass

- `supabase/migrations/202611030001_module_cohorts.sql`
- `src/lib/adminApi.js`
- `src/pages/ModulesPage.jsx`
- `src/components/CohortContent.jsx`
- `tests/cohort-database.test.mjs`
- `tests/ui/cohorts.test.jsx`
- `tests/ui/cohort-api.test.jsx` (new)
- `tests/ui/cohort-modules.test.jsx` (new)
- `supabase/verify_cohort_install.sql` (new)
- `supabase/COHORT_SETUP.md`
- `README.md`
