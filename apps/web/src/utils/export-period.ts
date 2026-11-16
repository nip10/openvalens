/**
 * exports#4 — the period choices of the doctor-ready export, as the dates the
 * API takes (inclusive local calendar dates). "All time" sends no period.
 */
export const EXPORT_PERIODS = ["3m", "1y", "all", "custom"] as const;
export type ExportPeriodChoice = (typeof EXPORT_PERIODS)[number];

export type ExportPeriodRange = { from: string | null; to: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A local date as YYYY-MM-DD. */
export function localIsoDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function monthsBefore(today: Date, months: number): Date {
  const date = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
  // 31 May minus 3 months is 28 or 29 Feb, never 3 Mar.
  if (date.getDate() !== today.getDate()) date.setDate(0);
  return date;
}

/**
 * The period to send, or `undefined` for all time. `null` means the choice is
 * not usable yet (a custom period with no date, or one that ends before it starts).
 */
export function exportPeriodRange(
  choice: ExportPeriodChoice,
  custom: { from: string; to: string },
  today: Date = new Date(),
): ExportPeriodRange | undefined | null {
  if (choice === "all") return undefined;
  if (choice === "3m") return { from: localIsoDate(monthsBefore(today, 3)), to: null };
  if (choice === "1y") return { from: localIsoDate(monthsBefore(today, 12)), to: null };
  const from = DATE_RE.test(custom.from) ? custom.from : null;
  const to = DATE_RE.test(custom.to) ? custom.to : null;
  if (!from && !to) return null;
  if (from && to && from > to) return null;
  return { from, to };
}
