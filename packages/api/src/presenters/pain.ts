/**
 * Pain log copy and formatting (Issue #442), shared by web and mobile.
 *
 * A pain entry is a record of what the member rated. The copy never names a
 * cause, a diagnosis or a pattern, and nothing changes with the value: a 9
 * reads the same way as a 2, number aside. The one notice is fixed and always
 * shown on the pain screens (`PAIN_COPY.notice`).
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { PAIN_RATING_MAX, PAIN_TYPES, type PainType } from "@openvalens/pain/model";

import { painRegionLabel } from "./body-map";
import { workoutTypeLabel } from "./workouts";

export const PAIN_TYPE_LABELS: Readonly<Record<PainType, MessageDescriptor>> = Object.freeze({
  ache: msg({ message: "Ache", context: "pain type" }),
  sharp: msg({ message: "Sharp", context: "pain type" }),
  burning: msg({ message: "Burning", context: "pain type" }),
  throbbing: msg({ message: "Throbbing", context: "pain type" }),
  stiffness: msg({ message: "Stiffness", context: "pain type" }),
  tingling: msg({ message: "Tingling", context: "pain type" }),
});

export const PAIN_TYPE_OPTIONS: readonly PainType[] = PAIN_TYPES;

export function painTypeLabel(type: string | null | undefined): MessageDescriptor | null {
  return type && Object.hasOwn(PAIN_TYPE_LABELS, type) ? PAIN_TYPE_LABELS[type as PainType] : null;
}

export const PAIN_COPY = Object.freeze({
  /** Fixed and always shown on the pain screens; never triggered by a value. */
  notice: msg({
    message:
      "This is a record, not a diagnosis. Talk to a healthcare professional about pain that is severe, sudden or not getting better.",
    comment: "safety",
  }),
  layer: msg`The highest rating you logged in each region. Regions with no rating stay grey. The joint spots appear only on this layer.`,
  offTitle: msg`The pain log is off`,
  offBody: msg`Turn it on to record where it hurts, a rating from 0 to 10, and what it feels like. Only you can see it. It is off by default.`,
  turnOn: msg`Turn on the pain log`,
  enabled: msg`Keep a pain log`,
  enabledDetail: msg`Turning it off hides your pain log everywhere. Nothing is deleted.`,
  aiVisible: msg`Coach and connected AI apps can read my pain log`,
  aiVisibleDetail: msg`Off by default. Connected AI apps also need the pain log permission.`,
  history: msg`Your ratings for this region, newest first, with the workouts you logged that day or the two days before.`,
  noHistory: msg`No ratings for this region yet.`,
  rating: msg`Rating from 0 to 10`,
});

/** "4 of 10". */
export function painRatingText(rating: number, i18n: I18n): string {
  const max = PAIN_RATING_MAX;
  return i18n._(msg`${rating} of ${max}`);
}

/** "4 of 10 · Ache". */
export function painEntrySummary(entry: { rating: number; type: string | null }, i18n: I18n) {
  const rating = painRatingText(entry.rating, i18n);
  const type = painTypeLabel(entry.type);
  return type ? `${rating} · ${i18n._(type)}` : rating;
}

/** The localized region name, or the id for a region this app does not know. */
export function painRegionText(region: string, i18n: I18n): string {
  const label = painRegionLabel(region);
  return label ? i18n._(label) : region;
}

export type PainWorkoutFactLike = {
  type: string;
  durationMinutes: number | null;
  daysBefore: number;
};

/**
 * A workout near a rating, as a plain fact: "Run, 45 min, the day before".
 * Only the type, the logged duration and the day; nothing links it to the
 * rating.
 */
export function painWorkoutFact(fact: PainWorkoutFactLike, i18n: I18n): string {
  const type = i18n._(workoutTypeLabel(fact.type));
  const minutes = fact.durationMinutes;
  if (minutes !== null && minutes > 0) {
    if (fact.daysBefore === 0) return i18n._(msg`${type}, ${minutes} min, the same day`);
    if (fact.daysBefore === 1) return i18n._(msg`${type}, ${minutes} min, the day before`);
    return i18n._(msg`${type}, ${minutes} min, 2 days before`);
  }
  if (fact.daysBefore === 0) return i18n._(msg`${type}, the same day`);
  if (fact.daysBefore === 1) return i18n._(msg`${type}, the day before`);
  return i18n._(msg`${type}, 2 days before`);
}
