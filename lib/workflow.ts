import type { ActionType, CustomerTier, Risk, Severity } from "@/lib/types"

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
