#!/usr/bin/env node

/**
 * db-health-check.js — Supabase connectivity and schema health check.
 *
 * Verifies that the Gatekeeper database is reachable, the required tables exist,
 * the RPC functions the app depends on are callable, and the demo seed contains
 * at least one ticket. Exits 0 when healthy, 1 on any failure.
 *
 * Usage:
 *   node scripts/db-health-check.js
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment (or .env.local via Node 22+ --env-file).
 */

try { process.loadEnvFile(".env.local") } catch { /* absent is reported below */ }

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error(
    "✗ Missing environment variables. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
  )
  process.exit(1)
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
}

const checks = []

async function check(name, fn) {
  try {
    await fn()
    checks.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (err) {
    checks.push({ name, ok: false, error: err.message })
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

async function run() {
  console.log(`\nGatekeeper DB Health Check`)
  console.log(`Target: ${URL}\n`)

  // 1. Basic connectivity — can we reach the REST API?
  await check("Supabase REST API reachable", async () => {
    const res = await fetch(`${URL}/rest/v1/`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  })

  // 2. tickets table exists and is queryable
  await check("tickets table exists", async () => {
    const res = await fetch(
      `${URL}/rest/v1/tickets?select=id&limit=1`,
      { headers }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HTTP ${res.status}: ${body}`)
    }
  })

  // 3. ticket_events table exists
  await check("ticket_events table exists", async () => {
    const res = await fetch(
      `${URL}/rest/v1/ticket_events?select=id&limit=1`,
      { headers }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HTTP ${res.status}: ${body}`)
    }
  })

  // 4. policies table exists
  await check("policies table exists", async () => {
    const res = await fetch(
      `${URL}/rest/v1/policies?select=id&limit=1`,
      { headers }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HTTP ${res.status}: ${body}`)
    }
  })

  // 5. apply_transition RPC is callable (dry probe — will fail on missing args, but 
  //    a 404 means the function does not exist)
  await check("apply_transition RPC exists", async () => {
    const res = await fetch(`${URL}/rest/v1/rpc/apply_transition`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    // 400 = function exists but args are wrong (expected). 404 = missing.
    if (res.status === 404) throw new Error("RPC function not found")
  })

  // 6. record_pipeline_failure RPC is callable
  await check("record_pipeline_failure RPC exists", async () => {
    const res = await fetch(`${URL}/rest/v1/rpc/record_pipeline_failure`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    if (res.status === 404) throw new Error("RPC function not found")
  })

  // 7. Demo seed — at least one ticket exists
  await check("Demo seed present (≥1 ticket)", async () => {
    const res = await fetch(
      `${URL}/rest/v1/tickets?select=id&limit=1`,
      { headers }
    )
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("No tickets found. Run the seed migration.")
    }
  })

  // Summary
  const failed = checks.filter((c) => !c.ok)
  console.log()
  if (failed.length === 0) {
    console.log(`All ${checks.length} checks passed. Database is healthy.\n`)
    process.exit(0)
  } else {
    console.error(
      `${failed.length} of ${checks.length} checks failed. See above.\n`
    )
    process.exit(1)
  }
}

run()
