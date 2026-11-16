import { describe, expect, test } from "bun:test";
import { validateGoalDefinition } from "@openvalens/plans/goal-model";

import { freeTextGoalDefinition, freeTextGoalInput } from "./free-text-goal";

describe("free-text goal", () => {
  test("is a valid new-model goal the person checks in themselves", () => {
    const definition = freeTextGoalDefinition(
      "  Walk most days ",
      new Date("2026-11-16T23:30:00Z"),
      "America/Los_Angeles",
    );
    expect(validateGoalDefinition(definition).ok).toBe(true);
    expect(definition).toMatchObject({
      title: "Walk most days",
      source: "manual",
      unit: null,
      rule: { kind: "recurring", cadence: "daily" },
      startDate: "2026-11-16",
      timeZone: "America/Los_Angeles",
      status: "active",
    });
  });

  test("the start date is the local day in the goal's time zone", () => {
    expect(
      freeTextGoalDefinition("Sleep more", new Date("2026-11-16T23:30:00Z"), "Europe/Lisbon")
        .startDate,
    ).toBe("2026-11-16");
    expect(
      freeTextGoalDefinition("Sleep more", new Date("2026-11-17T01:30:00Z"), "Asia/Tokyo")
        .startDate,
    ).toBe("2026-11-17");
  });

  test("each create carries its own ids", () => {
    const a = freeTextGoalInput("Walk most days");
    const b = freeTextGoalInput("Walk most days");
    expect(a.clientMutationId).not.toBe(b.clientMutationId);
    expect(a.definition.id).not.toBe(b.definition.id);
  });
});
