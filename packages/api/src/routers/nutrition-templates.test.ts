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
function context(db: Database): Context {
  return {
    session: { user: { id: "user-1" } },
    db,
    correlationId: "template-test",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

describe("nutritionTemplates router input boundary", () => {
  test("mounts the list procedure and rejects tenant overrides before database access", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_target, key) => touched.push(String(key)) }) as Database;
    const result = await appRouter.nutritionTemplates.list
      .callable({ context: context(db) })({ unexpected: "input" } as never)
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(touched).toEqual([]);
  });

  test("create rejects strict tenant fields before database access", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_target, key) => touched.push(String(key)) }) as Database;
    const result = await appRouter.nutritionTemplates.create
      .callable({ context: context(db) })({
        clientMutationId: "mutation-1",
        unexpected: true,
        content: {
          kind: "meal",
          name: "Meal",
          ingredients: [
            {
              food: {
                kind: "manual",
                food: { name: "Food", nutrientBasisAmount: 1, nutrientBasisUnit: "serving" },
              },
              amount: 1,
              unit: "serving",
            },
          ],
        },
      } as never)
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(touched).toEqual([]);
  });
});
