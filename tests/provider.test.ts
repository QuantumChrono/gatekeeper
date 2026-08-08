import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  FALLBACK_MODEL as FALLBACK,
  PRIMARY_MODEL as PRIMARY,
  runStage,
} from "../lib/ai/provider"

// The tier ladder itself: primary model → fallback model → seeded result, and the
// honesty rules that hang off it. Tested here, once, rather than three times
// through analyze/draft/verify — the ladder is one function and the three stages
// are prompts and schemas over it.
//
// The middle rung is the reason this file exists. The stage suites cover the
// primary tier answering and the seed absorbing a total outage, but nothing
// exercised a primary failure that the fallback model survived.
//
// A schema small enough that the assertions are about tiering and not about
// field validation, which the stage suites already cover in depth.
const Schema = z.object({ verdict: z.string().min(1) })
const VALID = { verdict: "ok" }

// Imported rather than restated: these are whatever the module resolved from
// env, and the assertions only need them distinct. Hardcoding them here is what
// let the suite keep passing against models the defaults had moved off.

const stage = (args: Partial<Parameters<typeof runStage>[0]> = {}) =>
  runStage({
    schema: Schema,
    system: "s",
    prompt: "p",
    seed: undefined,
    ...args,
  })

describe("runStage tiering", () => {
  it("labels a live primary success as the model tier and stops there", async () => {
    const generate = vi.fn().mockResolvedValue(VALID)
    const result = await stage({ generate })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.source).toBe("model")
    expect(result.data.model).toBe(PRIMARY)

    // Nothing failed, so nothing is reported as degraded. A clean run must be
    // distinguishable from one that merely survived.
    expect(result.data.degraded).toBeUndefined()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it("falls to the fallback model when the primary provider fails", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(VALID)
    const result = await stage({ generate })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Still live inference, and it says which model actually answered.
    expect(result.data.source).toBe("fallback")
    expect(result.data.model).toBe(FALLBACK)

    // The primary outage survived the call, so it is on the record.
    expect(result.data.degraded).toContain(PRIMARY)
    expect(result.data.degraded).toContain("request failed")

    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[0][0].modelId).toBe(PRIMARY)
    expect(generate.mock.calls[1][0].modelId).toBe(FALLBACK)
  })

  it("treats unusable primary output as a failed tier, not a result", async () => {
    // A provider that answers with the wrong shape is as unusable as one that is
    // down, and it must not be cast into place.
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ verdict: 42 })
      .mockResolvedValueOnce(VALID)
    const result = await stage({ generate })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.source).toBe("fallback")
    expect(result.data.degraded).toContain("failed validation")
  })

  it("falls to the seeded tier when both providers fail, and says why", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    const result = await stage({ seed: VALID, generate })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Seeded output is never dressed as live inference: no model is named,
    // because none answered.
    expect(result.data.source).toBe("seed")
    expect(result.data.model).toBeUndefined()

    // The outage the seed absorbed is still an outage. Without this, a survived
    // provider failure would be indistinguishable from a clean seeded run.
    expect(result.data.degraded).toContain(PRIMARY)
    expect(result.data.degraded).toContain(FALLBACK)

    expect(generate).toHaveBeenCalledTimes(2)
  })

  it("fails as a value when no tier produces anything usable", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    const result = await stage({ generate })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain("seed: absent")
  })

  it("keeps provider error detail out of what it reports", async () => {
    // Provider errors can echo the request, and the request carries the ticket.
    // `degraded` is rendered in the UI, so it names the tier, never what it said.
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("401 key sk-live-abcdef rejected"))
      .mockResolvedValueOnce(VALID)
    const result = await stage({ generate })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.degraded).not.toContain("sk-live-abcdef")
  })
})
