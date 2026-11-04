import { describe, expect, test } from "bun:test";
import { goalDateAt, goalDefinitionAt } from "./goal-calendar";
import type { GoalDefinition } from "./goal-model";

const definition: GoalDefinition = {
  id: "g",
  title: "Goal",
  source: "water",
  metric: "ml",
  rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 2 },
  startDate: "2026-01-01",
  timeZone: "UTC",
  dayCutoff: "00:00",
  status: "active",
  versions: [
    {
      id: "weekly-revision",
      effectiveDate: "2026-03-02",
      effectiveAt: "2026-03-02T00:00:00Z",
      rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 4 },
      timeZone: "Asia/Kathmandu",
      dayCutoff: "04:30",
    },
  ],
};

describe("goal effective calendar", () => {
  test("resolves effective rule and calendar at exact instant boundaries", () => {
    const before = goalDefinitionAt(definition, new Date("2026-03-01T23:59:59.999Z"));
    const after = goalDefinitionAt(definition, new Date("2026-03-02T00:00:00Z"));
    expect(before.rule).toMatchObject({ daysPerWeek: 2 });
    expect(after.rule).toMatchObject({ daysPerWeek: 4 });
    expect(after.timeZone).toBe("Asia/Kathmandu");
  });

  test("uses local cutoff across DST and non-hour timezone offsets", () => {
    const ny: GoalDefinition = {
      ...definition,
      timeZone: "America/New_York",
      dayCutoff: "04:00",
      versions: [],
    };
    // 07:30Z is 03:30 EDT, before the 04:00 local cutoff, so it belongs
    // to the previous goal day even though the wall-clock date is March 8.
    expect(goalDateAt(ny, new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-07");
    const kathmandu: GoalDefinition = { ...definition, timeZone: "Asia/Kathmandu", versions: [] };
    expect(goalDateAt(kathmandu, new Date("2026-01-01T18:45:00Z"))).toBe("2026-01-02");
    expect(goalDateAt({ ...ny, source: "sleep" }, new Date("2026-03-08T07:30:00Z"))).toBe(
      "2026-03-08",
    );
  });
});
