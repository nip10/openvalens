/**
 * Labs presentation shared by web and mobile. Pure TypeScript; only sibling
 * presenter helpers are imported — safe for the app bundle. Copy follows
 * docs/mobile/tone-of-voice.md (sentence case, real units).
 */
import { msg } from "@lingui/core/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";

import { displayLabValue, type LabUnitChoice } from "./clinical-units";
import { formatProductDate, type ProductDisplaySettings } from "./product-formatting";

export type LabMarkerLike = {
  code: string;
  displayName: string;
  unit: string | null;
  latestValue: number | null;
  latestSampledAt: string | null;
  sampleCount: number;
  recentValues: { sampledAt: string; value: number }[];
  referenceRange?: LabReferenceRangeLike | null;
};

/** The lab's own range stored with a reading (see `@openvalens/labs`). */
export type LabReferenceRangeLike = {
  low: number | null;
  high: number | null;
  text: string | null;
  unit: string | null;
};

/** "92 mg/dL" / "—" when unit or value is missing. */
export function formatLabValue(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  if (!unit) return String(Math.round(value * 10) / 10);
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

/**
 * "Jun 12, 2026" / "—" when missing. Locale comes from the optional display
 * settings (default en-US); the device-local timezone is preserved unless an
 * explicit `timeZone` is supplied.
 */
export function formatLabDate(
  iso: string | null | undefined,
  settings?: ProductDisplaySettings | null,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return formatProductDate(date, settings?.locale ?? "en-US", undefined, settings?.timeZone);
}

/** Sparkline series for the chart wrapper: just the numeric values, oldest first. */
export function labSparkline(marker: LabMarkerLike): { value: number; label: string }[] {
  return marker.recentValues.map((point) => ({
    value: point.value,
    label: point.sampledAt.slice(0, 10),
  }));
}

/**
 * How to show the lab's own reference range next to a reading. The range is
 * the lab's, as stored with the reading; nothing here looks one up. Whether a
 * reading sits below, within or above it is `labRangePosition` (the owner
 * reopened never-add item 1 for this on 2026-11-16).
 *
 * - Both numeric bounds: "30 to 100 ng/mL", converted with the same display
 *   choice as the reading (#67) so the two share a unit.
 * - Otherwise the lab's range text, verbatim and never converted, with the
 *   range's unit added when the text does not already carry it.
 * - Otherwise a single bound: "up to 100" / "from 50".
 *
 * Returns `null` when no range was recorded.
 */
export type LabRangeDisplay =
  | { kind: "between"; low: string; high: string; unit: string; converted: boolean }
  | { kind: "upTo"; high: string; unit: string; converted: boolean }
  | { kind: "from"; low: string; unit: string; converted: boolean }
  | { kind: "text"; text: string; unit: string; converted: false };

function boundText(value: number, converted: boolean): string {
  // Stored bounds are shown as recorded; converted ones get the reading's
  // one-decimal rounding.
  return converted ? String(Math.round(value * 10) / 10) : String(value);
}

export function displayLabRange(
  marker: { code: string; unit: string | null },
  range: LabReferenceRangeLike | null | undefined,
  choice: LabUnitChoice,
): LabRangeDisplay | null {
  if (!range) return null;
  const rangeMarker = { code: marker.code, unit: range.unit ?? marker.unit };
  const convert = (value: number) => displayLabValue(rangeMarker, value, choice);

  if (range.low !== null && range.high !== null) {
    const low = convert(range.low);
    const high = convert(range.high);
    return {
      kind: "between",
      low: boundText(low.value, low.converted),
      high: boundText(high.value, high.converted),
      unit: high.unit ?? "",
      converted: high.converted,
    };
  }
  if (range.text !== null) {
    const unit = rangeMarker.unit ?? "";
    const carriesUnit = unit !== "" && range.text.toLowerCase().includes(unit.toLowerCase());
    return { kind: "text", text: range.text, unit: carriesUnit ? "" : unit, converted: false };
  }
  if (range.high !== null) {
    const high = convert(range.high);
    return {
      kind: "upTo",
      high: boundText(high.value, high.converted),
      unit: high.unit ?? "",
      converted: high.converted,
    };
  }
  if (range.low !== null) {
    const low = convert(range.low);
    return {
      kind: "from",
      low: boundText(low.value, low.converted),
      unit: low.unit ?? "",
      converted: low.converted,
    };
  }
  return null;
}

/**
 * Where a marker's readings and the lab's printed range sit on one line, as
 * percentages of its width. Placement only; `labRangePosition` says whether a
 * reading is below, within or above the range.
 *
 * The scale runs from the range with some room either side (as on mobile,
 * `labRangeBar`), widened so every reading fits. `band` is null when the range
 * cannot be drawn on the readings' scale: a text range, another unit, or no
 * range at all; the readings are still placed, on a scale of their own.
 * Returns null when there is nothing to draw (no readings, or one reading and
 * no range).
 */
export type LabRangeLine = {
  min: number;
  max: number;
  band: { start: number; end: number; low: string | null; high: string | null } | null;
  /** Position of each value, in the order given (oldest first, latest last). */
  points: number[];
};

function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export type LabRangePosition = "below" | "within" | "above";

/**
 * Where a reading sits against the lab's own printed range: below, within or
 * above it. Null when the range can't be compared with the reading: a text
 * range, a range in another unit, a bound that isn't a number, or no range.
 * Bounds are inclusive ("30 to 100" counts 100 as within). The owner reopened
 * never-add item 1 for this on 2026-11-16 (Legal and clinical gate decisions).
 */
export function labRangePosition(
  value: number,
  valueUnit: string | null | undefined,
  range: LabRangeDisplay | null,
): LabRangePosition | null {
  if (!Number.isFinite(value) || !range || range.kind === "text") return null;
  if (!sameUnit(valueUnit, range.unit)) return null;
  const low = range.kind === "upTo" ? null : Number(range.low);
  const high = range.kind === "from" ? null : Number(range.high);
  if (low !== null && !Number.isFinite(low)) return null;
  if (high !== null && !Number.isFinite(high)) return null;
  if (low !== null && value < low) return "below";
  if (high !== null && value > high) return "above";
  return "within";
}

export function labRangeLine(
  values: readonly number[],
  valueUnit: string | null | undefined,
  range: LabRangeDisplay | null,
): LabRangeLine | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  let min: number | null = null;
  let max: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  let lowText: string | null = null;
  let highText: string | null = null;
  if (range && range.kind !== "text" && sameUnit(valueUnit, range.unit)) {
    if (range.kind === "between") {
      const l = Number(range.low);
      const h = Number(range.high);
      if (Number.isFinite(l) && Number.isFinite(h) && h > l) {
        const pad = (h - l) / 2;
        [min, max, low, high, lowText, highText] = [
          l >= 0 ? Math.max(0, l - pad) : l - pad,
          h + pad,
          l,
          h,
          range.low,
          range.high,
        ];
      }
    } else if (range.kind === "upTo") {
      const h = Number(range.high);
      // A one-sided "up to" range is shaded from the start of the scale.
      if (Number.isFinite(h) && h > 0)
        [min, max, low, high, highText] = [0, h * 1.5, 0, h, range.high];
    } else {
      const l = Number(range.low);
      if (Number.isFinite(l) && l > 0)
        [min, max, low, high, lowText] = [l / 2, l * 2, l, null, range.low];
    }
  }
  const lowest = Math.min(...finite);
  const highest = Math.max(...finite);
  if (min === null || max === null) {
    if (highest === lowest) return null;
    const pad = (highest - lowest) * 0.25;
    min = lowest - pad;
    max = highest + pad;
  } else {
    const room = (max - min) * 0.08;
    if (lowest < min) min = lowest - room;
    if (highest > max) max = highest + room;
  }
  const at = (value: number) => ((value - min!) / (max! - min!)) * 100;
  return {
    min,
    max,
    band:
      low === null
        ? null
        : { start: at(low), end: high === null ? 100 : at(high), low: lowText, high: highText },
    points: finite.map(at),
  };
}

/** The translated line for a range: "Lab range 30 to 100 ng/mL". */
export function labRangeMessage(range: LabRangeDisplay): MessageDescriptor {
  switch (range.kind) {
    case "between": {
      const { low, high, unit } = range;
      return msg({
        message: `Lab range ${low} to ${high} ${unit}`,
        comment: "safety",
      });
    }
    case "upTo": {
      const { high, unit } = range;
      return msg({
        message: `Lab range up to ${high} ${unit}`,
        comment: "safety",
      });
    }
    case "from": {
      const { low, unit } = range;
      return msg({
        message: `Lab range from ${low} ${unit}`,
        comment: "safety",
      });
    }
    case "text": {
      const { text, unit } = range;
      return msg({
        message: `Lab range: ${text} ${unit}`,
        comment: "safety",
      });
    }
  }
}

/** The range line in the active locale; a range without a unit leaves no trailing space. */
export function formatLabRange(i18n: I18n, range: LabRangeDisplay): string {
  return i18n._(labRangeMessage(range)).trim();
}

/**
 * The short range line for a reading whose unit is already shown beside it:
 * "Range 30–100", "Range up to 100", "Range from 50", or the lab's own text
 * as printed ("Range < 100"). The range's unit is added only when it differs
 * from the reading's. `labRangeMessage` keeps the long form for native.
 */
export function labRangeShortMessage(
  range: LabRangeDisplay,
  readingUnit: string | null | undefined,
): MessageDescriptor {
  const unit = sameUnit(range.unit, readingUnit) ? "" : range.unit;
  switch (range.kind) {
    case "between": {
      const { low, high } = range;
      return msg({ message: `Range ${low}–${high} ${unit}`, comment: "safety" });
    }
    case "upTo": {
      const { high } = range;
      return msg({ message: `Range up to ${high} ${unit}`, comment: "safety" });
    }
    case "from": {
      const { low } = range;
      return msg({ message: `Range from ${low} ${unit}`, comment: "safety" });
    }
    case "text": {
      const { text } = range;
      return msg({ message: `Range ${text} ${unit}`, comment: "safety" });
    }
  }
}

/** `labRangeShortMessage` in the active locale, without a trailing space. */
export function formatLabRangeShort(
  i18n: I18n,
  range: LabRangeDisplay,
  readingUnit: string | null | undefined,
): string {
  return i18n._(labRangeShortMessage(range, readingUnit)).trim();
}

/**
 * The panels the labs screen groups markers under, in screen order. A static
 * grouping by marker code, the way a lab report prints them; it says nothing
 * about the values.
 */
export const LAB_PANELS = [
  "lipids",
  "metabolic",
  "blood_count_iron",
  "thyroid",
  "vitamins",
  "inflammation",
  "other",
] as const;
export type LabPanel = (typeof LAB_PANELS)[number];

export const LAB_PANEL_LABELS: Record<LabPanel, MessageDescriptor> = {
  lipids: msg({ message: "Lipids", context: "lab panel" }),
  metabolic: msg({ message: "Metabolic", context: "lab panel" }),
  blood_count_iron: msg({ message: "Blood count and iron", context: "lab panel" }),
  thyroid: msg({ message: "Thyroid", context: "lab panel" }),
  vitamins: msg({ message: "Vitamins", context: "lab panel" }),
  inflammation: msg({ message: "Inflammation", context: "lab panel" }),
  other: msg({ message: "Other", context: "lab panel" }),
};

/** Marker codes (without `blood_marker_`) the app knows, by panel. */
const PANEL_MARKERS: Record<Exclude<LabPanel, "other">, readonly string[]> = {
  lipids: [
    "total_cholesterol",
    "cholesterol",
    "ldl",
    "hdl",
    "non_hdl",
    "triglycerides",
    "apob",
    "lipoprotein_a",
  ],
  metabolic: [
    "glucose",
    "hba1c",
    "insulin",
    "creatinine",
    "egfr",
    "urea",
    "bun",
    "uric_acid",
    "alt",
    "ast",
    "ggt",
    "alp",
    "bilirubin",
    "albumin",
    "sodium",
    "potassium",
    "calcium",
  ],
  blood_count_iron: [
    "hemoglobin",
    "haemoglobin",
    "hematocrit",
    "rbc",
    "wbc",
    "platelets",
    "mcv",
    "ferritin",
    "iron",
    "transferrin",
    "transferrin_saturation",
    "tibc",
  ],
  thyroid: ["tsh", "free_t4", "ft4", "t4", "free_t3", "ft3", "t3"],
  vitamins: ["vitamin_d", "vitamin_b12", "b12", "folate", "vitamin_b9"],
  inflammation: ["hs_crp", "crp", "esr"],
};

const PANEL_BY_MARKER: ReadonlyMap<string, LabPanel> = new Map(
  (Object.entries(PANEL_MARKERS) as [LabPanel, readonly string[]][]).flatMap(([panel, codes]) =>
    codes.map((code) => [code, panel] as const),
  ),
);

/** The panel a marker is listed under; "other" for a code the app doesn't know. */
export function labMarkerPanel(code: string): LabPanel {
  return PANEL_BY_MARKER.get(code.replace(/^blood_marker_/, "").toLowerCase()) ?? "other";
}

/**
 * Markers grouped by panel in `LAB_PANELS` order, keeping the given order
 * inside each panel. Empty panels are left out.
 */
export function groupLabMarkersByPanel<T extends { code: string }>(
  markers: readonly T[],
): { panel: LabPanel; markers: T[] }[] {
  const byPanel = new Map<LabPanel, T[]>();
  for (const marker of markers) {
    const panel = labMarkerPanel(marker.code);
    byPanel.set(panel, [...(byPanel.get(panel) ?? []), marker]);
  }
  return LAB_PANELS.flatMap((panel) => {
    const rows = byPanel.get(panel);
    return rows ? [{ panel, markers: rows }] : [];
  });
}
