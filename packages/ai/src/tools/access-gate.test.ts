import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";

import { resolveToolAccess, type AiHealthToolContext } from "./access";
import { resolveNutritionToolAccess } from "./nutrition-context";
import { createCapturingLogger } from "./test-fixtures";

/**
 * Issue #439 — a connected AI app's grant replaces the Coach consent gates.
 * The database is a trap: with an access gate, no consent table is read.
 */
const trapDb = new Proxy(
  {},
  {
    get() {
      throw new Error("the Coach consent tables must not be read");
    },
  },
) as unknown as Database;

function context(overrides: Partial<AiHealthToolContext>): AiHealthToolContext {
  return {
    db: trapDb,
    organizationId: "org-gate",
    userId: "user-gate",
    canReadRecords: async () => true,
    sources: {} as AiHealthToolContext["sources"],
    logger: createCapturingLogger().logger,
    ...overrides,
  };
}

describe("accessGate", () => {
  test("an allowing gate skips Coach consent", async () => {
    const gate = async () => ({ allowed: true as const, includeNutritionNumbers: true });
    expect((await resolveToolAccess(context({ accessGate: gate }), "labs")).allowed).toBe(true);
    const nutrition = await resolveNutritionToolAccess(context({ accessGate: gate }), "n");
    expect(nutrition).toMatchObject({ allowed: true, includeNumbers: true });
  });

  test("a refusing or failing gate fails closed", async () => {
    const refuse = async () => ({ allowed: false as const, reason: "consent_required" as const });
    expect(await resolveToolAccess(context({ accessGate: refuse }), "labs")).toMatchObject({
      allowed: false,
      reason: "consent_required",
    });
    const fail = async (): Promise<never> => {
      throw new Error("boom");
    };
    expect(await resolveNutritionToolAccess(context({ accessGate: fail }), "n")).toMatchObject({
      allowed: false,
    });
  });

  test("permission is still checked first", async () => {
    const gate = async () => ({ allowed: true as const, includeNutritionNumbers: true });
    expect(
      await resolveToolAccess(
        context({ accessGate: gate, canReadRecords: async () => false }),
        "labs",
      ),
    ).toMatchObject({ allowed: false, reason: "permission_denied" });
  });
});
