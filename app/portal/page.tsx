import type { Metadata } from "next"
import Link from "next/link"
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  Gavel,
  Headset,
  LifeBuoy,
  MessagesSquare,
  Search,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react"

import { FollowUpForm } from "@/components/follow-up-form"
import { Notice } from "@/components/notice"
import { PortalForm } from "@/components/portal-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getCustomerTicket, type CustomerTicket } from "@/lib/db"
import { formatTimestamp } from "@/lib/format"
import type { Status } from "@/lib/types"
import { cn } from "@/lib/utils"

// The customer-facing surface, and the only route that is not part of the
// operator console. It renders no ConsoleShell on purpose: a customer has no
// queue, no workflow trail and no gate, and inheriting that chrome would show
// them the machinery of a decision nobody has taken yet.
//
// This is a third route against the two-surface rule in CLAUDE.md §6, and it is
// the customer intake explicitly named out of scope in §4. Built at the user's
// direction, which is recorded here rather than left for someone to rediscover.
// It is unauthenticated, like the console — the app has no user table — so the
// submission action validates and bounds every field it accepts.
//
// Two tasks, one route, and which one is primary depends on whether a reference
// was looked up: with no reference this is an intake form, with one it is that
// customer's thread. The lookup is a plain GET form, so the thread is a real URL
// a customer can bookmark and the page needs no client state to remember which
// ticket is open.

export const metadata: Metadata = {
  title: "Contact support",
  description: "Submit a support request or check on an existing one.",
}

/**
 * The workflow's eight statuses in a customer's words.
 *
 * A separate vocabulary from `statusLabel` in components/badges.tsx, and
 * deliberately not shared with it: that one names the stage of an internal
 * decision for the operator taking it, and this one says what a customer is
 * waiting for. The two would drift into each other if one map served both.
 *
 * The raw status travels alongside the sentence because a customer quoting it
 * back to us should be quoting the same word the console shows.
 */
const CUSTOMER_STATUS: Record<
  Status,
  { label: string; blurb: string; tone: string; Icon: typeof Clock }
> = {
  RECEIVED: {
    label: "Received",
    blurb: "We have your request and it is queued for someone to look at.",
    tone: "text-muted-foreground",
    Icon: CircleDashed,
  },
  ANALYZING: {
    label: "Being looked at",
    blurb: "We are working out what your request needs.",
    tone: "text-muted-foreground",
    Icon: Clock,
  },
  DRAFTED: {
    label: "Being looked at",
    blurb: "A response has been prepared and is being checked.",
    tone: "text-muted-foreground",
    Icon: Clock,
  },
  VERIFIED: {
    label: "Being looked at",
    blurb: "A response has been prepared and is with our support team.",
    tone: "text-muted-foreground",
    Icon: Clock,
  },
  AWAITING_APPROVAL: {
    label: "With our support team",
    blurb:
      "A person is reviewing what we propose to do. Nothing happens on your account until they authorize it.",
    tone: "text-warning",
    Icon: Gavel,
  },
  APPROVED: {
    label: "Authorized",
    blurb: "Our support team has authorized the action and it is being carried out.",
    tone: "text-success",
    Icon: CheckCircle2,
  },
  EXECUTED: {
    label: "Resolved",
    blurb:
      "Our support team authorized the action and it has been carried out. Our reply is below.",
    tone: "text-success",
    Icon: CheckCircle2,
  },
  REJECTED: {
    label: "Closed without action",
    blurb:
      "Our support team reviewed this and decided not to act on it. Nothing was changed on your account.",
    tone: "text-muted-foreground",
    Icon: XCircle,
  },
}

/** One message in the thread, from either side. */
type Entry = {
  at: string
  from: "customer" | "support"
  text: string
  /** Said under the message: what is true about it beyond its text. */
  note?: string
}

/**
 * Everything that has actually been said on this ticket, oldest first.
 *
 * The drafted reply is included only once an execution has been recorded. Before
 * that it is a proposal no human has authorized, and showing a customer a reply
 * that has not been approved would be the product contradicting itself
 * (CLAUDE.md §1) — so the gate governs this surface as much as it governs the
 * console.
 *
 * Keyed off `execution_result` rather than `status === "EXECUTED"` on purpose: a
 * ticket reopened by a later follow-up sits back at AWAITING_APPROVAL while the
 * reply it already sent stays sent. Unsending it on screen would be a second
 * untruth in the other direction.
 */
function thread(ticket: CustomerTicket): Entry[] {
  const entries: Entry[] = [
    { at: ticket.created_at, from: "customer", text: ticket.body },
    ...(ticket.follow_ups ?? []).map(
      (f): Entry => ({ at: f.at, from: "customer", text: f.message })
    ),
  ]

  const executed = ticket.execution_result
  const reply = ticket.draft?.proposedResponse
  if (executed && reply) {
    entries.push({
      at: executed.executedAt,
      from: "support",
      text: reply,
      // Labeled here for the same reason it is labeled in the console: no email
      // provider is wired, so claiming this landed in an inbox would be claiming
      // a side effect that did not happen (CLAUDE.md §1).
      note: executed.simulated
        ? "Recorded as sent. Delivery is simulated in this demo."
        : undefined,
    })
  }

  // Chronological, so a follow-up that arrived after our reply reads as the reply
  // to it rather than being sorted underneath the original message.
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

function Message({ entry }: { entry: Entry }) {
  const mine = entry.from === "customer"
  const Icon = mine ? User : Headset
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={
          mine
            ? "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground"
            : "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary"
        }
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-foreground">
            {mine ? "You" : "Support team"}
          </span>
          <span className="text-xs text-muted-foreground">
            <span className="sr-only">sent </span>
            {formatTimestamp(entry.at)}
          </span>
        </p>
        {/* Plain text, never HTML: the customer's own words are untrusted and our
            reply quotes them (CLAUDE.md §7). `whitespace-pre-wrap` keeps the
            paragraphs they typed. */}
        <p
          className={
            mine
              ? "rounded-lg border bg-muted/25 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
              : "rounded-lg border border-primary/20 bg-primary/[0.04] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
          }
        >
          {entry.text}
        </p>
        {entry.note ? (
          <p className="text-xs text-muted-foreground">{entry.note}</p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Look a ticket up by the reference we gave the customer.
 *
 * A GET form, so the result is a URL: the customer can reload it, bookmark it and
 * come back to it, and the page holds no state of its own to get out of step with
 * the database. Nothing is written, so there is no Server Action here.
 */
function LookupForm({ reference }: { reference?: string }) {
  return (
    <form action="/portal" method="get" className="space-y-3">
      <div className="space-y-1.5">
        <label
          htmlFor="ref"
          className="block text-sm font-medium text-foreground"
        >
          Your ticket reference
        </label>
        <Input
          id="ref"
          name="ref"
          required
          defaultValue={reference}
          placeholder="The reference we gave you when you submitted"
          aria-describedby="ref-hint"
          className="font-mono text-[13px]"
        />
        <p id="ref-hint" className="text-xs text-muted-foreground">
          Paste the reference from your confirmation to see everything on your
          request.
        </p>
      </div>
      <Button type="submit" className="w-full">
        <Search aria-hidden="true" />
        View my request
      </Button>
    </form>
  )
}

export default async function PortalPage(props: PageProps<"/portal">) {
  const { ref } = await props.searchParams
  const reference = typeof ref === "string" ? ref.trim() : ""
  const result = reference ? await getCustomerTicket(reference) : null
  const ticket = result?.ok ? result.data : null

  const status = ticket ? CUSTOMER_STATUS[ticket.status] : null

  return (
    <main
      id="main"
      // Its own ground, not the console's: a wash rather than the flat canvas the
      // dense operator surfaces sit on.
      className="flex min-h-dvh flex-col bg-gradient-to-b from-muted/40 via-background to-background"
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-12 sm:py-16">
        <header className="mb-8 space-y-4 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex size-11 items-center justify-center rounded-xl border bg-card text-foreground shadow-xs"
          >
            <LifeBuoy className="size-5" />
          </span>
          <div className="space-y-2">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
              {ticket ? ticket.subject : "How can we help?"}
            </h1>
            {ticket ? (
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                Opened {formatTimestamp(ticket.created_at)}
              </p>
            ) : (
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
                Tell us what is going on and we will get it to the right person.
                Every request is read and decided by our support team.
              </p>
            )}
          </div>
        </header>

        {ticket && status ? (
          <>
            {/* Status first, because it is the question the customer came to
                answer. Label and icon, never colour alone (CLAUDE.md §6). */}
            <div className="rounded-2xl border bg-card px-5 py-6 shadow-sm sm:px-7 sm:py-7">
              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background",
                    status.tone
                  )}
                >
                  <status.Icon className="size-4" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={cn(
                        "text-base font-semibold tracking-tight",
                        status.tone
                      )}
                    >
                      {status.label}
                    </span>
                    <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                      {ticket.status}
                    </span>
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {status.blurb}
                  </p>
                </div>
              </div>

              <hr className="my-6" />

              <h2 className="mb-4 text-sm font-medium tracking-tight">
                Your conversation with us
              </h2>
              <ol className="space-y-5">
                {thread(ticket).map((entry, i) => (
                  <Message key={`${entry.at}-${i}`} entry={entry} />
                ))}
              </ol>

              <hr className="my-6" />

              <div className="space-y-3">
                <h2 className="text-sm font-medium tracking-tight">
                  Reply to this request
                </h2>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  If something has changed — a correction, a cancellation, or
                  anything you want to add — send it here and it will be added to
                  this request. If it changes a decision we had already reached,
                  that decision goes back to a person before anything else is
                  acted on.
                </p>
                {/* The reference is already known, so it is fixed rather than
                    retyped. The same Server Action as everywhere else: a message
                    can be recorded and can send a decision back to a human, and
                    it cannot do anything else whichever door it arrives through. */}
                <FollowUpForm ticketId={ticket.id} />
              </div>

              <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
                Reference{" "}
                <span className="font-mono break-all text-foreground">
                  {ticket.id}
                </span>
              </p>
            </div>

            {/* One link, because both ways back land on the same page: the intake
                form with the lookup field under it. Two links reading differently
                and going to the same place is a menu pretending to be a choice. */}
            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              <Link
                href="/portal"
                className="focus-ring rounded-sm underline underline-offset-4"
              >
                Submit a new request, or check a different reference
              </Link>
            </p>
          </>
        ) : (
          <>
            {/* One panel, generous padding. The console packs instruments
                together; this is a single task and is allowed the room. */}
            <div className="rounded-2xl border bg-card px-5 py-6 shadow-sm sm:px-7 sm:py-7">
              <PortalForm />
            </div>

            {/* Checking on an existing request is the second task on this page,
                and it is the rarer one — so it is disclosed rather than laid out
                beside the form. A native <details> because the platform already
                does this correctly: keyboard reachable, announced as expanded or
                collapsed, and it needs no client component and no state of its
                own. Open when a lookup was attempted and did not find anything,
                so the message and the field to correct sit together. */}
            <details
              open={result !== null}
              className="group mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm"
            >
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium sm:px-7">
                <span className="flex items-center gap-2.5">
                  <MessagesSquare
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  Already have a ticket? Check on it here
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="space-y-4 border-t px-5 py-5 sm:px-7">
                {result && !result.ok ? (
                  <Notice tone="error" title="We could not find that request">
                    {result.message}
                  </Notice>
                ) : null}
                <LookupForm reference={reference || undefined} />
              </div>
            </details>
          </>
        )}

        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            No action is taken on your account without a person authorizing it.
          </span>
        </p>
      </div>
    </main>
  )
}
