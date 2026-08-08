import Link from "next/link"
import {
  ArrowLeft,
  Bot,
  BookText,
  Cog,
  Gavel,
  History,
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
import { ConsoleShell } from "@/components/console-shell"
import { DecisionControls } from "@/components/decision-controls"
import { Notice } from "@/components/notice"
import { Badge } from "@/components/ui/badge"
import { getTicket } from "@/lib/db"
import {
  actionLabel,
  actionSentence,
  formatMoney,
  formatTimestamp,
  tierLabel,
} from "@/lib/format"
import { verifiedEvidence } from "@/lib/types"
import type {
  Actor,
  Policy,
  PriorTicket,
  Ticket,
  TicketEvent,
} from "@/lib/types"
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
  const { analysis } = ticket
  const confidence = ticket.verification?.confidence ?? analysis?.confidence
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

      {/* The AI's one-sentence reading, and the sentence that says what this
          screen is. Above the instruments because an operator should know who
          produced what before they read a single number (CLAUDE.md §1). */}
      {analysis ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="label-xs">AI decision summary</p>
            <ProvenanceBadge
              source={analysis.source}
              model={analysis.model}
              degraded={analysis.degraded}
            />
          </div>
          <p className="text-sm leading-relaxed">{analysis.summary}</p>
          <p className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
            <Bot aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              AI prepared this decision. A human authorizes the action. Nothing
              below has happened yet.
            </span>
          </p>
        </div>
      ) : null}

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
      value: ticket.draft
        ? actionLabel(ticket.draft.proposedAction.type)
        : "none",
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

/**
 * Settled earlier tickets that bear on this one, with the stated reason each was
 * retrieved.
 *
 * Retrieved by exact match on customer and category (lib/evidence.ts), so the
 * basis is a rule an operator can check rather than a similarity score they
 * cannot. The reason is shown on every row for that reason: prior context whose
 * relevance is unexplained is just an adjacent claim.
 */
function RelatedTickets({ related }: { related: PriorTicket[] }) {
  if (related.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No settled earlier ticket matches this customer or this category, so none
        is shown.
      </p>
    )
  }
  return (
    <ul className="divide-y overflow-hidden rounded-md border bg-card">
      {related.map((prior) => (
        <li key={prior.id} className="px-3.5 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
            <Link
              href={`/tickets/${prior.id}`}
              className="focus-ring min-w-0 flex-1 text-[13px] font-medium tracking-tight underline-offset-4 hover:underline"
            >
              {prior.subject}
            </Link>
            <Badge
              variant="outline"
              className="rounded-sm border-border/80 px-1.5 text-[11px] font-normal text-muted-foreground"
            >
              {prior.relation}
            </Badge>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
              {formatTimestamp(prior.created_at)}
            </span>
          </div>
          {/* What actually happened to it. The outcome is the useful part of a
              prior ticket — the decision someone already took on a case like
              this one. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
            <StatusBadge status={prior.status} />
            {prior.outcome ? (
              <span>{actionLabel(prior.outcome)}</span>
            ) : (
              <span>No action was carried out</span>
            )}
            {prior.risk ? <RiskBadge risk={prior.risk} /> : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * The operational rules that apply to this ticket, each with the reference an
 * operator can go and read.
 *
 * These are retrieved from our own reference data by exact match on category and
 * proposed action — never written by a model. A model-authored policy is an
 * invented policy, which is the failure the verifier exists to catch, so the
 * rules the decision is judged against do not come from one.
 */
function PolicyEvidence({ policies }: { policies: Policy[] }) {
  if (policies.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No operational rule is keyed to this category or proposed action.
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {policies.map((policy) => (
        <li key={policy.id} className="rounded-md border bg-card px-3.5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[13px] font-medium tracking-tight">
              {policy.title}
            </p>
            <cite className="font-mono text-[11px] text-muted-foreground not-italic">
              {policy.source_ref}
            </cite>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {policy.body}
          </p>
        </li>
      ))}
    </ul>
  )
}

/**
 * The three actors, as three visibly different things.
 *
 * The distinction is the product: `ai` inferred something, `system` did something
 * mechanical that involved no judgment, `human` authorized something. Only the
 * last of those can move a ticket past the gate, so it is the only one that gets
 * full-contrast treatment in the trail.
 *
 * The label is real text rather than a CSS transform of the enum, so it survives
 * being read aloud and does not silently become "AWAITING_APPROVAL"-style raw
 * vocabulary if the enum ever grows.
 */
const ACTOR_META: Record<
  Actor,
  { label: string; icon: typeof Bot; marker: string; text: string }
> = {
  ai: {
    label: "AI",
    icon: Bot,
    marker: "border-border bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
  system: {
    label: "System",
    icon: Cog,
    marker: "border-border bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
  human: {
    label: "Human",
    icon: User,
    marker: "border-foreground/25 bg-card text-foreground",
    text: "font-medium text-foreground",
  },
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
        const actor = ACTOR_META[event.actor]
        const Icon = actor.icon
        return (
          <li
            key={event.id}
            className="relative flex gap-3 py-2 pl-0 first:pt-0 last:pb-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 mt-0.5 flex size-5.5 shrink-0 items-center justify-center rounded-full border",
                actor.marker
              )}
            >
              <Icon className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span
                  className={cn(
                    "font-mono text-[11px] tracking-wide uppercase",
                    actor.text
                  )}
                >
                  <span className="sr-only">Actor: </span>
                  {actor.label}
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
    // No ticket loaded, so the trail is given no status to reflect rather than a
    // guessed one.
    return (
      <ConsoleShell>
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
      </ConsoleShell>
    )
  }

  const { ticket, events, policies, related } = result.data
  const { analysis, draft, verification } = ticket
  const evidence = analysis ? verifiedEvidence(analysis.evidence, ticket.body) : []
  const atGate = ticket.status === "AWAITING_APPROVAL"
  const blocked = verification ? !verification.safeToSend : false

  return (
    // The one surface with an open ticket, so the sidebar trail gets its status
    // and stops asserting a position it cannot know.
    <ConsoleShell activeStatus={ticket.status}>
    <div className="mx-auto max-w-3xl space-y-8 px-5 py-6 lg:px-8 lg:py-8">
      <Header ticket={ticket} />

      {/* 1 — what am I being asked to authorize */}
      <Section
        title="Proposed action"
        step="01"
        provenance={
          draft ? (
            <ProvenanceBadge
              source={draft.source}
              model={draft.model}
              degraded={draft.degraded}
            />
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
                  {draft.proposedAction.type}
                </Badge>
                <p className="min-w-0 flex-1 text-[15px] leading-snug font-medium tracking-tight text-balance">
                  {actionSentence(
                    draft.proposedAction.type,
                    draft.proposedAction.params
                  )}
                </p>
              </div>
              <p className="mt-2.5 border-t pt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                {draft.proposedAction.rationale}
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
            <ProvenanceBadge
              source={draft.source}
              model={draft.model}
              degraded={draft.degraded}
            />
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
                {draft.proposedResponse}
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
        title="Evidence and decision factors"
        step="03"
        provenance={
          analysis ? (
            <ProvenanceBadge
              source={analysis.source}
              model={analysis.model}
              degraded={analysis.degraded}
            />
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
                <p className="label-xs">Decision factors</p>
                {/* One claim per line: the schema asks the analyzer for separate
                    claims, so running them together as prose would discard the
                    structure it was told to produce. Findings, not deliberation
                    — the prompt asks for what drove the classification, and no
                    train of thought is shown here. */}
                <ul className="space-y-1.5">
                  {analysis.reasoning.map((claim) => (
                    <li
                      key={claim}
                      className="text-[13px] leading-relaxed text-muted-foreground before:mr-2 before:text-muted-foreground/60 before:content-['—']"
                    >
                      {claim}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <NotYet>This ticket has not been analyzed.</NotYet>
          )}

          {/* Retrieved evidence, outside the analysis conditional on purpose: a
              ticket with no analysis still has a customer history and is still
              subject to the general rules, and both are worth seeing before the
              pipeline has run. */}
          <div className="space-y-2">
            <p className="label-xs flex items-center gap-1.5">
              <History aria-hidden="true" className="size-3.5" />
              Previous tickets
            </p>
            <RelatedTickets related={related} />
            <p className="text-xs text-muted-foreground">
              Settled tickets that share this customer or this category, matched
              on those fields and ordered by recency. Not a similarity score.
            </p>
          </div>

          <div className="space-y-2">
            <p className="label-xs flex items-center gap-1.5">
              <BookText aria-hidden="true" className="size-3.5" />
              Operational rules that apply
            </p>
            <PolicyEvidence policies={policies} />
            <p className="text-xs text-muted-foreground">
              Reference text from our own records, selected by category and
              proposed action. Not written by a model.
            </p>
          </div>
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
              degraded={verification.degraded}
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
              {verification.verificationSummary}
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
            className={cn(
              "text-[13px] leading-relaxed",
              atGate ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {atGate
              ? "Nothing has happened yet. Everything above is a recommendation until it is approved here."
              : `The gate accepts a decision only at ${statusLabel(
                  "AWAITING_APPROVAL"
                )}, and the server re-reads this ticket's status and re-checks the transition on every write.`}
          </p>

          {/* A stage that failed. Stated here rather than inferred from a missing
              section, and it does not pretend the workflow moved on. */}
          {ticket.pipeline_error ? (
            <div
              role="alert"
              className="space-y-1.5 rounded-sm border border-danger/25 bg-danger/[0.04] px-3.5 py-3"
            >
              <p className="flex items-center gap-2 text-[13px] font-medium tracking-tight">
                <TriangleAlert
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-danger"
                />
                The {ticket.pipeline_error.stage} stage failed
              </p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {ticket.pipeline_error.message}
              </p>
              <p className="text-xs text-muted-foreground">
                The ticket was left at {statusLabel(ticket.status)} and nothing
                was carried out. Running the stages again retries from there.
              </p>
            </div>
          ) : null}

          <DecisionControls
            id={ticket.id}
            status={ticket.status}
            risk={ticket.risk}
            actionSentence={
              draft
                ? actionSentence(
                    draft.proposedAction.type,
                    draft.proposedAction.params
                  )
                : "No action has been proposed."
            }
          />

          <p className="flex items-start gap-2.5 border-t pt-3.5 text-xs leading-relaxed text-muted-foreground">
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Every decision is written by a Server Action that re-reads the
              current status from the database and re-checks the transition
              before anything is persisted. Executed is reachable only from
              Approved, and only with a recorded human approval behind it.
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
    </ConsoleShell>
  )
}
