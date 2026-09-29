import {
  ALLOWED_MEDICATION_STATUSES,
  ALLOWED_SUPPLEMENT_CHANGE_TYPES,
  ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES,
  ALLOWED_TIME_OF_DAY,
  type MedicationStatus,
  type SupplementChangeType,
  type SupplementScheduleStatus,
  type TimeOfDay,
} from "./types";

/**
 * Pure input-shape helpers for the supplements/medications domain (Issue #22).
 *
 * These functions are framework-agnostic: the oRPC layer (`z.strictObject`)
 * runs first and rejects bad inputs with `INVALID_INPUT`; this module only
 * resolves post-schema, in-domain shape decisions.
 */

export type ValidationOk<T> = { ok: true; data: T };
export type ValidationErr = { ok: false; error: string };

/** Trim a required string, return `null` for empty / non-string inputs. */
export function parseTrimmedRequiredString(
  payload: Record<string, unknown>,
  field: string,
): string | null {
  const value = payload[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Trim an optional string — `undefined` when the field is missing or empty. */
export function parseTrimmedOptionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isAllowedMedicationStatus(value: string): value is MedicationStatus {
  return (ALLOWED_MEDICATION_STATUSES as ReadonlyArray<string>).includes(value);
}

export function isAllowedSupplementScheduleStatus(
  value: string,
): value is SupplementScheduleStatus {
  return (ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES as ReadonlyArray<string>).includes(value);
}

export function isAllowedSupplementChangeType(value: string): value is SupplementChangeType {
  return (ALLOWED_SUPPLEMENT_CHANGE_TYPES as ReadonlyArray<string>).includes(value);
}

export function isAllowedTimeOfDay(value: string): value is TimeOfDay {
  return (ALLOWED_TIME_OF_DAY as ReadonlyArray<string>).includes(value);
}

/**
 * Today key (UTC date). The derivation layer treats `date` strings as
 * already-normalized YYYY-MM-DD; callers should pass either the
 * `currentDate` returned from this function or an explicit value.
 */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Type-guard against an arbitrary string-array payload. Used by the
 * change-history reshaper to narrow `changeType` before returning.
 */
export function coerceKnownChangeTypes(
  values: ReadonlyArray<string>,
): ReadonlyArray<SupplementChangeType> {
  return values.filter(isAllowedSupplementChangeType);
}
