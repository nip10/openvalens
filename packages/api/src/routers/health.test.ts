import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";

import type { CapabilityFlags, Context } from "../context";
import { readinessOutput } from "./health";
import { appRouter } from "./index";

const ALL_CAPABILITIES: CapabilityFlags = {
  telegram: true,
  anthropic: true,
  resend: true,
  mobilePairing: true,
};

function createTestContext(overrides: Partial<Context> = {}): Context {
  return {
    session: null,
    db: { execute: async () => [] } as unknown as Database,
    correlationId: "test-correlation-id",
    cronSecret: "test-cron-secret-long-enough",
    betterAuthSecretConfigured: true,
    capabilities: ALL_CAPABILITIES,
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  };
}

function unreachableDb(): Database {
  return {
    execute: async () => {
      throw new Error("ECONNREFUSED");
    },
  } as unknown as Database;
}

function callReadiness(context: Context) {
  return appRouter.health.readiness.callable({ context })({});
}

describe("health.readiness", () => {
  test("returns ok when the database is reachable and all secrets are present", async () => {
    const result = await callReadiness(createTestContext());

    expect(result.status).toBe("ok");
    expect(result.checks.database).toBe("ok");
    expect(result.checks.secrets).toEqual({
      betterAuthSecret: "ok",
      cronSecret: "ok",
    });
    expect(result.checks.capabilities).toEqual(ALL_CAPABILITIES);
    expect(typeof result.timestamp).toBe("string");
  });

  test("returns degraded when a secret is missing but the database is reachable", async () => {
    const result = await callReadiness(createTestContext({ betterAuthSecretConfigured: false }));

    expect(result.status).toBe("degraded");
    expect(result.checks.database).toBe("ok");
    expect(result.checks.secrets).toEqual({
      betterAuthSecret: "missing",
      cronSecret: "ok",
    });
  });

  test("returns degraded when the cron secret is too short", async () => {
    const result = await callReadiness(createTestContext({ cronSecret: "short" }));

    expect(result.status).toBe("degraded");
    expect(result.checks.secrets).toEqual({
      betterAuthSecret: "ok",
      cronSecret: "missing",
    });
  });

  test("returns unready when the database is unreachable", async () => {
    const result = await callReadiness(createTestContext({ db: unreachableDb() }));

    expect(result.status).toBe("unready");
    expect(result.checks.database).toBe("unreachable");
    // Secret state is still reported so monitoring can see the full picture.
    expect(result.checks.secrets).toEqual({
      betterAuthSecret: "ok",
      cronSecret: "ok",
    });
  });

  test("the output validates against the published schema", async () => {
    const result = await callReadiness(createTestContext());

    expect(() => readinessOutput.parse(result)).not.toThrow();
  });

  test("capabilities reflect the env-derived flags from context", async () => {
    const result = await callReadiness(
      createTestContext({
        capabilities: {
          telegram: false,
          anthropic: false,
          resend: true,
          mobilePairing: true,
        },
      }),
    );

    expect(result.checks.capabilities).toEqual({
      telegram: false,
      anthropic: false,
      resend: true,
      mobilePairing: true,
    });
  });
});
