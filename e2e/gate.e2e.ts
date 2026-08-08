import { expect, test } from "@playwright/test"

// The two flows that carry the product's premise: a human approval reaches
// EXECUTED and leaves a record, and a rejection does not reach EXECUTED at all.
//
// Both drive a seeded ticket that already sits at the gate with its analysis and
// verification on the row. Running the AI stages first would add three provider
// attempts and their timeouts to every run without testing anything the gate
// needs — the stages have their own unit specs.
//
// Selectors are roles, accessible names and the app's own sentences. Nothing here
// matches a class or a position, so restyling the gate does not break the suite.

/** The two seeded tickets at AWAITING_APPROVAL (001_initial_schema.sql). */
const APPROVE_TICKET = {
  id: "22222222-2222-4222-8222-222222222222",
  subject: "All /v2/events calls returning 500 since this morning",
}
const REJECT_TICKET = {
  id: "44444444-4444-4444-8444-444444444444",
  subject: "Refund the annual renewal, we cancelled before the date",
}

/**
 * Put the queue back to its seeded start state.
 *
 * Both flows spend their ticket: an approved ticket is EXECUTED for good, and the
 * audit trail is append-only by design, so there is nothing to undo. `reset_demo()`
 * ships in the schema for exactly this, and calling it over the REST endpoint
 * keeps the reset to one request rather than a database fixture.
 */
async function resetDemo() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "These specs drive a real seeded database. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local, and apply supabase/migrations/001_initial_schema.sql."
    )
  }

  const response = await fetch(`${url}/rest/v1/rpc/reset_demo`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  })
  if (!response.ok) {
    throw new Error(
      `The demo could not be reset (HTTP ${response.status}), so the queue is not at a known start state. Confirm the schema has been applied.`
    )
  }
}

test.beforeEach(resetDemo)

test("a human approval carries the action out and is recorded", async ({
  page,
}) => {
  await page.goto("/")

  // Open the ticket from the queue, the way an operator reaches it.
  await page.getByRole("link", { name: APPROVE_TICKET.subject }).click()
  await expect(
    page.getByRole("heading", { name: APPROVE_TICKET.subject, level: 1 })
  ).toBeVisible()

  // The decision is prepared: what is proposed, and the verifier's own verdict on
  // it. An approval asked for without either is the thing the product exists to
  // prevent.
  const proposed = page.getByRole("region", { name: /Proposed action/ })
  await expect(proposed).toContainText("ESCALATE_ENG")

  // This ticket's verifier passed the draft. Asserted as the exact verdict rather
  // than a loose match, because "Safe to send" is a substring of "Not safe to
  // send" and the two verdicts must not be able to satisfy the same assertion.
  const verification = page.getByRole("region", { name: /Verification/ })
  await expect(verification.getByText("Safe to send", { exact: true })).toBeVisible()

  // At the gate, and nothing has been carried out.
  const gate = page.getByRole("region", { name: /Approval gate/ })
  await expect(gate).toContainText("Nothing has happened yet")
  await expect(
    page.getByRole("region", { name: /Execution result/ })
  ).toHaveCount(0)

  const audit = page.getByRole("region", { name: /Audit trail/ })
  const eventsBefore = await audit.getByRole("listitem").count()

  // This ticket is HIGH risk, so approval goes through the confirmation step that
  // restates what will happen. An exact name, so it cannot also match the
  // dialog's own "Approve and carry out".
  await gate.getByRole("button", { name: "Approve" }).click()
  const confirm = page.getByRole("dialog")
  await expect(confirm).toContainText(/Escalate|engineering/i)
  await confirm.getByRole("button", { name: /Approve and carry out/ }).click()

  // Executed. Asserted on the state the page settles into, not on the action's
  // own success message: that message lives inside the gate's controls, and a
  // successful write re-renders the gate as closed and unmounts it.
  await expect(gate).toContainText("Approved by a human and carried out")
  await expect(
    page.getByRole("region", { name: /Execution result/ })
  ).toContainText(/Simulated/i)

  // The trail gained the approval and the execution, attributed to a human.
  await expect(audit.getByRole("listitem")).toHaveCount(eventsBefore + 2)
  await expect(audit).toContainText("Approved")
  await expect(audit).toContainText("Executed")
  // Attributed to a human, which is what EXECUTED is required to rest on.
  await expect(audit.getByText(/Actor: Human/).first()).toBeVisible()

  // And it survives a reload, so the state is the database's and not the form's.
  await page.reload()
  await expect(
    page.getByRole("region", { name: /Execution result/ })
  ).toBeVisible()
})

test("a rejection does not reach executed", async ({ page }) => {
  await page.goto(`/tickets/${REJECT_TICKET.id}`)

  const gate = page.getByRole("region", { name: /Approval gate/ })
  await expect(gate).toContainText("Nothing has happened yet")

  await gate.getByRole("button", { name: "Reject" }).click()

  // Settled state again, for the same reason as above: the write re-renders the
  // gate as closed, which takes the action's own message with it.
  await expect(gate).toContainText("a rejected ticket cannot move again")

  // The point of the test: nothing was carried out, and there is no way to carry
  // it out now. No execution record, and the gate offers no approval control.
  await expect(
    page.getByRole("region", { name: /Execution result/ })
  ).toHaveCount(0)
  await expect(gate.getByRole("button", { name: /Approve/ })).toHaveCount(0)

  const audit = page.getByRole("region", { name: /Audit trail/ })
  await expect(audit).toContainText("Rejected")
  await expect(audit).not.toContainText("Executed")

  // Rejected is terminal in the database, not just in the rendered page.
  await page.reload()
  await expect(gate).toContainText("a rejected ticket cannot move again")
  await expect(
    page.getByRole("region", { name: /Execution result/ })
  ).toHaveCount(0)
})
