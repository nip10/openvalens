import { describe, expect, test } from "bun:test";
import type { Goal, GoalCheckin } from "@openvalens/plans";

import type { Insight } from "./insight-contract";
import {
  addDays,
  CHANGE_INSIGHT_CAP,
  CHANGE_RULES,
  computeRecordingStreak,
  defaultKindChannels,
  evaluateChangeRule,
  evaluateWeightTrend,
  isoWeek,
  runInsightRules,
  selectInsights,
  type InsightDay,
} from "./insight-rules";
import { computeGoalProgress } from "./score-goal-progress";

/** Synthetic data only. Deterministic PRNG so every run sees the same series. */
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

type SeriesOptions = {
  days?: number;
  mean: number;
  sd: number;
  seed: number;
  source?: string | null;
  /** Added to days within `shiftDays` of `asOf`. */
  shift?: number;
  shiftDays?: number;
  /** Per weekday offset (0 = Sunday). */
  weekday?: (weekday: number) => number;
  asOf?: string;
};

function series(options: SeriesOptions): InsightDay[] {
  const random = rng(options.seed);
  const asOf = options.asOf ?? AS_OF;
  const days = options.days ?? 60;
  const out: InsightDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(asOf, -offset);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const shifted = options.shiftDays !== undefined && offset < options.shiftDays;
    out.push({
      date,
      value:
        options.mean +
        options.sd * random.normal() +
        (options.weekday?.(weekday) ?? 0) +
        (shifted ? (options.shift ?? 0) : 0),
      source: options.source === undefined ? "ds:1" : options.source,
    });
  }
  return out;
}

const RHR = CHANGE_RULES.find((rule) => rule.metric === "resting_heart_rate")!;
const SLEEP = CHANGE_RULES.find((rule) => rule.metric === "sleep_duration")!;
const STEPS = CHANGE_RULES.find((rule) => rule.metric === "steps")!;

describe("change rules", () => {
  test("noisy but stable resting heart rate does not fire", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = evaluateChangeRule(RHR, series({ mean: 60, sd: 3, seed }), AS_OF);
      expect(result.readiness.state).toBe("ready");
      expect(result.fired).toBe(false);
    }
  });

  test("a sustained 6 bpm shift over the last week fires, described against the usual", () => {
    const result = evaluateChangeRule(
      RHR,
      series({ mean: 60, sd: 2, seed: 7, shift: 6, shiftDays: 7 }),
      AS_OF,
    );
    expect(result.fired).toBe(true);
    expect(result.detail).toMatchObject({
      type: "change",
      metric: "resting_heart_rate",
      direction: "higher",
      unit: "bpm",
      recentDays: 7,
      baselineDays: 28,
    });
    expect(result.detail!.difference).toBeGreaterThanOrEqual(result.detail!.threshold);
  });

  test("one unusual day does not fire (persistence)", () => {
    const data = series({ mean: 60, sd: 1, seed: 3 });
    data[data.length - 1] = { ...data[data.length - 1]!, value: 95 };
    const result = evaluateChangeRule(RHR, data, AS_OF);
    expect(result.fired).toBe(false);
  });

  test("a shift below the practical floor never fires, however tight the baseline", () => {
    const result = evaluateChangeRule(
      RHR,
      series({ mean: 60, sd: 0.2, seed: 9, shift: 2, shiftDays: 7 }),
      AS_OF,
    );
    expect(result.detail).toBeNull();
    expect(result.fired).toBe(false);
  });

  test("shorter sleep by 70 minutes for a week fires as lower", () => {
    const result = evaluateChangeRule(
      SLEEP,
      series({ mean: 420, sd: 25, seed: 11, shift: -70, shiftDays: 7 }),
      AS_OF,
    );
    expect(result.fired).toBe(true);
    expect(result.detail?.direction).toBe("lower");
  });

  test("weekend step peaks (weekday cycle) do not fire", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = evaluateChangeRule(
        STEPS,
        series({
          mean: 8000,
          sd: 1500,
          seed,
          weekday: (day) => (day === 0 || day === 6 ? 3000 : 0),
        }),
        AS_OF,
      );
      expect(result.fired).toBe(false);
    }
  });

  test("readiness gate: under 14 baseline days says building, never fires", () => {
    const result = evaluateChangeRule(
      RHR,
      series({ mean: 60, sd: 2, seed: 5, days: 17, shift: 10, shiftDays: 7 }),
      AS_OF,
    );
    expect(result.readiness).toMatchObject({
      state: "building_baseline",
      baselineDays: 10,
      baselineMinDays: 14,
    });
    expect(result.fired).toBe(false);
    expect(result.strength).toBeNull();
  });

  test("too few recent days says no recent data", () => {
    const data = series({ mean: 60, sd: 2, seed: 5 }).filter(
      (day) => day.date < addDays(AS_OF, -3),
    );
    const result = evaluateChangeRule(RHR, data, AS_OF);
    expect(result.readiness.state).toBe("no_recent_data");
    expect(result.readiness.recentDays).toBe(3);
  });

  test("device switch: a new source reading 8 bpm higher does not fire; the usual is rebuilt", () => {
    const oldDevice = series({ mean: 60, sd: 2, seed: 21, source: "ds:old" }).filter(
      (day) => day.date < addDays(AS_OF, -6),
    );
    const newDevice = series({ mean: 68, sd: 2, seed: 22, source: "ds:new" }).filter(
      (day) => day.date >= addDays(AS_OF, -6),
    );
    const data = [...oldDevice, ...newDevice];
    const result = evaluateChangeRule(RHR, data, AS_OF);
    expect(result.fired).toBe(false);
    expect(result.readiness.state).toBe("rebuilding_after_source_change");
    expect(result.sourceChange).toEqual({ sinceDate: addDays(AS_OF, -6) });

    const output = runInsightRules({
      asOf: AS_OF,
      series: { resting_heart_rate: data },
      goals: null,
    });
    expect(output.insights.some((insight) => insight.kind === "change")).toBe(false);
    const switchInsight = output.insights.find(
      (insight) => insight.ruleId === "data_quality.source_change",
    );
    expect(switchInsight?.detail).toMatchObject({
      type: "source_change",
      metric: "resting_heart_rate",
      sinceDate: addDays(AS_OF, -6),
    });
  });

  test("days with an unknown source are not treated as a device switch", () => {
    const data = series({ mean: 60, sd: 2, seed: 4 }).map((day, index) => ({
      ...day,
      source: index % 3 === 0 ? null : "ds:1",
    }));
    const result = evaluateChangeRule(RHR, data, AS_OF);
    expect(result.readiness.state).toBe("ready");
    expect(result.sourceChange).toBeNull();
  });
});

describe("weight trend", () => {
  test("a steady 2 kg drop over four weeks fires", () => {
    const data = series({ mean: 80, sd: 0.3, seed: 31, days: 28 }).map((day, index) => ({
      ...day,
      value: day.value! - (2 * index) / 27,
    }));
    const result = evaluateWeightTrend(data, AS_OF);
    expect(result.fired).toBe(true);
    expect(result.detail).toMatchObject({ type: "trend", direction: "lower", windowDays: 28 });
  });

  test("a weekly weigh-in cycle (Monday peak) with no trend does not fire", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = evaluateWeightTrend(
        series({ mean: 80, sd: 0.45, seed, weekday: (day) => (day === 1 ? 0.3 : 0) }),
        AS_OF,
      );
      expect(result.fired).toBe(false);
    }
  });

  test("too few weigh-ins says building the usual", () => {
    const data = series({ mean: 80, sd: 0.3, seed: 1, days: 28 }).filter((_, i) => i % 5 === 0);
    expect(evaluateWeightTrend(data, AS_OF).readiness.state).toBe("building_baseline");
  });
});

describe("goal, data-quality and streak insights", () => {
  const goal: Goal = {
    id: 1,
    organizationId: "org",
    title: "Run 10 km",
    category: "endurance",
    horizon: "medium",
    status: "in_progress",
    targetValue: "10",
    currentValue: "6",
    targetDate: null,
    notes: null,
    direction: "increase",
    baselineValue: "2",
    priority: null,
  };
  const checkin = (id: number, date: string, value: string): GoalCheckin => ({
    id,
    organizationId: "org",
    goalId: 1,
    date,
    value,
    notes: null,
    createdAt: `${date}T08:00:00.000Z`,
  });

  test("goal moving toward its target produces a milestone keyed by the check-in", () => {
    const result = computeGoalProgress([
      {
        goal,
        checkins: [checkin(1, "2026-10-01", "4"), checkin(2, "2026-10-12", "6")],
      },
    ]);
    const output = runInsightRules({
      asOf: AS_OF,
      series: {},
      goals: { result, latestCheckinDates: { 1: "2026-10-12" } },
    });
    const milestone = output.insights.find((insight) => insight.kind === "goal_milestone");
    expect(milestone?.id).toBe("goal.toward_target:1:2026-10-12");
    expect(milestone?.topic).toBe("goals");
  });

  test("an old check-in no longer produces a toward/away insight", () => {
    const result = computeGoalProgress([
      {
        goal,
        checkins: [checkin(1, "2026-08-01", "4"), checkin(2, "2026-08-12", "6")],
      },
    ]);
    const output = runInsightRules({
      asOf: AS_OF,
      series: {},
      goals: { result, latestCheckinDates: { 1: "2026-08-12" } },
    });
    expect(output.insights).toEqual([]);
  });

  test("a recording gap after regular data is described once per gap", () => {
    const data = series({ mean: 420, sd: 30, seed: 2 }).filter(
      (day) => day.date <= addDays(AS_OF, -4),
    );
    const output = runInsightRules({ asOf: AS_OF, series: { sleep_duration: data }, goals: null });
    const gap = output.insights.find((insight) => insight.ruleId === "data_quality.recording_gap");
    expect(gap?.id).toBe(`data_quality.recording_gap:sleep_duration:${addDays(AS_OF, -4)}`);
    expect(gap?.detail).toMatchObject({ daysWithout: 4 });
  });

  test("recording streak reports the largest milestone reached", () => {
    const data = series({ mean: 420, sd: 30, seed: 2, days: 16 });
    expect(computeRecordingStreak(data, AS_OF)).toEqual({
      days: 16,
      startDate: addDays(AS_OF, -15),
      lastDate: AS_OF,
    });
    const output = runInsightRules({ asOf: AS_OF, series: { sleep_duration: data }, goals: null });
    const streak = output.insights.find((insight) => insight.kind === "streak");
    expect(streak?.detail).toMatchObject({ type: "streak", days: 14 });
  });

  test("measures the viewer cannot read are reported as no_access, never as zero", () => {
    const output = runInsightRules({ asOf: AS_OF, series: {}, goals: null });
    expect(output.insights).toEqual([]);
    expect(output.readiness.every((entry) => entry.state === "no_access")).toBe(true);
  });
});

describe("co-occurring factors", () => {
  test("a fired change lists other measures that moved in the same window, as co-occurrence", () => {
    const output = runInsightRules({
      asOf: AS_OF,
      series: {
        resting_heart_rate: series({ mean: 60, sd: 2, seed: 7, shift: 7, shiftDays: 7 }),
        sleep_duration: series({ mean: 420, sd: 20, seed: 8, shift: -60, shiftDays: 7 }),
      },
      goals: null,
    });
    const rhr = output.insights.find((insight) => insight.ruleId === "change.resting_heart_rate");
    expect(rhr?.factors).toContainEqual({ metric: "sleep_duration", direction: "lower" });
  });
});

describe("selection: feedback, channels and the cap", () => {
  const make = (ruleId: Insight["ruleId"], kind: Insight["kind"], id: string): Insight =>
    ({
      id,
      ruleId,
      ruleVersion: "1",
      kind,
      topic: "sleep",
      windowKey: "w",
      windowEnd: AS_OF,
      detail: {} as never,
      factors: [],
    }) as Insight;
  const now = new Date(`${AS_OF}T12:00:00.000Z`);
  const insights = [
    make("change.resting_heart_rate", "change", "a"),
    make("change.sleep_duration", "change", "b"),
    make("change.steps", "change", "c"),
    make("streak.recording", "streak", "d"),
  ];

  test("caps change insights and counts the rest as suppressed", () => {
    const selection = selectInsights(insights, {
      channel: "in_app",
      channels: defaultKindChannels(),
      feedback: [],
      now,
    });
    expect(selection.insights.map((insight) => insight.id)).toEqual(["a", "b", "d"]);
    expect(selection.suppressedChanges).toBe(3 - CHANGE_INSIGHT_CAP);
  });

  test("dismiss hides one insight; not useful mutes the rule until it expires", () => {
    const selection = selectInsights(insights, {
      channel: "in_app",
      channels: defaultKindChannels(),
      feedback: [
        {
          insightId: "a",
          ruleId: "change.resting_heart_rate",
          action: "dismiss",
          mutedUntil: null,
        },
        {
          insightId: "old",
          ruleId: "change.sleep_duration",
          action: "not_useful",
          mutedUntil: new Date(now.getTime() + 86_400_000),
        },
        {
          insightId: "older",
          ruleId: "streak.recording",
          action: "not_useful",
          mutedUntil: new Date(now.getTime() - 1),
        },
      ],
      now,
    });
    expect(selection.insights.map((insight) => insight.id)).toEqual(["c", "d"]);
    expect(selection.hiddenCount).toBe(2);
  });

  test("a kind switched off for a channel is hidden on that channel only", () => {
    const channels = defaultKindChannels();
    channels.streak.push = false;
    const push = selectInsights(insights, { channel: "push", channels, feedback: [], now });
    const inApp = selectInsights(insights, { channel: "in_app", channels, feedback: [], now });
    expect(push.insights.some((insight) => insight.kind === "streak")).toBe(false);
    expect(inApp.insights.some((insight) => insight.kind === "streak")).toBe(true);
  });
});

describe("false-alarm budget", () => {
  /**
   * Simulated people with stable (no real change) but noisy data, using the
   * day-to-day variability figures in docs/insight-rules.md, a weekday cycle for
   * steps and weight, and occasional missing days. Each day the engine runs;
   * every distinct change insight (rule + week) is a false alarm. The agreed
   * budget is at most one per person per 30 days across all change rules.
   */
  test("stable data stays under one change insight per person per 30 days", () => {
    const PEOPLE = 60;
    const DAYS = 150;
    const WARMUP = 40;
    let alarms = 0;
    for (let person = 0; person < PEOPLE; person += 1) {
      const random = rng(1000 + person);
      const start = addDays(AS_OF, -(DAYS - 1));
      // AR(1) noise: daily physiology is autocorrelated. ~10% of days missing.
      const build = (mean: number, sd: number, weekday: (day: number) => number) => {
        const out: InsightDay[] = [];
        let previous = 0;
        for (let i = 0; i < DAYS; i += 1) {
          const date = addDays(start, i);
          const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
          previous = 0.3 * previous + Math.sqrt(1 - 0.09) * random.normal();
          const value = random.uniform() < 0.1 ? null : mean + sd * previous + weekday(day);
          out.push({ date, value, source: "ds:1" });
        }
        return out;
      };
      const full = {
        resting_heart_rate: build(55 + 20 * random.uniform(), 3, () => 0),
        sleep_duration: build(400 + 60 * random.uniform(), 70, (d) =>
          d === 0 || d === 6 ? 25 : 0,
        ),
        steps: build(6000 + 6000 * random.uniform(), 3000, (d) => (d === 6 ? 1500 : 0)),
        weight: build(60 + 40 * random.uniform(), 0.5, (d) => (d === 1 ? 0.25 : 0)),
      };
      const seen = new Set<string>();
      for (let i = WARMUP; i < DAYS; i += 1) {
        const asOf = addDays(start, i);
        const output = runInsightRules({
          asOf,
          series: {
            resting_heart_rate: full.resting_heart_rate.filter((d) => d.date <= asOf),
            sleep_duration: full.sleep_duration.filter((d) => d.date <= asOf),
            steps: full.steps.filter((d) => d.date <= asOf),
            weight: full.weight.filter((d) => d.date <= asOf),
          },
          goals: null,
        });
        for (const insight of output.insights) if (insight.kind === "change") seen.add(insight.id);
      }
      alarms += seen.size;
    }
    const perPersonPer30Days = alarms / PEOPLE / ((DAYS - WARMUP) / 30);
    expect(perPersonPer30Days).toBeLessThanOrEqual(1);
  });
});

describe("helpers", () => {
  test("ISO week", () => {
    expect(isoWeek("2026-10-15")).toBe("2026-W42");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });
});
