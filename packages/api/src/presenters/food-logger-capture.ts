import type { FoodDraftCandidateWire } from "../contracts/nutrition-food-drafts";
import { msg } from "@lingui/core/macro";

/** Draft-only item handed to a diary surface; it has no logging semantics. */
export type FoodLoggerCaptureItem = FoodDraftCandidateWire & {
  /** Unique within this capture run, even if the server reuses candidate ids. */
  id: string;
};

/** Native inline capture labels; shared descriptors keep extraction in one place. */
export const FOOD_LOGGER_CAPTURE_COPY = Object.freeze({
  what: msg`What did you have?`,
  example: msg`Two eggs, a slice of toast and a coffee`,
  aiToggle: msg`Use the AI provider for this draft`,
  sendText: msg({
    message: "Send this text, and nothing else, to {provider} now.",
    comment: "safety",
  }),
  agreeText: msg`Agree to send this text to the AI provider now`,
  makeDraft: msg`Make a draft`,
  working: msg`Working…`,
  draftFailed: msg`Could not make a draft. Nothing was saved.`,
  takePhoto: msg`Take a meal photo`,
  takePhotoAction: msg`Take photo`,
  cameraOpening: msg`Opening camera…`,
  cameraDenied: msg`Camera permission is off. Allow camera access in Settings to take a photo.`,
  cameraUnavailable: msg`Camera is unavailable. Try again later.`,
  openSettings: msg`Open Settings`,
  photoReady: msg`Photo ready to review`,
  sendPhoto: msg({
    message: "Send this photo, and nothing else, to {provider} now.",
    comment: "safety",
  }),
  agreePhoto: msg`Agree to send this photo to the AI provider now`,
  agreePhotoLabel: msg`I agree to send this photo now`,
  makePhotoDraft: msg`Make a draft from this photo`,
  hideNumbers: msg`Amounts hidden`,
});

/** Make candidate identity local to a single run so parallel drafts cannot collide. */
export function identifyCaptureCandidates(
  candidates: readonly FoodDraftCandidateWire[],
  runId: string,
): FoodLoggerCaptureItem[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: `${runId}:${index}:${candidate.id}`,
  }));
}
