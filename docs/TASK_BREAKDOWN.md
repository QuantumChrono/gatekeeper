# Task Breakdown

This document summarizes the step-by-step plan followed to build the Gatekeeper project.

## 1. Define the problem and scope

- Identify the main product goal: an AI-assisted decision gate for support operations.
- Restrict the scope to a queue, a decision detail page, evidence/reasoning, approval/rejection, and an audit trail.
- Exclude auth, multi-tenancy, notifications, file uploads, background workers, and unrelated dashboards.

## 2. Choose the architecture and stack

- Use Next.js 16 App Router with TypeScript strict mode.
- Use Tailwind v4 with CSS-first tokens in `app/globals.css`.
- Use shadcn/ui on Base UI for primitives.
- Use Supabase Postgres for storage with direct `@supabase/supabase-js` queries.
- Use the Vercel AI SDK via the `ai` package for model access.
- Keep the app as a single deployable project with no microservices.

## 3. Design the data model

- Create `tickets` table for current ticket state, analysis/draft/verification payloads, and risk.
- Create `ticket_events` table as append-only audit trail.
- Enforce RLS so the browser only has select access and server-side writes use the service role key.
- Seed demo tickets with deterministic `seed` payloads for offline fallback.

## 4. Implement the AI workflow

- Build one AI module with three roles: analyze, draft, verify.
- Use a single provider config for primary/fallback/seeded tiers.
- Validate all model output with Zod schemas at the boundary.
- Ensure missing API keys or provider failures fall back to seeded output.

## 5. Build the UI

- Create a queue page showing ticket status, category, severity, and risk.
- Create a ticket detail page showing original ticket text, proposed action, proposed response, evidence, verification result, and audit trail.
- Add an approval gate with always-visible Approve and Reject buttons.
- Require confirmation for high-risk approvals.
- Keep client components minimal and only where interaction is required.

## 6. Add server-side enforcement

- Implement `canTransition(from, to)` in `lib/workflow.ts`.
- Enforce transitions inside Server Actions and database updates.
- Ensure `EXECUTED` is only reachable from `APPROVED`.

## 7. Add tests and CI

- Write unit tests for transition logic and risk computation.
- Add an end-to-end Playwright test for the full workflow from seed to executed.
- Configure CI to run lint, typecheck, unit tests, e2e tests, and build.

## 8. Add documentation and audit support

- Keep `CLAUDE.md` as the project constitution.
- Add `AGENTS_AND_SKILLS.md` to document the custom skill and agent strategy.
- Add `docs/TASK_BREAKDOWN.md` to explain the work plan.
- Preserve `docs/ARCHITECTURE.md` and `docs/PRD.md` as reference documentation.
