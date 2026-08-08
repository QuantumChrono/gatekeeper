import { describe, expect, it } from "vitest"

import { trailState } from "../components/app-sidebar"
import { STATUS_FLOW } from "../lib/types"
import type { Status } from "../lib/types"

// The sidebar trail is presentation, but it makes a claim about where a ticket
// sits — and a trail that says "done" over a step that never happened is the
// same class of defect as a fake number. These pin the three cases that are easy
// to get wrong: the ends of the flow, a rejection, and no ticket at all.

/** The trail as an operator reads it, top to bottom. */
function trail(status?: Status) {
  return STATUS_FLOW.map((step) => trailState(step, status))
}

describe("trailState", () => {
  it("marks earlier steps done, the current one current, and later ones pending", () => {
    expect(trail("VERIFIED")).toEqual([
      "done", // RECEIVED
      "done", // ANALYZING
      "done", // DRAFTED
      "current", // VERIFIED
      "pending", // AWAITING_APPROVAL
      "pending", // APPROVED
      "pending", // EXECUTED
    ])
  })

  it("claims nothing as done at the start of the flow", () => {
    const states = trail("RECEIVED")
    expect(states[0]).toBe("current")
    expect(states.filter((s) => s === "done")).toHaveLength(0)
  })

  it("shows the whole flow complete at EXECUTED", () => {
    const states = trail("EXECUTED")
    expect(states.at(-1)).toBe("current")
    // Every step before the last is behind it, and none is left pending.
    expect(states.slice(0, -1).every((s) => s === "done")).toBe(true)
  })

  it("stops a rejected ticket at the gate and claims no approval", () => {
    const states = trail("REJECTED")
    const gate = STATUS_FLOW.indexOf("AWAITING_APPROVAL")

    // The gate is where it left the happy path: neither completed nor in flight.
    expect(states[gate]).toBe("stopped")
    // The point of the case: APPROVED and EXECUTED were never reached, so the
    // trail must not colour them in.
    expect(states.slice(gate + 1).every((s) => s === "pending")).toBe(true)
    expect(states.slice(0, gate).every((s) => s === "done")).toBe(true)
  })

  it("asserts no position when no ticket is open", () => {
    // The queue. Nothing is in progress there, so nothing may read as current.
    expect(trail(undefined).every((s) => s === "pending")).toBe(true)
  })

  it("puts every status somewhere without throwing", () => {
    const all: Status[] = [
      "RECEIVED",
      "ANALYZING",
      "DRAFTED",
      "VERIFIED",
      "AWAITING_APPROVAL",
      "APPROVED",
      "REJECTED",
      "EXECUTED",
    ]
    for (const status of all) {
      const states = trail(status)
      expect(states).toHaveLength(STATUS_FLOW.length)
      // Exactly one step is ever the live one, whatever the status.
      expect(
        states.filter((s) => s === "current" || s === "stopped")
      ).toHaveLength(1)
    }
  })
})
