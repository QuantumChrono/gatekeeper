import type { Metadata } from "next"
import { LifeBuoy, ShieldCheck } from "lucide-react"

import { PortalForm } from "@/components/portal-form"

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

export const metadata: Metadata = {
  title: "Contact support",
  description: "Submit a support request.",
}

export default function PortalPage() {
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
              How can we help?
            </h1>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
              Tell us what is going on and we will get it to the right person.
              Every request is read and decided by our support team.
            </p>
          </div>
        </header>

        {/* One panel, generous padding. The console packs instruments together;
            this is a single task and is allowed the room. */}
        <div className="rounded-2xl border bg-card px-5 py-6 shadow-sm sm:px-7 sm:py-7">
          <PortalForm />
        </div>

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
