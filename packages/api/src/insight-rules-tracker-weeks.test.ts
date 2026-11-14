import { describe, expect, test } from "bun:test";

import type { Insight } from "./insight-contract";
import {
  addDays,
  defaultKindChannels,
  evaluateTrackerWeek,
  latestTrackerWeekEnd,
  passesTrackerDailyEntryGates,
  runInsightRules,
  selectInsights,
  TRACKER_WEEK_RULE,
  type InsightTrackerInput,
} from "./insight-rules";

/** #501 — weekly totals for trackers logged a few days a week. Synthetic data only. */

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

/** A Thursday. The latest complete week it reads is Mon 5 Oct – Sun 11 Oct. */
const AS_OF = "2026-10-15";
const WEEK_START = "2026-10-05";
const WEEK_END = "2026-10-11";

/**
 * Entries by week and weekday: `week` 0 is the latest complete week, 1–4 the
 * baseline weeks, and so on; `weekday` 0 is Monday. Null = no entry.
 */
function weeks(
  count: number,
  value: (week: number, weekday: number) => number | null,
): InsightTrackerInput["days"] {
  const out: { date: string; value: number }[] = [];
  for (let week = count - 1; week >= 0; week -= 1)
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const v = value(week, weekday);
      if (v !== null) out.push({ date: addDays(WEEK_START, -7 * week + weekday), value: v });
    }
  return out;
}

function sauna(days: InsightTrackerInput["days"], overrides: Partial<InsightTrackerInput> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Sauna",
    type: "duration",
    unit: null,
    decimals: 0,
    aggregation: "sum",
    aiVisible: true,
    days,
    ...overrides,
  } satisfies InsightTrackerInput;
}

/** Monday and Thursday, about 15 minutes each time. */
const twiceAWeek = (seed: number) => {
  const random = rng(seed);
  return (_week: number, weekday: number) =>
    weekday === 0 || weekday === 3 ? Math.round(60 * (15 + random.normal())) : null;
};

describe("weekly tracker comparison: acceptance", () => {
  test("a twice-a-week sauna whose weekly total clearly changes gets one neutral insight", () => {
    const usual = twiceAWeek(1);
    // The latest week: five sessions of about 20 minutes.
    const days = weeks(10, (week, weekday) =>
      week === 0 ? (weekday < 5 ? 1200 : null) : usual(week, weekday),
    );
    const output = runInsightRules({
      asOf: AS_OF,
      series: {},
      trackers: [sauna(days)],
      goals: null,
    });
    expect(output.insights).toHaveLength(1);
    const [insight] = output.insights;
    expect(insight?.ruleId).toBe("change.tracker");
    expect(insight?.ruleVersion).toBe("2");
    expect(insight?.kind).toBe("change");
    expect(insight?.topic).toBe("trackers");
    expect(insight?.id).toBe("change.tracker:00000000-0000-4000-8000-000000000002:week:2026-W41");
    expect(insight?.windowEnd).toBe(WEEK_END);
    expect(insight?.factors).toEqual([]);
    expect(insight?.detail).toMatchObject({
      type: "tracker_week_change",
      trackerName: "Sauna",
      trackerType: "duration",
      unit: null,
      direction: "higher",
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
      recentValue: 6000,
      recentDays: 5,
      baselineWeeks: 4,
      baselineWindowWeeks: 4,
      certainty: "clear",
    });
    // No readiness rows for trackers.
    expect(output.readiness.some((row) => row.ruleId === "change.tracker")).toBe(false);
  });

  test("the insight holds for the whole week it describes, and only that week", () => {
    const usual = twiceAWeek(2);
    const days = weeks(10, (week, weekday) =>
      week === 0 ? (weekday < 5 ? 1200 : null) : usual(week, weekday),
    );
    const ids = new Map<string, string[]>();
    // From the Monday right after the week to the Monday a week later.
    for (let offset = 0; offset <= 7; offset += 1) {
      const asOf = addDays(WEEK_END, 1 + offset);
      const output = runInsightRules({ asOf, series: {}, trackers: [sauna(days)], goals: null });
      ids.set(
        asOf,
        output.insights.map((insight) => insight.id),
      );
    }
    // Monday: the week only ended yesterday, so late entries may still come in.
    expect(ids.get("2026-10-12")).toEqual([]);
    for (const asOf of [
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
    ])
      expect(ids.get(asOf)).toEqual([
        "change.tracker:00000000-0000-4000-8000-000000000002:week:2026-W41",
      ]);
  });

  test("a stable twice-a-week sauna stays silent", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = evaluateTrackerWeek(sauna(weeks(10, twiceAWeek(seed))), AS_OF)!;
      expect(result.state).toBe("ready");
      expect(result.fired).toBe(false);
    }
  });
});

describe("weekly tracker comparison: gates", () => {
  test("weeks run Monday to Sunday and are read from the Tuesday after", () => {
    expect(latestTrackerWeekEnd("2026-10-12")).toBe("2026-10-04"); // Monday
    expect(latestTrackerWeekEnd("2026-10-13")).toBe("2026-10-11"); // Tuesday
    expect(latestTrackerWeekEnd("2026-10-18")).toBe("2026-10-11"); // Sunday
    expect(latestTrackerWeekEnd("2026-10-19")).toBe("2026-10-11"); // Monday
  });

  test("zero-heavy baseline: fewer than 3 of 4 baseline weeks with an entry stays silent", () => {
    const days = weeks(10, (week, weekday) =>
      week === 0
        ? weekday < 5
          ? 1200
          : null
        : week === 2 || week === 3
          ? null
          : weekday === 0 || weekday === 3
            ? 900
            : null,
    );
    const result = evaluateTrackerWeek(sauna(days), AS_OF)!;
    expect(result.state).toBe("building_baseline");
    expect(result.fired).toBe(false);
  });

  test("a tracker with no entry in the latest week stays silent, not 'less than usual'", () => {
    const usual = twiceAWeek(3);
    const days = weeks(10, (week, weekday) => (week === 0 ? null : usual(week, weekday)));
    const result = evaluateTrackerWeek(sauna(days), AS_OF)!;
    expect(result.state).toBe("no_recent_data");
    expect(
      runInsightRules({ asOf: AS_OF, series: {}, trackers: [sauna(days)], goals: null }).insights,
    ).toEqual([]);
  });

  test("one extreme day does not fire (persistence)", () => {
    // The usual two sessions, one of them three hours long.
    const days = weeks(10, (week, weekday) =>
      weekday === 0 ? (week === 0 ? 3 * 3600 : 900) : weekday === 3 ? 900 : null,
    );
    const result = evaluateTrackerWeek(sauna(days), AS_OF)!;
    expect(result.strength).toBeGreaterThan(1);
    expect(result.fired).toBe(false);
  });

  test("on a perfectly regular schedule, one extra session is more than the usual week", () => {
    // Two sessions of 15 min, then three: replacing the extra one with a usual
    // day still leaves 45 min against a usual 30 min.
    const three = weeks(10, (week, weekday) =>
      weekday === 0 || weekday === 3 || (week === 0 && weekday === 5) ? 900 : null,
    );
    expect(evaluateTrackerWeek(sauna(three), AS_OF)!.fired).toBe(true);
  });

  test("lower: four sessions to one fires; two to one (a single skipped day) does not", () => {
    const four = weeks(10, (week, weekday) =>
      week === 0 ? (weekday === 0 ? 1800 : null) : weekday % 2 === 0 && weekday < 7 ? 1800 : null,
    );
    const fourResult = evaluateTrackerWeek(sauna(four), AS_OF)!;
    expect(fourResult.fired).toBe(true);
    expect(fourResult.detail).toMatchObject({ direction: "lower", recentDays: 1 });

    const two = weeks(10, (week, weekday) =>
      weekday === 0 || (weekday === 3 && week !== 0) ? 900 : null,
    );
    expect(evaluateTrackerWeek(sauna(two), AS_OF)!.fired).toBe(false);
  });

  test("noise floor: a perfectly regular usual needs 20% of the median, or one step", () => {
    // Every baseline week is exactly 2 × 15 min, so the SD term is zero and
    // 20% of 30 min (6 min) is the threshold.
    const regular = (latest: (weekday: number) => number | null) =>
      weeks(10, (week, weekday) =>
        week === 0 ? latest(weekday) : weekday === 0 || weekday === 3 ? 900 : null,
      );
    const result = evaluateTrackerWeek(
      sauna(regular((weekday) => (weekday < 4 ? 900 : null))),
      AS_OF,
    )!;
    expect(result.fired).toBe(true);
    expect(result.detail?.threshold).toBe(360);
    expect(result.detail?.baselineValue).toBe(1800);

    // Yes/no with zero yes days in the usual week: the floor is one yes day.
    const yesNo = evaluateTrackerWeek(
      sauna(
        weeks(10, (week, weekday) =>
          week === 0 ? (weekday < 3 ? 1 : null) : weekday === 2 ? 0 : null,
        ),
        { type: "yes_no", aggregation: "any" },
      ),
      AS_OF,
    )!;
    expect(yesNo.fired).toBe(true);
    expect(yesNo.detail?.threshold).toBe(1);
  });

  test("noise threshold: a week inside the person's own week-to-week variation does not fire", () => {
    // Weekly totals alternate between one and three 15-minute sessions.
    const days = (latestSessions: number) =>
      weeks(10, (week, weekday) => {
        const sessions = week === 0 ? latestSessions : week % 2 ? 1 : 3;
        return weekday < sessions ? 900 : null;
      });
    const inside = evaluateTrackerWeek(sauna(days(4)), AS_OF)!;
    expect(inside.strength).toBeLessThan(1);
    expect(inside.fired).toBe(false);
  });

  test("a tracker logged on most days is left to the daily rule, even after a quiet week", () => {
    // Push-ups every day, then only twice in the latest week.
    const days = weeks(10, (week, weekday) => (week === 0 && weekday > 1 ? null : 20));
    const pushUps = sauna(days, { name: "Push-ups", type: "number", unit: "reps" });
    expect(evaluateTrackerWeek(pushUps, AS_OF)!.state).toBe("not_sparse");
    expect(
      runInsightRules({ asOf: AS_OF, series: {}, trackers: [pushUps], goals: null }).insights,
    ).toEqual([]);
  });

  test("a sparse tracker that still passes the daily gates stays on the daily rule", () => {
    // Four days a week (16 baseline days), then five of the last seven.
    const days = [
      ...weeks(8, (_week, weekday) => (weekday < 4 ? 900 : null)),
      { date: "2026-10-10", value: 900 },
      { date: "2026-10-12", value: 900 },
      { date: "2026-10-13", value: 900 },
      { date: "2026-10-14", value: 900 },
    ];
    expect(passesTrackerDailyEntryGates(sauna(days), AS_OF)).toBe(true);
    // Twice a week fails them.
    expect(passesTrackerDailyEntryGates(sauna(weeks(10, twiceAWeek(4))), AS_OF)).toBe(false);
  });
});

describe("weekly tracker comparison: which trackers", () => {
  test("yes/no logged on yes days: yes days per week", () => {
    const days = weeks(10, (week, weekday) =>
      week === 0 ? (weekday < 5 ? 1 : null) : weekday === 1 || weekday === 4 ? 1 : null,
    );
    const flossed = sauna(days, { name: "Flossed", type: "yes_no", aggregation: "any" });
    const output = runInsightRules({ asOf: AS_OF, series: {}, trackers: [flossed], goals: null });
    expect(output.insights).toHaveLength(1);
    expect(output.insights[0]?.detail).toMatchObject({
      type: "tracker_week_change",
      trackerType: "yes_no",
      direction: "higher",
      recentValue: 5,
      baselineValue: 2,
    });
  });

  test("numbers only when their days are added up", () => {
    const days = weeks(10, (week, weekday) =>
      weekday === 2 || weekday === 5 ? (week === 0 ? 25 : 10) : null,
    );
    const km = (aggregation: string) =>
      sauna(days, { name: "Cycling", type: "number", unit: "km", aggregation });
    const summed = evaluateTrackerWeek(km("sum"), AS_OF)!;
    expect(summed.fired).toBe(true);
    expect(summed.detail).toMatchObject({ unit: "km", recentValue: 50, baselineValue: 20 });
    for (const aggregation of ["average", "last"]) {
      expect(evaluateTrackerWeek(km(aggregation), AS_OF)!.state).toBe("not_added_up");
      expect(
        runInsightRules({ asOf: AS_OF, series: {}, trackers: [km(aggregation)], goals: null })
          .insights,
      ).toEqual([]);
    }
  });

  test("1–5 scales and trackers with the insights/AI switch off are excluded", () => {
    const days = weeks(10, (week, weekday) =>
      weekday === 0 || weekday === 3 ? (week === 0 ? 5 : 1) : null,
    );
    expect(evaluateTrackerWeek(sauna(days, { type: "scale" }), AS_OF)).toBeNull();
    expect(evaluateTrackerWeek(sauna(days, { aiVisible: false }), AS_OF)).toBeNull();
  });

  test("weekly tracker changes count toward the tracker share of the change cap", () => {
    const make = (id: string, ruleId: Insight["ruleId"]): Insight =>
      ({
        id,
        ruleId,
        ruleVersion: "2",
        kind: "change",
        topic: "trackers",
        windowKey: "w",
        windowEnd: AS_OF,
        detail: {} as never,
        factors: [],
      }) as Insight;
    const selection = selectInsights(
      [
        make("week", "change.tracker"),
        make("day", "change.tracker"),
        make("sleep", "change.sleep_duration"),
      ],
      {
        channel: "in_app",
        channels: defaultKindChannels(),
        feedback: [],
        now: new Date(`${AS_OF}T12:00:00.000Z`),
      },
    );
    expect(selection.insights.map((insight) => insight.id)).toEqual(["week", "sleep"]);
  });
});

describe("weekly tracker false-alarm budget", () => {
  /**
   * Stable trackers logged a few days a week (no real change): durations on
   * random days, durations on a fixed schedule with skipped and extra
   * sessions, added-up numbers on random days, and yes/no logged only on yes
   * days. The engine runs every day; every distinct tracker insight is a false
   * alarm.
   */
  test("stable sparse trackers stay under one change insight per tracker per 300 days", () => {
    const PEOPLE = 60;
    const DAYS = 200;
    const WARMUP = 50;
    let alarms = 0;
    let trackers = 0;
    for (let person = 0; person < PEOPLE; person += 1) {
      const random = rng(9000 + person);
      const start = addDays(AS_OF, -(DAYS - 1));
      const build = (value: (index: number) => number | null) => {
        const out: { date: string; value: number }[] = [];
        for (let index = 0; index < DAYS; index += 1) {
          const v = value(index);
          if (v !== null) out.push({ date: addDays(start, index), value: v });
        }
        return out;
      };
      const randomShare = 0.1 + 0.5 * random.uniform();
      const randomMinutes = 10 + 30 * random.uniform();
      const sessions = 1 + Math.floor(4 * random.uniform());
      const offset = Math.floor(7 * random.uniform());
      const scheduledMinutes = 10 + 30 * random.uniform();
      const numberShare = 0.1 + 0.5 * random.uniform();
      const numberMean = 5 + 45 * random.uniform();
      const yesShare = 0.1 + 0.5 * random.uniform();
      const all: InsightTrackerInput[] = [
        sauna(
          build(() =>
            random.uniform() < randomShare
              ? Math.max(60, Math.round(60 * randomMinutes * (1 + 0.3 * random.normal())))
              : null,
          ),
          { id: `random${person}` },
        ),
        sauna(
          build((index) => {
            const slot = (index + offset) % 7;
            const planned = slot < sessions * 2 && slot % 2 === 0;
            // 10% of planned sessions skipped, an unplanned one on 4% of days.
            const happens = planned ? random.uniform() > 0.1 : random.uniform() < 0.04;
            return happens
              ? Math.max(60, Math.round(60 * scheduledMinutes * (1 + 0.25 * random.normal())))
              : null;
          }),
          { id: `scheduled${person}` },
        ),
        sauna(
          build(() =>
            random.uniform() < numberShare
              ? Math.max(0, Math.round(numberMean * (1 + 0.4 * random.normal())))
              : null,
          ),
          { id: `number${person}`, type: "number", unit: "km" },
        ),
        sauna(
          build(() => (random.uniform() < yesShare ? 1 : null)),
          { id: `yes${person}`, type: "yes_no", aggregation: "any" },
        ),
      ];
      trackers += all.length;
      const seen = new Set<string>();
      for (let index = WARMUP; index < DAYS; index += 1) {
        const asOf = addDays(start, index);
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
    // The current parameters give about 0.03; with the SD of the 4 baseline
    // weeks alone it would be about 0.12.
    expect(perTrackerPer30Days).toBeLessThanOrEqual(0.1);
  });

  test("rule parameters", () => {
    expect(TRACKER_WEEK_RULE).toMatchObject({
      baselineWeeks: 4,
      baselineMinWeeksLogged: 3,
      latestMinDaysLogged: 1,
      sparseBelowDays: 5,
      lateEntryDays: 1,
      floorRelative: 0.2,
      noiseMultiplier: 3.5,
      spreadWeeks: 8,
    });
  });
});
