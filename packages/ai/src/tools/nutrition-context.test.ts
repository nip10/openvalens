import { describe, expect, test } from "bun:test";
import type { DailyTotals } from "@openvalens/nutrition";
import { normalizeNutrients, summarizeEntries, type NutrientValues } from "@openvalens/nutrition";

import {
  createNutritionContextTool,
  executeNutritionContext,
  nutritionContextInput,
  nutritionContextOutput,
} from "./nutrition-context";
import {
  FIXED_NOW,
  ORG_A,
  ORG_B,
  USER_A,
  createCapturingLogger,
  createFakeSources,
  toolContext,
} from "./test-fixtures";

// Synthetic data only; no real people or foods.

const FULL = { granted: true, includeNumbers: true } as const;
const NUMBERS_OFF = { granted: true, includeNumbers: false } as const;
const SENTINEL_KCAL = 2000;

function totalsDay(
  localDate: string,
  status: "complete" | "unmarked",
  entries: Array<Partial<NutrientValues>>,
): DailyTotals {
  return {
    localDate,
    status,
    ...summarizeEntries(
      entries.map((nutrients) => ({ nutrients: normalizeNutrients(nutrients), source: "manual" })),
    ),
  };
}

const LOGGED_WEEK: DailyTotals[] = [
  totalsDay("2026-03-04", "complete", [
    { energyKcal: SENTINEL_KCAL, proteinG: 100, carbohydrateG: 200, fatG: 70, fiberG: 30 },
  ]),
  totalsDay("2026-03-05", "complete", [
    { energyKcal: SENTINEL_KCAL, proteinG: 100, carbohydrateG: 200, fatG: 70, fiberG: 30 },
  ]),
];

describe("nutritionContext input", () => {
  test("accepts 1-30 days and rejects anything else", () => {
    expect(nutritionContextInput.safeParse({}).success).toBe(true);
    expect(nutritionContextInput.safeParse({ windowDays: 1 }).success).toBe(true);
    expect(nutritionContextInput.safeParse({ windowDays: 30 }).success).toBe(true);
    expect(nutritionContextInput.safeParse({ windowDays: 0 }).success).toBe(false);
    expect(nutritionContextInput.safeParse({ windowDays: 31 }).success).toBe(false);
    expect(nutritionContextInput.safeParse({ windowDays: 7, extra: 1 }).success).toBe(false);
  });
});

describe("executeNutritionContext consent gating", () => {
  test("no consent row means no context and no read", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const result = await executeNutritionContext(
      toolContext({ sources, nutritionConsent: null }),
      {},
    );

    expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
    // The member's diary was never read.
    expect(calls).toHaveLength(0);
    expect(() => nutritionContextOutput.parse(result)).not.toThrow();
  });

  test("a revoked consent stops usage on the next call", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const result = await executeNutritionContext(
      toolContext({ sources, nutritionConsent: { granted: false, includeNumbers: true } }),
      {},
    );

    expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
    expect(calls).toHaveLength(0);
  });

  test("a grant at an older disclosure version fails closed", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const result = await executeNutritionContext(
      toolContext({
        sources,
        nutritionConsent: { granted: true, includeNumbers: true, consentVersion: "v0" },
      }),
      {},
    );
    expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
  });

  test("a missing records permission blocks the tool even with consent", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const result = await executeNutritionContext(
      toolContext({ sources, nutritionConsent: FULL, canReadRecords: async () => false }),
      {},
    );
    expect(result).toMatchObject({ status: "unavailable", reason: "permission_denied" });
    expect(calls).toHaveLength(0);
  });

  test("the org AI consent still gates the nutrition tool", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const result = await executeNutritionContext(
      toolContext({
        sources,
        nutritionConsent: FULL,
        consent: { orgMetadata: { aiConsent: false }, userGranted: true },
      }),
      {},
    );
    expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
  });
});

describe("executeNutritionContext output", () => {
  test("honours the hide-numbers choice", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const result = await executeNutritionContext(
      toolContext({ sources, nutritionConsent: NUMBERS_OFF }),
      {},
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.context.numbersHidden).toBe(true);
    expect(result.context.averages).toBeNull();
    expect(JSON.stringify(result)).not.toContain(String(SENTINEL_KCAL));
    // The read is scoped to the bound member, never a client id.
    expect(calls).toEqual([{ port: "listNutritionDailyTotals", organizationId: ORG_A }]);
  });

  test("shares numeric averages only when the member allowed them", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const result = await executeNutritionContext(toolContext({ sources, nutritionConsent: FULL }), {
      windowDays: 7,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.context.averages).toEqual({
      energyKcal: SENTINEL_KCAL,
      proteinG: 100,
      carbohydrateG: 200,
      fatG: 70,
      fiberG: 30,
    });
    expect(() => nutritionContextOutput.parse(result)).not.toThrow();
  });

  test("reports no_data without inventing values when nothing is logged", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { nutritionTotals: [] } });
    const result = await executeNutritionContext(
      toolContext({ sources, nutritionConsent: FULL }),
      {},
    );

    expect(result.status).toBe("no_data");
    if (result.status !== "no_data") throw new Error("expected no_data");
    expect(result.context.loggedDays).toBe(0);
    expect(result.context.averages).toBeNull();
    expect(() => nutritionContextOutput.parse(result)).not.toThrow();
  });

  test("never reads another tenant's nutrition", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: { nutritionTotals: LOGGED_WEEK },
      [ORG_B]: { nutritionTotals: LOGGED_WEEK },
    });
    await executeNutritionContext(toolContext({ sources, nutritionConsent: FULL }), {});
    expect(calls.every((call) => call.organizationId === ORG_A)).toBe(true);
  });
});

describe("nutritionContext logging", () => {
  test("logs statuses and counts only — never a measured value", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const { logger, records } = createCapturingLogger();
    await executeNutritionContext(toolContext({ sources, nutritionConsent: FULL, logger }), {});

    const serialized = JSON.stringify(records);
    expect(serialized).toContain("ai.tool.executed");
    expect(serialized).not.toContain(String(SENTINEL_KCAL));
    expect(serialized).not.toContain(USER_A);
  });
});

describe("createNutritionContextTool", () => {
  test("is an executable tool bound to the request context", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { nutritionTotals: LOGGED_WEEK } });
    const tool = createNutritionContextTool(
      toolContext({ sources, nutritionConsent: FULL, now: () => FIXED_NOW }),
    );
    expect(typeof tool.execute).toBe("function");
  });
});
