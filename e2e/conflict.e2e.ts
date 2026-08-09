import { expect, test } from "@playwright/test"

// The cycle: new information arriving after a decision was carried out.
//
// The premise of the linear pipeline is that nothing happens without a human. The
// premise of this path is the other half of it — that a decision made on facts
// which have since changed does not get to stand just because it was already
// authorized. So the property under test is that a contradicting customer message
// lands the ticket back in human review, with the reason on the append-only trail,
// and that getting back to EXECUTED still costs a fresh human approval.
//
// Driven through the real UI against the real seeded database, like gate.e2e.ts.
// The conflict stage always has a usable tier (it derives a deterministic finding
// from the message text when no provider answers), and the seeded ticket carries
// its own analysis, draft and verification, so this runs with the provider up or
// down. The message below is written to be caught either way: a model reads it as a
// withdrawal, and the keyword tier matches on "cancel".

/** Seeded at EXECUTED by 001_initial_schema.sql — a decision already carried out. */
const EXECUTED_TICKET = {
  id: "11111111-1111-4111-8111-111111111111",
  subject: "Charged twice for the March invoice",
}

const CONTRADICTION =
  "Please cancel this request. We checked with our bank and only one charge was ever taken, so there is nothing to look into and no adjustment is needed."

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function requireEnv() {
  if (!URL || !KEY) {
    throw new Error(
      "This spec drives a real seeded database. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local, and apply supabase/migrations/001_initial_schema.sql."
    )
  }
}

async function resetDemo() {
  requireEnv()
  const response = await fetch(`${URL}/rest/v1/rpc/reset_demo`, {
    method: "POST",
    headers: {
      apikey: KEY!,
      Authorization: `Bearer ${KEY!}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `The demo could not be reset (HTTP ${response.status}: ${text}), so the queue is not at a known start state.`
    )
  }
}

/** The row as the database holds it, so the assertions do not rest on the rendering. */
async function readTicket(id: string) {
  const response = await fetch(
    `${URL}/rest/v1/tickets?select=status,risk,conflict,follow_ups,execution_result&id=eq.${id}`,
    { headers: { apikey: KEY!, Authorization: `Bearer ${KEY!}` } }
  )
  const rows = await response.json()
  return rows[0]
}

async function readEvents(id: string) {
  const response = await fetch(
    `${URL}/rest/v1/ticket_events?select=actor,from_status,to_status,reason&ticket_id=eq.${id}&order=id.asc`,
    { headers: { apikey: KEY!, Authorization: `Bearer ${KEY!}` } }
  )
  return (await response.json()) as {
    actor: string
    from_status: string | null
    to_status: string
    reason: string | null
  }[]
}

test.beforeEach(resetDemo)

test("a contradicting reply to an executed ticket returns it to human review", async ({
  page,
}) => {
  // The reopen re-drafts and re-verifies, so this waits on the conflict stage plus
  // three more. Each falls to the seeded tier if the provider does not answer.
  test.setTimeout(180_000)

  const before = await readTicket(EXECUTED_TICKET.id)
  expect(before.status).toBe("EXECUTED")

  await page.goto(`/tickets/${EXECUTED_TICKET.id}`)

  // The starting state: carried out, and the gate offers no decision to make.
  const gate = page.getByRole("region", { name: /Approval gate/ })
  await expect(gate).toContainText("Approved by a human and carried out")
  await expect(
    page.getByRole("region", { name: /Context conflict/ })
  ).toHaveCount(0)

  const eventsBefore = (await readEvents(EXECUTED_TICKET.id)).length

  // The customer replies, contradicting what was already done.
  const simulate = page.getByRole("region", { name: /Simulate a customer reply/ })
  await simulate.getByLabel("Message from the customer").fill(CONTRADICTION)
  await simulate.getByRole("button", { name: "Send as customer" }).click()

  // Back in human review, flagged, with the conflict explained rather than merely
  // asserted.
  const banner = page.getByRole("region", { name: /Context conflict/ })
  await expect(banner).toBeVisible({ timeout: 120_000 })
  await expect(banner).toContainText("re-routed for human review", {
    ignoreCase: true,
  })
  await expect(banner).toContainText("Please cancel this request")
  // The finding names what changed. An unexplained reversal is the failure mode.
  await expect(banner.getByRole("listitem").first()).toBeVisible()

  // The gate is open again and asking for a decision.
  await expect(gate).toContainText("Nothing has happened yet")
  await expect(gate.getByRole("button", { name: "Approve" })).toBeVisible()

  // The database agrees, which is what makes this a state change and not a render.
  const after = await readTicket(EXECUTED_TICKET.id)
  expect(after.status).toBe("AWAITING_APPROVAL")
  expect(after.conflict?.detected).toBe(true)
  expect(after.follow_ups).toHaveLength(1)
  // A reopened decision is HIGH regardless of what it scored before — this ticket
  // was LOW when it executed.
  expect(after.risk).toBe("HIGH")
  // The action really was carried out, and the record of it survives the reopen.
  // Nulling it to tidy the state would erase the only thing that actually happened.
  expect(after.execution_result).not.toBeNull()

  // The trail gained the arrival of the message and the reversal it caused, and
  // says plainly why the ticket moved backwards.
  const events = await readEvents(EXECUTED_TICKET.id)
  expect(events.length).toBeGreaterThan(eventsBefore)

  const arrival = events.find((e) => e.reason?.includes("Customer follow-up received"))
  expect(arrival).toBeTruthy()
  // A message arriving moves nothing by itself.
  expect(arrival?.from_status).toBe("EXECUTED")
  expect(arrival?.to_status).toBe("EXECUTED")

  const reopen = events.find((e) => e.reason?.includes("CONFLICT DETECTED"))
  expect(reopen).toBeTruthy()
  expect(reopen?.from_status).toBe("EXECUTED")
  expect(reopen?.reason).toContain("Re-routed to human review")
  // Attributed to the system that found it, not to a human who decided nothing.
  expect(reopen?.actor).toBe("ai")

  // The earlier approval and execution are still on the trail. It is append-only,
  // so reopening adds to the record rather than rewriting it.
  expect(events.some((e) => e.to_status === "APPROVED" && e.actor === "human")).toBe(true)
  expect(events.some((e) => e.to_status === "EXECUTED")).toBe(true)

  // And the reopened state is the database's, not the form's.
  await page.reload()
  await expect(page.getByRole("region", { name: /Context conflict/ })).toBeVisible()
})

test("an ordinary reply leaves the carried-out decision standing", async ({
  page,
}) => {
  // The other half of the contract. A detector that cannot leave a decision alone
  // would send every ticket with any follow-up back to the gate, which trains an
  // operator to ignore the flag — so "no conflict" has to be a reachable answer.
  test.setTimeout(120_000)

  await page.goto(`/tickets/${EXECUTED_TICKET.id}`)

  const simulate = page.getByRole("region", { name: /Simulate a customer reply/ })
  await simulate
    .getByLabel("Message from the customer")
    .fill(
      "Thank you for looking into this so quickly, that explanation makes sense to our finance team."
    )
  await simulate.getByRole("button", { name: "Send as customer" }).click()

  // The message is recorded either way — losing a customer's words would be worse
  // than not acting on them.
  await expect(
    page.getByRole("region", { name: /Evidence and decision factors/ })
  ).toContainText("Thank you for looking into this", { timeout: 90_000 })

  const after = await readTicket(EXECUTED_TICKET.id)
  expect(after.follow_ups).toHaveLength(1)
  // Nothing was reopened, and the executed decision stands.
  expect(after.status).toBe("EXECUTED")
  expect(after.conflict?.detected).toBe(false)
  await expect(
    page.getByRole("region", { name: /Context conflict/ })
  ).toHaveCount(0)
})

test("a customer cannot reopen a ticket into execution", async () => {
  // The property that keeps the cycle safe. The reopen path is reachable by anyone
  // who can post to it, so it is worth proving directly that it cannot be steered
  // past the gate: the database refuses EXECUTED from anywhere but APPROVED, and
  // refuses a reversal that carries no grounds.
  requireEnv()

  const post = (fn: string, body: unknown) =>
    fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: KEY!,
        Authorization: `Bearer ${KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

  // A reversal with no conflict finding behind it, on a ticket that has not even
  // received a message. Refused, so the trail cannot be filled with unexplained
  // reversals by anyone who can reach the endpoint.
  const ungrounded = await post("apply_transition", {
    p_id: EXECUTED_TICKET.id,
    p_expect: "EXECUTED",
    p_to: "AWAITING_APPROVAL",
    p_actor: "ai",
    p_reason: "no grounds",
  })
  expect(ungrounded.ok).toBe(false)

  // And the ticket did not move.
  expect((await readTicket(EXECUTED_TICKET.id)).status).toBe("EXECUTED")

  // Straight back to EXECUTED from the gate, skipping the human. Refused even
  // though this ticket already carries a human approval from its first pass.
  const skipTheGate = await post("apply_transition", {
    p_id: EXECUTED_TICKET.id,
    p_expect: "AWAITING_APPROVAL",
    p_to: "EXECUTED",
    p_actor: "human",
    p_reason: "skipping the gate",
  })
  expect(skipTheGate.ok).toBe(false)
})
