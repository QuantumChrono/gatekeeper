import { createGateway, generateObject } from "ai"
import type { ZodType } from "zod"

import type { Result } from "@/lib/db"
import type { AiSource } from "@/lib/types"

// Server-only by construction: reached from Server Components and Server
// Actions, never imported into a client component. The key is read from a
// non-NEXT_PUBLIC_* var, so Next has no value to inline into a browser bundle
// even by accident (CLAUDE.md §7).
//
// ponytail: convention, not enforcement — the `server-only` package would make
// a client import a build error, but it is not installed here. Add it if a
// client component ever grows an import of this module.
//
// One provider config and one tiered runner. The three roles (analyze / draft /
// verify) are prompts and schemas over this — not three clients.

/** Which tier produced a result, and what it cost to say so. */
export type Tiered<T> = T & { source: AiSource; model?: string }

/**
 * Model resolution lives in env vars so the model changes without touching
 * application logic. Primary and fallback deliberately sit in different
 * provider families, so one vendor outage cannot take both (CLAUDE.md §2).
 *
 * These defaults are gateway slugs of the form `creator/model`. Confirm them
 * against your gateway's model list before relying on the fallback tier — an
 * unknown slug is not a crash, it just falls through to the next tier, which
 * is quiet enough to be missed.
 */
const PRIMARY_MODEL = process.env.AI_PRIMARY_MODEL ?? "anthropic/claude-opus-5"
const FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL ?? "openai/gpt-5.1"

/**
 * The gateway's own convention is `AI_GATEWAY_API_KEY`; this repo's `.env.local`
 * had `AI_API_KEY`. Both are read so the code and the environment agree without
 * a rename in a gitignored file (CLAUDE.md §7). The value is never logged.
 */
const API_KEY = process.env.AI_GATEWAY_API_KEY ?? process.env.AI_API_KEY

/** One attempt should not hold a decision open. */
const TIMEOUT_MS = 15_000

/**
 * The one call the tiers make. Taking it as a seam is what lets the model change
 * without application logic changing — and lets the validation path be tested
 * without a live provider.
 */
export type Generator = (args: {
  modelId: string
  schema: ZodType
  system: string
  prompt: string
}) => Promise<unknown>

const gatewayGenerator: Generator = async ({
  modelId,
  schema,
  system,
  prompt,
}) => {
  if (!API_KEY) throw new Error("No AI credentials configured.")
  const gateway = createGateway({ apiKey: API_KEY })
  const { object } = await generateObject({
    model: gateway(modelId),
    schema,
    system,
    prompt,
    // The tier ladder is the retry strategy; retrying inside an attempt only
    // delays the fall to a provider that is actually up.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    // No temperature or top_p: the current Claude and GPT generations reject
    // non-default sampling parameters outright.
  })
  return object
}

/**
 * Primary model → fallback model → seeded result, in that order, every result
 * labeled with the tier that produced it.
 *
 * Model output is untrusted input: every tier is validated against the schema
 * here, at the boundary. Invalid output falls to the next tier — it is never
 * cast into shape.
 *
 * Failure is a value, not an exception. The caller gets `{ ok: false, message }`
 * and can park the ticket honestly instead of catching a stack trace.
 */
export async function runStage<T extends object>(args: {
  schema: ZodType<T>
  system: string
  prompt: string
  /** Tier 3. Ships with the ticket row, so degraded mode is a designed path. */
  seed: unknown
  generate?: Generator
}): Promise<Result<Tiered<T>>> {
  const { schema, system, prompt, seed, generate = gatewayGenerator } = args
  const failures: string[] = []

  const tiers: { source: AiSource; modelId?: string }[] = [
    { source: "model", modelId: PRIMARY_MODEL },
    { source: "fallback", modelId: FALLBACK_MODEL },
  ]

  for (const { source, modelId } of tiers) {
    if (!modelId) {
      failures.push(`${source}: no model configured`)
      continue
    }
    try {
      const raw = await generate({ modelId, schema, system, prompt })
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        failures.push(`${source} (${modelId}): output failed validation`)
        continue
      }
      return { ok: true, data: { ...parsed.data, source, model: modelId } }
    } catch {
      // The reason is deliberately not interpolated: provider errors can echo
      // request contents, and secrets never reach a log (CLAUDE.md §7).
      failures.push(`${source} (${modelId}): request failed`)
    }
  }

  const seeded = schema.safeParse(seed)
  if (seeded.success) {
    return { ok: true, data: { ...seeded.data, source: "seed" } }
  }

  return {
    ok: false,
    message: `No tier produced a usable result. ${failures.join("; ")}; seed: ${
      seed === undefined || seed === null
        ? "absent"
        : "present but failed validation"
    }. The ticket was left where it was.`,
  }
}
