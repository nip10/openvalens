/**
 * Body presentation shared by web and mobile (pure, no imports). Formatting
 * follows docs/mobile/tone-of-voice.md: one decimal for kg, units always,
 * a real minus sign for decreases.
 */
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

export function formatKg(value: number): string {
  return `${value.toFixed(1)} kg`;
}

export function formatKgDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "No change";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)} kg`;
}

const SOURCE_LABELS: Record<string, string> = {
  auto: "Synced",
  manual: "Manual",
  override: "Override",
};

export function weightSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? "Other";
}
