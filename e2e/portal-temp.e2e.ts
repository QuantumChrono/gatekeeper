import { expect, test } from "@playwright/test"

// TEMPORARY verification spec. Delete after running.
// Drives the real portal form against the real database and the real provider.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function readTicket(id: string) {
  const res = await fetch(
    `${URL}/rest/v1/tickets?select=id,status,customer_name,customer_tier,subject,analysis,draft,verification,risk,pipeline_error&id=eq.${id}`,
    { headers: { apikey: KEY!, Authorization: `Bearer ${KEY!}` } }
  )
  const rows = await res.json()
  return rows[0]
}

test("a portal submission creates a ticket and the pipeline advances it", async ({
  page,
}) => {
  test.setTimeout(180_000)

  await page.goto("/portal")

  const unique = `Portal check ${Date.now()}`
  await page.getByLabel("Your name").fill("Verification Customer")
  await page.getByLabel("Your plan").selectOption("pro")
  await page.getByLabel("Subject").fill(unique)
  await page
    .getByLabel("How can we help?")
    .fill(
      "Our team was billed twice for the same monthly invoice of 20.00 USD in August. The billing portal only lists one invoice. Please confirm whether a duplicate charge was taken."
    )

  await page.getByRole("button", { name: "Submit ticket" }).click()

  // The success state, and the reference the customer is given.
  await expect(page.getByText("Ticket submitted successfully")).toBeVisible({
    timeout: 30_000,
  })
  const reference = await page
    .locator("p.font-mono")
    .first()
    .innerText()
  const id = reference.trim()
  console.log("REFERENCE:", id)

  // It exists in the database with exactly the submitted fields.
  const row = await readTicket(id)
  expect(row).toBeTruthy()
  expect(row.subject).toBe(unique)
  expect(row.customer_name).toBe("Verification Customer")
  expect(row.customer_tier).toBe("pro")
  console.log("STATUS RIGHT AFTER SUBMIT:", row.status)

  // The background pipeline. Poll rather than assume: it runs after the response.
  let final = row
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    final = await readTicket(id)
    if (final.status === "AWAITING_APPROVAL" || final.pipeline_error) break
  }

  console.log("FINAL STATUS:", final.status)
  console.log("PIPELINE ERROR:", JSON.stringify(final.pipeline_error))
  console.log("RISK:", final.risk)
  console.log("HAS ANALYSIS:", !!final.analysis, "SOURCE:", final.analysis?.source)
  console.log("HAS DRAFT:", !!final.draft)
  console.log("HAS VERIFICATION:", !!final.verification)

  // The queue can see it.
  await page.goto("/")
  await expect(page.getByRole("link", { name: unique })).toBeVisible()
  console.log("VISIBLE IN QUEUE: yes")

  // And the detail view opens, proving the console shell still renders.
  await page.getByRole("link", { name: unique }).click()
  await expect(page.getByRole("heading", { name: unique, level: 1 })).toBeVisible()
  const trail = page.getByRole("list", { name: "Workflow" })
  console.log("SIDEBAR TRAIL:", (await trail.innerText()).replace(/\n+/g, " | "))

  // Whatever it reached, it must not have executed itself.
  expect(final.status).not.toBe("EXECUTED")
  expect(final.status).not.toBe("APPROVED")
})
