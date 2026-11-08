/**
 * Workout statistics aggregation math, ported from Gadgetbridge's
 * `StatisticsAggregation.kt` at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 *
 * Pure TypeScript, no runtime dependencies. AGPL-3.0-or-later, same as
 * upstream. The calendar/period/chart layer is not included; only the
 * mergeable weighted-sum and metric math is ported.
 */

export * from "./statistics-aggregation";
