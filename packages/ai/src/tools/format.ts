import { z } from "zod";

/**
 * Small shared helpers for the AI health tool outputs (Issue #130).
 *
 * Every tool builds its output field by field from an allowlist; these helpers
 * keep the rounding, string caps and the `unavailable` shape identical across
 * tools.
 */

export const unavailableReason = z.enum(["permission_denied", "consent_required"]);

/** `YYYY-MM-DD` calendar date accepted as tool input. */
export const isoDateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine(
    (value) => {
      const ms = Date.parse(`${value}T00:00:00.000Z`);
      return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value);
    },
    {
      message: "Use a real calendar date.",
    },
  );

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function roundOrNull(value: number | null | undefined, digits: number): number | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : round(value, digits);
}

/**
 * Trims a short label-like string (a unit, a dose, a value written as text)
 * and caps its length so a long free-text field cannot ride along.
 */
export function shortText(value: string | null | undefined, max = 40): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Calendar-date part of an ISO date or timestamp string. */
export function datePart(value: string): string {
  return value.slice(0, 10);
}

/** UTC calendar date `days` before `now`. */
export function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
