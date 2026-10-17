import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { createNutritionRepository } from "@openvalens/nutrition";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import { appRouter } from "./index";

/**
 * `nutritionCoach.*` over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL (Issue #86): explicit, revocable consent; the preview showing
 * exactly what the Coach would send; hide-numbers; and member/tenant
 * isolation. All data is synthetic.
 */

const url = process.env.NUTRITION_COACH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_coach_test"
  )
    throw new Error("Empty disposable loopback nutrition_coach_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/** Members: A and A2 share workspace org-a (A2 is a collaborator); B owns org-b. */
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-a2": { org: "org-a", role: "collaborator" },
  "user-b": { org: "org-b", role: "owner" },
};

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]!.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const role = MEMBERS[actorOf(headers)]!.role;
      const actions = Object.values(body.permissions).flat();
      return { success: role !== "viewer" || actions.every((action) => action === "read") };
    },
  },
} as unknown as Auth;

type ConsentState = {
  granted: boolean;
  includeNumbers: boolean;
  grantedAt: string;
  revokedAt: string | null;
  consentVersion: string;
};

type Preview = {
  sharedWithProvider: boolean;
  context: {
    windowDays: number;
    loggedDays: number;
    completeDays: number;
    coverage: string;
    numbersHidden: boolean;
    averages: Record<string, number | null> | null;
    notes: string[];
  };
};

describe.skipIf(!url)("nutritionCoach over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_coach_test" });
  const rpc = new RPCHandler(appRouter);
  const today = new Date().toISOString().slice(0, 10);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } },
      db,
      correlationId: "corr-86",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    procedure: string,
    input: unknown,
    user = "user-a",
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/nutritionCoach/${procedure}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const getConsent = (user = "user-a") => call<ConsentState | null>("getConsent", {}, user);
  const grant = (includeNumbers: boolean, user = "user-a") =>
    call<ConsentState>("grantConsent", { includeNumbers }, user);
  const revoke = (user = "user-a") => call<ConsentState>("revokeConsent", {}, user);
  const preview = (user = "user-a") => call<Preview>("previewContext", {}, user);

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-a', 'a@example.test'), ('user-a2', 'a2@example.test'), ('user-b', 'b@example.test');
      insert into organization (id, name, slug) values
        ('org-a', 'Record A', 'record-a'), ('org-b', 'Record B', 'record-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-user-a', 'org-a', 'user-a', 'owner'),
        ('m-user-a2', 'org-a', 'user-a2', 'collaborator'),
        ('m-user-b', 'org-b', 'user-b', 'owner');
    `),
    );
    setRegisteredAuth(fakeAuth);

    // One logged day for user-a with a full nutrient set, so the preview has data.
    await createNutritionRepository(db).logEntry(
      { organizationId: "org-a", userId: "user-a" },
      {
        localDate: today,
        timeZone: "UTC",
        slot: "breakfast",
        amount: 100,
        unit: "g",
        method: "search",
        food: {
          kind: "external",
          snapshot: {
            source: "fdc",
            sourceFoodId: "900001",
            sourceVersion: "synthetic-2026-04",
            attribution: "Synthetic catalog fixture",
            name: "Synthetic oats",
            nutrientBasisAmount: 100,
            nutrientBasisUnit: "g",
            nutrients: {
              energyKcal: 2000,
              proteinG: 100,
              carbohydrateG: 200,
              fatG: 70,
              fiberG: 30,
            },
          },
        },
      },
    );
  });

  afterAll(() => clearRegisteredAuth());

  test("no consent before the member grants one; the preview shares nothing", async () => {
    expect((await getConsent()).body).toBeNull();
    const before = await preview();
    expect(before.status).toBe(200);
    expect(before.body.sharedWithProvider).toBe(false);
    // Even locally, numbers are off until the member chooses to share them.
    expect(before.body.context.numbersHidden).toBe(true);
    expect(before.body.context.averages).toBeNull();
  });

  test("granting with numbers shows the exact sanitized summary that would be sent", async () => {
    const granted = await grant(true);
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({ granted: true, includeNumbers: true, revokedAt: null });

    const result = await preview();
    expect(result.body.sharedWithProvider).toBe(true);
    expect(result.body.context.numbersHidden).toBe(false);
    expect(result.body.context.loggedDays).toBeGreaterThanOrEqual(1);
    expect(result.body.context.averages?.energyKcal).toBe(2000);
    // The preview carries no foods, ids or dates — only the aggregates.
    expect(JSON.stringify(result.body)).not.toContain("Synthetic oats");
  });

  test("hide-numbers shares coverage only, never a value", async () => {
    await grant(false);
    const result = await preview();
    expect(result.body.sharedWithProvider).toBe(true);
    expect(result.body.context.numbersHidden).toBe(true);
    expect(result.body.context.averages).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain("2000");
  });

  test("revoking stops sharing on the very next read", async () => {
    const revoked = await revoke();
    expect(revoked.body.granted).toBe(false);
    expect(revoked.body.revokedAt).not.toBeNull();

    const result = await preview();
    expect(result.body.sharedWithProvider).toBe(false);
    expect(result.body.context.averages).toBeNull();
    expect((await getConsent()).body).toMatchObject({ granted: false });
  });

  test("consent never leaks across members or workspaces", async () => {
    await grant(true, "user-a");
    // The collaborator in the same workspace has their own, separate row.
    expect((await getConsent("user-a2")).body).toBeNull();
    expect((await preview("user-a2")).body.sharedWithProvider).toBe(false);
    // Another workspace is untouched too.
    expect((await getConsent("user-b")).body).toBeNull();
  });
});
