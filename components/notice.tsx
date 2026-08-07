import { CircleAlert, Inbox } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Empty and error states say what happened and what to do next
 * (CLAUDE.md §6). Used by both surfaces, so it lives on its own.
 *
 * An error is a genuine fault and reads as one; an empty queue is a normal
 * operating condition and stays quiet. Same layout either way, so the page does
 * not reflow between them.
 */
export function Notice({
  tone = "empty",
  title,
  children,
}: {
  tone?: "empty" | "error"
  title: string
  children?: React.ReactNode
}) {
  const isError = tone === "error"
  const Icon = isError ? CircleAlert : Inbox
  return (
    <div
      role={isError ? "alert" : undefined}
      className={cn(
        "flex items-start gap-3.5 rounded-md border px-5 py-6",
        isError
          ? "border-danger/25 bg-danger/[0.035]"
          : "border-dashed bg-muted/25"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-sm border bg-card",
          isError ? "border-danger/25 text-danger" : "text-muted-foreground"
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 space-y-1 pt-1">
        <p className="text-sm font-medium tracking-tight">{title}</p>
        {children ? (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {children}
          </p>
        ) : null}
      </div>
    </div>
  )
}
