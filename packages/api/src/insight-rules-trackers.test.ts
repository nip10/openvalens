import { describe, expect, test } from "bun:test";

import type { Insight } from "./insight-contract";
import {
  addDays,
  defaultKindChannels,
  evaluateTrackerChange,
  isInsightTracker,
  runInsightRules,
  selectInsights,
  TRACKER_CHANGE_RULE,
  trackerDailySeries,
  type InsightTrackerInput,
} from "./insight-rules";

/** #450 — the change rule for custom trackers. Synthetic data only. */

function rng(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    uniform,
    normal: () => {
      const u = Math.max(uniform(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
    },
  };
}

const AS_OF = "2026-10-15";
/** The tracker window ends yesterday: today's total is partial. */
const END = addDays(AS_OF, -1);

type DaysOptions = {
  days?: number;
  /** Value for a day `offset` days before `END` (0 = END); null = no entry. */
  value: (offset: number) => number | null;
};

function trackerDays(options: DaysOptions): InsightTrackerInput["days"] {
  const out: { date: string; value: number }[] = [];
  for (let offset = (options.days ?? 60) - 1; offset >= 0; offset -= 1) {
    const value = options.value(offset);
    if (value !== null) out.push({ date: addDays(END, -offset), value });
  }
  return out;
}

function tracker(
  overrides: Partial<InsightTrackerInput> & Pick<InsightTrackerInput, "days">,
): InsightTrackerInput {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Push-ups",
    type: "number",
    unit: "reps",
    decimals: 0,
    aiVisible: true,
    ...overrides,
  };
}

/** A noisy number series with an optional shift over the last `shiftDays` days. */
function noisy(mean: number, sd: number, seed: number, shift = 0, shiftDays = 0) {
  const random = rng(seed);
  return trackerDays({
    value: (offset) => Math.round(mean + sd * random.normal() + (offset < shiftDays ? shift : 0)),
  });
}

describe("tracker change rule: number and duration", () => {
  test("a stable, noisy number tracker does not fire", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = evaluateTrackerChange(tracker({ days: noisy(30, 5, seed) }), AS_OF)!;
      expect(result.state).toBe("ready");
      expect(result.fired).toBe(false);
    }
  });

  test("a sustained shift fires, in the tracker's own name and unit", () => {
    const output = runInsightRules({
      asOf: AS_OF,
      series: {},
      trackers: [tracker({ days: noisy(30, 3, 4, 15, 7) })],
      goals: null,
    });
    const [insight] = output.insights;
    expect(insight?.ruleId).toBe("change.tracker");
    expect(insight?.kind).toBe("change");
    expect(insight?.topic).toBe("trackers");
    expect(insight?.id).toBe("change.tracker:00000000-0000-4000-8000-000000000001:2026-W42");
    expect(insight?.windowEnd).toBe(END);
    expect(insight?.factors).toEqual([]);
    expect(insight?.detail).toMatchObject({
      type: "tracker_change",
      trackerName: "Push-ups",
      trackerType: "number",
      unit: "reps",
      direction: "higher",
      recentWindowDays: 7,
      baselineWindowDays: 28,
    });
    // Trackers stay silent until ready: they add no readiness rows.
    expect(output.readiness.some((row) => row.ruleId === "change.tracker")).toBe(false);
  });

  test("the window ends yesterday: a partial today is not read", () => {
    const days = [
      ...trackerDays({ value: () => 10 }),
      // Today, still being logged.
      { date: AS_OF, value: 500 },
    ];
    const result = evaluateTrackerChange(tracker({ days }), AS_OF)!;
    expect(result.windowEnd).toBe(END);
    expect(result.fired).toBe(false);
  });

  test("zero is a logged value, not a missing day", () => {
    const values = trackerDailySeries(
      "number",
      [
        { date: "2026-10-01", value: 0 },
        { date: "2026-10-02", value: -2 },
      ],
      END,
    );
    expect([...values.entries()]).toEqual([
      ["2026-10-01", 0],
      ["2026-10-02", -2],
    ]);
  });

  test("gate: under 14 baseline days says building and never fires", () => {
    const days = trackerDays({ days: 7 + 13, value: (offset) => (offset < 7 ? 60 : 10) });
    const result = evaluateTrackerChange(tracker({ days }), AS_OF)!;
    expect(result.state).toBe("building_baseline");
    expect(result.fired).toBe(false);
  });

  test("gate: fewer than 5 of the last 7 days says no recent data", () => {
    const days = trackerDays({
      value: (offset) => (offset < 7 ? (offset < 4 ? 60 : null) : 10),
    });
    const result = evaluateTrackerChange(tracker({ days }), AS_OF)!;
    expect(result.state).toBe("no_recent_data");
    expect(result.fired).toBe(false);
  });

  test("relative floor: a tight baseline needs 20% of its median", () => {
    // Every baseline day is 10, so the person's own variation is zero and the
    // floor alone decides: 20% of 10 = 2.
    const below = trackerDays({ value: (offset) => (offset < 7 ? 11.5 : 10) });
    const above = trackerDays({ value: (offset) => (offset < 7 ? 12.5 : 10) });
    const small = evaluateTrackerChange(tracker({ days: below, decimals: 1 }), AS_OF)!;
    const large = evaluateTrackerChange(tracker({ days: above, decimals: 1 }), AS_OF)!;
    expect(small.fired).toBe(false);
    expect(large.fired).toBe(true);
    expect(large.detail?.threshold).toBe(2);
  });

  test("absolute floor: one display step when the usual is zero", () => {
    const tiny = trackerDays({ value: (offset) => (offset < 7 ? 0.6 : 0) });
    const whole = trackerDays({ value: (offset) => (offset < 7 ? 2 : 0) });
    expect(evaluateTrackerChange(tracker({ days: tiny }), AS_OF)!.fired).toBe(false);
    const result = evaluateTrackerChange(tracker({ days: whole }), AS_OF)!;
    expect(result.fired).toBe(true);
    expect(result.detail?.threshold).toBe(1);
  });

  test("noise threshold: a shift inside the person's own variation does not fire", () => {
    // Baseline alternates 20 and 40 (median 30, SD ≈ 10.2), so the threshold is
    // 3.5 × SD × √(1/7 + 1/28) ≈ 15, above the 20% floor of 6.
    const days = (recent: number) =>
      trackerDays({ value: (offset) => (offset < 7 ? recent : offset % 2 ? 20 : 40) });
    const inside = evaluateTrackerChange(tracker({ days: days(40) }), AS_OF)!;
    expect(inside.fired).toBe(false);
    expect(inside.strength).toBeLessThan(1);
    const outside = evaluateTrackerChange(tracker({ days: days(50) }), AS_OF)!;
    expect(outside.fired).toBe(true);
    expect(outside.detail?.threshold).toBeCloseTo(15.1, 0);
  });

  test("one extreme day does not fire (persistence)", () => {
    const days = trackerDays({ value: (offset) => (offset === 0 ? 500 : 10) });
    expect(evaluateTrackerChange(tracker({ days }), AS_OF)!.fired).toBe(false);
  });

  test("a change that only tips over today is not described (2-day confirmation)", () => {
    // Four raised days end the window today; yesterday's window had only three.
    const days = trackerDays({ value: (offset) => (offset < 4 ? 20 : 10) });
    const result = evaluateTrackerChange(tracker({ days, decimals: 0 }), AS_OF)!;
    expect(result.fired).toBe(false);
  });

  test("duration trackers use seconds with a one-minute floor", () => {
    const sauna = (recent: number) =>
      tracker({
        name: "Sauna",
        type: "duration",
        unit: null,
        days: trackerDays({ value: (offset) => (offset < 7 ? recent : 240) }),
      });
    // Usual 4 min: 20% is 48 s, so the one-minute floor applies.
    expect(evaluateTrackerChange(sauna(290), AS_OF)!.fired).toBe(false);
    const result = evaluateTrackerChange(sauna(600), AS_OF)!;
    expect(result.fired).toBe(true);
    expect(result.detail).toMatchObject({
      trackerType: "duration",
      unit: null,
      recentValue: 600,
      baselineValue: 240,
      difference: 360,
      threshold: 60,
      certainty: "clear",
    });
  });
});

describe("tracker change rule: yes/no", () => {
  const flossed = (days: InsightTrackerInput["days"]) =>
    tracker({ name: "Flossed", type: "yes_no", unit: null, days });

  test("the daily series counts every day from the first entry, a day with no entry as no", () => {
    const values = trackerDailySeries(
      "yes_no",
      [
        { date: "2026-10-03", value: 1 },
        { date: "2026-10-05", value: 0 },
        { date: "2026-10-06", value: 1 },
      ],
      "2026-10-07",
    );
    expect([...values.entries()]).toEqual([
      ["2026-10-03", 1],
      ["2026-10-04", 0],
      ["2026-10-05", 0],
      ["2026-10-06", 1],
      ["2026-10-07", 0],
    ]);
  });

  test("yes on most days after about one a week fires, in yes days per week", () => {
    // Baseline: yes on one day each week (logged only on yes days). Recent: 6 of 7.
    const days = trackerDays({
      value: (offset) => (offset < 7 ? (offset === 3 ? null : 1) : offset % 7 === 2 ? 1 : null),
    });
    const result = evaluateTrackerChange(flossed(days), AS_OF)!;
    expect(result.state).toBe("ready");
    expect(result.fired).toBe(true);
    expect(result.detail).toMatchObject({
      trackerType: "yes_no",
      direction: "higher",
      recentValue: 6,
      baselineValue: 1,
      recentDays: 7,
    });
  });

  test("the same share of yes days does not fire", () => {
    const random = rng(9);
    const days = trackerDays({ value: () => (random.uniform() < 0.5 ? 1 : 0) });
    expect(evaluateTrackerChange(flossed(days), AS_OF)!.fired).toBe(false);
  });

  test("a tracker the member stopped using stays silent, not 'fewer yes days'", () => {
    const days = trackerDays({ value: (offset) => (offset < 7 ? null : 1) });
    const result = evaluateTrackerChange(flossed(days), AS_OF)!;
    expect(result.state).toBe("no_recent_data");
    expect(result.fired).toBe(false);
  });

  test("an explicit 'no' on recent days is described", () => {
    const days = trackerDays({ value: (offset) => (offset < 7 ? (offset < 5 ? 0 : null) : 1) });
    const result = evaluateTrackerChange(flossed(days), AS_OF)!;
    expect(result.fired).toBe(true);
    expect(result.detail).toMatchObject({ direction: "lower", recentValue: 0, baselineValue: 7 });
  });

  test("gate: under 14 days since the first entry says building", () => {
    const days = trackerDays({ days: 20, value: (offset) => (offset < 7 ? 1 : null) });
    expect(evaluateTrackerChange(flossed(days), AS_OF)!.state).toBe("building_baseline");
  });
});

describe("which trackers are read", () => {
  const shifted = trackerDays({ value: (offset) => (offset < 7 ? 5 : 1) });

  test("1–5 scale trackers are excluded entirely", () => {
    const mood = tracker({ name: "Mood", type: "scale", unit: null, days: shifted });
    expect(isInsightTracker(mood)).toBe(false);
    expect(evaluateTrackerChange(mood, AS_OF)).toBeNull();
    const output = runInsightRules({ asOf: AS_OF, series: {}, trackers: [mood], goals: null });
    expect(output.insights).toEqual([]);
  });

  test("a tracker with the insights/AI switch off is excluded", () => {
    const hidden = tracker({ aiVisible: false, days: shifted });
    expect(isInsightTracker(hidden)).toBe(false);
    expect(evaluateTrackerChange(hidden, AS_OF)).toBeNull();
    const output = runInsightRules({ asOf: AS_OF, series: {}, trackers: [hidden], goals: null });
    expect(output.insights).toEqual([]);
    // The same tracker with the switch on fires.
    const visible = runInsightRules({
      asOf: AS_OF,
      series: {},
      trackers: [{ ...hidden, aiVisible: true }],
      goals: null,
    });
    expect(visible.insights).toHaveLength(1);
  });
});

describe("tracker changes and the change cap", () => {
  const make = (ruleId: Insight["ruleId"], id: string): Insight =>
    ({
      id,
      ruleId,
      ruleVersion: "1",
      kind: "change",
      topic: ruleId === "change.tracker" ? "trackers" : "sleep",
      windowKey: "w",
      windowEnd: AS_OF,
      detail: {} as never,
      factors: [],
    }) as Insight;
  const now = new Date(`${AS_OF}T12:00:00.000Z`);
  // Strongest first, as runInsightRules orders them.
  const insights = [
    make("change.tracker", "t1"),
    make("change.tracker", "t2"),
    make("change.tracker", "t3"),
    make("change.sleep_duration", "s"),
    make("change.steps", "p"),
  ];

  test("trackers fill at most half of the cap in the app; built-ins take the rest", () => {
    const selection = selectInsights(insights, {
      channel: "in_app",
      channels: defaultKindChannels(),
      feedback: [],
      now,
    });
    expect(selection.insights.map((insight) => insight.id)).toEqual(["t1", "s"]);
    expect(selection.suppressedChanges).toBe(3);
  });

  test("the weekly email's cap of 4 allows two tracker changes", () => {
    const selection = selectInsights(insights, {
      channel: "email",
      channels: defaultKindChannels(),
      feedback: [],
      now,
      changeCap: 4,
    });
    expect(selection.insights.map((insight) => insight.id)).toEqual(["t1", "t2", "s", "p"]);
  });

  test("with no built-in change, a tracker still takes only its share", () => {
    const selection = selectInsights(insights.slice(0, 3), {
      channel: "in_app",
      channels: defaultKindChannels(),
      feedback: [],
      now,
    });
    expect(selection.insights.map((insight) => insight.id)).toEqual(["t1"]);
  });

  test("tracker and built-in changes are ordered by strength together", () => {
    const output = runInsightRules({
      asOf: AS_OF,
      series: {},
      trackers: [
        tracker({ id: "a", days: noisy(30, 3, 4, 8, 7) }),
        tracker({ id: "b", days: noisy(30, 3, 4, 30, 7) }),
      ],
      goals: null,
    });
    expect(output.insights.map((insight) => insight.id.split(":")[1])).toEqual(["b", "a"]);
  });
});

describe("tracker false-alarm budget", () => {
  /**
   * Stable trackers (no real change): number counts with day-to-day noise and
   * some unlogged days, durations logged on most days, and yes/no trackers with
   * a steady share of yes days logged only on yes days. Each day the engine
   * runs; every distinct tracker change insight is a false alarm.
   */
  test("stable trackers stay under one change insight per tracker per 300 days", () => {
    const PEOPLE = 40;
    const DAYS = 150;
    const WARMUP = 40;
    let alarms = 0;
    let trackers = 0;
    for (let person = 0; person < PEOPLE; person += 1) {
      const random = rng(5000 + person);
      const start = addDays(AS_OF, -(DAYS - 1));
      const build = (value: () => number | null) => {
        const out: { date: string; value: number }[] = [];
        for (let i = 0; i < DAYS; i += 1) {
          const v = value();
          if (v !== null) out.push({ date: addDays(start, i), value: v });
        }
        return out;
      };
      const mean = 10 + 40 * random.uniform();
      const minutes = 5 + 25 * random.uniform();
      const share = 0.1 + 0.8 * random.uniform();
      const all: InsightTrackerInput[] = [
        tracker({
          id: `n${person}`,
          days: build(() =>
            random.uniform() < 0.15
              ? null
              : Math.max(0, Math.round(mean + mean * 0.35 * random.normal())),
          ),
        }),
        tracker({
          id: `d${person}`,
          type: "duration",
          unit: null,
          days: build(() =>
            random.uniform() < 0.2
              ? null
              : Math.max(60, Math.round(60 * (minutes + minutes * 0.4 * random.normal()))),
          ),
        }),
        tracker({
          id: `y${person}`,
          type: "yes_no",
          unit: null,
          days: build(() => (random.uniform() < share ? 1 : null)),
        }),
      ];
      trackers += all.length;
      const seen = new Set<string>();
      for (let i = WARMUP; i < DAYS; i += 1) {
        const asOf = addDays(start, i);
        const output = runInsightRules({
          asOf,
          series: {},
          trackers: all.map((t) => ({ ...t, days: t.days.filter((day) => day.date <= asOf) })),
          goals: null,
        });
        for (const insight of output.insights) seen.add(insight.id);
      }
      alarms += seen.size;
    }
    const perTrackerPer30Days = alarms / trackers / ((DAYS - WARMUP) / 30);
    // The current parameters give about 0.02.
    expect(perTrackerPer30Days).toBeLessThanOrEqual(0.1);
  });

  test("rule parameters match the built-in change gates", () => {
    expect(TRACKER_CHANGE_RULE).toMatchObject({
      recentWindowDays: 7,
      recentMinDays: 5,
      baselineWindowDays: 28,
      baselineMinDays: 14,
      noiseMultiplier: 3.5,
      persistenceMinDays: 4,
      sustainedDays: 2,
    });
  });
});
