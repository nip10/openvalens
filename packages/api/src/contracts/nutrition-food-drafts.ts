import { z } from "zod";

/**
 * `nutritionFoodDrafts.*` wire contract (Issue #73): turning a spoken or typed
 * meal description into unresolved food candidates. Shared by the server
 * router, `apps/web` and `apps/native`, so this file imports only `zod`.
 *
 * Audio never reaches the server: the device transcribes. A draft is never
 * stored and never carries nutrient values; the member matches each
 * candidate to a food and confirms it through `nutritionDiary.logEntry`.
 */

export const FOOD_DRAFT_MODES = ["local", "ai"] as const;

export const foodDraftProviderOutput = z.object({
  /** Whether a provider is configured for the optional AI mode. */
  available: z.boolean(),
  provider: z.string().nullable(),
  /** Hostname the transcript would be sent to. */
  host: z.string().nullable(),
});
export type FoodDraftProvider = z.infer<typeof foodDraftProviderOutput>;

export const parseFoodDraftInput = z.strictObject({
  transcript: z.string().max(2_000),
  mode: z.enum(FOOD_DRAFT_MODES),
  /**
   * Required for `ai`: the provider and host the member was shown and
   * agreed to send this transcript to, just now.
   */
  sendToProvider: z.strictObject({ provider: z.string(), host: z.string().nullable() }).optional(),
});
export type ParseFoodDraftInput = z.infer<typeof parseFoodDraftInput>;

export const foodDraftCandidate = z.object({
  id: z.string(),
  sourceText: z.string(),
  foodText: z.string(),
  quantityText: z.string().nullable(),
  quantity: z.number().nullable(),
  unitText: z.string().nullable(),
  flags: z.array(z.enum(["no_quantity", "vague_quantity", "no_unit", "unsure_food"])),
});
export type FoodDraftCandidateWire = z.infer<typeof foodDraftCandidate>;

export const parseFoodDraftOutput = z.object({
  status: z.enum([
    "ready",
    "empty",
    "unrecognized",
    "too_long",
    /** The member has not turned voice drafts on. */
    "disabled",
    /** AI mode was asked for but no provider is configured. */
    "ai_unavailable",
    /** AI mode without a matching, contemporaneous provider confirmation. */
    "consent_required",
    /** The provider replied with nothing usable; nothing was guessed. */
    "unparseable",
  ]),
  mode: z.enum(FOOD_DRAFT_MODES),
  candidates: z.array(foodDraftCandidate),
});
export type ParseFoodDraftOutput = z.infer<typeof parseFoodDraftOutput>;

/** Upload limit before decoding; the sanitizer enforces the same bound. */
export const FOOD_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * `nutritionFoodDrafts.parsePhoto` (Issue #71). The photo is decoded and
 * re-encoded on the server, which drops EXIF and location, sent once to the
 * provider the member just confirmed, and then discarded: it is never stored.
 */
export const parsePhotoFoodDraftInput = z.strictObject({
  photo: z.instanceof(Blob).refine((file) => file.size > 0 && file.size <= FOOD_PHOTO_MAX_BYTES, {
    message: "Choose a JPEG or PNG photo up to 10 MB.",
  }),
  /** The provider and host the member was shown and agreed to send this photo to, just now. */
  sendToProvider: z.strictObject({ provider: z.string(), host: z.string().nullable() }),
});
export type ParsePhotoFoodDraftInput = z.infer<typeof parsePhotoFoodDraftInput>;

export const parsePhotoFoodDraftOutput = z.object({
  status: z.enum([
    "ready",
    /** No food could be made out; nothing was guessed. */
    "unrecognized",
    /** The member has not turned photo drafts on. */
    "disabled",
    "ai_unavailable",
    /** No matching, contemporaneous provider confirmation; nothing was sent. */
    "consent_required",
    /** Not a readable JPEG or PNG; nothing was sent. */
    "invalid_photo",
    "unparseable",
    /** The provider refused or failed the request (for example, no image support). */
    "provider_error",
  ]),
  candidates: z.array(foodDraftCandidate),
});
export type ParsePhotoFoodDraftOutput = z.infer<typeof parsePhotoFoodDraftOutput>;
