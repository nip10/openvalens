import { describe, expect, test } from "bun:test";

import { englishI18n } from "@openvalens/i18n/testing";

import type { ReadinessHistory } from "../score-contract";
import { computeReadiness, readinessHistoryDay } from "../score-readiness";
import { readinessMoverText, readinessTrend } from "./score";

/** scores#8 — the 30-day readiness history and its plain-arithmetic summary. Synthetic data. */

const AS_OF = "2026-10-15";

function daysBefore(offset: number): string {
  const value = new Date(`${AS_OF}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

const series = (offset: number, count: number, value: number) =>
  Array.from({ length: count }, (_, index) => ({ date: daysBefore(offset + index), value }));

type Day = ReadinessHistory["days"][number];

const day = (date: string, score: number | null, parts: Partial<Day["parts"]> = {}): Day => ({
  date,
  score,
  profile: score === null ? null : "physiology_enhanced",
  parts: {
    sleep: null,
    resting_heart_rate: null,
    activity_load: null,
    hrv: null,
    check_in: null,
    ...parts,
  },
});

const history = (days: Day[]): ReadinessHistory => ({
  kind: "readiness_history",
  experimental: true,
  algorithmVersion: "readiness-0.1.0-experimental",
  status: "available",
  withheldReason: null,
  days,
});

describe("readiness history (scores#8)", () => {
  test("each day is the index computeReadiness gave that day, with the parts it counted", () => {
    const sleep = [...series(1, 28, 450), { date: AS_OF, value: 405 }];
    const result = computeReadiness(
      { sleepMinutes: sleep, restingHeartRate: series(0, 29, 60), steps: series(1, 31, 8000) },
      AS_OF,
    );
    expect(readinessHistoryDay(result)).toEqual({
      date: AS_OF,
      score: result.score,
      profile: result.profile,
      parts: { sleep: 40, resting_heart_rate: 50, activity_load: 50, hrv: null, check_in: null },
    });
    // A withheld day carries no parts, never zeros.
    expect(
      readinessHistoryDay(
        computeReadiness({ sleepMinutes: [], restingHeartRate: [], steps: [] }, AS_OF),
      ),
    ).toEqual({
      date: AS_OF,
      score: null,
      profile: null,
      parts: {
        sleep: null,
        resting_heart_rate: null,
        activity_load: null,
        hrv: null,
        check_in: null,
      },
    });
  });

  test("the trend gives yesterday and the part that moved most, by plain subtraction", () => {
    const trend = readinessTrend(
      history([
        day(daysBefore(2), null),
        day(daysBefore(1), 50, { sleep: 50, resting_heart_rate: 50, activity_load: 50 }),
        day(AS_OF, 42, { sleep: 58, resting_heart_rate: 35, activity_load: 50 }),
      ]),
    );
    expect(trend.scoredDays).toBe(2);
    expect(trend.yesterday).toBe(50);
    expect(trend.points.map((point) => point.score)).toEqual([null, 50, 42]);
    expect(trend.mover).toEqual({ input: "resting_heart_rate", change: -15 });
    expect(readinessMoverText(trend.mover!, englishI18n)).toBe(
      "Resting heart rate −15 since yesterday",
    );
    expect(readinessMoverText({ input: "sleep", change: 8 }, englishI18n)).toBe(
      "Sleep +8 since yesterday",
    );
  });

  test("0.2.0: the check-in and HRV can be the part that moved most", () => {
    const trend = readinessTrend(
      history([
        day(daysBefore(1), 50, { sleep: 50, resting_heart_rate: 50, hrv: 50, check_in: 50 }),
        day(AS_OF, 50, { sleep: 50, resting_heart_rate: 45, hrv: 55, check_in: 75 }),
      ]),
    );
    expect(trend.mover).toEqual({ input: "check_in", change: 25 });
    expect(readinessMoverText(trend.mover!, englishI18n)).toBe(
      "How you feel (check-in) +25 since yesterday",
    );
  });

  test("no mover when nothing changed or a part is missing on one of the days", () => {
    expect(
      readinessTrend(
        history([
          day(daysBefore(1), 50, { sleep: 50 }),
          day(AS_OF, 55, { sleep: 50, activity_load: 60 }),
        ]),
      ).mover,
    ).toBeNull();
    expect(readinessTrend(history([day(AS_OF, 50, { sleep: 50 })]))).toMatchObject({
      yesterday: null,
      mover: null,
      scoredDays: 1,
    });
  });
});
