"use client"

import { useActionState, useState } from "react"
import { CircleCheck, CircleAlert, Lock, Play, TriangleAlert } from "lucide-react"

import { approve, reject, runPipeline, type ActionState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { Risk, Status } from "@/lib/types"
import { cn } from "@/lib/utils"

// The controls inside the approval gate. A client component only because a
// decision needs in-flight state and a confirmation step; the decision itself is
// made entirely on the server (app/actions.ts), which re-reads the ticket and
// re-checks the transition on every call. Nothing here authorizes anything —
// disabling a button is a courtesy to the operator, not the security boundary
// (CLAUDE.md §7).

/** The result of the last write, or nothing yet. Announced, never a bare colour. */
function Outcome({ state }: { state: ActionState }) {
  return (
    // Always mounted so the announcement is picked up, and so the panel does not
    // shift when a result lands.
    <div aria-live="polite" className="min-h-0">
      {state ? (
        <p
          className={cn(
            "flex items-start gap-2.5 rounded-sm border px-3 py-2.5 text-[13px] leading-relaxed",
            state.ok
              ? "border-success/25 bg-success/[0.04]"
              : "border-danger/25 bg-danger/[0.04]"
          )}
        >
          {state.ok ? (
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-success"
            />
          ) : (
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-danger"
            />
          )}
          <span className="min-w-0">
            <span className="sr-only">
              {state.ok ? "Succeeded: " : "Failed: "}
            </span>
            {state.message}
          </span>
        </p>
      ) : null}
    </div>
  )
}

function TicketField({ id }: { id: string }) {
  return <input type="hidden" name="ticketId" value={id} />
}

/**
 * Runs the AI stages that precede the gate. Present because the workflow has to
 * be startable; it cannot approve or execute anything, since the pipeline's last
 * legal move is to AWAITING_APPROVAL.
 */
function PipelineControl({ id, status }: { id: string; status: Status }) {
  const [state, formAction, pending] = useActionState(runPipeline, null)

  return (
    <div className="space-y-3.5">
      <form action={formAction}>
        <TicketField id={id} />
        <Button type="submit" disabled={pending}>
          <Play aria-hidden="true" />
          {pending
            ? "Running the stages…"
            : status === "RECEIVED"
              ? "Run analysis, drafting and verification"
              : "Continue from " + status}
        </Button>
      </form>
      <Outcome state={state} />
    </div>
  )
}

/**
 * The gate. Approve and Reject are the only primary actions, both always visible
 * and never behind a menu (CLAUDE.md §6).
 *
 * A HIGH-risk approval goes through a confirmation that restates what will
 * happen. The dialog is a courtesy: the server checks the same condition against
 * the risk on the row, so an approval that skipped it is refused there.
 */
function Gate({
  id,
  risk,
  actionSentence,
}: {
  id: string
  risk: Risk | null
  actionSentence: string
}) {
  const [approveState, approveAction, approving] = useActionState(approve, null)
  const [rejectState, rejectAction, rejecting] = useActionState(reject, null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const busy = approving || rejecting
  const highRisk = risk === "HIGH"
  // Both forms write, so whichever answered last is the outcome to show.
  const state = approveState ?? rejectState

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="note"
          className="label-xs block"
        >
          Note for the audit trail (optional)
        </label>
        <Textarea
          id="note"
          name="note"
          form="approve-form"
          rows={2}
          disabled={busy}
          placeholder="Why this decision. Recorded with it, and it cannot be edited afterwards."
          className="text-[13px]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* The note field belongs to this form by id, so one textarea serves the
            decision that is actually taken. */}
        <form id="approve-form" action={approveAction} className="contents">
          <TicketField id={id} />
          {highRisk ? (
            <>
              {/* Confirmation is required, so the primary control opens it rather
                  than submitting. The submit lives inside the dialog. */}
              <Button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(true)}
              >
                <TriangleAlert aria-hidden="true" />
                Approve
              </Button>
              <input type="hidden" name="confirmed" value="yes" />
              <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Approve a high-risk decision</DialogTitle>
                    <DialogDescription>
                      This is what will happen when you approve.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2.5 rounded-sm border border-danger/25 bg-danger/[0.035] px-3.5 py-3">
                    <p className="text-[13px] leading-relaxed font-medium">
                      {actionSentence}
                    </p>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      The drafted reply is recorded as sent, and your approval is
                      written to the audit trail against this ticket. Neither can
                      be edited or removed afterwards.
                    </p>
                  </div>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>
                      Cancel
                    </DialogClose>
                    <Button type="submit" form="approve-form" disabled={busy}>
                      {approving ? "Recording…" : "Approve and carry out"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <Button type="submit" disabled={busy}>
              <CircleCheck aria-hidden="true" />
              {/* Named for what it does: this records the approval and then
                  carries the action out. "Approve" alone would understate the
                  side effect the operator is authorizing. */}
              {approving ? "Recording…" : "Approve and execute"}
            </Button>
          )}
        </form>

        <form action={rejectAction} className="contents">
          <TicketField id={id} />
          <Button type="submit" variant="outline" disabled={busy}>
            {rejecting ? "Recording…" : "Reject"}
          </Button>
        </form>
      </div>

      <Outcome state={state} />
    </div>
  )
}

/**
 * Approval is on record but the action did not complete. The retry goes through
 * the same approve action, which finds the approval already recorded and carries
 * the action out rather than recording a second authorization.
 */
function RetryExecution({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(approve, null)
  return (
    <div className="space-y-3.5">
      <form action={formAction}>
        <TicketField id={id} />
        <input type="hidden" name="confirmed" value="yes" />
        <Button type="submit" disabled={pending}>
          {pending ? "Carrying out…" : "Carry out the approved action"}
        </Button>
      </form>
      <Outcome state={state} />
    </div>
  )
}

/** Nothing to decide. Says which status the gate accepts, and why not this one. */
function Closed({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
      <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export function DecisionControls({
  id,
  status,
  risk,
  actionSentence,
}: {
  id: string
  status: Status
  risk: Risk | null
  actionSentence: string
}) {
  if (status === "AWAITING_APPROVAL") {
    return <Gate id={id} risk={risk} actionSentence={actionSentence} />
  }
  if (status === "APPROVED") {
    return <RetryExecution id={id} />
  }
  if (status === "EXECUTED") {
    return (
      <Closed>
        Approved by a human and carried out. The audit trail below holds the
        approval this execution required.
      </Closed>
    )
  }
  if (status === "REJECTED") {
    return (
      <Closed>
        Rejected. Nothing was carried out, and a rejected ticket cannot move
        again.
      </Closed>
    )
  }
  return <PipelineControl id={id} status={status} />
}
