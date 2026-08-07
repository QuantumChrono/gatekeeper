"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Gavel, Inbox, ShieldCheck } from "lucide-react"

import { STATUS_FLOW } from "@/lib/types"
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
 * The workflow, spelled out as a rail. An operator should be able to see where
 * the human sits in the chain without opening a ticket — the gate is the
 * product, so it is named on every screen. The connector is what makes it read
 * as one ordered machine rather than seven unrelated words.
 */
function WorkflowLegend() {
  return (
    <div className="space-y-2.5">
      <p className="label-xs px-2.5">Workflow</p>
      <ol className="relative">
        {/* The spine, inset to the dot centre and stopping at the last dot. */}
        <span
          aria-hidden="true"
          className="absolute top-3 bottom-3 left-[calc(0.625rem+0.1875rem)] w-px bg-border"
        />
        {STATUS_FLOW.map((status) => {
          const isGate = status === "AWAITING_APPROVAL"
          const byHuman = status === "AWAITING_APPROVAL" || status === "EXECUTED"
          return (
            <li
              key={status}
              className={cn(
                "relative flex items-center gap-2.5 rounded-sm py-1 pr-2 pl-2.5 text-xs",
                isGate ? "text-warning" : "text-muted-foreground"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 size-1.5 shrink-0 rounded-full ring-3",
                  isGate
                    ? "bg-warning ring-warning/20"
                    : "bg-border ring-sidebar"
                )}
              />
              <span
                className={cn(
                  "min-w-0 truncate",
                  isGate && "font-medium tracking-tight"
                )}
              >
                {statusLabel(status)}
              </span>
              {byHuman ? (
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

export function AppSidebar() {
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
        <WorkflowLegend />
      </div>

      <p className="mt-auto border-t px-2.5 pt-4 text-[11px] leading-relaxed text-muted-foreground">
        AI prepares the decision. A human authorizes the action. Executed is
        reachable only from Approved, enforced on the server.
      </p>
    </div>
  )
}
