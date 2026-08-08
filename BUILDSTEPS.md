# Build & Run — Gatekeeper

This document walks a developer or judge through running Gatekeeper locally and verifying the project.

1) Prerequisites
- Node.js 20 or newer
- pnpm
- Git

2) Clone the repository
```bash
git clone https://github.com/your-org/gatekeeper.git
cd gatekeeper
```

3) Install dependencies
```bash
pnpm install
```

4) Environment variables
Create a `.env.local` file at the repository root with the following values (example template):

```
# Supabase (client-safe) values used by the app
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-public-key

# Supabase service role key (server-only)
SUPABASE_SERVICE_ROLE_KEY=service-role-secret

# Google Generative AI / Gemini API key used by the ai provider
GOOGLE_GENERATIVE_AI_API_KEY=sk-...
```

Notes:
- Never commit `.env.local` or secret keys to the repo.
- In a CI or reviewer environment, inject these values via the runner's secure variables.

5) Database migration
The database schema is provided in `supabase/migrations/001_initial_schema.sql`.
Apply it to your Postgres database (for example, via the Supabase dashboard or using the `psql` CLI). Example using psql:

```bash
psql postgresql://USER:PASSWORD@HOST:PORT/DATABASE -f supabase/migrations/001_initial_schema.sql
```

6) Run locally (development)
```bash
pnpm dev
```
Open http://localhost:3000 to view the app.

7) Production build
```bash
pnpm build
pnpm start
```

8) Tests
- Unit tests (Vitest):
```bash
pnpm test
```
- End-to-end tests (Playwright):
```bash
pnpm test:e2e
```

9) Live demo
The project is deployed at: https://usegatekeeper.vercel.app

Troubleshooting
- If `pnpm build` or `pnpm dev` fail with type errors, run:
```bash
pnpm typecheck
pnpm lint
```
- If migrations reference extensions or Postgres features your local DB lacks, use Supabase for a drop-in compatible Postgres instance.

That's it — you should now be able to run and test Gatekeeper locally.
