// Locale-aware formatting via Intl rather than hand-rolled strings.

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})

export function formatMoney(cents: number) {
  return MONEY.format(cents / 100)
}

const TIMESTAMP = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatTimestamp(iso: string) {
  return TIMESTAMP.format(new Date(iso))
}

/**
 * Compact age for the queue's Age column. Rendered on the server and passed
 * down as a string, so there is no clock to disagree with at hydration.
 */
export function formatAge(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

const ACTION_LABEL: Record<string, string> = {
  REPLY: "Send reply",
  ESCALATE_T2: "Escalate to tier 2",
  ESCALATE_ENG: "Escalate to engineering",
  REFUND: "Issue refund",
  CLOSE: "Close as resolved",
}

export function actionLabel(type: string) {
  return ACTION_LABEL[type] ?? type
}

/**
 * The proposed action in one plain sentence, so an operator knows what they are
 * being asked to authorize before reading anything else (US-4). Refund amounts
 * come from the action params, which is where the clamp to order value writes
 * them.
 */
export function actionSentence(
  type: string,
  params: Record<string, unknown>
): string {
  if (type === "REFUND") {
    const cents = params.amount_cents
    if (typeof cents === "number") {
      return `Issue a ${formatMoney(cents)} refund to the customer.`
    }
    return "Issue a refund to the customer."
  }
  if (type === "ESCALATE_T2" || type === "ESCALATE_ENG") {
    const queue = params.queue
    return typeof queue === "string"
      ? `${actionLabel(type)} (${queue}).`
      : `${actionLabel(type)}.`
  }
  if (type === "REPLY") return "Send the drafted reply to the customer."
  if (type === "CLOSE") return "Close this ticket as resolved."
  return `${actionLabel(type)}.`
}

export function tierLabel(tier: string) {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}
