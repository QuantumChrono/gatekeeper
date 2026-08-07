# Gatekeeper — Architecture

One Next.js app, one Postgres database, one AI module with three prompts. Sized
for one developer in a hackathon window. Governed by `CLAUDE.md`.

Verified against the installed tree: Next 16.3.0, React 19.2.8, Tailwind v4
(CSS-first, no config file), shadcn/ui on **Base UI** (`@base-ui/react`, style
`base-vega`, 14 primitives already in `components/ui/`), `ai@7.0.55` with
`@ai-sdk/gateway` and **no provider SDK installed**, `zod@4.4.3` present as a
peer of `ai`, `@supabase/supabase-js@2.112.2`, vitest + playwright installed with
no scripts wired.

---

## 1. Next.js structure

Two routes. Server Components read, Server Actions write. No API routes — nothing
outside the app calls in.

```
app/
  layout.tsx                  root shell (exists; retitle from "Create Next App")
  globals.css                 Tailwind v4 tokens (exists)
  page.tsx                    QUEUE — server component, reads tickets
  tickets/[id]/page.tsx       DECISION DETAIL — server component, reads one ticket + events
  actions.ts                  every Server Action, one file

lib/
  types.ts                    Status union, domain types, zod schemas for AI output
  workflow.ts                 canTransition() + computeRisk()  ← pure, tested
  db.ts                       two Supabase clients (read/anon, write/service-role)
  ai/
    provider.ts               model resolution + 3-tier runner
    stages.ts                 analyze / draft / verify — prompts + schemas only

components/
  ui/                         14 existing Base UI primitives — reuse, add via CLI only
  queue-table.tsx             server component
  provenance-badge.tsx        model | fallback | seeded
  approval-gate.tsx           CLIENT — approve/reject, confirm step, reason
  stage-button.tsx            CLIENT — advance one AI stage, pending state
  audit-trail.tsx             server component

supabase/
  schema.sql                  DDL + RLS + append-only trigger + seed, idempotent

tests/
  workflow.test.ts            vitest — transitions + risk table
  gate.spec.ts                playwright — seed → … → EXECUTED
```

Client components are only the two that need interaction. Every other detail
section renders inline in `tickets/[id]/page.tsx` — fewer files, no prop
plumbing. Total new files: ~14.

**`package.json` gaps to close first:** add `"test": "vitest run"`, `"test:e2e":
"playwright test"`, and declare `zod` explicitly (it resolves at 4.4.3 today but
is only a transitive peer; importing an undeclared package under pnpm is
fragile). No other dependency is added.

---

## 2. Supabase schema

Two tables. `tickets` holds current state plus the latest AI output as JSONB;
`ticket_events` is the append-only audit trail. No ORM — `@supabase/supabase-js`
directly. One checked-in file, safe to re-run.

```sql
-- supabase/schema.sql

create type ticket_status as enum (
  'RECEIVED','ANALYZING','DRAFTED','VERIFIED',
  'AWAITING_APPROVAL','APPROVED','REJECTED','EXECUTED'
);
create type actor_kind  as enum ('ai','human','system');
create type ai_source   as enum ('model','fallback','seed');

create table tickets (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  subject           text not null,
  body              text not null,                        -- untrusted customer text
  customer_name     text not null,
  customer_tier     text not null check (customer_tier in ('free','pro','enterprise')),
  order_value_cents integer not null default 0,           -- refund ceiling + risk input
  status            ticket_status not null default 'RECEIVED',

  analysis          jsonb,   -- { category, severity, evidence[], routing, confidence,
                             --   reasoning, source, model }
  draft             jsonb,   -- { response, action:{type,params}, rationale, source, model }
  verification      jsonb,   -- { issues[], confidence, safeToSend, notes, source, model }
  risk              text check (risk in ('LOW','MEDIUM','HIGH')),  -- computed in code
  execution_result  jsonb,   -- { executedAt, action, simulated:true, detail }

  seed              jsonb not null default '{}'::jsonb
                             -- { analysis, draft, verification } — tier 3, ships with the row
);

create table ticket_events (
  id          bigserial primary key,
  ticket_id   uuid not null references tickets(id) on delete cascade,
  created_at  timestamptz not null default now(),
  actor       actor_kind not null,
  from_status ticket_status,
  to_status   ticket_status not null,
  reason      text,
  source      ai_source,       -- which tier answered, when actor = 'ai'
  model       text
);

create index on ticket_events (ticket_id, id);
create index on tickets (status);
```

**Append-only, enforced in the database** — not by convention:

```sql
create function ticket_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'ticket_events is append-only'; end $$;

create trigger no_mutate_events before update or delete on ticket_events
  for each row execute function ticket_events_immutable();
```

**RLS.** Enabled on both tables. The anon key gets `select` only; the
service-role key bypasses RLS for writes. The browser therefore cannot mutate
anything even if someone drives it directly.

```sql
alter table tickets       enable row level security;
alter table ticket_events enable row level security;
create policy read_tickets on tickets       for select using (true);
create policy read_events  on ticket_events for select using (true);
-- no insert/update/delete policy exists → anon writes are impossible
```

**Seed.** ~8 tickets spanning categories, severities, and tiers, each carrying a
pre-computed `seed` payload. Two are scripted for the demo: a clear-cut
escalation and a high-value refund the verifier objects to. Includes one ticket
whose body contains a prompt-injection attempt (AC-13). Reset = one `delete from
tickets` plus re-insert, exposed as a server action.

**Why JSONB and not three tables.** Each stage produces exactly one current
result per ticket, always read together with the ticket. Three tables would add
three joins and three migrations to model a 1:1. The audit trail already provides
history. Revisit if stage results ever need independent versioning.

---

## 3. AI workflow

**One module, three roles.** `lib/ai/provider.ts` owns model resolution and the
tier ladder. `lib/ai/stages.ts` is three prompts and three zod schemas. Nothing
else. No agent framework, no tool loop, no orchestration layer.

**Provider access.** Through `@ai-sdk/gateway`, which `ai@7.0.55` already
bundles — so the fallback model costs no new dependency and no second SDK.
`generateObject` + `zodSchema` (both exported by `ai`) give schema-validated
structured output directly.

**Model tiers.** Primary and fallback deliberately sit in different provider
families so a single vendor outage cannot take both.

```
tier 1  primary   e.g. gateway 'anthropic/claude-sonnet-5'
tier 2  fallback  e.g. gateway 'openai/gpt-...'    ← different family
tier 3  seed      tickets.seed[stage] — deterministic, always available
```

Model IDs live in one constant block, not scattered in prompts.

**The runner.** One function every stage goes through:

```ts
// lib/ai/provider.ts
type Tiered<T> = T & { source: 'model' | 'fallback' | 'seed'; model?: string }

async function runStage<T>(
  schema: ZodType<T>,
  prompt: { system: string; user: string },
  seedFallback: T,
): Promise<Tiered<T>>
```

Order of operations: try primary → on throw or schema-validation failure, try
fallback → on second failure, return `seedFallback` tagged `source: 'seed'`. A
short timeout per attempt (~15s) keeps the demo responsive. Missing credentials
skip straight to tier 3 rather than throwing, so a clean clone with no keys still
runs (AC-10).

**The three stages** — signatures and output shapes only:

```ts
analyze(ticket)            → { category, severity, evidence: string[],
                               routing, confidence, reasoning }
draft(ticket, analysis)    → { response, action: { type, params }, rationale }
verify(ticket, draft)      → { issues: string[], confidence, safeToSend, notes }
```

`action.type ∈ { REPLY, ESCALATE_T2, ESCALATE_ENG, REFUND, CLOSE }`.

**Design decisions that keep this honest and small:**

- **Evidence is verified in code.** Quotes returned by the analyzer are matched
  against the ticket body; unmatched quotes are dropped rather than displayed
  (AC-5). The model cannot invent a citation into the UI.
- **The verifier sees the ticket and the draft, never the analyzer's reasoning.**
  Independence is the point; feeding it the prior rationale invites agreement.
- **Risk is not asked for.** `computeRisk` derives it in code (§4). Confidence
  comes from the model; risk never does.
- **Refund parameters are clamped in code** to `order_value_cents`. A model
  cannot propose refunding more than the order was worth.
- **Ticket text is untrusted input.** It enters inside a delimited block with an
  explicit instruction that the block is data, not instructions. Injection can at
  worst produce a bad recommendation — which is exactly what the human gate is
  for (AC-13).

---

## 4. State machine

One `Status` union and one `canTransition`. Every write goes through it;
illegal transitions are refused server-side (`CLAUDE.md` §2).

```
RECEIVED ──▶ ANALYZING ──▶ DRAFTED ──▶ VERIFIED ──▶ AWAITING_APPROVAL
    ▲            │            │           │                │
    └── failure ─┘            │           │        ┌───────┴───────┐
                              ▼           ▼        ▼               ▼
                   (failure: stays)  (stays)   APPROVED        REJECTED ■
                                                   │
                                                   ▼
                                              EXECUTED ■
```

```ts
// lib/workflow.ts
const TRANSITIONS: Record<Status, Status[]> = {
  RECEIVED:          ['ANALYZING'],
  ANALYZING:         ['DRAFTED', 'RECEIVED'],       // RECEIVED = analysis failed
  DRAFTED:           ['VERIFIED'],
  VERIFIED:          ['AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED:          ['EXECUTED'],
  REJECTED:          [],
  EXECUTED:          [],
}
export const canTransition = (from: Status, to: Status) =>
  TRANSITIONS[from].includes(to)
```

`EXECUTED` appears in exactly one arm: from `APPROVED`. That single line is the
product premise, and `workflow.test.ts` asserts it directly.

**Resting states are honest.** `ANALYZING` is written *before* the analyzer runs
and stays until the drafter succeeds — so a crashed run is visibly parked in
`ANALYZING` rather than silently rewound. A stage failure returns the ticket to
its prior status and records an error event; it never leaves partial output on
screen (AC-11).

**Verification performs two recorded transitions in one click:**
`DRAFTED → VERIFIED`, then `VERIFIED → AWAITING_APPROVAL`. Both land in the audit
trail, so the mandated chain is fully visible without a pointless fourth click.

**Risk, deterministic and tested:**

```ts
computeRisk({ severity, actionType, customerTier, safeToSend }): 'LOW'|'MEDIUM'|'HIGH'
// severity  LOW 0 · MEDIUM 1 · HIGH 2 · CRITICAL 3
// action    REPLY/ESCALATE_* 0 · CLOSE 1 · REFUND 2
// + 1 if !safeToSend        + 1 if customerTier === 'enterprise'
// ≥4 HIGH · 2–3 MEDIUM · else LOW
```

The UI names the contributing factors, so "HIGH" is never unexplained (AC-7/AC-8).

---

## 5. Server-action boundaries

All actions live in `app/actions.ts`. **No API routes.** Every one of them: reads
current status from the database, checks `canTransition`, writes the new status
and its event, then `revalidatePath`. The client sends an intent, never a state.

| Action | Transition | Notes |
|---|---|---|
| `runAnalysis(id)` | `RECEIVED → ANALYZING` | actor `ai`, records tier |
| `runDraft(id)` | `ANALYZING → DRAFTED` | actor `ai` |
| `runVerification(id)` | `DRAFTED → VERIFIED → AWAITING_APPROVAL` | actor `ai`; computes and stores `risk` |
| `approve(id)` | `AWAITING_APPROVAL → APPROVED` | actor **`human`** |
| `reject(id, reason)` | `AWAITING_APPROVAL → REJECTED` | actor `human`; reason required, non-empty |
| `execute(id)` | `APPROVED → EXECUTED` | actor `human`; idempotent |
| `resetDemo()` | — | re-seeds; demo affordance |

**The gate, concretely.** `approve` and `execute` are separate actions. `execute`
cannot fire on a ticket that is not already `APPROVED`, and because status is
re-read server-side, a stale or forged client cannot skip the gate (AC-1, AC-2).

**Idempotent execution** via a conditional write plus a rows-affected check:

```
update tickets set status='EXECUTED', execution_result=…
 where id=$1 and status='APPROVED'
→ 0 rows ⇒ someone already executed or it was never approved ⇒ no event, no-op
```

A double-click executes once (AC-3).

**Execution is simulated and says so.** No email provider is wired for the demo,
so `execution_result` records `simulated: true` and the UI renders a *simulated*
label. Real delivery is a credential swap inside this one function.

**Optional demo convenience.** A "Process ticket" button may call the three AI
actions in sequence — same actions, same events, no new path. Nothing else
chains transitions.

---

## 6. Error handling

Three failure classes, three responses.

**AI failure** (provider down, timeout, malformed or schema-invalid output).
Handled by the tier ladder in §3 — fall to fallback, then to seed. Invalid output
means fall through, never `as any`. Because tier 3 always exists, an AI stage
does not fail from the operator's point of view; it produces a `seeded` result
and says so.

**Transition failure** (illegal transition, stale client, ticket already moved).
The action returns a typed result — `{ ok: false, message }` — rather than
throwing. The UI shows the message and re-renders from the server, so the screen
corrects itself instead of drifting.

**Infrastructure failure** (database unreachable, write rejected). Revert the
status to its prior value, write a `system` error event where the connection
allows, and surface a plain statement of what failed and what to do next. Never a
silent catch, never a spinner that resolves into nothing.

**Rules that apply to all three:** no partial AI output is ever displayed as
complete; every error path leaves the state machine in a legal state; error text
names the thing that failed; secrets never appear in a message or a log.

---

## 7. Fallback and demo strategy

**The requirement:** the demo runs end to end with the AI provider unavailable.
This is a designed path, not a catch block (`CLAUDE.md` §1.6).

**How it works.** Every seeded ticket ships with its own `seed` JSONB containing
a plausible analysis, draft, and verification. With no credentials or an
unreachable provider, `runStage` returns that payload tagged
`source: 'seed'`, and every affected block on screen carries a `seeded` badge.
The state machine, the gate, the audit trail, and execution are entirely
provider-independent — the AI supplies content, never control flow.

**Three tiers, always labeled.**

| Tier | Trigger | Badge |
|---|---|---|
| primary model | credentials present, call succeeds, output valid | `model` + id |
| fallback model | primary throws, times out, or fails validation | `fallback` + id |
| seed | no credentials, or both models fail | `seeded` |

**Honesty constraint.** Seeded output is never dressed as live inference. The
badge is mandatory, its absence is a defect, and the audit trail records the tier
that produced each AI transition.

**Demo readiness.** `schema.sql` on a clean database yields a demo-ready app with
no AI call required. `resetDemo()` returns it to the starting state between runs.

**Environment reconciliation, required before the first AI call.** `.env.local`
currently holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`AI_API_KEY`. The gateway reads **`AI_GATEWAY_API_KEY`** (confirmed in the
installed package), and server writes need `SUPABASE_SERVICE_ROLE_KEY`, which is
absent. Both must be fixed or the app runs permanently in seeded mode with no
write path.

---

## 8. Testing strategy

Small and real. Three specs, per `CLAUDE.md` §5. Wire the missing scripts first.

**`tests/workflow.test.ts` (vitest, pure).**
- `canTransition`: every legal edge passes; representative illegal edges fail
  (`RECEIVED → EXECUTED`, `AWAITING_APPROVAL → EXECUTED`, `REJECTED → *`,
  `EXECUTED → *`); asserts `EXECUTED` is reachable **only** from `APPROVED` by
  scanning the whole transition map.
- `computeRisk`: the input table from §4, including both boundaries (3 → MEDIUM,
  4 → HIGH) and the `!safeToSend` and enterprise bumps.

**`tests/gate.spec.ts` (playwright, one flow).** Seed → open ticket → analyze →
draft → verify → approve → execute → `EXECUTED`. Asserts the audit trail gained
the right rows in order with a `human` actor on approval, and that execution is
unavailable before approval. Runs against seeded data with the provider stubbed —
a suite that needs a live model is broken.

**Not tested:** component snapshots, mocked Supabase clients, framework wiring,
one-line functions. No coverage target.

**Manual checks before calling it done:** run with credentials removed (AC-10),
double-click execute (AC-3), tab-only through the gate (AC-14).

---

## 9. Security considerations

Restating `CLAUDE.md` §7 as implementation constraints.

**The gate is server-enforced.** Approval and execution re-read status from the
database and re-check `canTransition` inside the Server Action. A client-side
boolean guarding execution would make the entire product a lie.

**The browser never writes.** Anon key + RLS `select`-only in the client;
service-role key in Server Actions only. The service-role key is server-only,
never in a `NEXT_PUBLIC_*` var, never imported into a client component. It is
missing from `.env.local` and must be added there — `.env*` stays gitignored.

**Ticket content is untrusted.** Delimited data block in prompts, rendered as
text and never as HTML. Injection cannot move the state machine; only a human
can (AC-13).

**Model output is untrusted.** Schema-validated at the boundary; refund amounts
clamped to order value; evidence quotes matched against the ticket body before
display.

**The audit trail is append-only,** enforced by trigger and by the absence of any
write policy — not by convention. It is the record of who authorized what.

**Idempotent, conditional writes** on every status change, so races and
double-submits cannot produce two executions or a lost transition.

**Secrets never reach the client or the logs.** No key value is echoed, not even
truncated.

**Accepted for the hackathon, with the reason:** no authentication (single
implied operator — approvals are attributed to `human`, not a named person;
adding identity is the first post-hackathon item), and simulated execution
(labeled on screen and in the record).
