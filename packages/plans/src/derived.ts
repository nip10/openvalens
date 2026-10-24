import type {
  SupplementChange,
  SupplementListItem,
  SupplementSchedule,
  SupplementScheduleStatus,
  SupplementScheduleSummary,
} from "./types";

/**
 * Pure derived helpers (Issue #22).
 *
 * No DB calls. All functions are deterministic so callers can unit-test
 * the "active today" filter, change-history reshape, and reason aggregation
 * without Drizzle.
 */

/**
 * A schedule is "active today" when its status is `active`. Paused and
 * stopped schedules are filtered out regardless of date — the source data
 * does not carry an explicit start/end window so the status column is the
 * sole source of truth.
 */
export function isScheduleActiveToday(
  schedule: Pick<SupplementSchedule, "status">,
  today: string,
): boolean {
  if (schedule.status !== "active") return false;
  // The schema has no `startDate`/`endDate` columns — keep the `today`
  // parameter so callers can swap in a timezone-aware derivation later
  // without changing this contract.
  return Boolean(today);
}

/** Counts schedules in `active` status (today-agnostic). */
export function countActiveSchedules(
  schedules: ReadonlyArray<Pick<SupplementSchedule, "status">>,
): number {
  return schedules.filter((s) => s.status === "active").length;
}

/**
 * Reshape a flat list of `supplement_change` rows into a deterministic,
 * date-desc history (most-recent change first). Stable tie-break on `id`
 * desc so callers can rely on order across runs.
 */
export function deriveChangeHistory(changes: ReadonlyArray<SupplementChange>): SupplementChange[] {
  return [...changes].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id - a.id;
  });
}

/**
 * Aggregate the per-supplement latest change reason / date + active-schedule
 * count from raw join rows. `changesBySupplementId` and
 * `schedulesBySupplementId` are pre-grouped maps (id → rows). When no change
 * rows exist for a supplement, `latestChangeReason` and `latestChangeDate`
 * are both `null`.
 *
 * Deterministic: ties on `changeDate` resolve to the higher `change.id`.
 */
export function reshapeSupplementList(
  supplements: ReadonlyArray<{
    id: number;
    name: string;
    dose: string | null;
    form: string | null;
    category: string | null;
  }>,
  changesBySupplementId: ReadonlyMap<number, ReadonlyArray<SupplementChange>>,
  schedulesBySupplementId: ReadonlyMap<
    number,
    ReadonlyArray<Pick<SupplementSchedule, "status"> & Partial<SupplementScheduleSummary>>
  >,
): SupplementListItem[] {
  return supplements.map((supplement) => {
    const changes = changesBySupplementId.get(supplement.id) ?? [];
    const sortedChanges = [...changes].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.id - a.id;
    });
    const latest = sortedChanges[0];
    const schedules = schedulesBySupplementId.get(supplement.id) ?? [];
    return {
      ...supplement,
      latestChangeReason: latest?.reason ?? null,
      latestChangeDate: latest?.date ?? null,
      activeScheduleCount: countActiveSchedules(schedules),
      schedules: schedules.flatMap((schedule) =>
        schedule.id === undefined
          ? []
          : [
              {
                id: schedule.id,
                status: schedule.status,
                frequency: schedule.frequency ?? null,
                daysOfWeek: schedule.daysOfWeek ?? null,
              },
            ],
      ),
    };
  });
}

/**
 * True when the schedule is in a "live" state — i.e. not paused or stopped.
 * Used by the AI coach (`#13`) and any future consumer that wants to filter
 * inactive supplements out of a stack view.
 */
export function isLiveScheduleStatus(status: SupplementScheduleStatus): boolean {
  return status === "active";
}
