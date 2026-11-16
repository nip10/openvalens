// exports#4 — a period for the doctor-ready (CSV/PDF) export. Pure: it narrows
// an already-built payload, so every extractor keeps its own scoping.
import type { ExportDomain } from "./domains";
import type { ExportPayload, JsonObject } from "./types";

/** Inclusive calendar dates (YYYY-MM-DD); an open end is null. */
export type ExportPeriod = { from: string | null; to: string | null };

/**
 * The date each dated domain's rows carry. Domains left out are current lists
 * or snapshots (medications, supplements, goals, family history, the latest
 * body figures and insight counts): they describe now, so a period keeps them
 * whole.
 */
const DATED_FIELDS: Partial<Record<ExportDomain, string>> = {
  blood: "recordedAt",
  workouts: "date",
  calendar: "date",
  imaging: "date",
  cardiac: "date",
  dexa: "date",
  weight: "date",
  audit: "timestamp",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function inPeriod(value: unknown, period: ExportPeriod): boolean {
  // An undated row is kept: leaving it out would hide it without saying so.
  if (typeof value !== "string" || !DATE_RE.test(value)) return true;
  const day = value.slice(0, 10);
  if (period.from && day < period.from) return false;
  if (period.to && day > period.to) return false;
  return true;
}

/** The payload with dated rows outside `period` removed, and the period recorded. */
export function applyExportPeriod<Payload extends ExportPayload>(
  payload: Payload,
  period: ExportPeriod | null | undefined,
): Payload {
  if (!period || (!period.from && !period.to)) return payload;
  const data: Record<string, unknown> = { ...payload.data };
  for (const [domain, field] of Object.entries(DATED_FIELDS)) {
    const rows = data[domain];
    if (Array.isArray(rows))
      data[domain] = (rows as JsonObject[]).filter((row) => inPeriod(row[field], period));
  }
  return { ...payload, data, period: { from: period.from, to: period.to } };
}
