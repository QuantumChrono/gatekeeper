import type {
  ActionType,
  Actor,
  AiSource,
  Analysis,
  Conflict,
  CustomerTier,
  Draft,
  ExecutionResult,
  PipelineError,
  Result,
  Risk,
  Severity,
  Status,
  Verification,
} from "@/lib/types"

// The state machine, and the only guard that writes it.
//
// `canTransition` is the single source of truth for what may move where. Nothing
// else in the app decides legality: no component, no route, no SQL function. The
// database enforces atomicity and the compare-and-set; this file enforces the
// rule.

/**
 * Every legal edge, and nothing else. Absence is a rejection, so a status with
 * no entry (`REJECTED`) is terminal by construction rather than by a separate
 * check that could fall out of step with this table.
 *
 * `EXECUTED` appears exactly once as a *target*, and only from `APPROVED`. That
 * is the whole premise of the product (CLAUDE.md §2): an action is carried out
 * only after a human authorized it. Adding the reopen edges below does not touch
 * that — it adds ways *out* of a settled decision, never a new way into one.
 *
 * The two reopen edges are the cycle. A decision is settled against the facts as
 * they stood; new facts can arrive afterwards, and a system that could only move
 * forwards would have to either ignore them or re-execute on a premise that no
 * longer holds. Both are worse than sending the decision back to a human, so
 * `APPROVED` and `EXECUTED` lead back to `ANALYZING` (re-run the stages against
 * the new message) and to `AWAITING_APPROVAL` (return straight to the gate when
 * the stages cannot run). `REJECTED` stays terminal: nothing was authorized, so
 * there is no decision to reconsider — a customer with more to say on a rejected
 * ticket is opening a new one.
 */
const TRANSITIONS: Record<Status, readonly Status[]> = {
  RECEIVED: ["ANALYZING"],
  ANALYZING: ["DRAFTED"],
  DRAFTED: ["VERIFIED"],
  VERIFIED: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["EXECUTED", "ANALYZING", "AWAITING_APPROVAL"],
  REJECTED: [],
  EXECUTED: ["ANALYZING", "AWAITING_APPROVAL"],
}

/**
 * May a ticket move from `from` to `to`?
 *
 * Pure and total: every pair of statuses has an answer, and the answer does not
 * depend on a database, a request, or who is asking. Self-transitions are false —
 * staying put is not a move, and the failure path deliberately does not come
 * through here (see `recordFailure` on the store).
 */
export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to)
}

/**
 * Is this edge a settled decision being reopened?
 *
 * Named rather than inlined because three places need the same answer and must
 * not drift: the transition guard (which requires a reason for one), the audit
 * reason it writes, and `apply_transition` in the schema, which refuses a reopen
 * on a ticket carrying no follow-up. A reopen is the one move whose justification
 * lives outside the ticket's own workflow, so it is the one move that has to
 * prove it has one.
 */
export function isReopen(from: Status, to: Status): boolean {
  return (from === "APPROVED" || from === "EXECUTED") && to !== "EXECUTED"
}

/**
 * The two writes a guarded transition needs, as a port rather than a client.
 *
 * Taken as a seam for the same reason `runStage` takes `generate`: the guard
 * below is the security boundary of the product, and it has to be testable
 * without a live database standing behind it. `lib/db.ts` holds the one
 * implementation that talks to Supabase with the service-role key.
 */
export type TransitionStore = {
  /** Current status straight from the database. Null if no such ticket. */
  readStatus(ticketId: string): Promise<Result<Status | null>>
  /**
   * Compare-and-set: move `ticketId` from `expect` to `to`, apply `patch`, and
   * append the audit event — atomically, or not at all.
   *
   * `applied: false` means the row was not at `expect` when the write landed, so
   * nothing changed. It is not an error; it is a lost race, and the caller
   * re-reads to say what actually happened.
   */
  apply(args: {
    ticketId: string
    expect: Status
    to: Status
    actor: Actor
    reason: string
    source?: AiSource
    model?: string
    patch?: TransitionPatch
  }): Promise<Result<{ applied: boolean }>>
  /**
   * Record that a stage failed, without moving the ticket.
   *
   * Not a transition, and deliberately not routed through `transition()`: it
   * writes the `pipeline_error` column and appends one event whose from-status
   * and to-status are both the ticket's current status. `canTransition` returns
   * false for every self-edge, so the failure path has no way to advance a
   * ticket even if it is called wrongly — the ticket is preserved by
   * construction rather than by remembering not to move it (CLAUDE.md §1).
   */
  recordFailure(args: {
    ticketId: string
    error: PipelineError
  }): Promise<Result<void>>
}

/**
 * Columns a transition may carry with it. The artifact and the move it justifies
 * land together or not at all — a `VERIFIED` status with no verification on the
 * row would be a state the UI cannot explain.
 */
export type TransitionPatch = {
  analysis?: Analysis
  draft?: Draft
  verification?: Verification
  risk?: Risk
  execution_result?: ExecutionResult
  /**
   * The conflict verdict that justifies a reopen. Lands with the transition for
   * the same reason every other artifact does: a ticket back at the gate with no
   * recorded reason for being there is a state the UI cannot explain.
   */
  conflict?: Conflict
}

/**
 * The one way a ticket's status changes.
 *
 * Order matters and is the security requirement: re-read the current status from
 * the database, check the move against `canTransition`, then write conditionally
 * on that same status. The client's opinion about where the ticket is never
 * reaches the decision — it supplies only an id and a destination, and both are
 * checked against server state (CLAUDE.md §7).
 *
 * The read gives an operator a truthful message; the conditional write is what
 * makes it safe under a double-click or two tabs. A ticket already at `to` is
 * reported as success, so approving twice authorizes once and executing twice
 * executes once.
 */
export async function transition(
  store: TransitionStore,
  args: {
    ticketId: string
    to: Status
    actor: Actor
    reason: string
    source?: AiSource
    model?: string
    patch?: TransitionPatch
  }
): Promise<Result<{ status: Status; changed: boolean }>> {
  const { ticketId, to, ...rest } = args

  const current = await store.readStatus(ticketId)
  if (!current.ok) return current
  if (current.data === null) {
    return { ok: false, message: "No ticket exists with this id." }
  }

  const from = current.data
  if (from === to) {
    // Already there. The work this call would do has been done, so saying so is
    // more truthful than reporting an illegal transition.
    return { ok: true, data: { status: to, changed: false } }
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      message: `A ticket at ${from} cannot move to ${to}. The database was re-read before this check, so this is the ticket's current state, not a stale view.`,
    }
  }

  // Reopening a settled decision needs grounds on the record. Every other edge is
  // justified by the ticket's own position in the workflow — DRAFTED follows
  // ANALYZING because that is what the workflow is — but a reopen is driven by
  // something from outside it, so the thing that drove it travels with the move or
  // the move does not happen. Without this, an unexplained AWAITING_APPROVAL would
  // be reachable from EXECUTED by anyone who can POST, and the trail would record
  // a bounce with no stated cause.
  if (isReopen(from, to) && !rest.patch?.conflict) {
    return {
      ok: false,
      message: `Reopening a ticket at ${from} requires the conflict finding that justifies it, and none was supplied, so nothing was changed.`,
    }
  }

  const written = await store.apply({ ticketId, expect: from, to, ...rest })
  if (!written.ok) return written

  if (!written.data.applied) {
    // The row moved between the read and the write. Report where it actually is
    // rather than claiming a transition that did not happen.
    const now = await store.readStatus(ticketId)
    const where =
      now.ok && now.data ? `It is now at ${now.data}.` : "Its state is unclear."
    return {
      ok: false,
      message: `This ticket was no longer at ${from} when the change was written, so nothing was changed. ${where}`,
    }
  }

  return { ok: true, data: { status: to, changed: true } }
}

// Deterministic where determinism is cheaper (CLAUDE.md §2). Risk is derived in
// code from facts we already hold, so it is testable and never invented by a
// model. Confidence comes from the model; risk does not.
//
// The table is the one documented in docs/ARCHITECTURE.md §4, and the seeded
// tickets in supabase/migrations/001_initial_schema.sql were scored by hand with
// it — the test asserts this function reproduces those three values.

const SEVERITY_POINTS: Record<Severity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
}

const ACTION_POINTS: Record<ActionType, number> = {
  REPLY: 0,
  ESCALATE_T2: 0,
  ESCALATE_ENG: 0,
  CLOSE: 1,
  REFUND: 2,
}

export type RiskInput = {
  severity: Severity
  actionType: ActionType
  customerTier: CustomerTier
  /**
   * The verifier's verdict. Before verification has run there is no objection
   * on record, so callers pass `true` — it contributes nothing to the score,
   * which keeps a pre-verification risk from being inflated by a check that has
   * not happened yet.
   */
  safeToSend: boolean
  /**
   * A customer message contradicts a decision a human already authorized.
   * Optional and false by default, so a ticket that has never been reopened is
   * scored by exactly the table below and nothing else.
   */
  conflict?: boolean
}

export function computeRisk({
  severity,
  actionType,
  customerTier,
  safeToSend,
  conflict = false,
}: RiskInput): Risk {
  // An override rather than a point, and the only one in this function. The
  // score measures how much scrutiny a *fresh* decision needs; a contradicted
  // authorization is a different thing — something was already authorized on a
  // premise that no longer holds, and possibly already carried out. There is no
  // combination of severity, action and tier that should let that reach an
  // operator as routine, so it does not compete on points.
  if (conflict) return "HIGH"

  const score =
    SEVERITY_POINTS[severity] +
    ACTION_POINTS[actionType] +
    (safeToSend ? 0 : 1) +
    (customerTier === "enterprise" ? 1 : 0)

  if (score >= 4) return "HIGH"
  if (score >= 2) return "MEDIUM"
  return "LOW"
}
