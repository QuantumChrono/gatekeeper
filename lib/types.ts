// Domain types, derived from the DB shape in supabase/migrations/001_initial_schema.sql.
// One home for these (CLAUDE.md §3) — never redeclare Status in a component.
// Field names stay snake_case because that is what postgrest returns.

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

export type Analysis = {
  category: Category
  severity: Severity
  evidence: string[]
  routing: string
  confidence: number
  reasoning: string
  source: AiSource
  model?: string
}

export type Draft = {
  response: string
  action: { type: ActionType; params: Record<string, unknown> }
  rationale: string
  source: AiSource
  model?: string
}

export type Verification = {
  issues: string[]
  confidence: number
  safeToSend: boolean
  notes: string
  source: AiSource
  model?: string
}

export type ExecutionResult = {
  executedAt: string
  action: ActionType
  simulated: boolean
  detail: string
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
