"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { z } from "zod"

import {
  analyze,
  draft as runDraft,
  verify,
  type TicketInput,
} from "@/lib/ai/stages"
import {
  createTicket,
  getPipelineTicket,
  store,
  type PipelineTicket,
} from "@/lib/db"
import { transition } from "@/lib/workflow"
import type { Analysis, Draft, Result, Status } from "@/lib/types"

// The only write path in the app. Server Components read; these four actions
// write, and every one of them re-reads the ticket's status from the database and
// re-checks the move through `canTransition` before anything is persisted
// (CLAUDE.md §7).
//
// A Server Action is a POST endpoint reachable by anyone who can send the
// request, so nothing here trusts its arguments beyond "which ticket" and "what
// the operator decided". Status, risk and the artifacts all come from the
// database on this request.

/** What a form gets back. Shaped for rendering, not a database row. */
export type ActionState = {
  ok: boolean
  message: string
} | null

function fail(message: string): ActionState {
  return { ok: false, message }
}

/**
 * Only a ticket id crosses the boundary, so it is validated as one before it
 * reaches a query. A malformed id is a caller error, not a database error.
 */
function ticketId(formData: FormData): string | null {
  const raw = formData.get("ticketId")
  if (typeof raw !== "string") return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    raw
  )
    ? raw
    : null
}

function refreshViews(id: string) {
  revalidatePath("/")
  revalidatePath(`/tickets/${id}`)
}

function toTicketInput(ticket: PipelineTicket): TicketInput {
  return {
    subject: ticket.subject,
    body: ticket.body,
    customerTier: ticket.customer_tier,
    orderValueCents: ticket.order_value_cents,
  }
}

/**
 * Record that a stage produced nothing usable, and stop.
 *
 * The ticket is preserved where it was, the failure is on the row for the UI to
 * show, and one event says the system tried. Nothing downstream runs: a failed
 * stage must not be followed by a stage pretending its input exists
 * (CLAUDE.md §1).
 */
async function stageFailed(
  id: string,
  stage: "analyze" | "draft" | "verify",
  message: string
): Promise<ActionState> {
  const recorded = await store.recordFailure({
    ticketId: id,
    error: { stage, message, at: new Date().toISOString() },
  })
  refreshViews(id)
  return fail(
    recorded.ok
      ? `The ${stage} stage did not produce a usable result, so the ticket was left where it was. ${message}`
      : `The ${stage} stage failed, and the failure could not be recorded: ${recorded.message} Original failure: ${message}`
  )
}

/**
 * Run the AI pipeline as far as it will go: analyzer, writer, reviewer, then park
 * the decision for a human.
 *
 * Resumable by construction. Each stage runs first and its result lands *with*
 * the transition it justifies, so a ticket never sits in a status whose artifact
 * is missing — and a failed stage leaves the ticket at a status it can be retried
 * from. Advancing first would strand a ticket at ANALYZING with no analysis and
 * no legal edge back.
 *
 * Nothing here can approve or execute. The pipeline's last move is to
 * AWAITING_APPROVAL, and `canTransition` gives it no path past that.
 */
export async function runPipeline(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const id = ticketId(formData)
  if (!id) return fail("No valid ticket id was supplied, so nothing was run.")
  return advanceThroughStages(id)
}

/**
 * The stages themselves, separated from the form that usually starts them.
 *
 * Two callers reach the pipeline — an operator pressing the button on the detail
 * view, and a ticket arriving through the customer portal — and they must run the
 * *same* stages against the same guarded transitions. A second copy shaped for
 * the portal would be a second state machine, which is the one thing CLAUDE.md §2
 * forbids. Not exported: it is reached through `runPipeline` or from the portal
 * submission on this server, never as its own endpoint.
 */
async function advanceThroughStages(id: string): Promise<ActionState> {
  const read = await getPipelineTicket(id)
  if (!read.ok) return fail(read.message)

  const ticket = read.data
  const input = toTicketInput(ticket)
  const seed = ticket.seed ?? {}

  let status: Status = ticket.status
  let analysis: Analysis | null = ticket.analysis
  let draft: Draft | null = ticket.draft

  if (status === "RECEIVED") {
    const result = await analyze({ ticket: input, seed: seed.analysis })
    if (!result.ok) return stageFailed(id, "analyze", result.message)

    const { risk, ...fields } = result.data
    analysis = fields
    const moved = await transition(store, {
      ticketId: id,
      to: "ANALYZING",
      actor: "ai",
      reason: `Classified as ${fields.category} at ${fields.severity} severity, routed to ${fields.routing}.`,
      source: fields.source,
      model: fields.model,
      // Risk is provisional here: it is computed without a verifier's objection
      // on record, and the verify step recomputes and overwrites it.
      patch: { analysis: fields, risk },
    })
    if (!moved.ok) return fail(moved.message)
    status = moved.data.status
  }

  if (status === "ANALYZING") {
    if (!analysis) {
      return fail(
        "This ticket is past analysis but carries no analysis, so drafting has nothing to work from. Reseed the ticket."
      )
    }
    const result = await runDraft({
      ticket: input,
      analysis,
      seed: seed.draft,
    })
    if (!result.ok) return stageFailed(id, "draft", result.message)

    draft = result.data
    const moved = await transition(store, {
      ticketId: id,
      to: "DRAFTED",
      actor: "ai",
      reason: `Drafted a reply and proposed one action: ${result.data.proposedAction.type}.`,
      source: result.data.source,
      model: result.data.model,
      patch: { draft: result.data },
    })
    if (!moved.ok) return fail(moved.message)
    status = moved.data.status
  }

  if (status === "DRAFTED") {
    if (!analysis || !draft) {
      return fail(
        "This ticket is past drafting but carries no analysis or draft, so there is nothing to verify. Reseed the ticket."
      )
    }
    const result = await verify({
      ticket: input,
      analysis,
      draft,
      seed: seed.verification,
    })
    if (!result.ok) return stageFailed(id, "verify", result.message)

    const { riskLevel, ...fields } = result.data
    const moved = await transition(store, {
      ticketId: id,
      to: "VERIFIED",
      actor: "ai",
      reason: `Verification returned ${fields.verificationStatus} with ${
        fields.issues.length
      } ${fields.issues.length === 1 ? "issue" : "issues"} raised.`,
      source: fields.source,
      model: fields.model,
      patch: { verification: fields, risk: riskLevel },
    })
    if (!moved.ok) return fail(moved.message)
    status = moved.data.status
  }

  if (status === "VERIFIED") {
    const moved = await transition(store, {
      ticketId: id,
      to: "AWAITING_APPROVAL",
      actor: "ai",
      reason:
        "Decision assembled and parked for a human. Nothing is carried out until it is approved.",
      patch: {},
    })
    if (!moved.ok) return fail(moved.message)
    status = moved.data.status
  }

  refreshViews(id)

  if (status === "AWAITING_APPROVAL") {
    return {
      ok: true,
      message:
        "The pipeline finished. This decision is waiting for a human at the gate.",
    }
  }
  return fail(
    `This ticket is at ${status}, which is past the automated stages, so the pipeline had nothing to run.`
  )
}

// ------------------------------------------------------------ customer intake
// The one write that does not move a ticket through the state machine: it creates
// one at the start of it. Everything a customer sends is untrusted, and this is
// the widest trust boundary in the app — it is reachable by anyone who can reach
// the portal, with no operator behind it — so the fields are validated here
// before a database or a model sees them.

/**
 * What the portal form may contain. Bounded on purpose: `body` reaches a model,
 * so an unbounded one is both a cost and an availability problem, and a limit is
 * the only thing standing where an authenticated session normally would.
 *
 * `trim()` before the length check, so whitespace cannot satisfy a required field.
 */
const SubmissionSchema = z.object({
  customer_name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(120, "This name is longer than 120 characters."),
  // The tier vocabulary the tickets table checks. A value outside it is not a
  // typo to explain, it is a tampered form field.
  customer_tier: z.enum(["free", "pro", "enterprise"], {
    message: "Choose one of the listed plans.",
  }),
  subject: z
    .string()
    .trim()
    .min(1, "Enter a subject.")
    .max(200, "Keep the subject under 200 characters."),
  body: z
    .string()
    .trim()
    .min(1, "Describe the problem so we can help.")
    .max(4000, "Keep the message under 4000 characters."),
})

/** What the portal form gets back. Field errors so the form can point at them. */
export type SubmissionState =
  | { ok: true; reference: string }
  | { ok: false; message: string; errors?: Record<string, string> }
  | null

/**
 * Accept a ticket from a customer, then start the AI stages behind the response.
 *
 * The ticket lands at RECEIVED and nothing about the decision is decided here.
 * The stages run through `advanceThroughStages`, which is the same guarded path
 * the operator's button uses, so a ticket arriving this way is subject to the
 * identical state machine — and its furthest reachable status is
 * AWAITING_APPROVAL. A ticket cannot approve or execute itself by being submitted,
 * whatever its text asks for.
 */
export async function submitTicket(
  _prev: SubmissionState,
  formData: FormData
): Promise<SubmissionState> {
  const parsed = SubmissionSchema.safeParse({
    customer_name: formData.get("customer_name"),
    customer_tier: formData.get("customer_tier"),
    subject: formData.get("subject"),
    body: formData.get("body"),
  })

  if (!parsed.success) {
    // The schema's own messages, which are written above for a customer to read.
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (typeof field === "string" && !errors[field]) {
        errors[field] = issue.message
      }
    }
    return {
      ok: false,
      message: "This form could not be submitted. Check the fields below.",
      errors,
    }
  }

  const created = await createTicket(parsed.data)
  if (!created.ok) return { ok: false, message: created.message }

  const { id } = created.data

  // The customer's confirmation does not wait on three model calls. The stages
  // run after the response, and a failure inside them is recorded on the ticket
  // as a pipeline error — the ticket stays at RECEIVED and an operator sees why,
  // which is the honest outcome rather than a submission that appears to fail
  // after it has already been accepted.
  after(async () => {
    try {
      const result = await advanceThroughStages(id)
      // AI stage failures are already recorded by `stageFailed`, but transition
      // rejections and missing-data paths return fail() without recording. A
      // portal-submitted ticket that stalls for one of those reasons would have
      // no pipeline_error on the row, so the operator would not see why it
      // stopped. Record it here so the stall is always visible.
      if (result && !result.ok) {
        await store.recordFailure({
          ticketId: id,
          error: {
            stage: "pipeline",
            message: result.message,
            at: new Date().toISOString(),
          },
        })
      }
    } catch {
      // Already-accepted work must not surface as an unhandled rejection. The
      // stages record their own failures against the ticket; nothing is logged
      // here because provider errors can echo request contents (CLAUDE.md §7).
    }
  })

  // The queue reads through `connection()`, so it is never served from a cache
  // and this ticket is visible on the operator's next load either way. Revalidated
  // regardless, because the detail route it links to is the one an operator opens
  // straight after.
  refreshViews(id)

  return { ok: true, reference: id }
}

/**
 * The human decision. `to` is the only thing the client chooses, and it is
 * checked against the ticket's re-read status before anything is written.
 *
 * A HIGH-risk approval requires the confirmation flag, and the risk it is checked
 * against is re-read from the database rather than taken from the request — a
 * client claiming LOW risk cannot skip the step (CLAUDE.md §6).
 */
async function decide(
  formData: FormData,
  to: "APPROVED" | "REJECTED"
): Promise<ActionState> {
  const id = ticketId(formData)
  if (!id) {
    return fail("No valid ticket id was supplied, so no decision was recorded.")
  }

  const note = formData.get("note")
  const reason =
    typeof note === "string" && note.trim().length > 0
      ? `${to === "APPROVED" ? "Approved" : "Rejected"} by the operator. ${note
          .trim()
          .slice(0, 400)}`
      : `${to === "APPROVED" ? "Approved" : "Rejected"} by the operator.`

  const moved = await transition(store, {
    ticketId: id,
    to,
    actor: "human",
    reason,
  })
  if (!moved.ok) {
    refreshViews(id)
    return fail(moved.message)
  }

  if (to === "REJECTED") {
    refreshViews(id)
    return {
      ok: true,
      message:
        "Rejected. Nothing was carried out, and this ticket cannot move again.",
    }
  }

  // Approval authorizes the action; carrying it out is the next transition and is
  // guarded independently. `execute` re-reads status and re-checks the edge, so
  // this call cannot smuggle a ticket into EXECUTED — it only asks.
  const executed = await execute(id)
  refreshViews(id)

  if (!executed.ok) {
    return fail(
      `The approval was recorded, so this ticket is at APPROVED, but the action was not carried out: ${executed.message} The gate offers a retry.`
    )
  }
  return {
    ok: true,
    message: "Approved, and the action was carried out and recorded.",
  }
}

export async function approve(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const id = ticketId(formData)
  if (!id) {
    return fail("No valid ticket id was supplied, so no decision was recorded.")
  }

  const read = await getPipelineTicket(id)
  if (!read.ok) return fail(read.message)

  // The confirmation step for a high-risk approval, enforced on the server. The
  // band is the one on the row, re-read on this request — a caller claiming a
  // lower risk than the ticket carries cannot skip the step (CLAUDE.md §6).
  if (read.data.risk === "HIGH" && formData.get("confirmed") !== "yes") {
    return fail(
      "This is a HIGH risk decision, so it needs the confirmation step. Nothing was recorded. Confirm what will happen, then approve."
    )
  }

  if (read.data.status === "APPROVED") {
    // The approval is already on record and the action evidently did not
    // complete. Retrying the action is the right move; recording a second
    // approval for the same decision is not.
    const executed = await execute(id)
    refreshViews(id)
    return executed.ok
      ? { ok: true, message: "The approved action was carried out and recorded." }
      : fail(executed.message)
  }

  return decide(formData, "APPROVED")
}

export async function reject(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return decide(formData, "REJECTED")
}

/**
 * Carry out an approved action.
 *
 * The hard requirement of the product lives here and in two places behind it:
 * this call re-reads status and asks `canTransition`, which permits EXECUTED only
 * from APPROVED; and `apply_transition` in the schema refuses an EXECUTED write
 * whose expected status is not APPROVED and whose ticket carries no recorded
 * human approval event. A caller POSTing this against a RECEIVED ticket gets a
 * rejection from the first check and would get one from the database too.
 *
 * Not exported as an action: it is reached through `approve`, so there is no
 * separate endpoint that only executes. The retry path goes through `approve`,
 * which finds the approval already recorded and comes back here.
 */
async function execute(id: string): Promise<Result<{ status: Status }>> {
  const read = await getPipelineTicket(id)
  if (!read.ok) return read

  const action = read.data.draft?.proposedAction.type
  if (!action) {
    return {
      ok: false,
      message:
        "This ticket carries no proposed action, so there is nothing to carry out.",
    }
  }

  const moved = await transition(store, {
    ticketId: id,
    to: "EXECUTED",
    actor: "human",
    reason: "Approved action carried out and recorded. Delivery is simulated.",
    patch: {
      execution_result: {
        executedAt: new Date().toISOString(),
        action,
        // Labeled simulated here and on screen. No email provider is wired, and
        // a side effect the product only claims to have performed would make the
        // audit trail a lie (CLAUDE.md §1).
        simulated: true,
        detail:
          "Recorded as carried out. No email provider or billing integration is wired, so the side effect is simulated rather than performed.",
      },
    },
  })
  if (!moved.ok) return moved
  return { ok: true, data: { status: moved.data.status } }
}
