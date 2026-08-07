@AGENTS.md

# Gatekeeper — Project Constitution

**AI prepares the decision. A human authorizes the action.**

Gatekeeper is an AI support-operations decision gate. A ticket enters, the system
analyzes it, classifies category and severity, routes it, drafts a response,
verifies its own recommendation, explains itself, and presents a proposed action
to an operator. Nothing is executed until a human approves it.

This file is law. When a request conflicts with it, say so before writing code.

---

## 1. Product principles

1. **The gate is the product.** Every screen exists to help a human decide
   approve or reject. If a feature does not serve that decision, it is out.
2. **Operations tool, not a chatbot.** No chat bubbles, no streaming assistant
   persona, no "thinking…" theater. Dense, calm, scannable. The user is an
   operator at work, not a person having a conversation.
3. **Never fake functionality.** Anything shown as done must have happened.
   Simulated side effects are allowed only when labeled as simulated in the UI
   and recorded truthfully in the audit trail. No hardcoded numbers presented as
   model output. No spinner that waits on nothing.
4. **Explainability is not optional.** Every AI-produced field carries its
   evidence (which part of the ticket drove it) and its provenance (which tier
   produced it). An unexplained recommendation is a bug.
5. **The verifier must be able to disagree.** A verifier that always approves is
   theater. It can lower confidence, raise issues, and flag a draft as unsafe to
   send — and the UI must visibly change when it does.
6. **The demo works offline.** With the AI provider unreachable, seeded data
   still drives a complete run through the workflow. Degraded mode is a designed
   path, not a catch block.

---

## 2. Architecture principles

**Stack (fixed).** Next.js 16 App Router · TypeScript strict · Tailwind v4 ·
shadcn/ui on Base UI · Supabase Postgres · Vercel AI SDK v7. One deployable
Next app. No microservices, no vector DB, no job queue, no ORM.

**Workflow is a state machine, and it is law.**

```
RECEIVED → ANALYZING → DRAFTED → VERIFIED → AWAITING_APPROVAL
                                              ├─ APPROVED → EXECUTED
                                              └─ REJECTED
```

- One `Status` union type and one `canTransition(from, to)` function. Every write
  goes through it. No component and no route invents a transition.
- Illegal transitions are rejected server-side, not merely avoided by the UI.
- `EXECUTED` is reachable **only** from `APPROVED`. This is the whole premise.

**One AI module, three roles.** `lib/ai/` holds one provider config and three
functions — `analyze`, `draft`, `verify` — that are three prompts and three
output schemas over one structured-generation wrapper. Not three services, not
three clients, not an agent framework.

**Three-tier model resolution, always labeled.** Primary model → fallback model
in a *different* provider family (so one outage does not take both) → seeded
deterministic result. Every AI result returns `{ source: 'model' | 'fallback' |
'seed', model?: string }` and the UI displays which tier answered. Reach the
provider through the AI Gateway already bundled with `ai` rather than installing
a provider SDK.

**Model output is untrusted input.** Validate every generation against a schema
at the boundary. Invalid output means fall to the next tier, not `as any`.

**Deterministic where determinism is cheaper.** Risk level is computed in code
from severity, category, and action type — a pure, testable function. Do not ask
the model for a number you can derive. Confidence comes from the model; risk
does not.

**Data.** Two tables is the target: `tickets` (current state, plus the latest
analysis / draft / verification as JSON columns) and `ticket_events`
(append-only audit trail). Schema lives in one checked-in SQL file that also
seeds demo tickets — running it on a clean database must produce a demo-ready
app. Query with `@supabase/supabase-js` directly.

**Server by default.** Server Components read data; Server Actions write it.
Client components only where interaction demands it. No API routes unless
something outside the app must call in.

---

## 3. Coding rules

- **Read before writing.** `AGENTS.md` applies: this is Next 16 — consult
  `node_modules/next/dist/docs/` instead of recalling older conventions.
- **This shadcn/ui is built on Base UI (`@base-ui/react`), not Radix.** Do not
  import Radix packages or copy Radix-era snippets. 14 primitives are already in
  `components/ui/` — use them; add more with the shadcn CLI, never by hand.
- **Tailwind v4 is CSS-first.** Tokens live in `app/globals.css`. Do not create
  `tailwind.config.js`. Use existing semantic tokens (`bg-background`,
  `text-muted-foreground`); no raw hex, no arbitrary values where a token fits.
- **No new dependencies** without a one-line justification of why existing ones
  cannot do it. A dependency added for something a small function covers is a
  defect.
- **No abstraction until the third use.** No interface with one implementation,
  no factory, no config for a value that never changes, no `types/` barrel file,
  no wrapper that only forwards arguments.
- **`strict` stays on.** No `any`, no non-null `!` on data crossing a boundary,
  no `@ts-expect-error` without an adjacent explanation.
- **Types come from one place.** One `lib/types.ts` for domain types, derived
  from the DB shape. Never redeclare `Status` in a component.
- **Deliberate shortcuts get marked.** `// ponytail:` comment naming the ceiling
  and the upgrade path.
- Prose in the UI and in commits: plain, specific, no exclamation marks.

---

## 4. Scope firewall

Build only: ticket queue · decision detail · evidence and reasoning · proposed
response · proposed action · risk and confidence · approval gate · audit trail.

**Out of scope. Do not build these, and do not ask to.**

Auth, login, or OAuth (single implied operator; no user table) · multi-tenancy ·
RBAC · realtime subscriptions or websockets · streaming chat UI · a real email
provider · ticket-creation forms beyond a seed/replay control · settings or admin
pages · notifications · search, filters, or pagination beyond a status filter ·
analytics dashboards and charts that do not inform one decision · dark/light
theme switcher work · retry queues, cron, or background workers · file uploads ·
i18n · vector search, embeddings, or RAG · agent frameworks, tool loops, or
multi-agent orchestration · prompt-tuning UI · export to CSV/PDF · Storybook ·
CI pipelines · Docker.

If something on this list appears genuinely necessary, stop and raise it. Do not
build it and explain afterward.

---

## 5. Testing rules

Small and real. `vitest` and `@playwright/test` are installed; wire up the
missing `package.json` scripts before the first test.

- **Two unit specs, non-negotiable:** `canTransition` (every legal edge passes,
  representative illegal edges fail, `EXECUTED` unreachable except from
  `APPROVED`) and the risk function (its table of inputs).
- **One end-to-end spec:** seed → open ticket → analyze → draft → verify →
  approve → executed, asserting the audit trail gained the right rows and that
  execution is impossible before approval.
- **Pure logic is tested; framework wiring is not.** No component snapshots, no
  mocked Supabase client, no coverage target, no test for a one-line function.
- Tests run against seeded data with the AI provider stubbed. A test suite that
  needs a live model is broken.

---

## 6. UI rules

**Two surfaces.** A queue and a decision detail. Everything else is a section
inside one of them. Resist a third route.

**Priority order on the detail view** — highest first, and this order does not
change: status and risk/confidence header → proposed action → proposed response
→ evidence and reasoning → verification result → **approval gate** → audit trail.

**The gate.** Approve and Reject are the only primary actions on the page, always
visible, never hidden behind a menu or a tab. Approve on a high-risk item
requires a confirmation step that restates what will happen. Both buttons
disable while a write is in flight and reflect the true post-write state.

**Honesty in pixels.** Show the provenance badge (model / fallback / seeded) next
to AI output. Show confidence as a number with its scale, never a bare
percentage bar implying precision the model did not give. Simulated execution is
labeled *simulated* on screen. Empty and error states say what happened and what
to do next.

**Craft.** Neutral palette, one accent reserved for risk and status semantics.
Type and spacing consistent to a scale — density over whitespace, but never
cramped. Status is never conveyed by color alone (label or icon too). Keyboard
reachable, visible focus rings, real labels on controls, `aria-live` on status
changes. No layout shift when async content lands: reserve space with the
existing `skeleton` primitive.

---

## 7. Security rules

- **The gate is enforced on the server.** Approval is a Server Action that
  re-reads current status from the database and re-checks the transition. A
  client-side boolean guarding execution makes the entire product a lie.
- **Execution is idempotent.** Update conditionally (`… WHERE status =
  'APPROVED'`) and check rows affected. A double-click executes once.
- **The browser never writes.** Client gets the anon key with RLS allowing
  `select` only. All mutations use the service-role key in Server Actions. That
  key is server-only, never in a `NEXT_PUBLIC_*` var, never imported into a
  client component. Add it to `.env.local`; it is not there yet.
- **Reconcile the AI key before the first AI call.** `.env.local` has
  `AI_API_KEY`; the gateway expects `AI_GATEWAY_API_KEY`. Pick one and make the
  code and the env agree.
- **Secrets never reach the client or the logs.** `.env*` stays gitignored. Never
  echo a key value, not even truncated.
- **Ticket content is untrusted.** It reaches the model inside a delimited data
  block with an explicit instruction that it is data, not instructions. Rendered
  as text, never as HTML. A ticket that tries to instruct the model must not be
  able to move the state machine — only a human can.
- **The audit trail is append-only.** Every transition writes one event with
  actor (`ai` | `human`), timestamp, from-status, to-status, and reason. No
  updates, no deletes, no exceptions. It is the record of who authorized what.

---

## 8. Definition of done

A change is done when all of these hold:

1. `pnpm build` passes with no type errors and `pnpm lint` is clean.
2. The three specs in §5 pass.
3. The full workflow runs end to end on a freshly seeded database.
4. It still runs end to end with the AI provider unreachable, and the UI says so.
5. Nothing on screen is fake: every state, number, and side effect is real or
   visibly labeled as simulated.
6. `EXECUTED` cannot be reached without a human approval event in
   `ticket_events` — demonstrated, not assumed.
7. Keyboard-only operation of the approval gate works, with visible focus.
8. No new dependency, abstraction, file, or route beyond what the change needed.
9. Nothing from §4 was built.
