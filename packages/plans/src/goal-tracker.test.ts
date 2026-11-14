import { describe, expect, test } from "bun:test";
import { evaluateGoal } from "./goal-evaluation";
import { validateGoalDefinition, validateGoalEvidence, type GoalDefinition } from "./goal-model";
import {
  TRACKER_DONE_TARGET,
  trackerGoalEvidence,
  trackerGoalMetric,
  trackerGoalProblem,
  trackerGoalRuleKinds,
  trackerGoalUnit,
  trackerIdFromGoalMetric,
  type TrackerGoalEntry,
  type TrackerGoalShape,
} from "./goal-tracker";

const TRACKER_ID = "0b9c6f1e-4a3d-4c2b-9f1e-2a3b4c5d6e7f";
const metric = trackerGoalMetric(TRACKER_ID);

function goal(rule: GoalDefinition["rule"], extra: Partial<GoalDefinition> = {}): GoalDefinition {
  return {
    id: "g",
    title: "Tracker goal",
    source: "tracker",
    metric,
    unit: null,
    rule,
    startDate: "2026-03-02",
    timeZone: "UTC",
    status: "active",
    ...extra,
  };
}

let sequence = 0;
function entry(localDate: string, value: number, time = "08:00:00"): TrackerGoalEntry {
  sequence += 1;
  return { id: `e${sequence}`, value, localDate, loggedAt: `${localDate}T${time}Z` };
}

function evidenceFor(tracker: TrackerGoalShape, entries: TrackerGoalEntry[]) {
  return trackerGoalEvidence({ metric, tracker, entries });
}

describe("tracker goal metric", () => {
  test("round-trips a tracker id and rejects anything else", () => {
    expect(metric).toBe(`tracker:${TRACKER_ID}`);
    expect(trackerIdFromGoalMetric(metric)).toBe(TRACKER_ID);
    expect(trackerIdFromGoalMetric("tracker:not-a-uuid")).toBeNull();
    expect(trackerIdFromGoalMetric(`supplement:${TRACKER_ID}`)).toBeNull();
  });

  test("the goal model accepts the tracker source for definitions and evidence", () => {
    expect(
      validateGoalDefinition(goal({ kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 3 }))
        .ok,
    ).toBe(true);
    for (const item of evidenceFor({ type: "scale", unit: null, aggregation: "average" }, [
      entry("2026-03-02", 4),
    ]))
      expect(validateGoalEvidence(item).ok).toBe(true);
  });
});

describe("tracker goal evidence is combined per day the way the tracker defines", () => {
  test("number sum: a day's entries add up before the rule compares them", () => {
    const tracker: TrackerGoalShape = { type: "number", unit: "pages", aggregation: "sum" };
    const evidence = evidenceFor(tracker, [
      entry("2026-03-02", 10, "07:00:00"),
      entry("2026-03-02", 15, "21:00:00"),
      entry("2026-03-03", 12),
    ]);
    expect(evidence.map((item) => [item.dateOnly, item.value])).toEqual([
      ["2026-03-02", 25],
      ["2026-03-03", 12],
    ]);
    const out = evaluateGoal(
      goal(
        { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 20 } },
        { unit: "pages" },
      ),
      evidence,
      "2026-03-03",
    );
    expect(out.days.map((day) => [day.date, day.state, day.value])).toEqual([
      ["2026-03-02", "qualifies", 25],
      ["2026-03-03", "does-not-qualify", 12],
    ]);
  });

  test("number average and last follow the tracker's aggregation", () => {
    const entries = [entry("2026-03-02", 2, "07:00:00"), entry("2026-03-02", 6, "20:00:00")];
    const averaged = evidenceFor({ type: "number", unit: "x", aggregation: "average" }, entries);
    const last = evidenceFor({ type: "number", unit: "x", aggregation: "last" }, entries);
    expect(averaged[0]?.value).toBe(4);
    expect(last[0]?.value).toBe(6);
    const out = evaluateGoal(
      goal({ kind: "target", target: { kind: "minimum", value: 5 } }, { unit: "x" }),
      last,
      "2026-03-02",
    );
    expect(out.achieved).toBe(true);
    expect(out.currentValue).toBe(6);
  });

  test("duration: seconds are summed per day and compared in minutes", () => {
    const tracker: TrackerGoalShape = { type: "duration", unit: null, aggregation: "sum" };
    const evidence = evidenceFor(tracker, [
      entry("2026-03-02", 600, "07:00:00"),
      entry("2026-03-02", 900, "19:00:00"),
      entry("2026-03-03", 300),
    ]);
    expect(evidence.map((item) => item.value)).toEqual([25, 5]);
    const out = evaluateGoal(
      goal(
        { kind: "average", target: { kind: "minimum", value: 15 }, windowDays: 2 },
        { unit: "min" },
      ),
      evidence,
      "2026-03-03",
    );
    expect(out.currentValue).toBe(15);
    expect(out.days.at(-1)?.state).toBe("qualifies");
  });

  test("yes/no: a day is done when any entry says yes, and a no-only day breaks the streak", () => {
    const tracker: TrackerGoalShape = { type: "yes_no", unit: null, aggregation: "any" };
    const evidence = evidenceFor(tracker, [
      entry("2026-03-02", 0, "07:00:00"),
      entry("2026-03-02", 1, "21:00:00"),
      entry("2026-03-03", 1),
      entry("2026-03-04", 0),
      entry("2026-03-05", 1),
    ]);
    expect(evidence.map((item) => [item.dateOnly, item.completed, item.value])).toEqual([
      ["2026-03-02", true, undefined],
      ["2026-03-03", true, undefined],
      ["2026-03-04", false, undefined],
      ["2026-03-05", true, undefined],
    ]);
    const streak = evaluateGoal(
      goal({ kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 3 }),
      evidence,
      "2026-03-05",
    );
    expect(streak.days.map((day) => day.state)).toEqual([
      "qualifies",
      "qualifies",
      "does-not-qualify",
      "qualifies",
    ]);
    expect(streak.bestStreak).toBe(2);
    expect(streak.currentStreak).toBe(1);
    expect(streak.achieved).toBe(false);

    const weekly = evaluateGoal(
      goal({ kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 3 }),
      evidence,
      "2026-03-08",
    );
    expect(weekly.recurringWeeks[0]).toMatchObject({ qualifyingDays: 3, met: true });
  });

  test("scale: any logged day counts, whatever the rating, and no value is exposed", () => {
    const tracker: TrackerGoalShape = { type: "scale", unit: null, aggregation: "average" };
    const evidence = evidenceFor(tracker, [
      entry("2026-03-02", 1),
      entry("2026-03-03", 5),
      entry("2026-03-03", 2),
      entry("2026-03-04", 3),
    ]);
    expect(evidence.every((item) => item.completed === true && item.value === undefined)).toBe(
      true,
    );
    const out = evaluateGoal(
      goal({ kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 3 }),
      evidence,
      "2026-03-04",
    );
    expect(out.achieved).toBe(true);
    expect(out.achievedDate).toBe("2026-03-04");
    expect(out.days.every((day) => day.value === null)).toBe(true);
    expect(out.currentValue).toBeNull();
  });

  test("a missing day stays unknown rather than zero", () => {
    const evidence = evidenceFor({ type: "number", unit: "x", aggregation: "sum" }, [
      entry("2026-03-02", 3),
    ]);
    const out = evaluateGoal(
      goal(
        { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 1 } },
        { unit: "x" },
      ),
      evidence,
      "2026-03-03",
    );
    expect(out.days.at(-1)).toMatchObject({ state: "unknown", unknownReason: "no-evidence" });
  });
});

describe("which rules a tracker type allows", () => {
  test("number and duration get every rule; yes/no recurring and streak; scale streak only", () => {
    expect(trackerGoalRuleKinds("number")).toEqual(["target", "recurring", "average", "streak"]);
    expect(trackerGoalRuleKinds("duration")).toEqual(["target", "recurring", "average", "streak"]);
    expect(trackerGoalRuleKinds("yes_no")).toEqual(["recurring", "streak"]);
    expect(trackerGoalRuleKinds("scale")).toEqual(["streak"]);
  });

  test("units follow the tracker", () => {
    expect(trackerGoalUnit({ type: "number", unit: "pages" })).toBe("pages");
    expect(trackerGoalUnit({ type: "duration", unit: null })).toBe("min");
    expect(trackerGoalUnit({ type: "yes_no", unit: null })).toBeNull();
    expect(trackerGoalUnit({ type: "scale", unit: null })).toBeNull();
  });

  test("scale goals refuse value targets such as an average mood", () => {
    const scale = { type: "scale" as const, unit: null };
    expect(
      trackerGoalProblem(
        goal({ kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 7 }),
        scale,
      ),
    ).toBeNull();
    expect(
      trackerGoalProblem(
        goal({ kind: "average", target: { kind: "minimum", value: 4 }, windowDays: 7 }),
        scale,
      ),
    ).not.toBeNull();
    expect(
      trackerGoalProblem(goal({ kind: "target", target: { kind: "minimum", value: 4 } }), scale),
    ).not.toBeNull();
    expect(trackerGoalProblem(goal({ kind: "recurring", cadence: "daily" }), scale)).not.toBeNull();
    expect(
      trackerGoalProblem(
        goal({ kind: "streak", target: { kind: "minimum", value: 4 }, targetDays: 7 }),
        scale,
      ),
    ).not.toBeNull();
    expect(
      trackerGoalProblem(
        goal(
          { kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 7 },
          { milestones: [{ id: "m", value: 4, targetDate: "2026-04-01" }] },
        ),
        scale,
      ),
    ).not.toBeNull();
  });

  test("yes/no goals count yes days, not amounts", () => {
    const yesNo = { type: "yes_no" as const, unit: null };
    expect(trackerGoalProblem(goal({ kind: "recurring", cadence: "daily" }), yesNo)).toBeNull();
    expect(
      trackerGoalProblem(
        goal({ kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 1 } }),
        yesNo,
      ),
    ).not.toBeNull();
    expect(
      trackerGoalProblem(goal({ kind: "target", target: { kind: "minimum", value: 1 } }), yesNo),
    ).not.toBeNull();
  });

  test("number goals must use the tracker's unit, and edits are checked across versions", () => {
    const number = { type: "number" as const, unit: "pages" };
    const rule = { kind: "average" as const, target: { kind: "minimum" as const, value: 20 } };
    expect(trackerGoalProblem(goal(rule, { unit: "pages" }), number)).toBeNull();
    expect(trackerGoalProblem(goal(rule, { unit: "kg" }), number)).not.toBeNull();
    expect(
      trackerGoalProblem(
        goal(
          { kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 3 },
          {
            versions: [
              {
                id: "2",
                effectiveDate: "2026-03-05",
                rule: { kind: "average", target: { kind: "minimum", value: 4 } },
              },
            ],
          },
        ),
        { type: "scale", unit: null },
      ),
    ).not.toBeNull();
  });
});
