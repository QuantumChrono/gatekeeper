# Gatekeeper — Judge Demonstration

**Runtime: 2:55.** Two tickets, one point.

Opens with the problem, not the stack. The wow moment is at **1:30** — an AI
recommendation crossing a human approval gate into an auditable execution
result. Everything before it sets that up; everything after it proves the gate is
real.

---

## Pre-flight (before the timer starts)

- `schema.sql` freshly applied, or `resetDemo()` clicked. Queue shows 8 tickets.
- **Ticket A** — "Checkout returns 500 for all card payments" — enterprise tier,
  seeded at status `RECEIVED`. Driven live on stage.
- **Ticket B** — "Cancel my plan and refund the last 3 months" — $147 order,
  seeded at `AWAITING_APPROVAL` with the verifier already objecting. No waiting.
- Both browser tabs pre-opened: queue, and Ticket B detail. Ticket A opened live.
- Zoom to ~125%. Judges read a projector, not a monitor.
- Say **"proposed action"** and **"approval"**, never "the agent decides".

---

## The script

### 0:00 — 0:25 · The problem (25s)

*Queue on screen, do not touch it.*

> "A support team gets 400 tickets a week. They have two options today, and both
> are bad.
>
> Option one: a human reads every ticket. Accurate, and the queue wins.
>
> Option two: let AI handle it. Fast — until it refunds $2,000 it shouldn't, or
> closes an outage as resolved. And afterwards nobody can prove who authorized
> it.
>
> The missing piece isn't a smarter model. It's accountability. So we built the
> gate."

**Beat.** Then, one line only:

> "Gatekeeper prepares the decision. A human authorizes the action."

### 0:25 — 0:40 · The queue (15s)

*Gesture across the table; do not narrate columns.*

> "This is an operations console. Every ticket, its category, severity, and risk.
> No chat window anywhere in this product — an operator has 40 of these waiting."

*Point at the status column.* "Each one is somewhere in a fixed workflow."

### 0:40 — 1:05 · Analysis, with evidence (25s)

*Open Ticket A. Scroll the customer message so they see it is real text.*

> "Checkout is down for an enterprise customer. Watch what the system does with
> it."

*Click **Run analysis**. Status flips `RECEIVED → ANALYZING → DRAFTED`.*

> "Category: billing-critical. Severity: critical. Routed to engineering.
>
> And here's the part I care about — **evidence**. These are quotes pulled from
> the ticket, and we verify each one appears in the body before we'll show it. It
> cannot cite something the customer never wrote."

*Tap the provenance badge.* "Every AI block is stamped with what produced it."

### 1:05 — 1:30 · Draft and verify (25s)

*Click **Run verification**. Status → `VERIFIED` → `AWAITING_APPROVAL`.*

> "It drafted the customer reply — this exact text is what would go out. And it
> proposed one concrete action: escalate to engineering.
>
> Then a second pass checks that draft against the original ticket
> independently — it never sees the first pass's reasoning. No issues here.
> Confidence 0.9. Risk: computed in code from severity and action type, not asked
> of the model, so it's the same number every run."

*Land on the gate.*

> "And now it stops. On its own it will never do anything else."

### 1:30 — 2:10 · The gate (40s) ← **WOW**

*Slow down. This is the demo.*

> "Everything so far is a **recommendation**. Nothing has happened. No queue was
> touched, no engineer paged."

*Click **Approve**. Confirmation appears restating the action.*

> "High-risk approvals make me confirm what I'm authorizing, in plain language."

*Confirm. Status → `APPROVED`. Then click **Execute**.*

> "Now it executes — and only now."

*Status → `EXECUTED`. Scroll to the audit trail.*

> "Here is the whole record. Analysis by `ai`. Draft by `ai`. Verification by
> `ai`. **Approval by `human`** — timestamped. Then execution.
>
> This table is append-only, enforced by a database trigger. Nothing here can be
> edited or deleted, by me or by the app.
>
> And `EXECUTED` is reachable from exactly one state: `APPROVED`. Enforced on the
> server, re-read from the database on every call. You can't skip the gate from
> the browser, because the browser has no write access at all."

*One honest line, delivered without apology:*

> "Delivery is labeled *simulated* here — no email provider is wired for a
> hackathon demo. That's a credential swap inside one function."

### 2:10 — 2:40 · The gate has teeth (30s)

*Switch to the pre-opened Ticket B.*

> "A gate that always says yes is theater. Second ticket — customer wants a $147
> refund across three months."

*Point at the verification block, already objecting.*

> "The verifier disagrees with its own draft. It flagged that the refund window
> in our terms is 30 days, so the draft promises something policy doesn't
> support. Confidence dropped to 0.4. Marked **not safe to send** — which pushes
> risk to HIGH."

*Click **Reject**, type "Outside 30-day refund window", submit.*

> "I reject it with a reason. It's terminal — this ticket can never be approved
> or executed now. And the reason is in the record, so in three weeks the answer
> to 'why didn't we refund this?' is right here."

### 2:40 — 2:55 · Close (15s)

> "One queue. Three AI stages that classify, draft, and check their own work.
> Verified evidence, deterministic risk, an approval gate the client cannot
> bypass, and an append-only record of who authorized what.
>
> AI prepares the decision. A human authorizes the action."

*Stop talking.*

---

## Timing

| Beat | Cum. | Cut order |
|---|---|---|
| Problem | 0:25 | never — this is why the product exists |
| Queue | 0:40 | trim to 8s |
| Analysis + evidence | 1:05 | **cut 1st** — fold into verify beat (−15s) |
| Draft + verify | 1:30 | trim the risk sentence (−7s) |
| **The gate** | **2:10** | never |
| Rejection | 2:40 | **cut 2nd** — costs credibility (−30s) |
| Close | 2:55 | trim to the last line (−10s) |

Hard floor with both cuts: **2:20**. Over-running past 3:00 is worse than
dropping the rejection beat — the gate must land with room to breathe.

## If it breaks on stage

**A model call hangs or errors.** Do not apologize — this is a designed path.
The badge flips to `fallback` or `seeded` and the stage completes anyway:

> "That's the fallback tier — the provider is unreachable, so it fell through to
> seeded data and told you so. The gate and the audit trail don't depend on any
> model being up."

**Running fully offline** (no credentials): every badge reads `seeded` for the
whole demo. Point at it once, early, in the analysis beat, and move on. The
script does not otherwise change — the AI supplies content, never control flow.

**The database is unreachable.** No recovery. Verify the queue loads during
pre-flight.

## Judge questions, prepared

**"Couldn't a user just call the API and skip approval?"** No. Execution is a
Server Action that re-reads status from Postgres and re-checks the transition;
`EXECUTED` is only legal from `APPROVED`. The browser holds a read-only key with
RLS `select`-only — it has no write path to forge.

**"What if the ticket tells the model to approve itself?"** *Open the injection
ticket in the seed.* Prompt text arrives as delimited data, and no model output
can move the state machine. Worst case it produces a bad recommendation — which
is what the human gate is for.

**"Is the confidence number real?"** Confidence comes from the model. Risk does
not — it's computed in code from severity, action type, customer tier, and the
verifier's verdict, so it's reproducible and testable. We don't ask a model for a
number we can derive.

**"How do you know the evidence isn't hallucinated?"** Quotes are string-matched
against the ticket body server-side; unmatched quotes are dropped, not displayed.

**"What's the fastest path to production?"** Operator identity on approvals, then
swap the simulated send for a real provider inside the existing execute function.
Both are small; the gate and the audit trail already hold.

## What this script requires from the build

Writing the demo first constrains the seed. The build must deliver:

1. Ticket A at `RECEIVED`, enterprise, critical, with evidence quotes that
   verifiably appear in its body.
2. Ticket B at `AWAITING_APPROVAL` with a seeded verification that objects:
   issues populated, confidence ~0.4, `safeToSend: false`, risk `HIGH`.
3. A refund action whose proposed amount is visible as a dollar figure.
4. One ticket containing a prompt-injection attempt, for Q&A.
5. Provenance badges on every AI block, including seeded.
6. Audit trail rendering `actor` prominently — `human` must be unmissable.
7. `resetDemo()` reachable in two clicks.
8. Confirmation step wired on `HIGH` risk approvals.
