import type {
  ActionType,
  Analysis,
  Category,
  ExecutionResult,
  Policy,
  PriorTicket,
  Ticket,
} from "@/lib/types"

// Which prior tickets and which policy rules bear on this decision.
//
// Retrieval is exact-match and ordered by a fixed rule, so the same ticket
// retrieves the same evidence on every render. No embeddings, no vector store, no
// ranking model, no search box — the keys are the vocabularies the schema already
// validates, and equality is the whole of the matching.
//
// Pure, and separate from lib/db.ts, because the rules are the part worth testing
// and testing them should not need a database standing behind it.

/**
 * A rule applies when every key it is keyed on matches. A null key is not a
 * wildcard the model chose — it means the rule is not scoped on that axis, so it
 * does not narrow the match.
 *
 * A ticket with no analysis has no category and no proposed action, so only the
 * generally applicable rules come back. That is the honest answer at that stage
 * rather than an empty panel.
 */
export function applicablePolicies(
  policies: Policy[],
  keys: { category?: Category; actionType?: ActionType }
): Policy[] {
  return policies.filter((policy) => {
    if (policy.category !== null && policy.category !== keys.category) {
      return false
    }
    if (policy.action_type !== null && policy.action_type !== keys.actionType) {
      return false
    }
    return true
  })
}

/**
 * Exactly the fields retrieval reads from a candidate, derived from `Ticket`
 * rather than redeclared (CLAUDE.md §3). A full `Ticket` satisfies it, so callers
 * pass what they already hold; naming the subset states the real dependency and
 * keeps it visible that retrieval never reads the ticket body.
 */
export type Candidate = Pick<
  Ticket,
  "id" | "created_at" | "subject" | "customer_name" | "status" | "risk"
> & {
  /** Only the category is consulted, never the ticket body or the reasoning. */
  analysis: Pick<Analysis, "category"> | null
  /** Only what was carried out. A rejected ticket has none. */
  execution_result: Pick<ExecutionResult, "action"> | null
}

/**
 * Prior tickets worth reading before deciding this one, most relevant first.
 *
 * Relevance is not scored, it is ordered by a stated rule: this customer's own
 * history outranks a category match, and within each, the most recent outranks
 * the older. Same-customer-and-same-category is reported as the customer match,
 * which is the stronger of the two.
 *
 * Only settled tickets are returned. A ticket still moving through the workflow
 * is not yet evidence of anything, and one awaiting approval would put an
 * undecided recommendation on screen as though it were precedent.
 */
export function relatedTickets(
  candidates: Candidate[],
  subject: Pick<Ticket, "id" | "created_at" | "customer_name"> & {
    category?: Category
  },
  limit = 3
): PriorTicket[] {
  const related: PriorTicket[] = []

  for (const candidate of candidates) {
    if (candidate.id === subject.id) continue
    // Only what was already closed when this ticket arrived. A "previous ticket"
    // that postdates the one citing it is not history.
    if (candidate.created_at >= subject.created_at) continue
    if (candidate.status !== "EXECUTED" && candidate.status !== "REJECTED") {
      continue
    }

    const sameCustomer = candidate.customer_name === subject.customer_name
    const sameCategory =
      subject.category !== undefined &&
      candidate.analysis?.category === subject.category
    if (!sameCustomer && !sameCategory) continue

    related.push({
      id: candidate.id,
      created_at: candidate.created_at,
      subject: candidate.subject,
      customer_name: candidate.customer_name,
      status: candidate.status,
      risk: candidate.risk,
      category: candidate.analysis?.category ?? null,
      outcome: candidate.execution_result?.action ?? null,
      relation: sameCustomer ? "Same customer" : "Same category",
    })
  }

  return related
    .sort((a, b) => {
      if (a.relation !== b.relation) {
        return a.relation === "Same customer" ? -1 : 1
      }
      // Descending by arrival: ISO-8601 from postgrest, so lexicographic order is
      // chronological order and no Date needs constructing to compare two.
      return a.created_at < b.created_at ? 1 : -1
    })
    .slice(0, limit)
}
