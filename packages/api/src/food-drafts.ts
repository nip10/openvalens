import {
  AiConsentError,
  describeAiEndpoint,
  describeAiIntegration,
  extractStructured,
  requireAiConsent,
  type AiConfig,
  type InMemoryRateLimiter,
} from "@openvalens/ai";
import type { Database } from "@openvalens/db";
import type { NutritionScope } from "@openvalens/nutrition";
import {
  candidateFromParts,
  FOOD_DRAFT_LIMITS,
  parseFoodTranscript,
  type FoodDraftCandidate,
} from "@openvalens/nutrition/food-draft";
import { readNutritionTargetSettings } from "@openvalens/nutrition/targets";
import { z } from "zod";

import type {
  FoodDraftProvider,
  ParseFoodDraftInput,
  ParseFoodDraftOutput,
} from "./contracts/nutrition-food-drafts";

/**
 * Food drafts from a description (Issue #73). `local` mode parses on this
 * server with no third party involved. `ai` mode sends the transcript text,
 * and nothing else, to the configured provider, and only when the request
 * names the exact provider and host the member just agreed to; a stale or
 * missing confirmation sends nothing. Neither mode stores the transcript or
 * the draft, and neither produces nutrient values.
 */

const providerReply = z.object({
  items: z
    .array(
      z.object({
        food: z.string().max(FOOD_DRAFT_LIMITS.maxFoodTextChars),
        quantity: z.string().max(40).nullable(),
        unit: z.string().max(40).nullable(),
      }),
    )
    .max(FOOD_DRAFT_LIMITS.maxCandidates),
});

const PROMPT =
  "List each food or drink the person says they had. For each, give the food as they named it, the quantity exactly as stated (or null), and the unit exactly as stated (or null). Do not estimate portions, guess missing quantities, add foods, or give any nutrition values.";
const SHAPE = '{"items":[{"food":string,"quantity":string|null,"unit":string|null}]}';

export class FoodDraftError extends Error {
  constructor(readonly code: "AI_DISABLED" | "RATE_LIMITED") {
    super(code);
  }
}

export type FoodDraftDeps = { extract?: typeof extractStructured };

export function describeFoodDraftProvider(config: AiConfig): FoodDraftProvider {
  if (describeAiIntegration(config).state !== "configured")
    return { available: false, provider: null, host: null };
  const endpoint = describeAiEndpoint(config);
  return { available: true, provider: endpoint.provider, host: endpoint.host };
}

export function createFoodDraftService(deps: FoodDraftDeps = {}) {
  const extract = deps.extract ?? extractStructured;
  return {
    async parse(
      db: Database,
      scope: NutritionScope,
      input: ParseFoodDraftInput,
      ai: { config: AiConfig; rateLimiter: Pick<InMemoryRateLimiter, "check"> },
    ): Promise<ParseFoodDraftOutput> {
      const settings = await readNutritionTargetSettings(db, scope);
      if (!settings.voiceDraftsEnabled)
        return { status: "disabled", mode: input.mode, candidates: [] };

      if (input.mode === "local") {
        const result = parseFoodTranscript(input.transcript);
        return { status: result.status, mode: "local", candidates: result.candidates };
      }

      const provider = describeFoodDraftProvider(ai.config);
      if (!provider.available) return { status: "ai_unavailable", mode: "ai", candidates: [] };
      const confirmed = input.sendToProvider;
      if (
        !confirmed ||
        confirmed.provider !== provider.provider ||
        confirmed.host !== provider.host
      )
        return { status: "consent_required", mode: "ai", candidates: [] };
      const text = input.transcript.trim();
      if (!text) return { status: "empty", mode: "ai", candidates: [] };

      try {
        await requireAiConsent(db, scope.organizationId, "chat", scope.userId);
      } catch (error) {
        if (error instanceof AiConsentError) throw new FoodDraftError("AI_DISABLED");
        throw error;
      }
      if (!ai.rateLimiter.check(`${scope.userId}:${scope.organizationId}`).allowed)
        throw new FoodDraftError("RATE_LIMITED");

      const reply = await extract({
        config: ai.config,
        text,
        promptHint: PROMPT,
        jsonShape: SHAPE,
        schema: providerReply,
      });
      if (reply.status !== "ok") return { status: "unparseable", mode: "ai", candidates: [] };
      const candidates = reply.data.items
        .map((item, index) => candidateFromParts(item, index))
        .filter((candidate): candidate is FoodDraftCandidate => candidate !== null);
      return {
        status: candidates.length ? "ready" : "unrecognized",
        mode: "ai",
        candidates,
      };
    },
  };
}

export type FoodDraftService = ReturnType<typeof createFoodDraftService>;
