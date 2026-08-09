"use client"

import { useActionState } from "react"
import { CircleAlert, CircleCheck, Send } from "lucide-react"

import { submitFollowUp, type ActionState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// A customer message arriving after the ticket was opened. One component for both
// places it can be sent from — the operator's detail view and the customer portal
// — because they must go through the identical Server Action against the identical
// guarded path. Two forms would be two intake rules, and the whole point of this
// path is that a message cannot move the state machine whichever door it enters
// through.
//
// A client component only because a send needs in-flight state and a result.
// Nothing here judges the message or moves anything: the action records it, and
// the conflict check that follows can at most send the decision back to a human.

export function FollowUpForm({
  /** Fixed on the detail view, typed by the customer on the portal. */
  ticketId,
  /**
   * The operator's copy is a demo control and says so. Labeling it is not
   * decoration — the message it sends is real and lands on the real audit trail,
   * so the only thing being simulated is the customer sending it, and that is
   * exactly what the label has to say (CLAUDE.md §1).
   */
  simulated = false,
}: {
  ticketId?: string
  simulated?: boolean
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    submitFollowUp,
    null
  )

  return (
    <form action={formAction} className="space-y-3">
      {ticketId ? (
        <input type="hidden" name="ticketId" value={ticketId} />
      ) : (
        <div className="space-y-1.5">
          <label
            htmlFor="followup-ticket"
            className="block text-sm font-medium text-foreground"
          >
            Your ticket reference
          </label>
          <Input
            id="followup-ticket"
            name="ticketId"
            required
            disabled={pending}
            placeholder="The reference we gave you when you submitted"
            aria-describedby="followup-ticket-hint"
            className="font-mono text-[13px]"
          />
          <p id="followup-ticket-hint" className="text-xs text-muted-foreground">
            Paste the reference from your original submission.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label
          htmlFor="followup-message"
          className={cn(
            "block font-medium text-foreground",
            simulated ? "label-xs" : "text-sm"
          )}
        >
          {simulated ? "Message from the customer" : "Your message"}
        </label>
        <Textarea
          id="followup-message"
          name="message"
          required
          rows={simulated ? 3 : 5}
          maxLength={4000}
          disabled={pending}
          placeholder={
            simulated
              ? "A reply, a correction, or something that changes the request."
              : "Tell us what has changed."
          }
          className={cn("resize-y", simulated && "text-[13px]")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={pending}
          variant={simulated ? "outline" : "default"}
          size={simulated ? "sm" : "lg"}
          className={simulated ? undefined : "w-full"}
        >
          <Send aria-hidden="true" />
          {pending ? "Sending…" : simulated ? "Send as customer" : "Send message"}
        </Button>
      </div>

      {/* Always mounted so the result is announced and the panel does not shift
          when one lands. */}
      <div aria-live="polite">
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
              <span className="sr-only">{state.ok ? "Sent: " : "Failed: "}</span>
              {state.message}
            </span>
          </p>
        ) : null}
      </div>
    </form>
  )
}
