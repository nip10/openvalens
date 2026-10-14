import { describe, expect, test } from "bun:test";

import { formatKg, formatKgDelta, summarizeDailyWeights, weightSourceLabel } from "./body";

const row = (date: string, weightKg: number, source = "auto") => ({ date, weightKg, source });

describe("body presenter", () => {
  test("latest, 7- and 30-day change, and an oldest-first series", () => {
    const summary = summarizeDailyWeights([
      row("2026-10-01", 72.4),
      row("2026-09-28", 72.9),
      row("2026-09-24", 73.0),
      row("2026-09-01", 74.1, "manual"),
    ]);
    expect(summary.latest).toEqual({ date: "2026-10-01", weightKg: 72.4, source: "auto" });
    // 7 days back is 2026-09-24 (the nearest day on or before it).
    expect(summary.change7d).toBeCloseTo(-0.6);
    // 30 days back is 2026-09-01.
    expect(summary.change30d).toBeCloseTo(-1.7);
    expect(summary.series.map((p) => p.date)).toEqual([
      "2026-09-01",
      "2026-09-24",
      "2026-09-28",
      "2026-10-01",
    ]);
  });

  test("no comparison point means no change, and empty input is empty", () => {
    expect(summarizeDailyWeights([row("2026-10-01", 72.4)]).change7d).toBeNull();
    expect(summarizeDailyWeights([])).toEqual({
      latest: null,
      change7d: null,
      change30d: null,
      series: [],
    });
  });

  test("formatting: one decimal, explicit sign, sources in plain words", () => {
    expect(formatKg(72.44)).toBe("72.4 kg");
    expect(formatKgDelta(-0.6)).toBe("−0.6 kg");
    expect(formatKgDelta(0.25)).toBe("+0.3 kg");
    expect(formatKgDelta(0.01)).toBe("No change");
    expect(weightSourceLabel("auto")).toBe("Synced");
    expect(weightSourceLabel("manual")).toBe("Manual");
    expect(weightSourceLabel("override")).toBe("Override");
  });

  test("imperial weight: real kg→lb conversion, canonical record unchanged", () => {
    const imperial = { units: "imperial" as const, locale: "en-US" as const };
    expect(formatKg(100, imperial)).toBe("220.5 lb");
    expect(formatKg(72.44, imperial)).toBe("159.7 lb");
    expect(formatKg(100, { units: "metric", locale: "en-US" })).toBe("100.0 kg");
    // Presentation never mutates the stored kilograms.
    const summary = summarizeDailyWeights([row("2026-10-01", 100)]);
    expect(summary.latest?.weightKg).toBe(100);
    expect(summary.series[0]?.weightKg).toBe(100);
  });

  test("imperial deltas: sign, magnitude, and no negative zero", () => {
    const imperial = { units: "imperial" as const, locale: "en-US" as const };
    expect(formatKgDelta(-1, imperial)).toBe("−2.2 lb");
    expect(formatKgDelta(1, imperial)).toBe("+2.2 lb");
    expect(formatKgDelta(0, imperial)).toBe("No change");
    expect(formatKgDelta(-0, imperial)).toBe("No change");
    expect(formatKgDelta(0.01, imperial)).toBe("No change");
    expect(formatKgDelta(0.25, { units: "metric", locale: "en-US" })).toBe("+0.3 kg");
  });
});
