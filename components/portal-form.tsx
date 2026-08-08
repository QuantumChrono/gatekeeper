"use client"

import { useActionState } from "react"
import { CheckCircle2, ChevronDown, CircleAlert } from "lucide-react"

import { submitTicket, type SubmissionState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// The customer's side of the product. A client component because a submission
// needs in-flight state and a success view; the write itself is a Server Action
// that validates every field before a database or a model sees it.
//
// Deliberately not built from the console's vocabulary: no status chips, no
// provenance badges, no risk bands. A customer is not an operator, and showing
// them the machinery would be showing them a decision that has not been made.

const TIERS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
] as const

/** Field label, control, and its error, wired together for assistive tech. */
function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-foreground"
      >
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {/* Reserved rather than conditional at the container level, so a message
          appearing does not push the rest of the form down. */}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          className="flex items-start gap-1.5 text-xs leading-relaxed text-danger"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * What the customer sees once the ticket is on record.
 *
 * It says what has happened and what has not. The AI stages run behind this
 * response, so promising a reply time or implying the request has been assessed
 * would be describing work that has not finished — and the outcome is a human's
 * to decide either way (CLAUDE.md §1).
 */
function Submitted({ reference }: { reference: string }) {
  return (
    <div className="space-y-5 text-center">
      <span
        aria-hidden="true"
        className="mx-auto flex size-11 items-center justify-center rounded-full bg-success/10 text-success ring-1 ring-success/25"
      >
        <CheckCircle2 className="size-5" />
      </span>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Ticket submitted successfully
        </h2>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          We have your request and our support team is reviewing it. A person
          decides what happens next, so nothing has been actioned automatically.
        </p>
      </div>

      <div className="space-y-1.5 rounded-lg border bg-muted/30 px-4 py-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Your reference
        </p>
        <p className="font-mono text-[13px] break-all text-foreground">
          {reference}
        </p>
      </div>

      {/* A real reload, so the second ticket starts from a clean form and a
          clean action state rather than from cleared fields. */}
      <Button variant="outline" onClick={() => window.location.reload()}>
        Submit another ticket
      </Button>
    </div>
  )
}

export function PortalForm() {
  const [state, formAction, pending] = useActionState<SubmissionState, FormData>(
    submitTicket,
    null
  )

  const errors = state && !state.ok ? state.errors : undefined
  /** Shared by every control: the token treatment the app's Input already uses. */
  const controlError =
    "border-danger/60 focus-visible:border-danger focus-visible:ring-danger/25"

  if (state?.ok) {
    // Announced, because the form it replaces was the thing being interacted with.
    return (
      <div aria-live="polite">
        <Submitted reference={state.reference} />
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-5">
      {/* The form-level failure. Always mounted so its announcement is picked up
          and the layout does not jump when one lands. */}
      <div aria-live="polite">
        {state && !state.ok ? (
          <p
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/[0.04] px-3.5 py-3 text-[13px] leading-relaxed"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-danger"
            />
            <span className="min-w-0">{state.message}</span>
          </p>
        ) : null}
      </div>

      <Field label="Your name" htmlFor="customer_name" error={errors?.customer_name}>
        <Input
          id="customer_name"
          name="customer_name"
          required
          maxLength={120}
          autoComplete="name"
          disabled={pending}
          aria-invalid={errors?.customer_name ? true : undefined}
          aria-describedby={
            errors?.customer_name ? "customer_name-error" : undefined
          }
          className={cn(errors?.customer_name && controlError)}
        />
      </Field>

      <Field
        label="Your plan"
        htmlFor="customer_tier"
        error={errors?.customer_tier}
      >
        {/* The platform's own control rather than a custom listbox: it is
            keyboard and screen-reader correct for free, uses the native picker on
            a phone, and adds nothing to the bundle. Styled to the same tokens as
            Input so it does not read as an unstyled outlier.

            ponytail: the tier is self-declared here, and it feeds computeRisk —
            a customer choosing Enterprise adds a risk point to their own ticket.
            Harmless in one direction (it raises scrutiny, never lowers the gate)
            and there is no account record to read it from in this app. Read it
            from the customer's account, not the form, once one exists. */}
        <div className="relative">
          <select
            id="customer_tier"
            name="customer_tier"
            defaultValue="free"
            required
            disabled={pending}
            aria-invalid={errors?.customer_tier ? true : undefined}
            aria-describedby={
              errors?.customer_tier ? "customer_tier-error" : undefined
            }
            className={cn(
              "h-9 w-full appearance-none rounded-md border border-input bg-transparent py-1 pr-9 pl-2.5 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
              errors?.customer_tier && controlError
            )}
          >
            {TIERS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </Field>

      <Field label="Subject" htmlFor="subject" error={errors?.subject}>
        <Input
          id="subject"
          name="subject"
          required
          maxLength={200}
          disabled={pending}
          aria-invalid={errors?.subject ? true : undefined}
          aria-describedby={errors?.subject ? "subject-error" : undefined}
          className={cn(errors?.subject && controlError)}
        />
      </Field>

      <Field
        label="How can we help?"
        htmlFor="body"
        error={errors?.body}
        hint="Include any detail that would help us understand the problem."
      >
        <Textarea
          id="body"
          name="body"
          required
          rows={7}
          maxLength={4000}
          disabled={pending}
          aria-invalid={errors?.body ? true : undefined}
          aria-describedby={errors?.body ? "body-error" : "body-hint"}
          className={cn("min-h-32 resize-y", errors?.body && controlError)}
        />
      </Field>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Submitting…" : "Submit ticket"}
      </Button>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Your request is reviewed by a person before any action is taken.
      </p>
    </form>
  )
}
