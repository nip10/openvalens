/**
 * Step-session segmentation and activity-kind inference, ported from
 * Gadgetbridge's `StepAnalysis`.
 *
 * Pure TypeScript with no runtime dependencies. Ported at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2; AGPL-3.0-or-later, same as
 * upstream.
 *
 * Porting deviations:
 * - Samples are sorted by time before processing; upstream assumes ordered
 *   input. Unsorted input therefore produces the same sessions as sorted
 *   input.
 * - Workout intervals are a plain `[start, end)` union. Upstream's `RangeMap`
 *   can reset to "not a workout" at an interval end that falls inside another
 *   overlapping interval; the union is the intended semantics.
 * - Recorded workout sessions are not synthesized. Upstream appends an
 *   `ActivitySession` per workout from its `BaseActivitySummary`; this pure
 *   input carries only intervals, so callers merge their own workout sessions.
 *   Workout samples are still excluded from segmentation and counted in
 *   `totalDailySteps`.
 * - `TrailingActivitySample` is Android/DB-specific and is not modelled;
 *   canonical per-minute samples do not carry it.
 */

export * from "./types";
export * from "./segment";
export * from "./summary";
