import { z } from "zod";

/**
 * Output conventions shared by every MCP and REST tool (Issue #439):
 *
 * - times are ISO 8601 with the member's UTC offset (`2026-11-12T07:30:00+01:00`);
 * - calendar days are `YYYY-MM-DD` in the member's time zone;
 * - values keep their stored unit next to a `unit` field, plus the member's
 *   preferred unit where the two differ (weights and lengths);
 * - labels are English.
 */

export const MAX_RANGE_DAYS = 365;
export const DEFAULT_RANGE_DAYS = 30;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

const DAY_MS = 86_400_000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine((value) => {
    const ms = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value);
  }, "Use a real calendar date.");

/** Input shared by the date-range reads. */
export const rangeInputShape = {
  from: isoDate
    .optional()
    .describe(
      `First day (YYYY-MM-DD, member's time zone). Defaults to ${DEFAULT_RANGE_DAYS - 1} days before \`to\`.`,
    ),
  to: isoDate.optional().describe("Last day (YYYY-MM-DD, member's time zone). Defaults to today."),
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe("Opaque `nextCursor` from the previous page; omit for the first page."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(`Rows per page (1-${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE}).`),
};

export type RangeInput = {
  from?: string;
  to?: string;
  cursor?: string;
  pageSize?: number;
};

export type ResolvedRange = { from: string; to: string; offset: number; pageSize: number };

export class ToolInputError extends Error {
  /**
   * Machine-readable detail the REST API adds to the error body, e.g.
   * `accepted_units` for a lab unit that is not accepted (M2c). The message
   * always says the same in words, for MCP clients.
   */
  readonly details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolInputError";
    if (details) this.details = details;
  }
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  );
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown };
    if (typeof parsed.o === "number" && Number.isInteger(parsed.o) && parsed.o >= 0)
      return parsed.o;
  } catch {
    // fall through
  }
  throw new ToolInputError("The cursor is not valid. Start again without a cursor.");
}

/** Resolves a range against "today" in the member's zone and enforces the 365-day cap. */
export function resolveRange(input: RangeInput, today: string): ResolvedRange {
  const to = input.to ?? today;
  const from = input.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) throw new ToolInputError("`from` must be on or before `to`.");
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
    throw new ToolInputError(
      `A range covers at most ${MAX_RANGE_DAYS} days. Ask for a shorter range and page through it.`,
    );
  }
  return {
    from,
    to,
    offset: decodeCursor(input.cursor),
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}

/** Splits a `pageSize + 1` read into the page and its next cursor. */
export function page<T>(
  rows: T[],
  range: ResolvedRange,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, range.pageSize);
  return {
    items,
    nextCursor: rows.length > range.pageSize ? encodeCursor(range.offset + range.pageSize) : null,
  };
}

function zoneParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/** A valid IANA zone, or UTC. */
export function safeTimeZone(value: string | null | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** `YYYY-MM-DD` of `date` in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  const parts = zoneParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** ISO 8601 with the zone's offset at that instant, e.g. `2026-11-12T07:30:00+01:00`. */
export function zonedIso(date: Date, timeZone: string): string {
  const parts = zoneParts(date, timeZone);
  const raw = parts.timeZoneName ?? "GMT";
  const offset = raw === "GMT" ? "+00:00" : raw.replace("GMT", "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export type Units = "metric" | "imperial";

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** A stored weight with the member's preferred unit next to it. */
export function weightValue(kg: number, units: Units) {
  return {
    value: round(kg, 2),
    unit: "kg" as const,
    preferred:
      units === "imperial"
        ? { value: round(kg * 2.204_622_621_8, 1), unit: "lb" as const }
        : { value: round(kg, 1), unit: "kg" as const },
  };
}

/** A stored measurement (`kg`, `lb`, `cm` or `in`) with the member's preferred unit. */
export function measurementValue(value: number, unit: string, units: Units) {
  const toMetric: Record<string, { factor: number; unit: string }> = {
    lb: { factor: 0.453_592_37, unit: "kg" },
    in: { factor: 2.54, unit: "cm" },
  };
  const toImperial: Record<string, { factor: number; unit: string }> = {
    kg: { factor: 2.204_622_621_8, unit: "lb" },
    cm: { factor: 1 / 2.54, unit: "in" },
  };
  const conversion = units === "imperial" ? toImperial[unit] : toMetric[unit];
  return {
    value: round(value, 2),
    unit,
    preferred: conversion
      ? { value: round(value * conversion.factor, 1), unit: conversion.unit }
      : { value: round(value, 1), unit },
  };
}
