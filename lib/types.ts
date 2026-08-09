// Domain types, derived from the DB shape in supabase/migrations/001_initial_schema.sql.
// One home for these (CLAUDE.md §3) — never redeclare Status in a component.
// Field names stay snake_case because that is what postgrest returns.

/**
 * Either it worked or it says why. Reads, writes and AI stages all return this,
 * so a failure is a value the UI can render rather than an exception an operator
 * meets as a stack trace (CLAUDE.md §6).
 *
 * Lives here rather than in lib/db.ts so that lib/workflow.ts — the state
 * machine, which must stay pure and importable without a database client — can
 * use it. lib/db.ts re-exports it for the modules that already read it there.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; message: string }

export type Status =
  | "RECEIVED"
  | "ANALYZING"
  | "DRAFTED"
  | "VERIFIED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"

export type Category =
  | "BILLING"
  | "BUG"
  | "ACCOUNT_ACCESS"
  | "REFUND"
  | "FEATURE_REQUEST"

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
export type Risk = "LOW" | "MEDIUM" | "HIGH"
export type CustomerTier = "free" | "pro" | "enterprise"

export type ActionType =
  | "REPLY"
  | "ESCALATE_T2"
  | "ESCALATE_ENG"
  | "REFUND"
  | "CLOSE"

/** Which tier produced an AI result. Displayed next to every AI field (AC-9). */
export type AiSource = "model" | "fallback" | "seed"
export type Actor = "ai" | "human" | "system"

/**
 * What every stored AI artifact carries: which tier produced it, and which model
 * if one did. Displayed next to the output it belongs to (CLAUDE.md §6).
 */
type Provenance = {
  source: AiSource
  model?: string
  /**
   * Set when a tier above this one was tried and failed. Stored with the artifact
   * so a provider outage the seed absorbed stays on the record and on the screen
   * instead of vanishing behind a result that happened to work.
   */
  degraded?: string
}

// The three stored artifacts are the three stage schemas plus provenance —
// derived from them, not restated.
//
// This is a type-only import, so it is erased at compile time and creates no
// runtime dependency from this module on the AI module (which reads env and must
// never reach a client bundle). Deriving rather than redeclaring is deliberate:
// runStage validates the seeded tier-3 payload against the very same schema it
// validates model output with, so a stored shape that drifted from the schema
// would make degraded mode unparseable — the one path that must work when
// nothing else does.
import type {
  AnalysisFields,
  ConflictFields,
  DraftFields,
  VerificationFields,
} from "@/lib/ai/stages"

export type Analysis = AnalysisFields & Provenance

export type Draft = DraftFields & Provenance

/**
 * `safeToSend` is recorded rather than re-derived at read time. It is the
 * verifier's objection as it stood when the verification was written, and the
 * audit trail and the risk band both rest on it — deriving it again on every
 * render would invite the screen and the record to disagree. `verify()` computes
 * it once, from the verdict, and it is stored with the verdict.
 */
export type Verification = VerificationFields &
  Provenance & { safeToSend: boolean }

/**
 * A stage that did not produce a usable result. Recorded on the ticket so the
 * failure is visible rather than inferred from an absence (CLAUDE.md §1), and
 * cleared when the pipeline is next run.
 *
 * There is no failure *status*: the workflow's eight statuses are fixed
 * (CLAUDE.md §2), and a failed stage leaves the ticket exactly where it was. A
 * failure therefore cannot advance anything, which is the property worth having.
 */
export type PipelineError = {
  stage: "analyze" | "draft" | "verify" | "conflict" | "pipeline"
  message: string
  at: string
}

export type ExecutionResult = {
  executedAt: string
  action: ActionType
  simulated: boolean
  detail: string
}

/**
 * A message the customer sent after the ticket was opened — a reply, a
 * correction, extra context.
 *
 * Untrusted on exactly the same terms as `body`, and stored separately from it
 * rather than appended to it: the original text is what the analysis and every
 * evidence quote were drawn from, and rewriting it would make the record of the
 * first decision disagree with the decision itself.
 */
export type FollowUp = {
  at: string
  message: string
}

/**
 * The reconsideration verdict on the newest follow-up: does it contradict what a
 * human already authorized?
 *
 * Recorded rather than re-derived, for the same reason `safeToSend` is: it is the
 * finding that sent the ticket back to the gate, the risk band rests on it, and
 * the audit trail names it. Kept on the row after the ticket is decided again —
 * it is a fact about what happened, not a flag to be tidied away.
 */
export type Conflict = ConflictFields &
  Provenance & {
    /** Which follow-up was judged. Indexes into `follow_ups`. */
    followUpIndex: number
    /** When the finding was made, which is not when the follow-up arrived. */
    at: string
  }

export type Ticket = {
  id: string
  created_at: string
  updated_at: string
  subject: string
  body: string
  customer_name: string
  customer_tier: CustomerTier
  order_value_cents: number
  status: Status
  analysis: Analysis | null
  draft: Draft | null
  verification: Verification | null
  risk: Risk | null
  execution_result: ExecutionResult | null
  /** Set when an AI stage failed. The ticket did not move; this says why. */
  pipeline_error: PipelineError | null
  /** Customer messages that arrived after the ticket was opened, oldest first. */
  follow_ups: FollowUp[]
  /** The reconsideration verdict on the newest follow-up, once one has been judged. */
  conflict: Conflict | null
}

export type TicketEvent = {
  id: number
  ticket_id: string
  created_at: string
  actor: Actor
  from_status: Status | null
  to_status: Status
  reason: string | null
  source: AiSource | null
  model: string | null
}

/**
 * An operational or policy rule from our own reference data, retrieved by exact
 * match on the keys below (lib/evidence.ts). Null on a key means the rule is not
 * scoped on that axis, so it does not narrow the match.
 *
 * `source_ref` is what makes it citable: a rule an operator cannot go and read is
 * an assertion, not evidence.
 */
export type Policy = {
  id: string
  title: string
  body: string
  source_ref: string
  category: Category | null
  action_type: ActionType | null
}

/**
 * A settled earlier ticket retrieved as prior context, and the stated reason it
 * was retrieved. The reason travels with it deliberately — evidence whose basis
 * is not shown is just an adjacent claim.
 */
export type PriorTicket = {
  id: string
  created_at: string
  subject: string
  customer_name: string
  status: Status
  risk: Risk | null
  category: Category | null
  /** The action actually carried out, where one was. Null on a rejected ticket. */
  outcome: ActionType | null
  relation: "Same customer" | "Same category"
}

/**
 * The happy path through the workflow, in order, for rendering progress.
 * Presentation only — it is not the transition rule. `canTransition` is the
 * authority on legal moves and lands with the server actions that write them.
 */
export const STATUS_FLOW = [
  "RECEIVED",
  "ANALYZING",
  "DRAFTED",
  "VERIFIED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTED",
] as const satisfies readonly Status[]

/** Statuses that no longer move. */
export const TERMINAL: readonly Status[] = ["EXECUTED", "REJECTED"]

/**
 * Evidence quotes are only trustworthy if they actually appear in the ticket
 * (AC-5). An unmatched quote is dropped rather than displayed, so the model
 * cannot invent a citation into the UI.
 */
export function verifiedEvidence(quotes: string[], body: string): string[] {
  return quotes.filter((q) => body.includes(q))
}

/**
 * Everything the customer has written on this ticket: the original message and
 * every follow-up, in order.
 *
 * One definition, used by both the AI stages (as the untrusted text they read)
 * and the detail view (as what evidence quotes are matched against). They have to
 * agree: a re-analysis prompted with a follow-up will quote it, and if the screen
 * matched quotes against `body` alone those quotes would silently disappear —
 * which is the same class of defect `verifiedEvidence` exists to prevent, just
 * pointing the other way.
 *
 * Follow-ups are untrusted on exactly the same terms as `body`, which is why they
 * are concatenated into it rather than passed as `context`: `context` is trusted
 * operational fact and widens what a reply may assert as true, so a customer
 * writing "refund me 9999.00 USD" into trusted context would ground a draft that
 * offered it.
 */
export function ticketText(body: string, followUps: FollowUp[]): string {
  if (followUps.length === 0) return body
  return [
    body,
    ...followUps.map((f) => `\n[Customer follow-up]\n${f.message}`),
  ].join("\n")
}
