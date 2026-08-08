import type {
  ActionType,
  Actor,
  AiSource,
  Analysis,
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
 * no entry (`EXECUTED`, `REJECTED`) is terminal by construction rather than by a
 * separate check that could fall out of step with this table.
 *
 * `EXECUTED` appears exactly once, as the sole target of `APPROVED`. That is the
 * whole premise of the product (CLAUDE.md §2): an action is carried out only
 * after a human authorized it.
 */
const TRANSITIONS: Record<Status, readonly Status[]> = {
  RECEIVED: ["ANALYZING"],
  ANALYZING: ["DRAFTED"],
  DRAFTED: ["VERIFIED"],
  VERIFIED: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["EXECUTED"],
  REJECTED: [],
  EXECUTED: [],
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
}

export function computeRisk({
  severity,
  actionType,
  customerTier,
  safeToSend,
}: RiskInput): Risk {
  const score =
    SEVERITY_POINTS[severity] +
    ACTION_POINTS[actionType] +
    (safeToSend ? 0 : 1) +
    (customerTier === "enterprise" ? 1 : 0)

  if (score >= 4) return "HIGH"
  if (score >= 2) return "MEDIUM"
  return "LOW"
}
