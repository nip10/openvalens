/**
 * Labs presentation shared by web and mobile. Pure TypeScript, no imports —
 * safe for the app bundle. Copy follows docs/mobile/tone-of-voice.md
 * (sentence case, real units).
 */
export type LabMarkerLike = {
  code: string;
  displayName: string;
  unit: string | null;
  latestValue: number | null;
  latestSampledAt: string | null;
  sampleCount: number;
  recentValues: { sampledAt: string; value: number }[];
};

/** "92 mg/dL" / "—" when unit or value is missing. */
export function formatLabValue(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  if (!unit) return String(Math.round(value * 10) / 10);
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

/** "Jun 12, 2026" / "—" when missing. Uses the device's locale for the month. */
export function formatLabDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Sparkline series for the chart wrapper: just the numeric values, oldest first. */
export function labSparkline(marker: LabMarkerLike): { value: number; label: string }[] {
  return marker.recentValues.map((point) => ({
    value: point.value,
    label: point.sampledAt.slice(0, 10),
  }));
}
