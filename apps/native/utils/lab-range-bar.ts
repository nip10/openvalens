import type { LabRangeDisplay } from "@openvalens/api/presenters/labs";

/**
 * Where a reading and the lab's printed range sit on one neutral track, as
 * percentages of its width. Placement only: nothing here judges the reading
 * against the range (Legal and clinical gate decisions, never-add item 1), so
 * there is no inside/outside result, and a reading beyond the track is simply
 * drawn at its edge.
 *
 * Returns `null` when no bar should be drawn: a text-only range, a range in a
 * different unit from the reading, or bounds that give no usable track.
 */
export type LabRangeBar = {
  bandStart: number;
  bandEnd: number;
  marker: number;
};

const percent = (value: number, min: number, max: number) =>
  Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function labRangeBar(
  value: number | null,
  valueUnit: string | null | undefined,
  range: LabRangeDisplay | null,
): LabRangeBar | null {
  if (value === null || !Number.isFinite(value) || !range || range.kind === "text") return null;
  if (!sameUnit(valueUnit, range.unit)) return null;

  let min: number;
  let max: number;
  let low: number;
  let high: number;
  if (range.kind === "between") {
    low = Number(range.low);
    high = Number(range.high);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
    // Half the range's width on each side, never below zero for a range that
    // starts at or above zero.
    const pad = (high - low) / 2;
    min = low >= 0 ? Math.max(0, low - pad) : low - pad;
    max = high + pad;
  } else if (range.kind === "upTo") {
    high = Number(range.high);
    if (!Number.isFinite(high) || high <= 0) return null;
    min = 0;
    low = 0;
    max = high * 1.5;
  } else {
    low = Number(range.low);
    if (!Number.isFinite(low) || low <= 0) return null;
    min = low / 2;
    max = low * 2;
    high = max;
  }
  return {
    bandStart: percent(low, min, max),
    bandEnd: percent(high, min, max),
    marker: percent(value, min, max),
  };
}
