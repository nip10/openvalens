import type { CockpitSleepInput } from "./types";

/**
 * Typed-contract facade for cross-domain cockpit reads (Issue #16).
 *
 * The cockpit package never imports another package's tables or
 * Drizzle queries directly. Instead, the API router resolves a
 * `CockpitInputs` shape by calling each domain's exported API
 * procedure (or, in tests, by feeding mock functions). This file is
 * the contract surface — a thin adapter that mirrors what the cockpit
 * is allowed to know.
 *
 * Domain ownership:
 * - `@openhealth/body`      — weight trend, latest weight, latest dexa.
 * - `@openhealth/clinical`   — latest blood panel, out-of-range markers.
 * - `@openhealth/coach`      — recent insights (read-only).
 * - `@openhealth/plans`      — latest workout, recent goal check-ins.
 * - `@openhealth/sleep`      — sleep coach context (last 7d window).
 * - `@openhealth/cockpit`    — the cockpit engine + weekly review table.
 *
 * If a domain hasn't shipped its procedure yet, the contract exposes
 * `null` and the engine simply treats the slice as missing — no PHI
 * is fabricated.
 */

export type CockpitInputs = {
  /** ISO date the cockpit is being computed for. */
  nowIso: string;
  /** Date string (YYYY-MM-DD) of the most recent blood panel, or null. */
  lastBloodPanelIso: string | null;
  /** Date string (YYYY-MM-DD) of the most recent workout, or null. */
  lastWorkoutIso: string | null;
  /** Number of out-of-range markers on the latest blood panel. */
  outOfRangeMarkers: number;
  /** Sanitized sleep coach context, or null when no data is available. */
  sleep: CockpitSleepInput | null;
  /** Active goals count (per `coach.listGoals` shape), or 0. */
  activeGoalsCount: number;
  /** Recent insight count, or 0. */
  recentInsightsCount: number;
  /** Optional deterministic blocker flags from caller-side predicates. */
  blockerFlags?: Record<string, boolean>;
};

export type CockpitInputFacades = ReturnType<typeof createCockpitInputFacades>;

export function createCockpitInputFacades() {
  return {
    /**
     * Compose a sanitized `CockpitInputs` snapshot. The router
     * orchestrates the actual cross-domain reads; this facade simply
     * reshapes their typed outputs into the engine input.
     */
    async loadCockpitInputs(sources: {
      loadNow: () => string;
      loadLatestBloodPanel: () => Promise<{ date: string } | null>;
      loadLatestWorkout: () => Promise<{ date: string } | null>;
      loadOutOfRangeMarkers: () => Promise<number>;
      loadSleepCoachContext: () => Promise<CockpitSleepInput | null>;
      loadActiveGoalsCount: () => Promise<number>;
      loadRecentInsightsCount: () => Promise<number>;
      loadBlockerFlags?: () => Promise<Record<string, boolean>>;
    }): Promise<CockpitInputs> {
      const [latestBlood, latestWorkout, outOfRange, sleep, goals, insights, flags] =
        await Promise.all([
          sources.loadLatestBloodPanel(),
          sources.loadLatestWorkout(),
          sources.loadOutOfRangeMarkers(),
          sources.loadSleepCoachContext(),
          sources.loadActiveGoalsCount(),
          sources.loadRecentInsightsCount(),
          sources.loadBlockerFlags ? sources.loadBlockerFlags() : Promise.resolve({}),
        ]);

      return {
        nowIso: sources.loadNow(),
        lastBloodPanelIso: latestBlood ? latestBlood.date.slice(0, 10) : null,
        lastWorkoutIso: latestWorkout ? latestWorkout.date.slice(0, 10) : null,
        outOfRangeMarkers: outOfRange,
        sleep,
        activeGoalsCount: goals,
        recentInsightsCount: insights,
        blockerFlags: flags,
      };
    },

    /**
     * Resolve the engine input from a sanitized cockpit snapshot.
     * Mirrors the anchor `today.ts` derivation: freshness ages are
     * computed against `nowIso` and projected into the cockpit shape.
     */
    resolveEngineInput(inputs: CockpitInputs) {
      return {
        nowIso: inputs.nowIso,
        lastBloodPanelIso: inputs.lastBloodPanelIso,
        lastWorkoutIso: inputs.lastWorkoutIso,
        blockerFlags: inputs.blockerFlags ?? {},
        sleep: inputs.sleep ?? undefined,
      };
    },
  };
}
