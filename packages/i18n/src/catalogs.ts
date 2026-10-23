import type { Messages } from "@lingui/core";

import type { Locale } from "./locales";
import { messages as en } from "./locales/en/messages";
import { messages as ptPT } from "./locales/pt-PT/messages";
import reviewState from "./review-state.json";
import { SAFETY_MESSAGE_IDS } from "./safety-ids";

/**
 * Catalog loading with review-state fallbacks (#67).
 *
 * - English is always loaded underneath, so a message missing from a
 *   translation renders in English rather than as an id.
 * - A locale whose `status` is not `reviewed` is a community translation: its
 *   strings are shown (with a badge in settings), except messages tagged
 *   `safety` (units, reference-range flags, medication and dosing labels,
 *   consent text). Those stay English until a reviewer approves them, by
 *   listing the id in `approvedSafetyIds` or marking the locale `reviewed`.
 *
 * Review state is maintained by reviewers in `review-state.json`.
 */

export type ReviewStatus = "reviewed" | "community";
type ReviewEntry = { status: ReviewStatus; approvedSafetyIds: string[] };

const CATALOGS: Readonly<Record<Locale, Messages>> = { en, "pt-PT": ptPT };
const REVIEW: Readonly<Partial<Record<Locale, ReviewEntry>>> = reviewState as Record<
  string,
  ReviewEntry
>;

export function reviewStatusOf(locale: Locale): ReviewStatus {
  if (locale === "en") return "reviewed";
  return REVIEW[locale]?.status === "reviewed" ? "reviewed" : "community";
}

/** The messages to activate for `locale`, with the fallbacks above applied. */
export function messagesFor(
  locale: Locale,
  catalogs: Readonly<Record<Locale, Messages>> = CATALOGS,
  review: Readonly<Partial<Record<Locale, ReviewEntry>>> = REVIEW,
  safetyIds: ReadonlySet<string> = SAFETY_MESSAGE_IDS,
): Messages {
  const source = catalogs.en;
  if (locale === "en") return source;
  const entry = review[locale];
  const reviewed = entry?.status === "reviewed";
  const approved = new Set(entry?.approvedSafetyIds ?? []);
  const merged: Messages = { ...source };
  for (const [id, message] of Object.entries(catalogs[locale])) {
    if (!reviewed && safetyIds.has(id) && !approved.has(id)) continue;
    merged[id] = message;
  }
  return merged;
}
