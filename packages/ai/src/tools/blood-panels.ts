import type { BloodMarkerWithContext, BloodPanel } from "@openvalens/clinical";
import { z } from "zod";

import { datePart, shortText } from "./format";

/**
 * Shared blood-panel projection for the `labs`, `panelCompare` and
 * `outOfRange` tools (Issue #130).
 *
 * Panels come from `@openvalens/clinical` (`blood_panel` + `blood_marker`).
 * Panels are addressed by calendar date only — row ids never reach the model.
 * Facility, physician, panel context, source file / PDF paths and notes are
 * never copied into a tool output.
 */

/** Upper bound on panels read when listing dates or resolving one. */
export const BLOOD_PANEL_LOOKUP_LIMIT = 50;
/** Cap on panel dates echoed back to the model. */
export const MAX_PANEL_DATES = 20;

const SOURCE_FLAGS = ["HIGH", "LOW", "CRITICAL"] as const;

export const labMarkerRow = z.object({
  testKey: z.string(),
  testName: z.string(),
  category: z.string(),
  value: z.number().nullable(),
  /** Result written as text by the lab (for example `< 3.1`, `Negative`). */
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  refRangeLow: z.number().nullable(),
  refRangeHigh: z.number().nullable(),
  refRangeText: z.string().nullable(),
  /** Flag recorded on the lab report itself. */
  sourceFlag: z.enum(SOURCE_FLAGS).nullable(),
  /** Recorded value compared with the stored optimal range, when one exists. */
  optimalRangeFlag: z.enum(["HIGH", "LOW"]).nullable(),
});

export type LabMarkerRow = z.infer<typeof labMarkerRow>;

function sourceFlag(flag: string | null): LabMarkerRow["sourceFlag"] {
  const upper = flag?.trim().toUpperCase();
  return SOURCE_FLAGS.find((candidate) => candidate === upper) ?? null;
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/** Allowlisted projection of one stored marker row. */
export function projectLabMarker(marker: BloodMarkerWithContext): LabMarkerRow {
  return {
    testKey: marker.testKey,
    testName: shortText(marker.testName, 80) ?? marker.testKey,
    category: shortText(marker.category, 80) ?? "",
    value: finiteOrNull(marker.valueNumeric),
    valueText: shortText(marker.valueText),
    unit: shortText(marker.unit),
    refRangeLow: finiteOrNull(marker.refRangeLow),
    refRangeHigh: finiteOrNull(marker.refRangeHigh),
    refRangeText: shortText(marker.refRangeText),
    sourceFlag: sourceFlag(marker.flag),
    optimalRangeFlag:
      marker.outOfRangeFlag === "HIGH" || marker.outOfRangeFlag === "LOW"
        ? marker.outOfRangeFlag
        : null,
  };
}

export function isFlagged(row: LabMarkerRow): boolean {
  return row.sourceFlag !== null || row.optimalRangeFlag !== null;
}

/** Stable display order: category, then test name, then key. */
export function compareLabMarkerRows(a: LabMarkerRow, b: LabMarkerRow): number {
  return (
    a.category.localeCompare(b.category) ||
    a.testName.localeCompare(b.testName) ||
    a.testKey.localeCompare(b.testKey)
  );
}

/** Case-insensitive category match; `undefined` matches everything. */
export function matchesCategory(
  marker: Pick<BloodMarkerWithContext, "category" | "subcategory">,
  category: string | undefined,
): boolean {
  if (category === undefined) return true;
  const wanted = category.trim().toLowerCase();
  return (
    marker.category.trim().toLowerCase() === wanted ||
    (marker.subcategory ?? "").trim().toLowerCase() === wanted
  );
}

/** Distinct panel dates, newest first, capped. `panels` is newest first. */
export function panelDates(panels: readonly BloodPanel[]): string[] {
  return [...new Set(panels.map((panel) => datePart(panel.date)))].slice(0, MAX_PANEL_DATES);
}

/**
 * Newest panel recorded on `date` (`panels` is newest first, so the first hit
 * wins and ties resolve the same way every time).
 */
export function findPanelByDate(panels: readonly BloodPanel[], date: string): BloodPanel | null {
  return panels.find((panel) => datePart(panel.date) === date) ?? null;
}
