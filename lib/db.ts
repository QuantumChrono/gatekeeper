import { createClient } from "@supabase/supabase-js"
import { connection } from "next/server"

import { applicablePolicies, relatedTickets } from "@/lib/evidence"
import type { TransitionStore } from "@/lib/workflow"
import type {
  Analysis,
  Draft,
  Policy,
  PriorTicket,
  Result,
  Risk,
  Status,
  Ticket,
  TicketEvent,
  Verification,
} from "@/lib/types"

// Read path only. The browser holds the anon key and RLS allows select and
// nothing else (CLAUDE.md §7); every mutation will go through a Server Action
// with the service-role key, which is not read here and never reaches a client
// component.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Reads and writes either succeed or explain themselves. Pages render the
 * message, so a missing database says what happened and what to do next instead
 * of throwing a stack trace at an operator (CLAUDE.md §6).
 *
 * Defined in lib/types.ts so that lib/workflow.ts can use it without importing a
 * database client; re-exported here because that is where callers already expect
 * it.
 */
export type { Result } from "@/lib/types"

const UNCONFIGURED =
  "No database is configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then apply supabase/migrations/001_initial_schema.sql to seed the demo tickets."

// `seed` is deliberately absent: it is tier-3 input for the AI stages, read
// server-side by the pipeline, and it has no business in a page payload.
const TICKET_COLUMNS =
  "id,created_at,updated_at,subject,body,customer_name,customer_tier,order_value_cents,status,analysis,draft,verification,risk,execution_result,pipeline_error"

function reader() {
  if (!url || !anonKey) return null
  return createClient(url, anonKey, { auth: { persistSession: false } })
}

/**
 * The queue and the detail view must reflect the database as it is now, not as
 * it was when the page was built. `connection()` keeps both out of the
 * prerender rather than reaching for a config flag.
 */
export async function getTickets(): Promise<Result<Ticket[]>> {
  await connection()
  const db = reader()
  if (!db) return { ok: false, message: UNCONFIGURED }

  // The whole queue in one read. The status filter narrows this set in the page
  // rather than in SQL, because the header counts need the unfiltered totals
  // either way and a demo queue is a handful of rows.
  const { data, error } = await db
    .from("tickets")
    .select(TICKET_COLUMNS)
    .order("created_at", { ascending: false })
    .returns<Ticket[]>()

  if (error) {
    return {
      ok: false,
      message: `The ticket queue could not be read: ${error.message}. Confirm the database is reachable and the schema has been applied.`,
    }
  }
  return { ok: true, data }
}

/**
 * Everything the decision detail renders, in one read.
 *
 * `policies` and `related` are the evidence behind the recommendation: reference
 * rules that apply to this ticket, and settled earlier tickets that bear on it.
 * Both come from the relational data already in the database and are selected by
 * the exact-match rules in lib/evidence.ts — nothing is embedded, ranked or
 * searched.
 */
export async function getTicket(id: string): Promise<
  Result<{
    ticket: Ticket
    events: TicketEvent[]
    policies: Policy[]
    related: PriorTicket[]
  }>
> {
  await connection()
  const db = reader()
  if (!db) return { ok: false, message: UNCONFIGURED }

  // Four independent reads — issued together rather than in series. The two
  // evidence reads do not depend on the ticket: they are filtered in code once it
  // has landed, which keeps retrieval a pure function of data we already hold
  // rather than a second round trip shaped by the first.
  const [ticketRes, eventsRes, policiesRes, candidatesRes] = await Promise.all([
    db.from("tickets").select(TICKET_COLUMNS).eq("id", id).maybeSingle<Ticket>(),
    db
      .from("ticket_events")
      .select("*")
      .eq("ticket_id", id)
      .order("id", { ascending: true })
      .returns<TicketEvent[]>(),
    // Ordered by id so the panel lists rules in a stable order across renders.
    db.from("policies").select("*").order("id").returns<Policy[]>(),
    // Settled tickets only, which is also all the evidence rules will accept. A
    // demo-scale queue, so the relevance filter runs in code beside the rule that
    // defines it rather than being restated as SQL.
    db
      .from("tickets")
      .select(TICKET_COLUMNS)
      .in("status", ["EXECUTED", "REJECTED"])
      .order("created_at", { ascending: false })
      .returns<Ticket[]>(),
  ])

  if (ticketRes.error) {
    return {
      ok: false,
      message: `This ticket could not be read: ${ticketRes.error.message}.`,
    }
  }
  if (!ticketRes.data) {
    return { ok: false, message: "No ticket exists with this id." }
  }
  if (eventsRes.error) {
    return {
      ok: false,
      message: `The audit trail could not be read: ${eventsRes.error.message}. The trail is the record of who authorized what, so this ticket is not shown without it.`,
    }
  }
  // The evidence reads are not fatal, and deliberately so: an operator can still
  // decide without the reference panels, and refusing to render the gate because a
  // supporting query failed would be the worse outcome. An empty panel says the
  // evidence could not be read rather than implying there was none.
  if (policiesRes.error || candidatesRes.error) {
    return {
      ok: true,
      data: {
        ticket: ticketRes.data,
        events: eventsRes.data,
        policies: [],
        related: [],
      },
    }
  }

  const ticket = ticketRes.data
  const category = ticket.analysis?.category
  return {
    ok: true,
    data: {
      ticket,
      events: eventsRes.data,
      policies: applicablePolicies(policiesRes.data, {
        category,
        actionType: ticket.draft?.proposedAction.type,
      }),
      related: relatedTickets(candidatesRes.data, {
        id: ticket.id,
        created_at: ticket.created_at,
        customer_name: ticket.customer_name,
        category,
      }),
    },
  }
}

// ---------------------------------------------------------------- write path
// Everything below runs only inside a Server Action. The service-role key is
// read from a non-NEXT_PUBLIC_* var, so Next has no value to inline into a
// browser bundle even by accident, and nothing here is reachable from a client
// component (CLAUDE.md §7).

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const NO_WRITE_KEY =
  "No write credentials are configured, so nothing was changed. Set SUPABASE_SERVICE_ROLE_KEY in .env.local — it is the server-only key, and it must never be a NEXT_PUBLIC_* variable."

function writer() {
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

/**
 * What the AI stages need to run, including the tier-3 seed.
 *
 * Read with the service-role client rather than the anon one so the seed stays
 * on the server: it is stage input, and no page renders it.
 */
export type PipelineTicket = {
  id: string
  subject: string
  body: string
  customer_tier: Ticket["customer_tier"]
  order_value_cents: number
  status: Status
  /** Re-read so the high-risk confirmation step is checked against the row. */
  risk: Risk | null
  analysis: Analysis | null
  draft: Draft | null
  verification: Verification | null
  seed: {
    analysis?: unknown
    draft?: unknown
    verification?: unknown
  } | null
}

export async function getPipelineTicket(
  id: string
): Promise<Result<PipelineTicket>> {
  const db = writer()
  if (!db) return { ok: false, message: NO_WRITE_KEY }

  const { data, error } = await db
    .from("tickets")
    .select(
      "id,subject,body,customer_tier,order_value_cents,status,risk,analysis,draft,verification,seed"
    )
    .eq("id", id)
    .maybeSingle<PipelineTicket>()

  if (error) {
    return { ok: false, message: `This ticket could not be read: ${error.message}.` }
  }
  if (!data) return { ok: false, message: "No ticket exists with this id." }
  return { ok: true, data }
}

/**
 * Insert a ticket at RECEIVED and hand back its id.
 *
 * Written with the service-role client like every other mutation: the anon key
 * the browser holds has no insert policy, so a ticket cannot be created from a
 * client component even if someone drives the Supabase client directly
 * (CLAUDE.md §7). The caller is a Server Action that has already validated the
 * fields.
 *
 * `status` is not passed. The column defaults to RECEIVED, and the receipt
 * trigger writes the first audit event from the row itself — so an arriving
 * ticket cannot be inserted mid-workflow, and its trail starts where the ticket
 * actually started.
 */
export async function createTicket(fields: {
  subject: string
  body: string
  customer_name: string
  customer_tier: Ticket["customer_tier"]
}): Promise<Result<{ id: string }>> {
  const db = writer()
  if (!db) return { ok: false, message: NO_WRITE_KEY }

  const { data, error } = await db
    .from("tickets")
    .insert(fields)
    .select("id")
    .single<{ id: string }>()

  if (error) {
    return {
      ok: false,
      message: `This ticket could not be submitted: ${error.message}.`,
    }
  }
  return { ok: true, data }
}

/**
 * The one implementation of the state machine's write port.
 *
 * It holds no policy: `canTransition` in lib/workflow.ts decides what may move
 * where, and `transition()` re-reads and checks before calling `apply`. What this
 * adds is the trip to a database that performs the compare-and-set and the audit
 * insert in a single statement pair, inside one transaction.
 */
export const store: TransitionStore = {
  async readStatus(ticketId) {
    const db = writer()
    if (!db) return { ok: false, message: NO_WRITE_KEY }

    const { data, error } = await db
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .maybeSingle<{ status: Status }>()

    if (error) {
      return {
        ok: false,
        message: `The ticket's current status could not be read, so nothing was changed: ${error.message}.`,
      }
    }
    return { ok: true, data: data?.status ?? null }
  },

  async apply({ ticketId, expect, to, actor, reason, source, model, patch }) {
    const db = writer()
    if (!db) return { ok: false, message: NO_WRITE_KEY }

    // A postgres function, so the conditional update and the audit event share
    // one transaction. Two round trips could leave a moved ticket with no record
    // of who moved it, and the trail is the product's evidence (CLAUDE.md §7).
    const { data, error } = await db.rpc("apply_transition", {
      p_id: ticketId,
      p_expect: expect,
      p_to: to,
      p_actor: actor,
      p_reason: reason,
      p_source: source ?? null,
      p_model: model ?? null,
      p_patch: patch ?? {},
    })

    if (error) {
      return {
        ok: false,
        message: `The change was rejected by the database and nothing was written: ${error.message}.`,
      }
    }
    return { ok: true, data: { applied: data === true } }
  },

  async recordFailure({ ticketId, error }) {
    const db = writer()
    if (!db) return { ok: false, message: NO_WRITE_KEY }

    const { error: rpcError } = await db.rpc("record_pipeline_failure", {
      p_id: ticketId,
      p_error: error,
    })

    if (rpcError) {
      return {
        ok: false,
        message: `The stage failed, and the failure itself could not be recorded: ${rpcError.message}.`,
      }
    }
    return { ok: true, data: undefined }
  },
}
