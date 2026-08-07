import { createClient } from "@supabase/supabase-js"
import { connection } from "next/server"

import type { Ticket, TicketEvent } from "@/lib/types"

// Read path only. The browser holds the anon key and RLS allows select and
// nothing else (CLAUDE.md §7); every mutation will go through a Server Action
// with the service-role key, which is not read here and never reaches a client
// component.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Reads either succeed or explain themselves. Pages render the message, so a
 * missing database says what happened and what to do next instead of throwing a
 * stack trace at an operator (CLAUDE.md §6).
 */
export type Result<T> = { ok: true; data: T } | { ok: false; message: string }

const UNCONFIGURED =
  "No database is configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then apply supabase/migrations/001_initial_schema.sql to seed the demo tickets."

const TICKET_COLUMNS =
  "id,created_at,updated_at,subject,body,customer_name,customer_tier,order_value_cents,status,analysis,draft,verification,risk,execution_result"

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

export async function getTicket(
  id: string
): Promise<Result<{ ticket: Ticket; events: TicketEvent[] }>> {
  await connection()
  const db = reader()
  if (!db) return { ok: false, message: UNCONFIGURED }

  // Two independent reads — issue them together rather than in series.
  const [ticketRes, eventsRes] = await Promise.all([
    db.from("tickets").select(TICKET_COLUMNS).eq("id", id).maybeSingle<Ticket>(),
    db
      .from("ticket_events")
      .select("*")
      .eq("ticket_id", id)
      .order("id", { ascending: true })
      .returns<TicketEvent[]>(),
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

  return { ok: true, data: { ticket: ticketRes.data, events: eventsRes.data } }
}
