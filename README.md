# Teen Academy — Teen Quiz Admin

A React + Vite administration dashboard for the existing Teen Quiz Supabase database.

It is designed for staff to review student performance without adding a separate Node/Express backend.
The browser uses only the Supabase publishable key. Admin-only `SECURITY DEFINER` RPC functions provide the protected analytics data.

## Included screens

The **AI Quiz Generator** extracts PDF text locally, processes it asynchronously,
and atomically publishes 30 validated questions with 10 questions per attempt.
Setup, session reservation, deployment and staging checks are documented in
[n8n/README.md](n8n/README.md). It remains disabled until explicitly configured.

- **Dashboard** — total students, attempts, completion rate, average score, score distribution, recent attempts, module performance
- **Students** — searchable student directory with age, phone, attempt count, average score, best score and latest activity
- **Student details** — per-module statistics and every quiz attempt for one student
- **Modules** — module/session performance, students attempted, total attempts, average/best scores
- **Module details** — session breakdown and the most frequently missed questions
- **Attempts** — searchable and module-filterable attempt history
- **Answer review** — every question, student-selected option, correct option, result, topic and difficulty
- **Responsive layout** — desktop, tablet and mobile
- **Demo mode** — lets you preview the complete UI before connecting Supabase

## Security model

Do **not** put a Supabase `service_role` key in this frontend.

The production flow is:

```text
Admin browser
   ↓ email/password
Supabase Auth
   ↓
admin_is_current_user()
   ↓
Admin-only RPC functions
   ↓
Teen Quiz tables
```

The included SQL creates `public.admin_users` and all RPC functions used by the React app. Every data RPC verifies that `auth.uid()` belongs to an active admin.

## 1. Requirements

- Node.js 20.19+ or a current Node.js 22 release
- npm
- Existing Teen Quiz Supabase project

## 2. Install

```bash
npm install
```

## 3. Configure environment variables

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

Open `.env`:

```env
VITE_SUPABASE_URL=https://ooqhcmnqllhllvyqtham.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE
VITE_DEMO_MODE=false
```

Use the project's **publishable/anon key only**.

For a UI-only preview before database setup:

```env
VITE_DEMO_MODE=true
```

## 4. Check the existing Teen Quiz schema

In Supabase:

```text
SQL Editor → New query
```

Run:

```text
supabase/schema_check.sql
```

The production admin SQL expects these relationships:

```text
profiles.id
   ↓ quiz_attempts.student_id
quiz_attempts.batch_id
   ↓ quiz_batches.id
quiz_attempts.id
   ↓ quiz_attempt_questions.attempt_id
quiz_attempt_questions.bank_question_id
   ↓ quiz_bank_questions.id
```

Expected answer fields:

```text
quiz_attempt_questions.selected_option
quiz_attempt_questions.is_correct
quiz_bank_questions.correct_option
```

If your question foreign-key column is called `question_id` instead of `bank_question_id`, replace `aq.bank_question_id` with `aq.question_id` in `supabase/admin_dashboard.sql` before running it.

## 5. Install the secure admin RPC layer

Run the complete file in the Supabase SQL Editor:

```text
supabase/admin_dashboard.sql
```

It creates:

```text
admin_users
admin_is_current_user()
admin_dashboard_stats()
admin_list_students()
admin_get_student()
admin_list_modules()
admin_get_module()
admin_list_attempts()
admin_get_attempt()
```

The frontend does not need direct SELECT permission on the quiz tables.

## 6. Create the first admin account

Use:

```text
Supabase Dashboard
→ Authentication
→ Users
→ Add user
```

Create an email/password account for the administrator.

Copy that user's UUID, then run:

```sql
insert into public.admin_users(user_id, display_name)
values ('PASTE_ADMIN_AUTH_USER_UUID'::uuid, 'Teen Academy Admin')
on conflict (user_id)
do update set
  is_active = true,
  display_name = excluded.display_name;
```

The same Supabase Auth account is then used on the admin login page.

## 7. Start locally

```bash
npm run dev
```

Open:

```text
http://localhost:5174
```

## 8. Production build

```bash
npm run build
```

The generated site is in:

```text
dist/
```

## 9. Deploy to Vercel

Create a new Vercel project from this folder/repository and add these variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_DEMO_MODE=false
```

`vercel.json` is included so React Router routes such as `/students/:id` and `/attempts/:id` work on direct refresh.

## Main project structure

```text
teen-quiz-admin/
├── public/
│   └── images/
├── src/
│   ├── components/
│   ├── context/
│   ├── data/
│   ├── lib/
│   ├── pages/
│   ├── styles/
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   ├── admin_dashboard.sql
│   └── schema_check.sql
├── .env.example
├── package.json
├── vercel.json
└── vite.config.js
```

## Theme

The admin UI uses the same Teen Quiz premium-light palette: violet/purple primary actions, white translucent cards, pale violet/blue surfaces, green success states, red incorrect states, yellow highlights, and the same rounded-card visual language.

## Important notes

1. Correct answers are available only through the protected admin RPC. Do not add public SELECT policies to `quiz_bank_questions` merely to make the admin frontend work.
2. Keep `VITE_SUPABASE_PUBLISHABLE_KEY` in the browser; never use a secret/service-role key.
3. To deactivate an admin:

```sql
update public.admin_users
set is_active = false
where user_id = 'ADMIN_USER_UUID'::uuid;
```

4. The SQL deliberately reads several optional attempt fields through `to_jsonb()` so minor differences such as `score` vs `score_percent` and `created_at` vs `completed_at` are tolerated.
5. If your core relation names differ, run `supabase/schema_check.sql` first and update only the named relationship columns in `admin_dashboard.sql`.
