# Verification scope

`npm test` runs isolated PostgreSQL/pgvector migration and publication tests, request authorization/CORS/body-limit tests, actual local PDF.js extraction, mocked AI worker processing, workflow structure checks and React interaction/polling/dashboard smoke tests.

The database fixture follows the supplied production column contract. It tests full rollback on insertion failure, staging validation, reservation protections, private source access, publication counts/distribution/runtime size, source cleanup and unchanged historical/cohort rows and legacy function definition.

No live Supabase writes, real OpenAI calls, n8n import/execution, real student RPC integration or true multi-connection database contention tests were performed. These require staging verification before production activation. See n8n/README.md.
