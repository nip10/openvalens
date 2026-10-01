import { describe, expect, test } from "bun:test";

import {
  formatDistanceMeters,
  formatKcalories,
  formatSteps,
  stepsSeries,
  summarizeDailyActivity,
} from "./activity";

const row = (
  date: string,
  steps: number | null = null,
  kcal: number | null = null,
  meters: number | null = null,
) => ({ date, steps, activeCaloriesKcal: kcal, distanceMeters: meters });

describe("activity presenter", () => {
  test("summarize: today is the last row, averages use active days for steps", () => {
    const summary = summarizeDailyActivity([
      row("2026-09-26", 0),
      row("2026-09-27", 6000, 280, 4500),
      row("2026-09-28", 0),
      row("2026-09-29", 9000, 410, 6800),
      row("2026-09-30", 12000, 520, 9100),
      row("2026-10-01", 4000, 180, 3000),
    ]);
    expect(summary.today?.date).toBe("2026-10-01");
    expect(summary.today?.steps).toBe(4000);
    // 4 active days out of 6: 6000+9000+12000+4000 = 31000 / 4 = 7750
    expect(summary.sevenDayAverageSteps).toBe(7750);
    // calories use every day: (0+280+0+410+520+180)/6 = 231.67 → 232
    expect(summary.sevenDayAverageCalories).toBe(232);
    expect(summary.sevenDayAverageDistance).toBe(3900);
    expect(summary.days).toHaveLength(6);
  });

  test("summarize: empty input yields zeros and no today", () => {
    const summary = summarizeDailyActivity([]);
    expect(summary.today).toBeNull();
    expect(summary.sevenDayAverageSteps).toBe(0);
    expect(summary.sevenDayAverageCalories).toBe(0);
    expect(summary.sevenDayAverageDistance).toBe(0);
    expect(summary.days).toEqual([]);
  });

  test("summarize: all-null metrics become zeros in days", () => {
    const summary = summarizeDailyActivity([row("2026-10-01")]);
    expect(summary.days[0]).toEqual({
      date: "2026-10-01",
      steps: 0,
      activeCaloriesKcal: 0,
      distanceMeters: 0,
    });
  });

  test("formatSteps: thousands separator, k for 1k–9.9k, k for 10k+", () => {
    expect(formatSteps(0)).toBe("0");
    expect(formatSteps(450)).toBe("450");
    expect(formatSteps(4500)).toBe("4.5k");
    expect(formatSteps(12345)).toBe("12k");
  });

  test("formatKcalories: rounded and grouped, '—' for null", () => {
    expect(formatKcalories(null)).toBe("—");
    expect(formatKcalories(0)).toBe("0 kcal");
    expect(formatKcalories(321.7)).toBe("322 kcal");
    expect(formatKcalories(1500)).toBe("1,500 kcal");
  });

  test("formatDistanceMeters: metres under 1km, one-decimal km above", () => {
    expect(formatDistanceMeters(null)).toBe("—");
    expect(formatDistanceMeters(0)).toBe("0 m");
    expect(formatDistanceMeters(750)).toBe("750 m");
    expect(formatDistanceMeters(5400)).toBe("5.4 km");
  });

  test("stepsSeries is MM-DD for the axis", () => {
    const series = stepsSeries([
      { date: "2026-09-30", steps: 100, activeCaloriesKcal: 0, distanceMeters: 0 },
    ]);
    expect(series[0]?.label).toBe("09-30");
  });
});
