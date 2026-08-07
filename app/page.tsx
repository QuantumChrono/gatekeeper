import Link from "next/link"
import { ChevronRight } from "lucide-react"

import {
  CategoryLabel,
  RiskBadge,
  SeverityIndicator,
  StatusBadge,
} from "@/components/badges"
import { Notice } from "@/components/notice"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getTickets } from "@/lib/db"
import { formatAge, tierLabel } from "@/lib/format"
import { TERMINAL } from "@/lib/types"
import type { Status, Ticket } from "@/lib/types"
import { cn } from "@/lib/utils"

// The queue. One table, densest useful form, rows link to the decision.

/** Only the counts that change what an operator works on next (PRD F-1). */
function QueueSummary({ tickets }: { tickets: Ticket[] }) {
  const waiting = tickets.filter((t) => t.status === "AWAITING_APPROVAL").length
  const inProgress = tickets.filter(
    (t) => !TERMINAL.includes(t.status) && t.status !== "AWAITING_APPROVAL"
  ).length
  const closed = tickets.filter((t) => TERMINAL.includes(t.status)).length

  const items = [
    { label: "Awaiting approval", value: waiting, accent: true },
    { label: "In progress", value: inProgress, accent: false },
    { label: "Closed", value: closed, accent: false },
  ]

  // An instrument cluster, not three cards: one surface, hairline dividers. The
  // only readout that changes an operator's next action is the only one that
  // takes colour, and it takes it only when it is non-zero.
  return (
    <dl className="grid grid-cols-3 divide-x rounded-md border bg-card shadow-xs">
      {items.map(({ label, value, accent }) => (
        <div key={label} className="min-w-0 px-4 py-3">
          <dt className="label-xs truncate">{label}</dt>
          <dd
            className={cn(
              "mt-1 font-mono text-2xl leading-none font-medium tabular-nums",
              accent && value > 0 ? "text-warning" : "text-foreground"
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const FILTERS: { label: string; status?: Status }[] = [
  { label: "All" },
  { label: "Awaiting approval", status: "AWAITING_APPROVAL" },
  { label: "Drafted", status: "DRAFTED" },
  { label: "Executed", status: "EXECUTED" },
]

/** Real links, so the filter is deep-linkable and survives a reload. */
function StatusFilter({ active }: { active?: string }) {
  return (
    <nav
      aria-label="Filter by status"
      className="flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/40 p-0.5"
    >
      {FILTERS.map(({ label, status }) => {
        const isActive = active === status || (!active && !status)
        return (
          <Link
            key={label}
            href={status ? `/?status=${status}` : "/"}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "focus-ring rounded-sm px-2.5 py-1 text-[13px] transition-colors",
              isActive
                ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Column headings are labels, not content: same micro-type as everywhere else. */
function Th({
  children,
  className,
  srOnly,
}: {
  children: React.ReactNode
  className?: string
  srOnly?: boolean
}) {
  return (
    <TableHead className={cn("h-9 px-3", className)}>
      <span className={cn(srOnly ? "sr-only" : "label-xs")}>{children}</span>
    </TableHead>
  )
}

/** A value the workflow has not produced yet. Reads as absent, not as zero. */
function Pending({ children }: { children: string }) {
  return (
    <span className="font-mono text-xs text-muted-foreground/70">
      <span aria-hidden="true">&mdash;</span>
      <span className="sr-only">{children}</span>
    </span>
  )
}

export default async function QueuePage(props: PageProps<"/">) {
  const { status } = await props.searchParams
  const active = typeof status === "string" ? status : undefined
  const result = await getTickets()

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-6 lg:px-8 lg:py-8">
        <h1 className="mb-6 text-base font-semibold tracking-tight">
          Ticket queue
        </h1>
        <Notice tone="error" title="The queue could not be loaded">
          {result.message}
        </Notice>
      </div>
    )
  }

  const all = result.data
  const tickets = active ? all.filter((t) => t.status === active) : all

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
        <div className="max-w-xl space-y-1.5">
          <h1 className="text-base font-semibold tracking-tight text-balance">
            Ticket queue
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Each ticket is somewhere in a fixed workflow. Tickets awaiting
            approval need a human decision before anything is carried out.
          </p>
        </div>
        <div className="lg:w-[26rem] lg:shrink-0">
          <QueueSummary tickets={all} />
        </div>
      </header>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <StatusFilter active={active} />
        <p
          aria-live="polite"
          className="font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          {tickets.length} of {all.length} {all.length === 1 ? "ticket" : "tickets"}
        </p>
      </div>

      <div className="mt-3">
        {tickets.length === 0 ? (
          <Notice
            title={
              active ? "No tickets in this status" : "No tickets in the queue"
            }
          >
            {active
              ? "Clear the filter to see the rest of the queue."
              : "Apply supabase/migrations/001_initial_schema.sql to seed the demo tickets."}
          </Notice>
        ) : (
          <div className="overflow-hidden rounded-md border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="border-b bg-muted/50 hover:bg-muted/50">
                  <Th>Subject</Th>
                  <Th>Customer</Th>
                  <Th>Category</Th>
                  <Th>Severity</Th>
                  <Th>Status</Th>
                  <Th>Risk</Th>
                  <Th className="text-right">Age</Th>
                  <Th className="w-9" srOnly>
                    Open
                  </Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => {
                  const atGate = ticket.status === "AWAITING_APPROVAL"
                  return (
                    <TableRow
                      key={ticket.id}
                      className={cn(
                        // A left rail marks the rows that need a human. It reads
                        // as a margin mark rather than a highlight, so a queue of
                        // them still scans as one table.
                        "group border-l-2 transition-colors",
                        "has-[a:focus-visible]:bg-muted/60",
                        atGate
                          ? "border-l-warning bg-warning/[0.045] hover:bg-warning/[0.075]"
                          : "border-l-transparent"
                      )}
                    >
                      <TableCell className="max-w-[22rem] px-3 py-2.5 whitespace-normal">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="focus-ring font-medium tracking-tight underline-offset-4 group-hover:underline"
                        >
                          {ticket.subject}
                        </Link>
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <span className="block truncate">
                          {ticket.customer_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {tierLabel(ticket.customer_tier)}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        {ticket.analysis ? (
                          <CategoryLabel category={ticket.analysis.category} />
                        ) : (
                          <Pending>Not analyzed</Pending>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        {ticket.analysis ? (
                          <SeverityIndicator
                            severity={ticket.analysis.severity}
                          />
                        ) : (
                          <Pending>Not analyzed</Pending>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <StatusBadge status={ticket.status} />
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        {ticket.risk ? (
                          <RiskBadge risk={ticket.risk} />
                        ) : (
                          <Pending>
                            Not computed until verification has run
                          </Pending>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {formatAge(ticket.created_at)}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
