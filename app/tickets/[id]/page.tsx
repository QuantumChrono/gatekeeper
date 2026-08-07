import Link from "next/link"
import {
  ArrowLeft,
  Bot,
  Gavel,
  Lock,
  Quote,
  TriangleAlert,
  User,
} from "lucide-react"

import {
  CategoryLabel,
  ConfidenceValue,
  ProvenanceBadge,
  RiskBadge,
  SeverityIndicator,
  StatusBadge,
  VerdictBadge,
  WorkflowProgress,
  statusLabel,
} from "@/components/badges"
import { Notice } from "@/components/notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getTicket } from "@/lib/db"
import {
  actionLabel,
  actionSentence,
  formatMoney,
  formatTimestamp,
  tierLabel,
} from "@/lib/format"
import { verifiedEvidence } from "@/lib/types"
import type { Ticket, TicketEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

// The decision detail. Section order is fixed by CLAUDE.md §6 and does not
// change: header → proposed action → proposed response → evidence and reasoning
// → verification → approval gate → audit trail.

/** Every section reads the same: a numbered heading, provenance on the right. */
function Section({
  title,
  step,
  provenance,
  children,
  className,
}: {
  title: string
  step: string
  provenance?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("scroll-mt-6", className)} aria-labelledby={step}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-2">
        <h2
          id={step}
          className="flex items-baseline gap-2.5 text-sm font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="font-mono text-[11px] font-normal text-muted-foreground/70 tabular-nums"
          >
            {step}
          </span>
          {title}
        </h2>
        {provenance}
      </div>
      <div className="pt-3.5">{children}</div>
    </section>
  )
}

/** Shown where an AI stage has not run. States the fact, promises nothing. */
function NotYet({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed bg-muted/25 px-3.5 py-3 text-sm leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

/** One readout in the header strip. Label above value, aligned to a grid. */
function Readout({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1.5 px-4 py-3">
      <p className="label-xs truncate">{label}</p>
      <div className="flex min-h-5 items-center">{children}</div>
    </div>
  )
}

function Unset({ children }: { children: string }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function Header({ ticket }: { ticket: Ticket }) {
  const confidence = ticket.verification?.confidence ?? ticket.analysis?.confidence
  return (
    <header className="space-y-5">
      <Link
        href="/"
        className="focus-ring group/back inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft
          aria-hidden="true"
          className="size-3.5 transition-transform group-hover/back:-translate-x-0.5"
        />
        Queue
      </Link>

      <div className="space-y-2.5">
        <h1 className="text-xl leading-snug font-semibold tracking-tight text-balance">
          {ticket.subject}
        </h1>
        {/* Facts about the ticket itself, separated by hairlines rather than
            middots so the row reads as fields, not a sentence. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {ticket.customer_name}
          </span>
          <span aria-hidden="true" className="h-3 w-px bg-border" />
          <span>{tierLabel(ticket.customer_tier)}</span>
          {ticket.order_value_cents > 0 ? (
            <>
              <span aria-hidden="true" className="h-3 w-px bg-border" />
              <span className="tabular-nums">
                Order{" "}
                <span className="font-mono text-foreground">
                  {formatMoney(ticket.order_value_cents)}
                </span>
              </span>
            </>
          ) : null}
          <span aria-hidden="true" className="h-3 w-px bg-border" />
          <span className="tabular-nums">
            Opened {formatTimestamp(ticket.created_at)}
          </span>
        </div>
      </div>

      {/* The instrument strip: the four values that decide whether this needs a
          human, on one surface, in fixed positions. */}
      <div className="overflow-hidden rounded-md border bg-card shadow-xs">
        <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          <Readout label="Status">
            <StatusBadge status={ticket.status} />
          </Readout>
          <Readout label="Risk">
            {ticket.risk ? (
              <RiskBadge risk={ticket.risk} />
            ) : (
              <Unset>Computed after verification</Unset>
            )}
          </Readout>
          <Readout label="Confidence">
            {confidence === undefined ? (
              <Unset>Not yet assessed</Unset>
            ) : (
              <ConfidenceValue value={confidence} />
            )}
          </Readout>
          <Readout label="Severity">
            {ticket.analysis ? (
              <SeverityIndicator severity={ticket.analysis.severity} />
            ) : (
              <Unset>Not yet classified</Unset>
            )}
          </Readout>
        </div>
        <div className="border-t bg-muted/30 px-4 py-2.5">
          <WorkflowProgress status={ticket.status} />
        </div>
      </div>
    </header>
  )
}

/**
 * The risk inputs, named. Risk itself is computed in code from these four
 * values, so listing them is what keeps a HIGH from being unexplained
 * (AC-7). The arithmetic lands with computeRisk(); these are its inputs as
 * they stand on this ticket.
 */
function RiskFactors({ ticket }: { ticket: Ticket }) {
  if (!ticket.risk) return null
  const factors = [
    { label: "Severity", value: ticket.analysis?.severity ?? "unknown" },
    {
      label: "Action",
      value: ticket.draft ? actionLabel(ticket.draft.action.type) : "none",
    },
    { label: "Customer tier", value: tierLabel(ticket.customer_tier) },
    {
      label: "Safe to send",
      value: ticket.verification
        ? ticket.verification.safeToSend
          ? "yes"
          : "no"
        : "unchecked",
    },
  ]
  return (
    <div className="rounded-md border bg-muted/25 px-3.5 py-3">
      <p className="label-xs">Risk computed from</p>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        {factors.map(({ label, value }) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tracking-tight">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function AuditTrail({ events }: { events: TicketEvent[] }) {
  if (events.length === 0) {
    return <NotYet>No transitions yet. The first will be recorded here.</NotYet>
  }
  return (
    <ol className="relative">
      {/* One spine down the actor markers: the trail is a sequence, and a human
          link in it should be visible without reading every row. */}
      <span
        aria-hidden="true"
        className="absolute top-3 bottom-3 left-[0.6875rem] w-px bg-border"
      />
      {events.map((event) => {
        const isHuman = event.actor === "human"
        const Icon = isHuman ? User : Bot
        return (
          <li
            key={event.id}
            className="relative flex gap-3 py-2 pl-0 first:pt-0 last:pb-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 mt-0.5 flex size-5.5 shrink-0 items-center justify-center rounded-full border",
                isHuman
                  ? "border-foreground/25 bg-card text-foreground"
                  : "border-border bg-muted text-muted-foreground"
              )}
            >
              <Icon className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span
                  className={cn(
                    "font-mono text-[11px] tracking-wide uppercase",
                    isHuman
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <span className="sr-only">Actor: </span>
                  {event.actor}
                </span>
                <span className="text-[13px]">
                  {event.from_status ? (
                    <>
                      <span className="text-muted-foreground">
                        {statusLabel(event.from_status)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="px-1 text-muted-foreground/60"
                      >
                        →
                      </span>
                      <span className="sr-only"> to </span>
                    </>
                  ) : null}
                  <span className="font-medium tracking-tight">
                    {statusLabel(event.to_status)}
                  </span>
                </span>
                {event.source ? (
                  <ProvenanceBadge
                    source={event.source}
                    model={event.model ?? undefined}
                  />
                ) : null}
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {formatTimestamp(event.created_at)}
                </span>
              </div>
              {event.reason ? (
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {event.reason}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default async function TicketPage(props: PageProps<"/tickets/[id]">) {
  const { id } = await props.params
  const result = await getTicket(id)

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-6 lg:px-8 lg:py-8">
        <Link
          href="/"
          className="focus-ring mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Queue
        </Link>
        <Notice tone="error" title="This ticket could not be loaded">
          {result.message}
        </Notice>
      </div>
    )
  }

  const { ticket, events } = result.data
  const { analysis, draft, verification } = ticket
  const evidence = analysis ? verifiedEvidence(analysis.evidence, ticket.body) : []
  const atGate = ticket.status === "AWAITING_APPROVAL"
  const blocked = verification ? !verification.safeToSend : false

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-5 py-6 lg:px-8 lg:py-8">
      <Header ticket={ticket} />

      {/* 1 — what am I being asked to authorize */}
      <Section
        title="Proposed action"
        step="01"
        provenance={
          draft ? (
            <ProvenanceBadge source={draft.source} model={draft.model} />
          ) : undefined
        }
      >
        {draft ? (
          <div className="space-y-3">
            {/* The single most important sentence on the page, so it gets the
                only raised surface above the gate itself. */}
            <div className="rounded-md border bg-card px-4 py-3.5 shadow-xs">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                <Badge
                  variant="outline"
                  className="rounded-sm border-border/80 px-1.5 font-mono text-[11px] tracking-wide"
                >
                  {draft.action.type}
                </Badge>
                <p className="min-w-0 flex-1 text-[15px] leading-snug font-medium tracking-tight text-balance">
                  {actionSentence(draft.action.type, draft.action.params)}
                </p>
              </div>
              <p className="mt-2.5 border-t pt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                {draft.rationale}
              </p>
            </div>
            <RiskFactors ticket={ticket} />
          </div>
        ) : (
          <NotYet>
            No action has been proposed. Drafting runs after analysis.
          </NotYet>
        )}
      </Section>

      {/* 2 — the exact text a customer would receive */}
      <Section
        title="Proposed response"
        step="02"
        provenance={
          draft ? (
            <ProvenanceBadge source={draft.source} model={draft.model} />
          ) : undefined
        }
      >
        {draft ? (
          <figure className="space-y-2">
            {/* Machine-written text carries a left rail; the customer's own words
                in section 03 do not. Two kinds of quoted text on one page need
                to be distinguishable at a glance. */}
            <blockquote className="rounded-md rounded-l-none border border-l-2 border-l-foreground/25 bg-muted/30 px-4 py-3.5">
              {/* Plain text, never HTML — the draft quotes untrusted ticket content. */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {draft.response}
              </p>
            </blockquote>
            <figcaption className="text-xs text-muted-foreground">
              Drafted text. Nothing is sent until this is approved.
            </figcaption>
          </figure>
        ) : (
          <NotYet>No response has been drafted.</NotYet>
        )}
      </Section>

      {/* 3 — the source, and what the classification rests on */}
      <Section
        title="Evidence and reasoning"
        step="03"
        provenance={
          analysis ? (
            <ProvenanceBadge source={analysis.source} model={analysis.model} />
          ) : undefined
        }
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="label-xs">Customer message</p>
            {/* Untrusted input, rendered as text. Held on the page background
                rather than a panel so it reads as the raw source material. */}
            <div className="rounded-md border border-dashed px-4 py-3.5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {ticket.body}
              </p>
            </div>
          </div>

          {analysis ? (
            <>
              <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>
                    <CategoryLabel category={analysis.category} />
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-muted-foreground">Routed to</dt>
                  <dd className="font-mono text-xs">{analysis.routing}</dd>
                </div>
              </dl>

              <div className="space-y-2">
                <p className="label-xs">Evidence from the ticket</p>
                {evidence.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No quote could be matched against the ticket body, so none is
                    shown.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {evidence.map((quote) => (
                      <li
                        key={quote}
                        className="flex gap-2.5 border-l-2 border-l-border py-0.5 pl-3 text-[13px] leading-relaxed text-muted-foreground"
                      >
                        <Quote
                          aria-hidden="true"
                          className="mt-1 size-3 shrink-0 text-muted-foreground/60"
                        />
                        <span className="min-w-0">{quote}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Each quote is matched against the message above before it is
                  shown.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="label-xs">Reasoning</p>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {analysis.reasoning}
                </p>
              </div>
            </>
          ) : (
            <NotYet>This ticket has not been analyzed.</NotYet>
          )}
        </div>
      </Section>

      {/* 4 — where the system doubts itself */}
      <Section
        title="Verification"
        step="04"
        provenance={
          verification ? (
            <ProvenanceBadge
              source={verification.source}
              model={verification.model}
            />
          ) : undefined
        }
      >
        {verification ? (
          <div
            className={cn(
              "space-y-3.5 rounded-md border px-4 py-3.5",
              // A disagreeing verifier must change the page, not just a word in it.
              blocked ? "border-danger/30 bg-danger/[0.035]" : "bg-card shadow-xs"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <VerdictBadge safeToSend={verification.safeToSend} />
              <div className="flex items-center gap-2.5">
                <span className="label-xs">Confidence</span>
                <ConfidenceValue value={verification.confidence} />
              </div>
            </div>

            {verification.issues.length > 0 ? (
              <div className="space-y-2">
                <p className="label-xs">
                  {verification.issues.length}{" "}
                  {verification.issues.length === 1 ? "issue" : "issues"} raised
                </p>
                <ul className="space-y-1.5">
                  {verification.issues.map((issue) => (
                    <li
                      key={issue}
                      className="flex gap-2.5 rounded-sm border border-danger/20 bg-card px-3 py-2.5 text-[13px] leading-relaxed"
                    >
                      <TriangleAlert
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-danger"
                      />
                      <span className="min-w-0">{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                The verifier raised no issues.
              </p>
            )}

            <p className="border-t pt-3 text-[13px] leading-relaxed text-muted-foreground">
              {verification.notes}
            </p>
          </div>
        ) : (
          <NotYet>
            The draft has not been verified. Verification checks the draft
            against the ticket independently.
          </NotYet>
        )}
      </Section>

      {/* 5 — the gate. The only place a decision is made. */}
      <section
        aria-labelledby="gate"
        className={cn(
          "overflow-hidden rounded-md border",
          atGate
            ? "border-warning/45 bg-warning/[0.05] shadow-sm"
            : "bg-muted/25"
        )}
      >
        {/* A titlebar rather than a heading in the body: the gate is the one
            section that should read as a distinct instrument on the page. */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-3",
            atGate ? "border-warning/30 bg-warning/[0.06]" : "bg-muted/40"
          )}
        >
          <h2
            id="gate"
            className={cn(
              "flex items-center gap-2 text-sm font-semibold tracking-tight",
              atGate && "text-warning"
            )}
          >
            <Gavel aria-hidden="true" className="size-4" />
            Approval gate
          </h2>
          {ticket.risk ? <RiskBadge risk={ticket.risk} /> : null}
        </div>

        <div className="space-y-4 px-5 py-4">
          <p
            aria-live="polite"
            className={cn(
              "text-[13px] leading-relaxed",
              atGate ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {atGate
              ? "Nothing has happened yet. Everything above is a recommendation until it is approved here."
              : `This ticket is not awaiting a decision. The gate accepts a decision only at ${statusLabel(
                  "AWAITING_APPROVAL"
                )}, and the server re-checks that on every write.`}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button disabled aria-describedby="gate-pending">
              Approve
            </Button>
            <Button variant="outline" disabled aria-describedby="gate-pending">
              Reject
            </Button>
          </div>

          {/* Honest about being unbuilt: disabled, and it says why. A live-looking
              button that writes nothing would make the gate a lie. */}
          <p
            id="gate-pending"
            className="flex items-start gap-2.5 border-t pt-3.5 text-xs leading-relaxed text-muted-foreground"
          >
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Not yet wired. Approving and rejecting land with the Server Actions
              that re-read status from the database and record the decision, so
              these controls stay disabled until a decision can actually be
              written.
            </span>
          </p>
        </div>
      </section>

      {/* 6 — who authorized what */}
      <Section title="Audit trail" step="05">
        <div className="space-y-3.5">
          <AuditTrail events={events} />
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Append-only, enforced by a database trigger. No row here can be
            edited or deleted.
          </p>
        </div>
      </Section>

      {ticket.execution_result ? (
        <Section title="Execution result" step="06">
          <div className="space-y-2 rounded-md border bg-card px-4 py-3.5 shadow-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm font-medium tracking-tight">
                {actionLabel(ticket.execution_result.action)}
              </span>
              {ticket.execution_result.simulated ? (
                <Badge
                  variant="outline"
                  className="rounded-sm border-border/80 px-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase"
                >
                  Simulated
                </Badge>
              ) : null}
              <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                {formatTimestamp(ticket.execution_result.executedAt)}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {ticket.execution_result.detail}
            </p>
          </div>
        </Section>
      ) : null}

      <p className="border-t pt-4 pb-2 text-xs text-muted-foreground">
        Executed is reachable only from Approved, re-validated server-side on
        every call.
      </p>
    </div>
  )
}
