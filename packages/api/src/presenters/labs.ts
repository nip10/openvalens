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
 * the lab's, as stored with the reading; nothing here looks one up or judges
 * the reading against it (docs/research/reports/Legal and clinical gate
 * decisions.md, never-add item 1: showing the lab's printed range is the
 * limit, so there is no within/above/below label).
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
