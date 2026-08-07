import { describe, expect, it } from "vitest"

import { computeRisk } from "../lib/workflow"

// Risk is computed, not asked for, so it is worth pinning to a table. The three
// seeded tickets in supabase/migrations/001_initial_schema.sql were scored by
// hand with this formula; if this function and those values ever disagree, the
// queue shows a risk the database contradicts.

describe("computeRisk", () => {
  it("reproduces the risk values the seeded tickets were scored with", () => {
    // MEDIUM(1) + REPLY(0) + safe(0) + pro(0) = 1
    expect(
      computeRisk({
        severity: "MEDIUM",
        actionType: "REPLY",
        customerTier: "pro",
        safeToSend: true,
      })
    ).toBe("LOW")

    // CRITICAL(3) + ESCALATE_ENG(0) + safe(0) + enterprise(1) = 4
    expect(
      computeRisk({
        severity: "CRITICAL",
        actionType: "ESCALATE_ENG",
        customerTier: "enterprise",
        safeToSend: true,
      })
    ).toBe("HIGH")

    // MEDIUM(1) + REFUND(2) + !safe(1) + enterprise(1) = 5
    expect(
      computeRisk({
        severity: "MEDIUM",
        actionType: "REFUND",
        customerTier: "enterprise",
        safeToSend: false,
      })
    ).toBe("HIGH")
  })

  it("puts the band boundaries where the table says", () => {
    // 3 → MEDIUM: HIGH(2) + CLOSE(1)
    expect(
      computeRisk({
        severity: "HIGH",
        actionType: "CLOSE",
        customerTier: "free",
        safeToSend: true,
      })
    ).toBe("MEDIUM")

    // 4 → HIGH: the same ticket one point up
    expect(
      computeRisk({
        severity: "HIGH",
        actionType: "REFUND",
        customerTier: "free",
        safeToSend: true,
      })
    ).toBe("HIGH")

    // 0 → LOW: the floor
    expect(
      computeRisk({
        severity: "LOW",
        actionType: "REPLY",
        customerTier: "free",
        safeToSend: true,
      })
    ).toBe("LOW")
  })

  it("raises risk when the verifier objects", () => {
    const base = {
      severity: "MEDIUM",
      actionType: "CLOSE",
      customerTier: "free",
    } as const
    expect(computeRisk({ ...base, safeToSend: true })).toBe("MEDIUM")
    expect(computeRisk({ ...base, safeToSend: false })).toBe("MEDIUM")

    // The bump is a real point, not decoration: it carries a 3 over the line.
    const nearBoundary = {
      severity: "HIGH",
      actionType: "CLOSE",
      customerTier: "free",
    } as const
    expect(computeRisk({ ...nearBoundary, safeToSend: true })).toBe("MEDIUM")
    expect(computeRisk({ ...nearBoundary, safeToSend: false })).toBe("HIGH")
  })
})
