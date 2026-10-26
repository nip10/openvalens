import type { LabReferenceRange } from "./types";

/** Longest range text kept; anything longer is not a printed range. */
const MAX_RANGE_TEXT = 120;

/** Units that say nothing about the reading (the blood-marker wildcard). */
const PLACEHOLDER_UNITS = new Set(["varies"]);

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rangeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_RANGE_TEXT ? trimmed : null;
}

/**
 * The lab's reference range stored with one `metric_sample`, read from its
 * `metadataJson` under the keys the clinical schema uses (`refRangeLow`,
 * `refRangeHigh`, `refRangeText`). Values are kept exactly as recorded: no
 * reordering, rounding or lookup. Returns `null` when nothing usable was
 * recorded. The range is in the reading's unit: the sample's own unit when it
 * names one, otherwise the marker's.
 */
export function referenceRangeFromSample(
  metadataJson: unknown,
  sampleUnit: string | null,
  markerUnit: string | null,
): LabReferenceRange | null {
  if (metadataJson === null || typeof metadataJson !== "object" || Array.isArray(metadataJson))
    return null;
  const meta = metadataJson as Record<string, unknown>;
  const low = finite(meta.refRangeLow);
  const high = finite(meta.refRangeHigh);
  const text = rangeText(meta.refRangeText);
  if (low === null && high === null && text === null) return null;
  const ownUnit = sampleUnit?.trim();
  const unit = ownUnit && !PLACEHOLDER_UNITS.has(ownUnit.toLowerCase()) ? ownUnit : markerUnit;
  return { low, high, text, unit };
}
