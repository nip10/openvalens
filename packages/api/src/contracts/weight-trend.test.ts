import { describe, expect, test } from "bun:test";
import { buildWeightTrend } from "@openvalens/body";

import { weightTrendInput, weightTrendOutput } from "./weight-trend";

describe("weightTrend contract", () => {
  test("the domain result satisfies the wire contract, sparse or not", () => {
    const rows = [
      { date: "2026-03-01", weightKg: 80, source: "auto" },
      { date: "2026-03-02", weightKg: 80.2, source: "override" },
      { date: "2026-03-04", weightKg: 80.4, source: "auto" },
    ];
    for (const range of [
      { from: "2026-03-01", to: "2026-03-05" },
      { from: "2026-04-01", to: "2026-04-02" },
    ])
      expect(weightTrendOutput.parse(buildWeightTrend(rows, range))).toBeDefined();
  });

  test("the input never accepts a tenant or member", () => {
    const range = { from: "2026-03-01", to: "2026-03-05" };
    expect(weightTrendInput.safeParse(range).success).toBe(true);
    expect(weightTrendInput.safeParse({ ...range, organizationId: "org-b" }).success).toBe(false);
    expect(weightTrendInput.safeParse({ ...range, userId: "user-b" }).success).toBe(false);
  });
});
