import { describe, expect, test } from "bun:test";

import type { GoalDayEvaluation } from "./goal-evaluation";
import type { GoalRule, GoalSource } from "./goal-model";
import { projectGoalTarget } from "./goal-projection";

const AS_OF = "2026-11-16";

function daysAgo(offset: number): string {
  const value = new Date(`${AS_OF}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

/** One day per offset with `value(offset)`; null leaves the day unrecorded. */
function days(from: number, to: number, value: (offset: number) => number | null) {
  const out: GoalDayEvaluation[] = [];
  for (let offset = to; offset >= from; offset -= 1)
    out.push({
      date: daysAgo(offset),
      state: "does-not-qualify",
      value: value(offset),
      coverage: "complete",
    });
  return out;
}

const reach65: GoalRule = { kind: "target", target: { kind: "maximum", value: 65 } };
const evaluation = (list: GoalDayEvaluation[]) => ({
  asOf: AS_OF,
  days: list,
  currentValue: [...list].reverse().find((day) => day.value !== null)?.value ?? null,
  achieved: false,
});
const goalOf = (rule: GoalRule, source: GoalSource = "manual", unit: string | null = "kg") => ({
  rule,
  source,
  unit,
});

describe("projectGoalTarget (goals#4)", () => {
  test("a steady fall reaches the target on the projected day", () => {
    // 0.1 kg a day down from 68.4 kg 27 days ago: 65.7 kg today, 7 days to go.
    const result = projectGoalTarget(
      goalOf(reach65),
      evaluation(days(0, 27, (d) => 65.7 + d * 0.1)),
    );
    expect(result).toEqual({ date: "2026-11-23", perWeek: -0.7, points: 28 });
  });

  test("an increase target works the same way", () => {
    const rule: GoalRule = { kind: "target", target: { kind: "minimum", value: 100 } };
    const result = projectGoalTarget(goalOf(rule), evaluation(days(0, 20, (d) => 90 - d * 0.5)));
    expect(result?.date).toBe("2026-12-06");
  });

  test("hidden when the trend runs the wrong way or is flat", () => {
    expect(
      projectGoalTarget(goalOf(reach65), evaluation(days(0, 27, (d) => 66 - d * 0.05))),
    ).toBeNull();
    expect(projectGoalTarget(goalOf(reach65), evaluation(days(0, 27, () => 67)))).toBeNull();
  });

  test("hidden without enough recorded days, or when they span under a week", () => {
    const sparse = days(0, 27, (d) => (d % 10 === 0 ? 66 + d * 0.1 : null));
    expect(sparse.filter((day) => day.value !== null)).toHaveLength(3);
    expect(projectGoalTarget(goalOf(reach65), evaluation(sparse))).toBeNull();
    expect(
      projectGoalTarget(goalOf(reach65), evaluation(days(0, 5, (d) => 66 + d * 0.2))),
    ).toBeNull();
  });

  test("only the last four weeks count", () => {
    // Older days climbed; the recent four weeks fall.
    const list = [...days(28, 60, (d) => 70 - d * 0.05), ...days(0, 27, (d) => 66 + d * 0.05)];
    expect(projectGoalTarget(goalOf(reach65), evaluation(list))?.points).toBe(28);
  });

  test("hidden once the target is met, beyond a year, or for other rules", () => {
    expect(
      projectGoalTarget(goalOf(reach65), evaluation(days(0, 27, (d) => 64.5 + d * 0.1))),
    ).toBeNull();
    // 0.001 kg a day from 70 kg: about 13 years.
    expect(
      projectGoalTarget(goalOf(reach65), evaluation(days(0, 27, (d) => 70 + d * 0.001))),
    ).toBeNull();
    const average: GoalRule = { kind: "average", target: { kind: "minimum", value: 7 } };
    expect(
      projectGoalTarget(goalOf(average), evaluation(days(0, 27, (d) => 6 - d * 0.01))),
    ).toBeNull();
  });

  test("a typed-in lab or vital value is never projected", () => {
    const below = (unit: string) =>
      projectGoalTarget(
        goalOf({ kind: "target", target: { kind: "maximum", value: 5.6 } }, "manual", unit),
        evaluation(days(0, 27, (d) => 5.9 + d * 0.01)),
      );
    expect(below("%")).toBeNull();
    expect(below("mmol/mol")).toBeNull();
    expect(below("mg/dL")).toBeNull();
    expect(below("mmHg")).toBeNull();
    // A tracked source keeps its estimate.
    expect(
      projectGoalTarget(
        goalOf(reach65, "workout", "kg"),
        evaluation(days(0, 27, (d) => 65.7 + d * 0.1)),
      ),
    ).not.toBeNull();
  });

  test("a range is reached at its nearer edge", () => {
    const rule: GoalRule = { kind: "target", target: { kind: "range", minimum: 60, maximum: 65 } };
    expect(
      projectGoalTarget(goalOf(rule), evaluation(days(0, 27, (d) => 65.7 + d * 0.1)))?.date,
    ).toBe("2026-11-23");
  });
});
