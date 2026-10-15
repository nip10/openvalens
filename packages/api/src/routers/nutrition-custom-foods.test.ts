import { describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";

import type { Context } from "../context";

class AuthzHttpError extends Error {
  readonly status = 403;
  readonly code = "PERMISSION_DENIED";
}
mock.module("@openvalens/auth/authz/guard", () => ({
  AuthzHttpError,
  requirePermission: mock(async () => ({
    user: { id: "user-1" },
    activeOrganizationId: "org-1",
    member: { role: "owner" },
    role: "owner",
  })),
  requireOrgMembership: mock(),
  requireSession: mock(),
}));

const { appRouter } = await import("./index");
const { toWireCustomFood } = await import("./nutrition-custom-foods");

function context(db: Database): Context {
  return {
    session: { user: { id: "user-1" } },
    db,
    correlationId: "corr-1",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

const food = {
  name: "Synthetic oats",
  nutrientBasisAmount: 100,
  nutrientBasisUnit: "g" as const,
};

describe("nutritionCustomFoods router", () => {
  test("owner fields in any input are rejected before touching the database", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_target, key) => touched.push(String(key)) }) as Database;
    const calls = [
      () =>
        appRouter.nutritionCustomFoods.list.callable({ context: context(db) })({
          userId: "user-2",
        } as never),
      () =>
        appRouter.nutritionCustomFoods.get.callable({ context: context(db) })({
          foodId: 1,
          userId: "user-2",
        } as never),
      () =>
        appRouter.nutritionCustomFoods.update.callable({ context: context(db) })({
          foodId: 1,
          expectedRevision: 1,
          food: { ...food, userId: "user-2" },
        } as never),
    ];
    for (const call of calls) {
      const result = await call().catch((error: unknown) => error);
      expect(result).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(touched).toEqual([]);
  });

  test("wire foods expose provenance and keep unknown apart from zero", () => {
    const now = new Date("2026-10-12T08:00:00.000Z");
    const wire = toWireCustomFood({
      id: 3,
      organizationId: "org-1",
      userId: "user-1",
      name: "Synthetic oats",
      brand: null,
      barcode: null,
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      servingSizeAmount: null,
      servingSizeUnit: null,
      servingLabel: null,
      energyKcal: 380,
      energyKj: null,
      proteinG: 0,
      carbohydrateG: null,
      fatG: null,
      saturatedFatG: null,
      fiberG: null,
      totalSugarsG: null,
      addedSugarsG: null,
      freeSugarsG: null,
      sodiumMg: null,
      saltG: null,
      revision: 1,
      archivedAt: null,
      clientMutationId: "c-1",
      createdAt: now,
      updatedAt: now,
    });
    expect(wire).toMatchObject({
      sourceQualifiedId: "custom:3",
      provenance: "user_entered",
      archived: false,
    });
    expect(wire.nutrientsPerBasis.proteinG).toBe(0);
    expect(wire.nutrientsPerBasis.fiberG).toBeNull();
    // Owner and replay ids never go back over the wire.
    expect(Object.keys(wire)).not.toContain("userId");
    expect(Object.keys(wire)).not.toContain("organizationId");
    expect(Object.keys(wire)).not.toContain("clientMutationId");
  });
});
