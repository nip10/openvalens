import { describe, expect, test } from "bun:test";
import { isProcedure } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

import { PROCEDURE_ACCESS } from "./access-policy";
import type { Context } from "./context";
import { allowedInDemo } from "./demo-policy";
import { appRouter } from "./routers/index";

function paths(node: unknown, prefix: string[] = []): string[][] {
  if (isProcedure(node)) return [prefix];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => paths(value, [...prefix, key]));
}

describe("public demo access through the real router", () => {
  const handler = new RPCHandler(appRouter);
  const touched: string[] = [];
  const context = {
    isDemo: true,
    session: { user: { id: "demo" }, session: { activeOrganizationId: "demo-org" } },
    db: new Proxy(
      {},
      {
        get: (_, key) => {
          touched.push(String(key));
          throw new Error("Handler reached database");
        },
      },
    ),
  } as unknown as Context;

  test("all writes, AI, exports and account changes fail before input validation or database access", async () => {
    const refused = paths(appRouter).filter((path) => !allowedInDemo(path));
    expect(refused.length).toBeGreaterThan(150);
    for (const path of refused) {
      const result = await handler.handle(
        new Request(`http://test/rpc/${path.join("/")}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: {} }),
        }),
        { prefix: "/rpc", context },
      );
      expect(result.matched).toBe(true);
      if (!result.matched) throw new Error("Missing procedure");
      expect({ path: path.join("."), status: result.response.status }).toEqual({
        path: path.join("."),
        status: 403,
      });
      expect(await result.response.json()).toMatchObject({ json: { code: "DEMO_READ_ONLY" } });
    }
    expect(touched).toEqual([]);
  });

  test("reads stay open and new routes default to refused", () => {
    for (const [path, cls] of Object.entries(PROCEDURE_ACCESS))
      if (cls === "read") expect(allowedInDemo(path.split("."))).toBe(true);
    for (const path of [
      "new.mutation",
      "dataRights.deleteEverything",
      "exports.clinicalBundle",
      "billing.checkout",
      "aiApps.oauth.approve",
      "analytics.capture",
      "preferences.setLocale",
      "healthConsent.accept",
      "insights.pushDevices.register",
    ])
      expect(allowedInDemo(path.split("."))).toBe(false);
  });

  test("access state identifies a demo and pauses sync without billing", async () => {
    const result = await handler.handle(
      new Request("http://test/rpc/access/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      }),
      { prefix: "/rpc", context },
    );
    if (!result.matched) throw new Error("Missing procedure");
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toMatchObject({
      json: { demo: true, level: "read_only" },
    });
  });
});
