/**
 * Manual sleep entry (#440), shared by web, mobile and the `sleep.logManualSession`
 * procedure. Pure TypeScript — safe for the app bundle.
 *
 * A manual night is stored as its own `sleep_session` event marked
 * `entryMode: "manual"`. It never overwrites or merges into a device night:
 * when the two overlap, the manual one is shown as a possible duplicate and the
 * device night counts in the totals (see `@openvalens/sleep`).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { localDateTimeToIso } from "./manual-entry";

export const SLEEP_QUALITY_MIN = 1;
export const SLEEP_QUALITY_MAX = 5;

/** Same bounds the sleep summary applies to every session. */
export const MANUAL_SLEEP_MIN_MINUTES = 10;
export const MANUAL_SLEEP_MAX_MINUTES = 24 * 60;
/** Clock drift allowed between the device and the server. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** How the night felt, from 1 to 5. */
export const SLEEP_QUALITY_LABELS: Record<number, MessageDescriptor> = {
  1: msg({ message: "Rough", context: "sleep quality" }),
  2: msg({ message: "Restless", context: "sleep quality" }),
  3: msg({ message: "Okay", context: "sleep quality" }),
  4: msg({ message: "Good", context: "sleep quality" }),
  5: msg({ message: "Great", context: "sleep quality" }),
};

export const SLEEP_QUALITY_VALUES = [1, 2, 3, 4, 5] as const;

export function isSleepQuality(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SLEEP_QUALITY_MIN &&
    value <= SLEEP_QUALITY_MAX
  );
}

export type ManualSleepError = "invalid" | "order" | "too_short" | "too_long" | "future";

export type ManualSleepWindow = { startAt: string; endAt: string; minutes: number };

/**
 * Checks a bedtime / wake time pair given as instants (ISO strings). Used by
 * the forms and again by the server.
 */
export function checkManualSleepWindow(
  startAt: string,
  endAt: string,
  now: Date = new Date(),
): { ok: true; window: ManualSleepWindow } | { ok: false; error: ManualSleepError } {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "invalid" };
  if (end <= start) return { ok: false, error: "order" };
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < MANUAL_SLEEP_MIN_MINUTES) return { ok: false, error: "too_short" };
  if (minutes > MANUAL_SLEEP_MAX_MINUTES) return { ok: false, error: "too_long" };
  if (end > now.getTime() + FUTURE_TOLERANCE_MS) return { ok: false, error: "future" };
  return {
    ok: true,
    window: {
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      minutes,
    },
  };
}

/** The form's local `YYYY-MM-DDTHH:MM` values, read in the device's time zone. */
export function parseManualSleepForm(
  bedtimeLocal: string,
  wakeLocal: string,
  now: Date = new Date(),
): { ok: true; window: ManualSleepWindow } | { ok: false; error: ManualSleepError } {
  const startAt = localDateTimeToIso(bedtimeLocal);
  const endAt = localDateTimeToIso(wakeLocal);
  if (!startAt || !endAt) return { ok: false, error: "invalid" };
  return checkManualSleepWindow(startAt, endAt, now);
}

export const MANUAL_SLEEP_ERROR_MESSAGES: Record<ManualSleepError, MessageDescriptor> = {
  invalid: msg`Enter a bedtime and a wake time.`,
  order: msg`Wake time must be after bedtime.`,
  too_short: msg`A night needs at least 10 minutes.`,
  too_long: msg`A night can be at most 24 hours.`,
  future: msg`Wake time can't be in the future.`,
};

function localMinute(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Form defaults: last night, 23:00 to 07:00 local. Before 07:00 it is the
 * night before, so the wake time is never in the future.
 */
export function defaultManualSleepWindow(now: Date = new Date()): {
  bedtime: string;
  wakeAt: string;
} {
  const wake = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0);
  if (wake.getTime() > now.getTime()) wake.setDate(wake.getDate() - 1);
  const bed = new Date(wake.getFullYear(), wake.getMonth(), wake.getDate() - 1, 23, 0);
  return { bedtime: localMinute(bed), wakeAt: localMinute(wake) };
}

/**
 * Stable id for one manual night, so a double-tap or a retry of "Save" keeps a
 * single row: the same bedtime and wake time are the same entry.
 */
export function manualSleepDedupeHash(window: Pick<ManualSleepWindow, "startAt" | "endAt">) {
  return `manual-sleep:${window.startAt.slice(0, 16)}:${window.endAt.slice(0, 16)}`;
}

export const MANUAL_SLEEP_DUPLICATE_NOTE = msg`Possible duplicate: a device recorded sleep at the same time. The device night counts in your totals.`;
