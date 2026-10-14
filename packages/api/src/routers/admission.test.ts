import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import { AdmissionError, type AdmissionService } from "@openvalens/auth/admission";
import type { Database } from "@openvalens/db";

import type { Context } from "../context";
import { appRouter } from "./index";

const ORIGIN = "https://app.test";

type Row = { role: string | null; banned: boolean | null };

function fakeDb(source: Row[] | (() => Row[]) | Error): { db: Database; queries: unknown[] } {
  const queries: unknown[] = [];
  const db = {
    execute: async (query: unknown) => {
      queries.push(query);
      if (source instanceof Error) throw source;
      return { rows: typeof source === "function" ? source() : source };
    },
  } as unknown as Database;
  return { db, queries };
}

const ACTOR_SESSION = {
  user: { id: "actor-1", email: "actor@example.com", name: null },
  session: { id: "s-1", userId: "actor-1", activeOrganizationId: null, expiresAt: null },
};

function service(overrides: Partial<AdmissionService> = {}): AdmissionService {
  return {
    status: async () => ({ setupAvailable: true }),
    begin: async () => ({ enrollmentId: "enr-1" }),
    complete: async () => ({ completed: true }),
    issueInvitation: async () => ({ invitationId: "inv-1", expiresAt: new Date("2026-10-20") }),
    revokeInvitation: async () => ({ revoked: true }),
    listInvitations: async () => [],
    ...overrides,
  } as unknown as AdmissionService;
}

function context(overrides: Record<string, unknown> = {}, origin?: string): Context {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return {
    session: ACTOR_SESSION,
    db: {} as Database,
    correlationId: "corr-1",
    cronSecret: "test-cron-secret-long-enough",
    betterAuthSecretConfigured: true,
    capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
    telegram: { webhookSecret: "test-webhook-secret-1234", connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      AI_PROVIDER: null,
      AI_API_KEY: null,
      AI_BASE_URL: null,
      AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
      AI_MODEL: "claude-sonnet-5-5",
      AI_RATE_LIMIT_PER_MINUTE: 20,
    },
    aiRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
    admissionOrigin: ORIGIN,
    admissionRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
    admissionService: service(),
    honoContext: { req: { raw: { headers } } },
    ...overrides,
  } as unknown as Context;
}

describe("admission.status", () => {
  test("is public and needs no origin", async () => {
    expect(await appRouter.admission.status.callable({ context: context() })({})).toEqual({
      setupAvailable: true,
    });
  });

  test("fails closed when the service is missing", async () => {
    await expect(
      appRouter.admission.status.callable({ context: context({ admissionService: undefined }) })(
        {},
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("admission.begin origin gate", () => {
  const validBody = { kind: "setup" as const, credential: "cred", email: "user@example.com" };

  test("a foreign origin is rejected BEFORE input validation or the service", async () => {
    let touched = false;
    const contextWithTrap = context(
      {
        admissionService: service({
          begin: async () => {
            touched = true;
            return { enrollmentId: "x" };
          },
        }),
      },
      "https://evil.test",
    );
    // Body is invalid too; the origin gate must win.
    await expect(
      appRouter.admission.begin.callable({ context: contextWithTrap })({ kind: "bogus" } as never),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(touched).toBe(false);
  });

  test("a missing origin is rejected", async () => {
    await expect(
      appRouter.admission.begin.callable({ context: context({}, undefined) })(validBody),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  test("a valid origin with invalid input is INVALID_INPUT with no echoed values", async () => {
    let caught: unknown;
    try {
      await appRouter.admission.begin.callable({ context: context({}, ORIGIN) })({
        kind: "bogus",
        credential: "leaky-secret",
        email: "x",
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "INVALID_INPUT" });
    expect(String(JSON.stringify(caught))).not.toContain("leaky-secret");
  });

  test("a valid origin and body calls the service", async () => {
    expect(
      await appRouter.admission.begin.callable({ context: context({}, ORIGIN) })(validBody),
    ).toEqual({ enrollmentId: "enr-1" });
  });

  test("a denied rate limit maps to RATE_LIMITED", async () => {
    const limiter = new InMemoryRateLimiter({ limitPerMinute: 1 });
    limiter.check("admission:begin");
    await expect(
      appRouter.admission.begin.callable({
        context: context({ admissionRateLimiter: limiter }, ORIGIN),
      })(validBody),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  test("an admission DENIED maps to PERMISSION_DENIED; delivery/unknown to INTERNAL", async () => {
    const denied = context(
      {
        admissionService: service({
          begin: async () => Promise.reject(new AdmissionError("DENIED")),
        }),
      },
      ORIGIN,
    );
    await expect(
      appRouter.admission.begin.callable({ context: denied })(validBody),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    const delivery = context(
      {
        admissionService: service({
          begin: async () => Promise.reject(new AdmissionError("DELIVERY_FAILED")),
        }),
      },
      ORIGIN,
    );
    await expect(
      appRouter.admission.begin.callable({ context: delivery })(validBody),
    ).rejects.toMatchObject({ code: "INTERNAL" });

    const raw = context(
      {
        admissionService: service({
          begin: async () => Promise.reject(new Error("raw dsn secret")),
        }),
      },
      ORIGIN,
    );
    let caught: unknown;
    try {
      await appRouter.admission.begin.callable({ context: raw })(validBody);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "INTERNAL" });
    expect(String(JSON.stringify(caught))).not.toContain("raw dsn secret");
  });
});

describe("admission admin mutations", () => {
  const validIssue = { email: "invitee@example.com" };

  test("anonymous callers are rejected with UNAUTHENTICATED", async () => {
    await expect(
      appRouter.admission.issueInvitation.callable({ context: context({ session: null }, ORIGIN) })(
        validIssue,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("a non-admin is rejected with PERMISSION_DENIED", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    await expect(
      appRouter.admission.issueInvitation.callable({ context: context({ db }, ORIGIN) })(
        validIssue,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  test("an admin with a foreign origin is still rejected", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    await expect(
      appRouter.admission.issueInvitation.callable({
        context: context({ db }, "https://evil.test"),
      })(validIssue),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  test("an admin with a valid origin issues an invitation", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const result = await appRouter.admission.issueInvitation.callable({
      context: context({ db }, ORIGIN),
    })(validIssue);
    expect(result.invitationId).toBe("inv-1");
  });

  test("listInvitations requires an admin but no origin", async () => {
    const anon = await appRouter.admission.listInvitations
      .callable({ context: context({ session: null }) })({})
      .catch((error: unknown) => error);
    expect(anon).toMatchObject({ code: "UNAUTHENTICATED" });

    const { db } = fakeDb([{ role: "admin", banned: false }]);
    expect(
      await appRouter.admission.listInvitations.callable({ context: context({ db }) })({}),
    ).toEqual({ invitations: [] });
  });
});
