"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Ban, Check, Gavel, Inbox, ShieldCheck } from "lucide-react"

import { STATUS_FLOW } from "@/lib/types"
import type { Status } from "@/lib/types"
import { statusLabel } from "@/components/badges"
import { cn } from "@/lib/utils"

// One product, two surfaces, so navigation is short by design (CLAUDE.md §6).
// "Awaiting approval" is the queue filtered by status, not a third route.
const NAV = [
  { href: "/", label: "Queue", icon: Inbox, status: undefined },
  {
    href: "/?status=AWAITING_APPROVAL",
    label: "Awaiting approval",
    icon: Gavel,
    status: "AWAITING_APPROVAL",
  },
] as const

function NavLinks() {
  const pathname = usePathname()
  const status = useSearchParams().get("status") ?? undefined

  return (
    <nav aria-label="Main" className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon, status: want }) => {
        const isActive = pathname === "/" && status === want
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // The active rail is a left border, not a filled pill: it marks
              // position without turning two links into two buttons.
              "focus-ring group/nav relative flex items-center gap-2.5 rounded-sm border-l-2 py-1.5 pr-2 pl-[calc(0.625rem-2px)] text-sm transition-colors",
              isActive
                ? "border-l-foreground bg-sidebar-accent font-medium text-foreground"
                : "border-l-transparent text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground/70 group-hover/nav:text-foreground"
              )}
            />
            <span className="min-w-0 truncate">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * Where one step of the trail stands relative to the open ticket.
 *
 * `stopped` is the rejection case and is why this is a function rather than an
 * index comparison inline: a rejected ticket left the happy path *at* the gate,
 * so the gate is neither completed nor in progress, and the two steps after it
 * were never reached. Calling that "done" would claim an approval that was
 * refused.
 */
export type TrailState = "done" | "current" | "stopped" | "pending"

/**
 * Which state each step of `STATUS_FLOW` is in for a given ticket status.
 *
 * Pure and total, and exported for its test. Presentation only: `canTransition`
 * in lib/workflow.ts remains the authority on what may actually move where
 * (CLAUDE.md §2). `undefined` means no ticket is open — the queue — and every
 * step reads as pending, because on that surface no step is in progress.
 *
 * REJECTED is not in STATUS_FLOW (it leaves the happy path), so it is mapped to
 * the gate it was refused at.
 */
export function trailState(step: Status, activeStatus?: Status): TrailState {
  if (!activeStatus) return "pending"

  // Widened deliberately: REJECTED is a Status that STATUS_FLOW does not contain,
  // and looking it up has to be expressible rather than cast around.
  const flow: readonly Status[] = STATUS_FLOW
  const rejected = activeStatus === "REJECTED"
  const current = rejected
    ? flow.indexOf("AWAITING_APPROVAL")
    : flow.indexOf(activeStatus)
  const index = flow.indexOf(step)

  // A status outside the happy path with no mapping into it. Nothing is claimed.
  if (current === -1 || index === -1) return "pending"

  if (index < current) return "done"
  if (index > current) return "pending"
  return rejected ? "stopped" : "current"
}

/**
 * The workflow, spelled out as a rail, filled to where this ticket actually sits.
 *
 * An operator should be able to see where the human sits in the chain, and — with
 * a ticket open — how far along it is, without reading the header. State is never
 * carried by colour alone (CLAUDE.md §6): a completed step carries a tick, the
 * current step carries a filled dot and the word "current", and a rejected gate
 * carries a slash icon.
 */
function WorkflowLegend({ activeStatus }: { activeStatus?: Status }) {
  return (
    <div className="space-y-2.5">
      <p className="label-xs px-2.5" id="workflow-trail">
        Workflow
      </p>
      <ol aria-labelledby="workflow-trail" className="relative">
        {/* The spine, inset to the dot centre and stopping at the last dot. */}
        <span
          aria-hidden="true"
          className="absolute top-3 bottom-3 left-[calc(0.625rem+0.1875rem)] w-px bg-border"
        />
        {STATUS_FLOW.map((status) => {
          const state = trailState(status, activeStatus)
          const isGate = status === "AWAITING_APPROVAL"
          const byHuman = isGate || status === "EXECUTED"
          // The gate keeps the one accent the palette reserves for it, but only
          // as the step it is — not as a state it is not in.
          const gateAccent = isGate && state !== "pending" && state !== "done"

          return (
            <li
              key={status}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-sm py-1 pr-2 pl-2.5 text-xs transition-colors",
                state === "stopped" && "text-danger",
                state === "current" && !isGate && "text-foreground",
                gateAccent && "text-warning",
                state === "done" && "text-muted-foreground",
                state === "pending" && "text-muted-foreground/70"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 flex size-1.5 shrink-0 items-center justify-center rounded-full ring-3",
                  state === "done" && "bg-muted-foreground/60 ring-sidebar",
                  state === "current" &&
                    (isGate
                      ? "bg-warning ring-warning/20"
                      : "bg-foreground ring-foreground/15"),
                  state === "stopped" && "bg-danger ring-danger/20",
                  state === "pending" && "bg-border ring-sidebar"
                )}
              />
              <span
                className={cn(
                  "min-w-0 truncate",
                  (state === "current" || state === "stopped") &&
                    "font-medium tracking-tight",
                  isGate && state === "pending" && "font-medium tracking-tight"
                )}
              >
                {statusLabel(status)}
              </span>

              {/* State in words, so the rail survives being read without colour. */}
              {state === "done" ? (
                <>
                  <span className="sr-only">completed</span>
                  <Check
                    aria-hidden="true"
                    className="ml-auto size-3 shrink-0 text-muted-foreground/70"
                  />
                </>
              ) : null}
              {state === "current" ? (
                <span className="ml-auto shrink-0 font-mono text-[10px] tracking-tight">
                  current
                </span>
              ) : null}
              {state === "stopped" ? (
                <>
                  <span className="sr-only">rejected here</span>
                  <Ban aria-hidden="true" className="ml-auto size-3 shrink-0" />
                </>
              ) : null}
              {/* Who acts, shown only where the state has not taken the slot. */}
              {byHuman && state === "pending" ? (
                <span className="ml-auto shrink-0 font-mono text-[10px] tracking-tight">
                  human
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function AppSidebar({ activeStatus }: { activeStatus?: Status }) {
  return (
    <div className="flex h-full flex-col gap-5 p-3 lg:gap-6">
      <div className="flex items-center gap-2.5 px-1.5 pt-1">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-sm border bg-card text-foreground shadow-xs"
        >
          <ShieldCheck className="size-4" />
        </span>
        <span className="min-w-0">
          <span
            className="block text-sm font-semibold tracking-tight"
            translate="no"
          >
            Gatekeeper
          </span>
          <span className="block font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Decision gate
          </span>
        </span>
      </div>

      <NavLinks />

      <div className="border-t pt-5 lg:pt-6">
        <WorkflowLegend activeStatus={activeStatus} />
      </div>

      <p className="mt-auto border-t px-2.5 pt-4 text-[11px] leading-relaxed text-muted-foreground">
        AI prepares the decision. A human authorizes the action. Executed is
        reachable only from Approved, enforced on the server.
      </p>
    </div>
  )
}
