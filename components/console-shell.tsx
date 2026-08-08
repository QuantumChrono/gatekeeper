import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import type { Status } from "@/lib/types"

/**
 * The operator console's chrome: sidebar plus the main region.
 *
 * A component the two console pages render, rather than a layout wrapping them,
 * for two reasons that both come from the workflow trail in the sidebar. It has
 * to reflect the open ticket's status, and a layout cannot receive that from the
 * page beneath it — props travel down, not up. Reading the ticket a second time
 * in a layout would be a second query answering a question the page has already
 * answered.
 *
 * The second reason is the customer-facing route: it is not part of this console
 * and must not inherit its chrome. With the shell here, /portal simply does not
 * render it, so the separation costs nothing and cannot be forgotten.
 */
export function ConsoleShell({
  activeStatus,
  children,
}: {
  /** The open ticket's status, on the surface that has one. The queue has none. */
  activeStatus?: Status
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <header className="border-b bg-sidebar lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-b-0">
        {/* Nav marks the active surface from the URL, so it reads search
            params — Suspense keeps that out of the render path above it. */}
        <Suspense fallback={null}>
          <AppSidebar activeStatus={activeStatus} />
        </Suspense>
      </header>
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  )
}
