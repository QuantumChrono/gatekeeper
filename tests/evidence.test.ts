import { describe, expect, it } from "vitest"

import { applicablePolicies, relatedTickets } from "../lib/evidence"
import type { Candidate } from "../lib/evidence"
import type { Policy } from "../lib/types"

// Retrieval decides what evidence an operator sees behind a recommendation, so
// the matching rules are worth pinning: a rule that silently stops matching, or a
// prior ticket that leaks in undecided, changes what a human is shown at the gate.

function policy(
  id: string,
  category: Policy["category"],
  action_type: Policy["action_type"]
): Policy {
  return {
    id,
    title: id,
    body: "body",
    source_ref: "handbook, section 1",
    category,
    action_type,
  }
}

const POLICIES = [
  policy("general", null, null),
  policy("refund-any-category", null, "REFUND"),
  policy("billing-any-action", "BILLING", null),
  policy("refund-and-refund", "REFUND", "REFUND"),
  policy("access-escalation", "ACCOUNT_ACCESS", "ESCALATE_T2"),
]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe("applicablePolicies", () => {
  it("treats a null key as unscoped rather than as a wildcard match", () => {
    // The general rule always applies; a rule scoped to one axis applies whenever
    // that axis matches, whatever the other axis holds.
    // Order follows the input, which is the caller's stable ordering.
    expect(
      ids(applicablePolicies(POLICIES, { category: "BILLING", actionType: "REPLY" }))
    ).toEqual(["general", "billing-any-action"])
  })

  it("requires both keys to match when a rule is keyed on both", () => {
    expect(
      ids(applicablePolicies(POLICIES, { category: "REFUND", actionType: "REFUND" }))
    ).toEqual(["general", "refund-any-category", "refund-and-refund"])

    // Same category, different action: the doubly-keyed rule drops out, the
    // category-only rule would stay if there were one for REFUND.
    expect(
      ids(applicablePolicies(POLICIES, { category: "REFUND", actionType: "REPLY" }))
    ).toEqual(["general"])
  })

  it("returns only the generally applicable rules before analysis has run", () => {
    // No category and no proposed action yet. Every keyed rule is unmatched, and
    // the honest answer is the general guidance rather than everything or nothing.
    expect(ids(applicablePolicies(POLICIES, {}))).toEqual(["general"])
  })
})

function candidate(over: Partial<Candidate> & { id: string }): Candidate {
  return {
    created_at: "2026-01-01T00:00:00.000Z",
    subject: `subject ${over.id}`,
    customer_name: "Someone Else",
    status: "EXECUTED",
    risk: "LOW",
    analysis: null,
    execution_result: { action: "REPLY" },
    ...over,
  }
}

const SUBJECT = {
  id: "self",
  created_at: "2026-06-01T00:00:00.000Z",
  customer_name: "Tomas Lindqvist",
  category: "REFUND" as const,
}

describe("relatedTickets", () => {
  it("matches on the customer or the category and reports which", () => {
    const result = relatedTickets(
      [
        candidate({ id: "same-customer", customer_name: "Tomas Lindqvist" }),
        candidate({ id: "same-category", analysis: { category: "REFUND" } }),
        candidate({ id: "unrelated", analysis: { category: "BUG" } }),
      ],
      SUBJECT
    )

    expect(result.map((r) => [r.id, r.relation])).toEqual([
      ["same-customer", "Same customer"],
      ["same-category", "Same category"],
    ])
  })

  it("reports a customer-and-category match as the stronger of the two", () => {
    const result = relatedTickets(
      [
        candidate({
          id: "both",
          customer_name: "Tomas Lindqvist",
          analysis: { category: "REFUND" },
        }),
      ],
      SUBJECT
    )

    expect(result[0].relation).toBe("Same customer")
  })

  it("excludes the ticket itself, and anything that is not already settled", () => {
    const result = relatedTickets(
      [
        candidate({ id: "self", customer_name: "Tomas Lindqvist" }),
        // At the gate: an undecided recommendation, which is not precedent.
        candidate({
          id: "at-gate",
          customer_name: "Tomas Lindqvist",
          status: "AWAITING_APPROVAL",
        }),
        candidate({
          id: "mid-pipeline",
          customer_name: "Tomas Lindqvist",
          status: "DRAFTED",
        }),
        candidate({
          id: "rejected",
          customer_name: "Tomas Lindqvist",
          status: "REJECTED",
          execution_result: null,
        }),
      ],
      SUBJECT
    )

    // A rejected ticket is settled and is evidence: someone declined this before.
    // It carries no outcome, because nothing was carried out.
    expect(ids(result)).toEqual(["rejected"])
    expect(result[0].outcome).toBeNull()
  })

  it("excludes a ticket that did not precede this one", () => {
    // "Previous" is a claim about chronology. A ticket stamped later than the one
    // citing it is not history, however well it matches.
    const result = relatedTickets(
      [
        candidate({
          id: "later",
          customer_name: "Tomas Lindqvist",
          created_at: "2026-07-01T00:00:00.000Z",
        }),
        candidate({
          id: "earlier",
          customer_name: "Tomas Lindqvist",
          created_at: "2026-05-01T00:00:00.000Z",
        }),
      ],
      SUBJECT
    )

    expect(ids(result)).toEqual(["earlier"])
  })

  it("ranks the customer's own history above a category match, then by recency", () => {
    const result = relatedTickets(
      [
        candidate({
          id: "category-older",
          created_at: "2026-02-01T00:00:00.000Z",
          analysis: { category: "REFUND" },
        }),
        candidate({
          id: "customer-older",
          created_at: "2026-03-01T00:00:00.000Z",
          customer_name: "Tomas Lindqvist",
        }),
        candidate({
          id: "category-newer",
          created_at: "2026-05-01T00:00:00.000Z",
          analysis: { category: "REFUND" },
        }),
        candidate({
          id: "customer-newer",
          created_at: "2026-04-01T00:00:00.000Z",
          customer_name: "Tomas Lindqvist",
        }),
      ],
      SUBJECT
    )

    // Customer before category, and newest first inside each group — a newer
    // category match does not outrank an older ticket from this same customer.
    expect(ids(result)).toEqual([
      "customer-newer",
      "customer-older",
      "category-newer",
    ])
  })

  it("caps the list, keeping the most relevant", () => {
    const result = relatedTickets(
      [
        candidate({ id: "a", created_at: "2026-01-01T00:00:00.000Z", customer_name: "Tomas Lindqvist" }),
        candidate({ id: "b", created_at: "2026-02-01T00:00:00.000Z", customer_name: "Tomas Lindqvist" }),
        candidate({ id: "c", created_at: "2026-03-01T00:00:00.000Z", customer_name: "Tomas Lindqvist" }),
      ],
      SUBJECT,
      2
    )

    expect(ids(result)).toEqual(["c", "b"])
  })

  it("matches nothing on category when the ticket has not been analyzed", () => {
    // No category to match on. An unanalyzed candidate has none either, and two
    // absent categories are not a match.
    const result = relatedTickets(
      [candidate({ id: "unanalyzed", analysis: null })],
      { ...SUBJECT, category: undefined }
    )

    expect(result).toEqual([])
  })
})
