import { describe, expect, test } from "bun:test";

import type { Context } from "../context";
import { appRouter } from "./index";

const VERSION = "health-consent-v1";
const CLOUD = {
  mode: "cloud" as const,
  legal: {
    terms: { url: "https://legal.test/terms", version: "t1" },
    privacy: { url: "https://legal.test/privacy", version: "p1" },
    healthDataConsent: { url: "https://legal.test/privacy", version: VERSION },
  },
};

function context(options: {
  version?: string;
  accepted?: { version: string; accepted_at: Date } | null;
  selfHosted?: boolean;
  userId?: string | null;
  impersonatedBy?: string | null;
  origin?: string;
  acceptOnFirstQuery?: boolean;
} = {}) {
  let stored = options.accepted ?? null;
  const writes: unknown[] = [];
  const db = {
    async execute(query: { queryChunks?: unknown[] }) {
      if (options.acceptOnFirstQuery && writes.length === 0) {
        writes.push(query);
        stored = { version: options.version ?? VERSION, accepted_at: new Date("2026-10-29T00:00:00Z") };
        return { rows: [] };
      }
      return { rows: stored ? [{ version: stored.version, accepted_at: stored.accepted_at }] : [] };
    },
  };
  const userId = options.userId === undefined ? "session-user" : options.userId;
  const value = {
    db,
    deployment: options.selfHosted ? { mode: "self-hosted" as const } : CLOUD,
    session: userId ? { user: { id: userId }, session: { impersonatedBy: options.impersonatedBy ?? null } } : null,
    admissionOrigin: "https://app.test",
    honoContext: { req: { raw: { headers: new Headers({ origin: options.origin ?? "https://app.test" }) } } },
  } as unknown as Context;
  return { value, writes };
}

describe("healthConsent RPC", () => {
  test("status requires the current version and reports the latest acceptance", async () => {
    const stale = context({ accepted: { version: "old", accepted_at: new Date("2026-01-01T00:00:00Z") } });
    expect(await appRouter.healthConsent.status.callable({ context: stale.value })({})).toEqual({
      required: true,
      currentVersion: VERSION,
      accepted: false,
      acceptedVersion: "old",
      acceptedAt: "2026-01-01T00:00:00.000Z",
      privacyUrl: "https://legal.test/privacy",
    });
  });

  test("self-host status is satisfied without a consent lookup", async () => {
    const local = context({ selfHosted: true });
    expect(await appRouter.healthConsent.status.callable({ context: local.value })({})).toEqual({
      required: false,
      currentVersion: null,
      accepted: true,
      acceptedVersion: null,
      acceptedAt: null,
      privacyUrl: null,
    });
  });

  test("a current consent row satisfies the current version", async () => {
    const current = context({ accepted: { version: VERSION, accepted_at: new Date("2026-10-29T00:00:00Z") } });
    expect(await appRouter.healthConsent.status.callable({ context: current.value })({}))
      .toMatchObject({ required: true, currentVersion: VERSION, accepted: true, acceptedVersion: VERSION });
  });

  test("accept writes only the trusted session subject and is idempotent", async () => {
    const state = context({ acceptOnFirstQuery: true });
    const result = await appRouter.healthConsent.accept.callable({ context: state.value })({
      acceptedHealthDataConsent: true,
      version: VERSION,
      userId: "attacker-controlled",
    } as never);
    expect(result).toMatchObject({ required: true, accepted: true, acceptedVersion: VERSION });
    expect(state.writes).toHaveLength(1);
    expect(JSON.stringify(state.writes)).not.toContain("attacker-controlled");
  });

  test("stale versions, missing affirmation, anonymous and impersonated sessions do not write", async () => {
    const stale = context();
    await expect(appRouter.healthConsent.accept.callable({ context: stale.value })({
      acceptedHealthDataConsent: true,
      version: "old",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(stale.writes).toHaveLength(0);

    const anonymous = context({ userId: null });
    await expect(appRouter.healthConsent.accept.callable({ context: anonymous.value })({
      acceptedHealthDataConsent: true,
      version: VERSION,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const impersonated = context({ impersonatedBy: "admin" });
    await expect(appRouter.healthConsent.accept.callable({ context: impersonated.value })({
      acceptedHealthDataConsent: true,
      version: VERSION,
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const falseConsent = context();
    await expect(appRouter.healthConsent.accept.callable({ context: falseConsent.value })({
      acceptedHealthDataConsent: false,
      version: VERSION,
    } as never)).rejects.toBeDefined();
    const foreignOrigin = context({ origin: "https://evil.test" });
    await expect(appRouter.healthConsent.accept.callable({ context: foreignOrigin.value })({
      acceptedHealthDataConsent: true,
      version: VERSION,
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(impersonated.writes).toHaveLength(0);
    expect(falseConsent.writes).toHaveLength(0);
    expect(foreignOrigin.writes).toHaveLength(0);
  });
});
