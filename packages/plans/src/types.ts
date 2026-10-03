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
};
