/**
 * Pain log copy and formatting (Issue #442), shared by web and mobile.
 *
 * A pain entry is a record of what the member rated. The copy never names a
 * cause, a diagnosis or a pattern, and nothing changes with the value: a 9
 * reads the same way as a 2, number aside. The one notice is fixed and always
 * shown on the pain screens (`PAIN_COPY.notice`).
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { painRegionLabel } from "./body-map";
import { workoutTypeLabel } from "./workouts";

export {
  PAIN_TYPE_LABELS,
  PAIN_TYPE_OPTIONS,
  painEntrySummary,
  painRatingText,
  painTypeLabel,
} from "./pain-entry";

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
