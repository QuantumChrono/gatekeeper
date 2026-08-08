import { describe, expect, it } from "vitest"

import { canTransition, transition, type TransitionStore } from "../lib/workflow"
import type { Actor, PipelineError, Status } from "../lib/types"

// The state machine is the product's security boundary, so this suite tests the
// property rather than the implementation: a ticket reaches EXECUTED only from
// APPROVED, the decision rests on state re-read from the store rather than on
// anything the caller supplied, and every move that lands leaves an audit event.

const ALL: Status[] = [
  "RECEIVED",
  "ANALYZING",
  "DRAFTED",
  "VERIFIED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
]

/** Every edge the workflow is specified to have, and no others. */
const LEGAL: [Status, Status][] = [
  ["RECEIVED", "ANALYZING"],
  ["ANALYZING", "DRAFTED"],
  ["DRAFTED", "VERIFIED"],
  ["VERIFIED", "AWAITING_APPROVAL"],
  ["AWAITING_APPROVAL", "APPROVED"],
  ["AWAITING_APPROVAL", "REJECTED"],
  ["APPROVED", "EXECUTED"],
]

type Event = {
  actor: Actor
  from: Status | null
  to: Status
  reason: string
}

/**
 * An in-memory stand-in for the database, modelling what the database actually
 * guarantees and nothing more: the compare-and-set, the atomic pairing of the
 * status change with its audit event, and the two assertions `apply_transition`
 * makes about EXECUTED.
 *
 * Deliberately does not consult `canTransition`. If it did, these tests would
 * prove only that the fake refuses illegal moves. The guard under test is
 * `transition()`, and the store here is as permissive as a raw UPDATE would be.
 */
function fakeStore(initial: Status, seededEvents: Event[] = []) {
  const state = {
    status: initial as Status | null,
    events: [...seededEvents],
    reads: 0,
    /** Runs between the read and the write, to stage a lost race. */
    onBeforeApply: undefined as undefined | (() => void),
  }

  const store: TransitionStore = {
    async readStatus() {
      state.reads += 1
      return { ok: true, data: state.status }
    },
    async apply({ expect: expected, to, actor, reason }) {
      state.onBeforeApply?.()

      if (to === "EXECUTED") {
        // Both assertions the schema's apply_transition makes.
        if (expected !== "APPROVED") {
          return {
            ok: false,
            message: `EXECUTED is reachable only from APPROVED (attempted from ${expected})`,
          }
        }
        if (
          !state.events.some((e) => e.to === "APPROVED" && e.actor === "human")
        ) {
          return {
            ok: false,
            message: "EXECUTED requires a recorded human approval event",
          }
        }
      }

      // Compare-and-set: no match, no change, and no event.
      if (state.status !== expected) return { ok: true, data: { applied: false } }

      state.status = to
      state.events.push({ actor, from: expected, to, reason })
      return { ok: true, data: { applied: true } }
    },
    async recordFailure({ error }: { error: PipelineError }) {
      // Mirrors record_pipeline_failure: an event whose from and to are both the
      // current status, and no status change.
      const at = state.status
      if (at === null) return { ok: false, message: "no such ticket" }
      state.events.push({
        actor: "system",
        from: at,
        to: at,
        reason: `${error.stage} stage failed. ${error.message}`,
      })
      return { ok: true, data: undefined }
    },
  }

  return { store, state }
}

const move = (
  store: TransitionStore,
  to: Status,
  actor: Actor = "human",
  reason = "test"
) => transition(store, { ticketId: "t1", to, actor, reason })

describe("canTransition", () => {
  it("permits every legal edge", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true)
    }
  })

  it("rejects every edge that is not legal", () => {
    const legal = new Set(LEGAL.map(([f, t]) => `${f}→${t}`))
    for (const from of ALL) {
      for (const to of ALL) {
        if (legal.has(`${from}→${to}`)) continue
        expect(canTransition(from, to), `${from} → ${to}`).toBe(false)
      }
    }
  })

  it("makes EXECUTED reachable only from APPROVED", () => {
    expect(canTransition("APPROVED", "EXECUTED")).toBe(true)
    for (const from of ALL.filter((s) => s !== "APPROVED")) {
      expect(canTransition(from, "EXECUTED"), `${from} → EXECUTED`).toBe(false)
    }
  })

  it("treats the terminal statuses as terminal and rejects self-edges", () => {
    for (const to of ALL) {
      expect(canTransition("EXECUTED", to), `EXECUTED → ${to}`).toBe(false)
      expect(canTransition("REJECTED", to), `REJECTED → ${to}`).toBe(false)
    }
    // A self-transition is not a move, which is what keeps the failure path from
    // being able to advance anything.
    for (const s of ALL) expect(canTransition(s, s), `${s} → ${s}`).toBe(false)
  })

  it("does not skip the gate", () => {
    // The whole premise: no path from the automated stages straight to a
    // carried-out action.
    expect(canTransition("VERIFIED", "APPROVED")).toBe(false)
    expect(canTransition("VERIFIED", "EXECUTED")).toBe(false)
    expect(canTransition("DRAFTED", "AWAITING_APPROVAL")).toBe(false)
  })
})

describe("transition", () => {
  it("carries out APPROVED → EXECUTED and records it", async () => {
    const { store, state } = fakeStore("APPROVED", [
      { actor: "human", from: "AWAITING_APPROVAL", to: "APPROVED", reason: "ok" },
    ])

    const result = await move(store, "EXECUTED")

    expect(result).toEqual({ ok: true, data: { status: "EXECUTED", changed: true } })
    expect(state.status).toBe("EXECUTED")
  })

  it("refuses RECEIVED → EXECUTED", async () => {
    const { store, state } = fakeStore("RECEIVED")

    const result = await move(store, "EXECUTED")

    expect(result.ok).toBe(false)
    expect(state.status).toBe("RECEIVED")
    expect(state.events).toHaveLength(0)
  })

  it("refuses AWAITING_APPROVAL → EXECUTED", async () => {
    // The ticket is at the gate with everything prepared. Without a human
    // decision it still cannot be carried out.
    const { store, state } = fakeStore("AWAITING_APPROVAL")

    const result = await move(store, "EXECUTED")

    expect(result.ok).toBe(false)
    expect(state.status).toBe("AWAITING_APPROVAL")
    expect(state.events).toHaveLength(0)
  })

  it("cannot execute a rejected ticket", async () => {
    const { store, state } = fakeStore("REJECTED", [
      { actor: "human", from: "AWAITING_APPROVAL", to: "REJECTED", reason: "no" },
    ])

    expect((await move(store, "EXECUTED")).ok).toBe(false)
    // Nor by any route back onto the happy path.
    expect((await move(store, "APPROVED")).ok).toBe(false)
    expect((await move(store, "AWAITING_APPROVAL")).ok).toBe(false)

    expect(state.status).toBe("REJECTED")
    expect(state.events).toHaveLength(1)
  })

  it("refuses every illegal move without writing anything", async () => {
    const legal = new Set(LEGAL.map(([f, t]) => `${f}→${t}`))

    for (const from of ALL) {
      for (const to of ALL) {
        if (legal.has(`${from}→${to}`) || from === to) continue
        const { store, state } = fakeStore(from)
        const result = await move(store, to)

        expect(result.ok, `${from} → ${to} should be refused`).toBe(false)
        expect(state.status, `${from} → ${to} must not move`).toBe(from)
        expect(state.events, `${from} → ${to} must write nothing`).toHaveLength(0)
      }
    }
  })

  it("records one audit event per transition, with actor and both statuses", async () => {
    const { store, state } = fakeStore("RECEIVED")

    await move(store, "ANALYZING", "ai", "Classified as BILLING.")
    await move(store, "DRAFTED", "ai", "Drafted a reply.")
    await move(store, "VERIFIED", "ai", "Verification returned CONCERNS.")
    await move(store, "AWAITING_APPROVAL", "ai", "Parked for a human.")
    await move(store, "APPROVED", "human", "Approved by the operator.")
    await move(store, "EXECUTED", "human", "Carried out.")

    expect(state.status).toBe("EXECUTED")
    expect(state.events).toEqual([
      { actor: "ai", from: "RECEIVED", to: "ANALYZING", reason: "Classified as BILLING." },
      { actor: "ai", from: "ANALYZING", to: "DRAFTED", reason: "Drafted a reply." },
      { actor: "ai", from: "DRAFTED", to: "VERIFIED", reason: "Verification returned CONCERNS." },
      { actor: "ai", from: "VERIFIED", to: "AWAITING_APPROVAL", reason: "Parked for a human." },
      { actor: "human", from: "AWAITING_APPROVAL", to: "APPROVED", reason: "Approved by the operator." },
      { actor: "human", from: "APPROVED", to: "EXECUTED", reason: "Carried out." },
    ])
    // AC-6, demonstrated rather than assumed: a human approval precedes execution.
    const approval = state.events.findIndex((e) => e.to === "APPROVED")
    const executed = state.events.findIndex((e) => e.to === "EXECUTED")
    expect(state.events[approval].actor).toBe("human")
    expect(approval).toBeLessThan(executed)
  })

  it("re-reads state from the store rather than trusting the caller", async () => {
    // The caller asks to execute. The store says the ticket is at RECEIVED, and
    // that is what decides — there is no argument by which a caller can assert a
    // status it does not have.
    const { store, state } = fakeStore("RECEIVED")

    const result = await move(store, "EXECUTED")

    expect(state.reads).toBeGreaterThan(0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("RECEIVED")
  })

  it("refuses when the ticket moved between the read and the write", async () => {
    // Two operators, or a double-click: the read sees AWAITING_APPROVAL, but the
    // row is already APPROVED by the time the write lands. The compare-and-set
    // matches nothing, so nothing is written twice.
    const { store, state } = fakeStore("AWAITING_APPROVAL")
    state.onBeforeApply = () => {
      state.status = "APPROVED"
      state.events.push({
        actor: "human",
        from: "AWAITING_APPROVAL",
        to: "APPROVED",
        reason: "the other tab",
      })
      state.onBeforeApply = undefined
    }

    const result = await move(store, "REJECTED")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("APPROVED")
    expect(state.status).toBe("APPROVED")
    expect(state.events).toHaveLength(1)
  })

  it("treats a repeated transition as already done rather than illegal", async () => {
    const { store, state } = fakeStore("EXECUTED", [
      { actor: "human", from: "AWAITING_APPROVAL", to: "APPROVED", reason: "ok" },
      { actor: "human", from: "APPROVED", to: "EXECUTED", reason: "carried out" },
    ])

    const result = await move(store, "EXECUTED")

    // Idempotent: a second execute authorizes nothing and writes no second event.
    expect(result).toEqual({ ok: true, data: { status: "EXECUTED", changed: false } })
    expect(state.events).toHaveLength(2)
  })

  it("reports a missing ticket instead of writing", async () => {
    const { store, state } = fakeStore("RECEIVED")
    state.status = null

    expect((await move(store, "ANALYZING")).ok).toBe(false)
    expect(state.events).toHaveLength(0)
  })

  it("preserves the ticket when a stage failure is recorded", async () => {
    const { store, state } = fakeStore("RECEIVED")

    await store.recordFailure({
      ticketId: "t1",
      error: {
        stage: "analyze",
        message: "No tier produced a usable result.",
        at: "2026-01-01T00:00:00.000Z",
      },
    })

    // The failure is on the record and the ticket has not moved.
    expect(state.status).toBe("RECEIVED")
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({
      actor: "system",
      from: "RECEIVED",
      to: "RECEIVED",
    })
    // And a failure event can never be an advance, because a self-edge is not a
    // legal transition.
    expect(canTransition("RECEIVED", "RECEIVED")).toBe(false)
  })
})
