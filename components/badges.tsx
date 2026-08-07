import {
  Activity,
  Ban,
  Check,
  CircleCheck,
  CircleDashed,
  FileText,
  Gavel,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { STATUS_FLOW } from "@/lib/types"
import type {
  AiSource,
  Category,
  Risk,
  Severity,
  Status,
} from "@/lib/types"

// Presentation for the domain vocabularies. Status, risk and severity all read
// the same way in the queue and on the detail view, so they live together here
// rather than in five files.
//
// Status is never carried by colour alone (CLAUDE.md §6): every badge below
// pairs its colour with a label and an icon.

/**
 * One tone scale for every machine-state chip in the app, so a status in the
 * queue and a verdict on the detail view cannot drift apart.
 *
 * `quiet` and `neutral` are the automated stages — they recede. `attention` is
 * the gate, and it is the loudest thing on any screen that has one. `positive`
 * and `negative` are settled outcomes, which is why they carry a hairline ring:
 * resolved, not in flight.
 */
const chipVariants = cva(
  "rounded-sm font-mono text-[11px] font-medium tracking-wide uppercase",
  {
    variants: {
      tone: {
        quiet: "bg-muted text-muted-foreground ring-1 ring-border/70",
        neutral: "bg-muted text-foreground ring-1 ring-border",
        attention: "bg-warning/12 text-warning ring-1 ring-warning/35",
        positive: "bg-success/12 text-success ring-1 ring-success/30",
        negative: "bg-danger/12 text-danger ring-1 ring-danger/30",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

type Tone = NonNullable<VariantProps<typeof chipVariants>["tone"]>

const STATUS_META: Record<
  Status,
  { label: string; icon: typeof Activity; tone: Tone }
> = {
  RECEIVED: { label: "Received", icon: CircleDashed, tone: "quiet" },
  ANALYZING: { label: "Analyzing", icon: Activity, tone: "neutral" },
  DRAFTED: { label: "Drafted", icon: FileText, tone: "neutral" },
  VERIFIED: { label: "Verified", icon: ShieldCheck, tone: "neutral" },
  // The gate. Deliberately the loudest state in the queue: it is the only one
  // that needs a human.
  AWAITING_APPROVAL: { label: "Awaiting approval", icon: Gavel, tone: "attention" },
  APPROVED: { label: "Approved", icon: Check, tone: "positive" },
  REJECTED: { label: "Rejected", icon: Ban, tone: "negative" },
  EXECUTED: { label: "Executed", icon: CircleCheck, tone: "positive" },
}

export function StatusBadge({
  status,
  className,
}: {
  status: Status
  className?: string
}) {
  const { label, icon: Icon, tone } = STATUS_META[status]
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1.5 px-1.5", chipVariants({ tone }), className)}
    >
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}

export function statusLabel(status: Status) {
  return STATUS_META[status].label
}

/**
 * Where this ticket sits in the fixed workflow, as one scannable rail.
 * Presentation over `STATUS_FLOW` and the current status — no new data. Rejected
 * leaves the happy path at the gate, so it fills to the gate and stops in
 * danger rather than pretending to a later step.
 */
export function WorkflowProgress({
  status,
  className,
}: {
  status: Status
  className?: string
}) {
  const rejected = status === "REJECTED"
  const index = rejected
    ? STATUS_FLOW.indexOf("AWAITING_APPROVAL")
    : STATUS_FLOW.indexOf(status)

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span aria-hidden="true" className="flex items-center gap-1">
        {STATUS_FLOW.map((step, i) => {
          const reached = i <= index
          const isGate = step === "AWAITING_APPROVAL"
          return (
            <span
              key={step}
              className={cn(
                "h-1 w-5 rounded-full transition-colors",
                !reached && "bg-border",
                reached && rejected && isGate && "bg-danger",
                reached && !(rejected && isGate) && isGate && "bg-warning",
                reached && !isGate && "bg-foreground/45"
              )}
            />
          )
        })}
      </span>
      <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
        <span className="sr-only">Workflow position: </span>
        {rejected
          ? `Stopped at step ${index + 1} of ${STATUS_FLOW.length}`
          : `Step ${index + 1} of ${STATUS_FLOW.length}`}
      </span>
    </div>
  )
}

const RISK_META: Record<
  Risk,
  { tone: Tone; icon?: typeof Activity }
> = {
  LOW: { tone: "positive" },
  MEDIUM: { tone: "attention" },
  HIGH: { tone: "negative", icon: TriangleAlert },
}

export function RiskBadge({
  risk,
  className,
}: {
  risk: Risk
  className?: string
}) {
  const { tone, icon: Icon } = RISK_META[risk]
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1.5 px-1.5", chipVariants({ tone }), className)}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {risk} risk
    </Badge>
  )
}

const SEVERITY_STEPS: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

const SEVERITY_FILL: Record<Severity, string> = {
  LOW: "bg-muted-foreground",
  MEDIUM: "bg-warning",
  HIGH: "bg-danger",
  CRITICAL: "bg-danger",
}

const SEVERITY_TEXT: Record<Severity, string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-warning",
  HIGH: "text-danger",
  CRITICAL: "text-danger",
}

/**
 * Four segments, filled to the level. The bars are decorative — the written
 * level next to them is what conveys the value, so severity survives being
 * read without colour.
 */
export function SeverityIndicator({ severity }: { severity: Severity }) {
  const steps = SEVERITY_STEPS[severity]
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="flex items-end gap-[3px]">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "w-[3px] rounded-[1px]",
              step <= steps ? SEVERITY_FILL[severity] : "bg-border",
              step === 1 && "h-1.5",
              step === 2 && "h-2",
              step === 3 && "h-2.5",
              step === 4 && "h-3"
            )}
          />
        ))}
      </span>
      <span
        className={cn(
          "text-xs font-medium tracking-tight",
          SEVERITY_TEXT[severity],
          // CRITICAL is the only severity that earns emphasis beyond colour.
          severity === "CRITICAL" && "uppercase"
        )}
      >
        {severity === "CRITICAL"
          ? "Critical"
          : severity.charAt(0) + severity.slice(1).toLowerCase()}
      </span>
    </span>
  )
}

const CATEGORY_LABEL: Record<Category, string> = {
  BILLING: "Billing",
  BUG: "Bug",
  ACCOUNT_ACCESS: "Account access",
  REFUND: "Refund",
  FEATURE_REQUEST: "Feature request",
}

export function CategoryLabel({ category }: { category: Category }) {
  return (
    <Badge
      variant="outline"
      className="rounded-sm border-border/80 bg-card px-1.5 font-normal text-muted-foreground"
    >
      {CATEGORY_LABEL[category]}
    </Badge>
  )
}

const SOURCE_META: Record<
  AiSource,
  { label: string; dot: string; text: string; title: string }
> = {
  model: {
    label: "model",
    dot: "bg-success",
    text: "text-foreground",
    title: "Produced by the primary model.",
  },
  fallback: {
    label: "fallback",
    dot: "bg-warning",
    text: "text-warning",
    title: "The primary model was unavailable; a fallback model answered.",
  },
  seed: {
    label: "seeded",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    title: "No model answered; this is the seeded deterministic result.",
  },
}

/**
 * Which tier produced the block this sits next to (AC-9). Its absence is a
 * defect, so it takes the source as a required prop rather than defaulting.
 */
export function ProvenanceBadge({
  source,
  model,
}: {
  source: AiSource
  model?: string
}) {
  const meta = SOURCE_META[source]
  return (
    <span
      title={meta.title}
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      <Badge
        variant="outline"
        className={cn(
          "h-5 gap-1.5 rounded-sm border-border/80 bg-card px-1.5 font-mono text-[11px] tracking-tight",
          meta.text
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", meta.dot)}
        />
        <span className="sr-only">Produced by </span>
        {meta.label}
      </Badge>
      {model ? (
        <span className="font-mono text-[11px] text-muted-foreground">
          {model}
        </span>
      ) : null}
    </span>
  )
}

/**
 * Confidence with its scale attached, plus ten discrete ticks. Deliberately
 * quantized rather than a continuous bar: a smooth fill would imply a precision
 * the model did not give (CLAUDE.md §6). The number is the value; the ticks only
 * make two tickets comparable at a glance.
 */
export function ConfidenceValue({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  const filled = Math.round(Math.min(Math.max(value, 0), 1) * 10)
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className="flex items-center gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 w-[3px] rounded-[1px]",
              i < filled ? "bg-foreground/55" : "bg-border"
            )}
          />
        ))}
      </span>
      <span className="inline-flex items-baseline gap-1 tabular-nums">
        <span className="font-mono text-sm font-medium">
          {value.toFixed(2)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          / 1.00
        </span>
      </span>
    </span>
  )
}

/**
 * The verifier's verdict. Its own component because it is the one place the
 * system is allowed to disagree with itself, and the UI has to change visibly
 * when it does (CLAUDE.md §1).
 */
export function VerdictBadge({ safeToSend }: { safeToSend: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1.5 px-1.5",
        chipVariants({ tone: safeToSend ? "positive" : "negative" })
      )}
    >
      {safeToSend ? (
        <CircleCheck aria-hidden="true" />
      ) : (
        <TriangleAlert aria-hidden="true" />
      )}
      {safeToSend ? "Safe to send" : "Not safe to send"}
    </Badge>
  )
}
