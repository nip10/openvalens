/**
 * TypeScript port of Gadgetbridge's sleep-session types.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/model/SleepStage.java`,
 * `SleepSession.java`, and `ActivityKind.java` (the subset the session layer uses).
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/model/SleepSession.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Time convention: every timestamp is **epoch milliseconds** (a plain
 * `number`, UTC), matching `packages/sleep/src/estimator`. Upstream used
 * epoch seconds for activity samples and epoch milliseconds for stages; this
 * module uses milliseconds everywhere so the two layers compose without a
 * unit change at the boundary.
 *
 * Stage kinds map to upstream `ActivityKind` as:
 * - `light`  → `LIGHT_SLEEP`
 * - `deep`   → `DEEP_SLEEP`
 * - `rem`    → `REM_SLEEP`
 * - `any`    → `SLEEP_ANY` (sleep, but not attributable to light/deep/REM)
 * - `awake`  → `AWAKE_SLEEP` (awake inside a sleep session)
 *
 * `ActivityKind.isSleep` is true for all five of the above and false for
 * `ACTIVITY`, `UNKNOWN` and `NOT_WORN`.
 */

/** Pinned upstream revision this port was taken from. */
export const SLEEP_SESSIONS_UPSTREAM_REVISION = "8976702fc3d00e6008c91fe994668cb4027f7bc2";

/** The kinds a `SleepStage` may carry, mirroring upstream `SleepStage`'s documented set. */
export type SleepStageKind = "light" | "deep" | "rem" | "any" | "awake";

/** The kinds an activity sample may carry: the sleep kinds plus non-sleep activity. */
export type ActivitySampleKind = SleepStageKind | "activity" | "unknown" | "not_worn";

/** One ordered stage of a sleep session, `[start, end)` in epoch milliseconds. */
export type SleepStage = {
  kind: SleepStageKind;
  start: number;
  end: number;
};

/**
 * A complete sleep session: an ordered, contiguous list of stages. `start`
 * and `end` mirror upstream `SleepSession.getStartTime()`/`getEndTime()`,
 * i.e. the first stage's start and the last stage's end.
 */
export type SleepSession = {
  start: number;
  end: number;
  stages: SleepStage[];
};

/** A session as persisted, with the identity used by the overlap-replace pattern. */
export type StoredSleepSession = SleepSession & {
  id: string;
};

/**
 * A newly detected session. `id` is the caller's id for a brand-new night;
 * when the candidate overlaps a stored session, `replaceOverlappingSessions`
 * keeps the stored id instead.
 */
export type SleepSessionCandidate = StoredSleepSession;

/** One activity sample, as the segmenter consumes it. `time` is epoch milliseconds. */
export type SleepActivitySample = {
  time: number;
  kind: ActivitySampleKind;
  steps: number;
};

/** Upstream `ActivityKind.isSleep`. */
export function isSleepKind(kind: ActivitySampleKind): kind is SleepStageKind {
  return (
    kind === "light" || kind === "deep" || kind === "rem" || kind === "any" || kind === "awake"
  );
}

/**
 * Builds a session from its stages, deriving the bounds the way upstream
 * `SleepSession` does. Throws on an empty stage list, as upstream does.
 */
export function makeSleepSession(stages: readonly SleepStage[]): SleepSession {
  if (stages.length === 0) {
    throw new Error("A sleep session must have at least one stage");
  }
  return {
    start: stages[0]!.start,
    end: stages[stages.length - 1]!.end,
    stages: [...stages],
  };
}

/** Upstream `SleepStage.getDuration()`: whole seconds, truncated toward zero. */
export function stageDurationSeconds(stage: SleepStage): number {
  return Math.trunc((stage.end - stage.start) / 1000);
}

/** Upstream `SleepSession.getDuration(kind)`: seconds spent in one stage kind. */
export function sessionDurationSeconds(session: SleepSession, kind: SleepStageKind): number {
  let total = 0;
  for (const stage of session.stages) {
    if (stage.kind === kind) total += stageDurationSeconds(stage);
  }
  return total;
}

/**
 * Upstream `SleepSession.getTotalSleepDuration()`: light + deep + REM +
 * sleep-any, excluding awake.
 */
export function totalSleepDurationSeconds(session: SleepSession): number {
  return (
    sessionDurationSeconds(session, "light") +
    sessionDurationSeconds(session, "deep") +
    sessionDurationSeconds(session, "rem") +
    sessionDurationSeconds(session, "any")
  );
}
