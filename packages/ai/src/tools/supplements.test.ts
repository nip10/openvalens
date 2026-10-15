import { describe, expect, test } from "bun:test";

import { buildSupplements, supplementsInput, supplementsOutput } from "./supplements";
import { FIXED_NOW, supplementEntry } from "./test-fixtures";

const STACK = [
  supplementEntry(1, "Vitamin D3", ["active", "stopped"]),
  supplementEntry(2, "Magnesium", ["paused"]),
  supplementEntry(3, "Creatine", ["stopped"]),
];

describe("supplements input", () => {
  test("defaults includeInactive to false", () => {
    expect(supplementsInput.parse({})).toEqual({ includeInactive: false });
    expect(supplementsInput.safeParse({ includeInactive: "yes" }).success).toBe(false);
  });
});

describe("buildSupplements", () => {
  test("lists active supplements with their schedules by default", () => {
    const result = buildSupplements(STACK, {}, FIXED_NOW);

    expect(() => supplementsOutput.parse(result)).not.toThrow();
    expect(result).toEqual({
      status: "ok",
      includeInactive: false,
      totalCount: 3,
      activeCount: 1,
      supplements: [
        {
          name: "Vitamin D3",
          dose: "1000 IU",
          form: "capsule",
          category: "vitamin",
          status: "active",
          latestChangeDate: "2026-02-01",
          schedules: [
            { timeOfDay: "morning", frequency: "daily", quantity: "1", status: "active" },
            { timeOfDay: "morning", frequency: "daily", quantity: "1", status: "stopped" },
          ],
        },
      ],
      generatedAt: FIXED_NOW.toISOString(),
    });
  });

  test("includes paused and stopped supplements on request, sorted by name", () => {
    const result = buildSupplements(STACK, { includeInactive: true }, FIXED_NOW);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.supplements.map((row) => [row.name, row.status])).toEqual([
      ["Creatine", "stopped"],
      ["Magnesium", "paused"],
      ["Vitamin D3", "active"],
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SYNTHETIC_CHANGE_REASON");
    expect(serialized).not.toContain("SYNTHETIC_SCHEDULE_NOTE");
  });

  test("an org without scheduled supplements gets no_data", () => {
    expect(buildSupplements([], {}, FIXED_NOW).status).toBe("no_data");
  });
});
