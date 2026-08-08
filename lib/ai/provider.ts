import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGateway, generateObject } from "ai"
import type { ZodType } from "zod"

import type { AiSource, Result } from "@/lib/types"

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

/**
 * Which tier produced a result, and what it cost to say so.
 *
 * `degraded` is set when an earlier tier was tried and did not produce a usable
 * result, on a call that nonetheless succeeded further down the ladder. A
 * provider outage that the seed absorbed is still an outage, and one the operator
 * is entitled to know about — without it, a survived failure is indistinguishable
 * from a clean run (CLAUDE.md §1). Absent when the first tier answered.
 */
export type Tiered<T> = T & {
  source: AiSource
  model?: string
  degraded?: string
}

/**
 * Model resolution lives in env vars so the model changes without touching
 * application logic.
 *
 * A value containing `/` is a gateway slug (`creator/model`) and is routed
 * through the AI Gateway; anything else is a Google model ID reached natively.
 * That is what lets these defaults be free-tier Google while a cross-family
 * fallback stays one env var away.
 *
 * Both defaults were confirmed against this key's ListModels *and* by a live
 * structured generation — an unknown or retired model ID is not a crash, it
 * falls quietly to the next tier, which is exactly how a dead fallback hides.
 * `gemini-2.0-flash` and `gemini-1.5-flash` are deliberately not used: the
 * first is over quota on the free tier, the second is retired for projects
 * created after April 2025 and no longer appears in ListModels at all.
 *
 * ponytail: both tiers are one vendor on one key, so quota exhaustion or a
 * Google-wide outage takes both and lands on the seed. CLAUDE.md §2 wants the
 * fallback in a different provider family; one free provider cannot satisfy
 * that. Set AI_FALLBACK_MODEL to a gateway slug (e.g. `anthropic/claude-opus-5`)
 * with AI_GATEWAY_API_KEY present to get real cross-family cover — the routing
 * below already handles it, no code change needed.
 */
export const PRIMARY_MODEL =
  process.env.AI_PRIMARY_MODEL ?? "gemini-flash-lite-latest"
export const FALLBACK_MODEL =
  process.env.AI_FALLBACK_MODEL ?? "gemini-3.5-flash-lite"

/**
 * `@ai-sdk/google` reads `GOOGLE_GENERATIVE_AI_API_KEY` natively; it is passed
 * explicitly so a missing key is a named failure on the tier rather than a
 * surprise from inside the SDK. Neither value is ever logged (CLAUDE.md §7).
 */
const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY

/**
 * The gateway's own convention is `AI_GATEWAY_API_KEY`; this repo's `.env.local`
 * had `AI_API_KEY`. Both are read so the code and the environment agree without
 * a rename in a gitignored file (CLAUDE.md §7).
 */
const GATEWAY_API_KEY =
  process.env.AI_GATEWAY_API_KEY ?? process.env.AI_API_KEY

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

/**
 * A gateway slug (`creator/model`) goes through the AI Gateway; a bare ID is a
 * Google model reached natively. Each path needs its own key, and a missing one
 * throws here so the ladder records it as that tier failing rather than as a
 * fault inside the SDK.
 */
function resolveModel(modelId: string) {
  if (modelId.includes("/")) {
    if (!GATEWAY_API_KEY) throw new Error("No gateway credentials configured.")
    return createGateway({ apiKey: GATEWAY_API_KEY })(modelId)
  }
  if (!GOOGLE_API_KEY) throw new Error("No Google credentials configured.")
  return createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY })(modelId)
}

const liveGenerator: Generator = async ({
  modelId,
  schema,
  system,
  prompt,
}) => {
  const { object } = await generateObject({
    model: resolveModel(modelId),
    schema,
    system,
    prompt,
    // The tier ladder is the retry strategy; retrying inside an attempt only
    // delays the fall to a provider that is actually up.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    // No temperature or top_p: provider defaults, deliberately. Classification
    // wants the least creative reading available, and some gateway-routed
    // models reject non-default sampling parameters outright.
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
  const { schema, system, prompt, seed, generate = liveGenerator } = args
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
      return {
        ok: true,
        data: {
          ...parsed.data,
          source,
          model: modelId,
          // A tier that answered after an earlier one failed is still a degraded
          // run, and saying so is the difference between a survived outage and a
          // clean one. These are the sanitized strings collected above — never
          // raw provider text, which can echo the request (CLAUDE.md §7).
          ...(failures.length ? { degraded: failures.join("; ") } : {}),
        },
      }
    } catch {
      // The reason is deliberately not interpolated: provider errors can echo
      // request contents, and secrets never reach a log (CLAUDE.md §7).
      failures.push(`${source} (${modelId}): request failed`)
    }
  }

  const seeded = schema.safeParse(seed)
  if (seeded.success) {
    // Reaching here means both model tiers were tried, so there is always
    // something to report. A seeded result that did not say why it was seeded
    // would read as a configuration choice rather than an outage.
    return {
      ok: true,
      data: { ...seeded.data, source: "seed", degraded: failures.join("; ") },
    }
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
