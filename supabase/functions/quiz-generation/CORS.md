# Quiz generation origin configuration

The old handler compared the request's `Origin` to the single
`QUIZ_ADMIN_ORIGIN` value before handling OPTIONS. An empty value, a production
origin, or a comma-separated value could therefore reject localhost with 403.

The same secret now accepts one origin or a comma-separated list. The code
always includes `http://localhost:5174` explicitly. Existing production values
remain allowed; localhost does not require replacing that secret. Entries are
trimmed, and a trailing slash is normalized. Wildcards and non-origin URLs are
not allowed. Different ports, subdomains and `127.0.0.1` are separate origins.

Allowed preflights return 204 before authentication with:

```text
Access-Control-Allow-Origin: <matching request origin>
Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type
Access-Control-Allow-Methods: POST, OPTIONS
Vary: Origin
```

All POST success/error responses to an allowed origin receive the same CORS
headers. Disallowed origins receive 403 without Access-Control-Allow-Origin.
Requests without Origin still require normal POST authentication and admin
authorization. No wildcard origin or credential-cookie setting is introduced.

## Deploy the code fix

From the project directory, deploy just this function to the existing project:

```powershell
supabase functions deploy quiz-generation --project-ref ooqhcmnqllhllvyqtham
```

Confirm this reference matches the project where your function is deployed.
This command does not push database migrations. No deployment or secret update
was performed as part of the local fix.

## Updating the server secret (only if needed)

The root Vite `.env` does not update hosted Edge Function secrets. In Supabase
Dashboard → Edge Functions → Secrets, update `QUIZ_ADMIN_ORIGIN` to the full
list of existing production origins plus any additional exact origins needed.
Do not replace production entries with localhost alone. The code already allows
localhost, so retaining your existing production secret unchanged is sufficient.

CLI equivalent (replace the example domains with ALL existing real values):

```powershell
supabase secrets set "QUIZ_ADMIN_ORIGIN=https://YOUR-EXISTING-PRODUCTION-ORIGIN,https://YOUR-OTHER-EXISTING-ORIGIN,http://localhost:5174" --project-ref ooqhcmnqllhllvyqtham
```

`secrets set` replaces the named secret's value; it does not append origins.
Do not run the example literally or remove any production value. No new secret
name is required. Keep the existing webhook secrets unchanged.

## Verify

```powershell
npm test
npm run build
curl.exe -i -X OPTIONS "https://ooqhcmnqllhllvyqtham.supabase.co/functions/v1/quiz-generation" -H "Origin: http://localhost:5174" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization, x-client-info, apikey, content-type"
```

After deployment, expect HTTP 204 and `Access-Control-Allow-Origin:
http://localhost:5174`. Repeat with each production origin. An unlisted origin
should receive 403 without Access-Control-Allow-Origin. This fixes CORS only;
generation readiness and backend configuration checks remain unchanged.

[Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-config)
