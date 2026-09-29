import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";

import type { Context } from "../context";
import { appRouter } from "./index";

function createTestContext(): Context {
  return {
    session: null,
    db: {} as Database,
    correlationId: "test-correlation-id",
    cronSecret: "test-cron-secret",
    honoContext: { req: { raw: { headers: new Headers() } } },
  };
}

describe("health.readiness", () => {
  test("returns the stub readiness report", async () => {
    const readiness = appRouter.health.readiness.callable({ context: createTestContext() });

    const result = await readiness({});

    expect(result.status).toBe("ok");
    expect(result.checks).toEqual({
      database: "stub-ok",
      secrets: "stub-ok",
      capabilities: {},
    });
    expect(typeof result.timestamp).toBe("string");
  });
});
