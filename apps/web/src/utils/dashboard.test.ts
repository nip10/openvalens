import { describe, expect, test } from "bun:test";

import { restingHeartRateTile, weightAxisTicks } from "./dashboard";

const day = (date: string, avgBpm: number | null) => ({ date, restingHeartRate: { avgBpm } });

describe("resting heart rate tile (#dashboard-10)", () => {
  test("shows the newest resting value and the mean of the last seven days with one", () => {
    const days = [
      day("2026-11-01", 70),
      ...Array.from({ length: 7 }, (_, i) => day(`2026-11-0${i + 2}`, 58 + (i % 2))),
      day("2026-11-10", null),
    ];
    expect(restingHeartRateTile(days)).toEqual({
      latest: { date: "2026-11-08", bpm: 58 },
      usualBpm: 58,
    });
  });

  test("needs two days for a usual, and a reading for anything", () => {
    expect(restingHeartRateTile([day("2026-11-01", 61.4)])).toEqual({
      latest: { date: "2026-11-01", bpm: 61 },
      usualBpm: null,
    });
    expect(restingHeartRateTile([day("2026-11-01", null)])).toEqual({
      latest: null,
      usualBpm: null,
    });
  });
});

describe("weight chart ticks (#dashboard-11)", () => {
  const gaps = (ticks: string[]) =>
    ticks.slice(1).map((tick, i) => (Date.parse(tick) - Date.parse(ticks[i]!)) / 86_400_000);

  test("every Monday in a short window", () => {
    const ticks = weightAxisTicks("2026-10-01", "2026-11-16");
    expect(ticks[0]).toBe("2026-10-05");
    expect(ticks.at(-1)).toBe("2026-11-16");
    expect(new Set(gaps(ticks))).toEqual(new Set([7]));
  });

  test("whole weeks apart over 90 days, at most eight, ending on the latest Monday", () => {
    const ticks = weightAxisTicks("2026-08-19", "2026-11-16");
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.at(-1)).toBe("2026-11-16");
    expect(new Set(gaps(ticks))).toEqual(new Set([14]));
    for (const tick of ticks) expect(new Date(`${tick}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});
