import {
  AiConsentError,
  describeAiEndpoint,
  describeAiIntegration,
  extractStructured,
  requireAiConsent,
  type AiConfig,
  type AiUsageMeter,
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

import { beginAiUsage } from "./ai-usage";
import type {
  FoodDraftProvider,
  ParseFoodDraftInput,
  ParseFoodDraftOutput,
  ParsePhotoFoodDraftInput,
  ParsePhotoFoodDraftOutput,
} from "./contracts/nutrition-food-drafts";

/**
 * Food drafts from a description (Issue #73). `local` mode parses on this
 * server with no third party involved. `ai` mode sends the transcript text,
 * and nothing else, to the configured provider, and only when the request
 * names the exact provider and host the member just agreed to; a stale or
 * missing confirmation sends nothing. Neither mode stores the transcript or
 * the draft, and neither produces nutrient values.
 *
 * Photo drafts (Issue #71) follow the same rules: the photo is re-encoded
 * without metadata, sent once to the confirmed provider, and dropped. No
 * portion weights or nutrient values are asked for or kept.
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

const photoReply = z.object({
  items: z
    .array(
      z.object({
        food: z.string().max(FOOD_DRAFT_LIMITS.maxFoodTextChars),
        quantity: z.string().max(40).nullable(),
        unit: z.string().max(40).nullable(),
        unsure: z.boolean().optional(),
      }),
    )
    .max(FOOD_DRAFT_LIMITS.maxCandidates),
});

const PHOTO_PROMPT =
  'List each food or drink you can see in this photo. For each, give a short plain name. Give a quantity only when items are clearly countable (for example "2"), with a unit only for a visible container or piece (for example "slice", "bowl", "glass"); otherwise null. Set "unsure" to true when you cannot tell what an item is. Do not estimate weights, volumes or portions, and do not give any nutrition values. If no food is clearly visible, return {"items":[]}.';
const PHOTO_SHAPE =
  '{"items":[{"food":string,"quantity":string|null,"unit":string|null,"unsure":boolean}]}';

export class FoodDraftError extends Error {
  constructor(readonly code: "AI_DISABLED" | "RATE_LIMITED") {
    super(code);
  }
}

export type FoodDraftDeps = { extract?: typeof extractStructured };

type AiDeps = {
  config: AiConfig;
  rateLimiter: Pick<InMemoryRateLimiter, "check">;
  /** Monthly AI usage cap (Issue #299); absent = nothing recorded, no cap. */
  usage?: { meter: AiUsageMeter | undefined; correlationId: string };
};

/** Checks the monthly AI cap for the member; throws `AI_USAGE_LIMIT_REACHED`. */
function beginUsage(ai: AiDeps, scope: NutritionScope, promptChars: number) {
  return beginAiUsage({
    meter: ai.usage?.meter,
    userId: scope.userId,
    promptChars,
    correlationId: ai.usage?.correlationId ?? "",
  });
}

/** True only when the request names the provider and host this server would use. */
function confirmedFor(
  config: AiConfig,
  confirmed: { provider: string; host: string | null } | undefined,
): boolean {
  const provider = describeFoodDraftProvider(config);
  return (
    confirmed !== undefined &&
    confirmed.provider === provider.provider &&
    confirmed.host === provider.host
  );
}

async function requireMemberAiConsent(db: Database, scope: NutritionScope): Promise<void> {
  try {
    await requireAiConsent(db, scope.organizationId, "chat", scope.userId);
  } catch (error) {
    if (error instanceof AiConsentError) throw new FoodDraftError("AI_DISABLED");
    throw error;
  }
}

function checkRate(ai: AiDeps, scope: NutritionScope): void {
  if (!ai.rateLimiter.check(`${scope.userId}:${scope.organizationId}`).allowed)
    throw new FoodDraftError("RATE_LIMITED");
}

function toCandidates(items: Parameters<typeof candidateFromParts>[0][]): FoodDraftCandidate[] {
  return items
    .map((item, index) => candidateFromParts(item, index))
    .filter((candidate): candidate is FoodDraftCandidate => candidate !== null);
}

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
      ai: AiDeps,
    ): Promise<ParseFoodDraftOutput> {
      const settings = await readNutritionTargetSettings(db, scope);
      if (!settings.voiceDraftsEnabled)
        return { status: "disabled", mode: input.mode, candidates: [] };

      if (input.mode === "local") {
        const result = parseFoodTranscript(input.transcript);
        return { status: result.status, mode: "local", candidates: result.candidates };
      }

      if (!describeFoodDraftProvider(ai.config).available)
        return { status: "ai_unavailable", mode: "ai", candidates: [] };
      if (!confirmedFor(ai.config, input.sendToProvider))
        return { status: "consent_required", mode: "ai", candidates: [] };
      const text = input.transcript.trim();
      if (!text) return { status: "empty", mode: "ai", candidates: [] };

      await requireMemberAiConsent(db, scope);
      checkRate(ai, scope);

      const usage = await beginUsage(ai, scope, text.length + PROMPT.length + SHAPE.length);
      let reply: Awaited<ReturnType<typeof extract<z.infer<typeof providerReply>>>>;
      try {
        reply = await extract({
          config: ai.config,
          text,
          promptHint: PROMPT,
          jsonShape: SHAPE,
          schema: providerReply,
          onUsage: usage.record,
        });
      } finally {
        await usage.finish();
      }
      if (reply.status !== "ok") return { status: "unparseable", mode: "ai", candidates: [] };
      const candidates = toCandidates(reply.data.items);
      return {
        status: candidates.length ? "ready" : "unrecognized",
        mode: "ai",
        candidates,
      };
    },

    /**
     * Photo drafts (Issue #71). Every gate is checked before the photo leaves
     * this server; the sanitized bytes live only for the one provider call.
     */
    async parsePhoto(
      db: Database,
      scope: NutritionScope,
      input: ParsePhotoFoodDraftInput,
      ai: AiDeps,
    ): Promise<ParsePhotoFoodDraftOutput> {
      const settings = await readNutritionTargetSettings(db, scope);
      if (!settings.photoDraftsEnabled) return { status: "disabled", candidates: [] };
      if (!describeFoodDraftProvider(ai.config).available)
        return { status: "ai_unavailable", candidates: [] };
      if (!confirmedFor(ai.config, input.sendToProvider))
        return { status: "consent_required", candidates: [] };
      await requireMemberAiConsent(db, scope);

      // Loaded on demand: Sharp is a native module only the server needs.
      const { ImageSanitizationError, sanitizeImage } =
        await import("@openvalens/body/sanitize-image");
      let image: { bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" };
      try {
        const sanitized = await sanitizeImage(new Uint8Array(await input.photo.arrayBuffer()));
        image = { bytes: new Uint8Array(sanitized.bytes), mediaType: sanitized.contentType };
      } catch (error) {
        if (error instanceof ImageSanitizationError)
          return { status: "invalid_photo", candidates: [] };
        throw error;
      }
      checkRate(ai, scope);

      // An image costs far more than its byte count suggests; reserve for the
      // prompt plus a generous image allowance (about 1,600 tokens).
      const usage = await beginUsage(ai, scope, PHOTO_PROMPT.length + PHOTO_SHAPE.length + 4_800);
      let reply: Awaited<ReturnType<typeof extract<z.infer<typeof photoReply>>>>;
      try {
        reply = await extract({
          config: ai.config,
          text: "",
          promptHint: PHOTO_PROMPT,
          jsonShape: PHOTO_SHAPE,
          schema: photoReply,
          image,
          onUsage: usage.record,
        });
      } catch {
        return { status: "provider_error", candidates: [] };
      } finally {
        await usage.finish();
      }
      if (reply.status !== "ok") return { status: "unparseable", candidates: [] };
      const candidates = toCandidates(reply.data.items);
      return { status: candidates.length ? "ready" : "unrecognized", candidates };
    },
  };
}

export type FoodDraftService = ReturnType<typeof createFoodDraftService>;
