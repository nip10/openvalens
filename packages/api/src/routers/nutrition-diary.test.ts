import { describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { NutritionError } from "@openvalens/nutrition";

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
const { run, toDomainFood } = await import("./nutrition-diary");

function context(db: Database): Context {
  return {
    session: { user: { id: "user-1" } },
    db,
    correlationId: "corr-1",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

describe("nutritionDiary router", () => {
  test("strict inputs reject tenant overrides before touching the database", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_target, key) => touched.push(String(key)) }) as Database;
    const result = await appRouter.nutritionDiary.getDay
      .callable({ context: context(db) })({
        localDate: "2026-10-12",
        organizationId: "org-2",
      } as never)
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_INPUT" });
    expect(touched).toEqual([]);
  });

  test("manual quick-add becomes a one-off manual snapshot", () => {
    expect(
      toDomainFood({
        kind: "manual",
        food: { name: "Soup", nutrientBasisAmount: 1, nutrientBasisUnit: "serving" },
      }),
    ).toEqual({
      kind: "external",
      snapshot: {
        source: "manual",
        name: "Soup",
        nutrientBasisAmount: 1,
        nutrientBasisUnit: "serving",
      },
    });
    expect(toDomainFood({ kind: "catalog", id: "fdc:1" })).toEqual({
      kind: "catalog",
      id: "fdc:1",
    });
  });

  test("domain errors map to the stable envelope; messages carry no values", async () => {
    const unit = await run(() => {
      throw new NutritionError("UNIT_INCOMPATIBLE", "Logged unit cannot be converted");
    }).catch((error: unknown) => error);
    expect(unit).toMatchObject({ code: "INVALID_INPUT", data: { reason: "UNIT_INCOMPATIBLE" } });
    const missing = await run(() => {
      throw new NutritionError("NOT_FOUND", "Meal entry not found");
    }).catch((error: unknown) => error);
    expect(missing).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
