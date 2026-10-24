/**
 * Supplements & medications — public type surface (Issue #22).
 *
 * Mirrors the four OpenValens tables in `packages/db/src/schema/plans.ts`:
 *
 * - `supplement`           — catalog row (name, dose, form, category). Shared
 *   across orgs (no `organizationId`); org scoping happens via the schedule
 *   rows that reference it.
 * - `supplement_schedule`  — org-scoped (organizationId, userId), one row per
 *   active regime.
 * - `supplement_change`    — org-scoped history (`changeType`: added,
 *   removed, paused, resumed, dose_changed).
 * - `medication`           — directly org-scoped + user-scoped.
 *
 * No PHI is included in the type surface — `notes`, `interactions`, `reason`
 * round-trip as opaque strings the caller owns. Logs never carry them.
 */

export type SupplementChangeType = "added" | "removed" | "paused" | "resumed" | "dose_changed";

export type SupplementScheduleStatus = "active" | "paused" | "stopped";

export type MedicationStatus = "active" | "completed" | "paused";

export type Supplement = {
  id: number;
  name: string;
  dose: string | null;
  form: string | null;
  category: string | null;
};

export type SupplementSchedule = {
  id: number;
  organizationId: string;
  userId: string;
  supplementId: number;
  timeOfDay: string;
  quantity: string | null;
  frequency: string | null;
  /** ISO weekdays (1 = Monday … 7 = Sunday) for weekly / training-day items. */
  daysOfWeek: number[] | null;
  notes: string | null;
  status: SupplementScheduleStatus;
};

export type SupplementChange = {
  id: number;
  organizationId: string;
  date: string;
  supplementId: number | null;
  changeType: SupplementChangeType;
  reason: string | null;
  details: string | null;
};

export type Medication = {
  id: number;
  organizationId: string;
  userId: string;
  name: string;
  dose: string | null;
  route: string | null;
  protocol: string | null;
  frequency: string | null;
  /** ISO weekdays (1 = Monday … 7 = Sunday) for weekly / training-day items. */
  daysOfWeek: number[] | null;
  status: MedicationStatus;
  interactions: string | null;
  notes: string | null;
};

export const ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES: ReadonlyArray<SupplementScheduleStatus> = [
  "active",
  "paused",
  "stopped",
];

export const ALLOWED_MEDICATION_STATUSES: ReadonlyArray<MedicationStatus> = [
  "active",
  "completed",
  "paused",
];

export const ALLOWED_SUPPLEMENT_CHANGE_TYPES: ReadonlyArray<SupplementChangeType> = [
  "added",
  "removed",
  "paused",
  "resumed",
  "dose_changed",
];

/** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Frequencies whose reminder days the member picks (`days_of_week`). The
 * app knows no planned training calendar per member (workouts are logged
 * after the fact and are not per member), so "training days" are chosen the
 * same way as weekly days. Case, spaces and `_` / `-` are ignored.
 */
export function frequencyNeedsDays(frequency: string | null | undefined): boolean {
  const normalized = (frequency ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");
  return normalized === "weekly" || normalized === "training_days";
}

/**
 * Sorted, de-duplicated ISO weekdays, or `null` when none are left. Values
 * outside 1–7 are dropped (the API schema already rejects them).
 */
export function normalizeDaysOfWeek(
  days: ReadonlyArray<number> | null | undefined,
): number[] | null {
  if (!days) return null;
  const unique = [...new Set(days)].filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  unique.sort((a, b) => a - b);
  return unique.length > 0 ? unique : null;
}

export const ALLOWED_TIME_OF_DAY = ["morning", "lunch", "dinner", "pre-bed", "training"] as const;

export type TimeOfDay = (typeof ALLOWED_TIME_OF_DAY)[number];

/**
 * Row shape returned from the catalog join. Includes the latest change
 * reason so callers can render "why am I taking this?" without a second
 * round trip. `latestChangeReason` is `null` when no change row exists.
 */
export type SupplementListItem = Supplement & {
  latestChangeReason: string | null;
  latestChangeDate: string | null;
  activeScheduleCount: number;
  /** The supplement's schedules in this workspace: cadence and reminder days. */
  schedules: SupplementScheduleSummary[];
};

/** What the supplement list needs to show (and edit) a schedule's reminder days. */
export type SupplementScheduleSummary = {
  id: number;
  status: SupplementScheduleStatus;
  frequency: string | null;
  daysOfWeek: number[] | null;
};
