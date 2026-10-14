/**
 * Body presentation shared by web and mobile. Formatting follows
 * docs/mobile/tone-of-voice.md: one decimal, units always, a real minus sign
 * for decreases. Canonical values stay in kilograms; the optional display
 * settings only change the rendered unit.
 */
import { formatProductNumber, kgToLb, type ProductDisplaySettings } from "./product-formatting";

export type DailyWeightLike = { date: string; weightKg: number; source: string };

export type WeightSummary = {
  latest: DailyWeightLike | null;
  /** kg change against the nearest day on or before 7 / 30 days earlier. */
  change7d: number | null;
  change30d: number | null;
  /** Oldest first, for charts. */
  series: { date: string; weightKg: number }[];
};

const DAY_MS = 86_400_000;

function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

export function summarizeDailyWeights(rows: readonly DailyWeightLike[]): WeightSummary {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = sorted.at(-1) ?? null;
  const changeOver = (days: number) => {
    if (!latest) return null;
    const cutoff = daysBefore(latest.date, days);
    const base = sorted.findLast((point) => point.date <= cutoff);
    return base ? latest.weightKg - base.weightKg : null;
  };
  return {
    latest: latest ? { date: latest.date, weightKg: latest.weightKg, source: latest.source } : null,
    change7d: changeOver(7),
    change30d: changeOver(30),
    series: sorted.map(({ date, weightKg }) => ({ date, weightKg })),
  };
}

/**
 * "72.4 kg" (metric, default) or "159.6 lb" (imperial). The stored value stays
 * in kilograms; conversion happens here only.
 */
export function formatKg(value: number, settings?: ProductDisplaySettings | null): string {
  if (settings?.units === "imperial") {
    const lb = formatProductNumber(kgToLb(value), settings.locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${lb} lb`;
  }
  return `${value.toFixed(1)} kg`;
}

/**
 * "−0.6 kg" / "+0.3 kg" / "No change" (metric, default), or the same shape in
 * pounds. Sign and magnitude are taken in the displayed unit; a value that
 * rounds to zero stays "No change" with no negative zero.
 */
export function formatKgDelta(value: number, settings?: ProductDisplaySettings | null): string {
  const imperial = settings?.units === "imperial";
  const display = imperial ? kgToLb(value) : value;
  const rounded = Math.round(display * 10) / 10;
  if (rounded === 0) return "No change";
  const magnitude = Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? "+" : "−"}${magnitude} ${imperial ? "lb" : "kg"}`;
}

const SOURCE_LABELS: Record<string, string> = {
  auto: "Synced",
  manual: "Manual",
  override: "Override",
};

export function weightSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? "Other";
}
