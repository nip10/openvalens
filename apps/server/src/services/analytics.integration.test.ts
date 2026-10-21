import { readdir } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Session } from "@openvalens/auth";
import { deleteSubjectData } from "@openvalens/data-rights/delete";
import { exportSubjectData } from "@openvalens/data-rights/export";
import { createDb, sql } from "@openvalens/db";
import { appRouter } from "@openvalens/api/routers/index";
import type { Context } from "@openvalens/api/context";
import { RPCHandler } from "@orpc/server/fetch";

import { createAnalyticsService } from "./analytics";

const url = process.env.ANALYTICS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/analytics_consent_test"
  ) {
    throw new Error("Empty disposable loopback analytics_consent_test database required.");
  }
}

const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/analytics_consent_test" });
if (url) {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) throw new Error("Integration database must be empty.");
  const root = new URL("../../../../packages/db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }
}

function sessionFor(userId: string): Session {
  return {
    user: { id: userId, email: `${userId}@example.test`, name: null },
    session: {
      id: `sess-${userId}`,
      userId,
      activeOrganizationId: `org-${userId}`,
      impersonatedBy: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  } as unknown as Session;
}

const rpc = new RPCHandler(appRouter);
let fetchHandler: (url: string, init?: RequestInit) => Promise<Response> = async () =>
  new Response('{"status":"ok"}');
const fetchMock: typeof fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetchHandler(String(input), init),
  { preconnect: () => {} },
);
let analytics = createAnalyticsService(
  db,
  { enabled: true, projectToken: "test-project", ipCaptureDisabled: true },
  fetchMock,
);

function contextFor(headers: Headers, session: unknown): Context {
  return {
    session,
    db,
    correlationId: "corr-analytics-test",
    cronSecret: "cron-secret-long-enough-value",
    betterAuthSecretConfigured: true,
    capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
    telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      AI_PROVIDER: null,
      AI_API_KEY: null,
      AI_BASE_URL: null,
      AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
      AI_MODEL: "test-model",
      AI_RATE_LIMIT_PER_MINUTE: 20,
    },
    aiRateLimiter: { consume: async () => true },
    analytics,
    honoContext: { req: { raw: { headers } } },
  } as unknown as Context;
}

type RpcResult = { status: number; json: unknown };
async function call(
  path: "getPreference" | "setPreference" | "capture",
  body: unknown,
  session: unknown,
): Promise<RpcResult> {
  const headers = new Headers({ "content-type": "application/json" });
  const request = new Request(`http://test.local/rpc/analytics/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ json: body }),
  });
  const { matched, response } = await rpc.handle(request, {
    prefix: "/rpc",
    context: contextFor(headers, session),
  });
  if (!matched || !response) throw new Error("unmatched analytics RPC path");
  return { status: response.status, json: await response.json() };
}

async function seedUsers(): Promise<void> {
  await db.execute(sql`
    insert into "user" (id, email) values
      ('analytics-user-a', 'analytics-user-a@example.test'),
      ('analytics-user-b', 'analytics-user-b@example.test')
  `);
}

async function reset(): Promise<void> {
  await db.execute(sql`delete from analytics_consent`);
  await db.execute(sql`delete from "user" where id in ('analytics-user-a', 'analytics-user-b')`);
}

describe.skipIf(!url)("analytics consent over RPC and PostgreSQL", () => {
  beforeAll(async () => {
    await db.execute(sql`select 1`);
  });

  beforeEach(async () => {
    await reset();
    await seedUsers();
    fetchHandler = async () => new Response('{"status":"ok"}');
    analytics = createAnalyticsService(
      db,
      { enabled: true, projectToken: "test-project", ipCaptureDisabled: true },
      fetchMock,
    );
  });

  afterEach(async () => {
    await reset();
  });

  test("RPC consent is derived from authenticated actor; client actor and payload properties are rejected", async () => {
    expect(
      (await call("getPreference", { userId: "analytics-user-a" }, sessionFor("analytics-user-a")))
        .status,
    ).toBe(400);
    expect(
      (
        await call(
          "setPreference",
          { enabled: true, userId: "analytics-user-b", organizationId: "org-b" },
          sessionFor("analytics-user-a"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "capture",
          { event: "preferences_opened", distinct_id: "attacker-id", health: "value" },
          sessionFor("analytics-user-a"),
        )
      ).status,
    ).toBe(400);

    expect((await call("getPreference", {}, sessionFor("analytics-user-a"))).json).toMatchObject({
      json: { enabled: false },
    });
    expect(
      (await call("setPreference", { enabled: true }, sessionFor("analytics-user-a"))).status,
    ).toBe(200);
    expect((await call("getPreference", {}, sessionFor("analytics-user-a"))).json).toMatchObject({
      json: { enabled: true },
    });
    expect((await call("getPreference", {}, sessionFor("analytics-user-b"))).json).toMatchObject({
      json: { enabled: false },
    });
  });

  test("consent exports and deletes as user-owned data", async () => {
    await call("setPreference", { enabled: true }, sessionFor("analytics-user-a"));
    const exported = await exportSubjectData(db, {
      userId: "analytics-user-a",
      organizationIds: [],
    });
    const consentFile = exported.files.find(
      (file) => file.path === "entities/analytics_consent.json",
    );
    expect(consentFile).toBeDefined();
    expect(JSON.parse(consentFile!.content)).toEqual([
      { user_id: "analytics-user-a", enabled: true, updated_at: expect.any(String) },
    ]);

    await deleteSubjectData(db, { userId: "analytics-user-a", organizationIds: [] });
    const remaining = await db.execute(sql`select user_id from analytics_consent`);
    expect(remaining.rows).toEqual([]);
  });

  test("capture FOR SHARE blocks revocation until its bounded fake provider request finishes", async () => {
    await call("setPreference", { enabled: true }, sessionFor("analytics-user-a"));
    let beginFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      beginFetch = resolve;
    });
    let finishFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      finishFetch = resolve;
    });
    let providerCalls = 0;
    fetchHandler = async () => {
      providerCalls += 1;
      beginFetch();
      await fetchGate;
      return new Response('{"status":"ok"}', { status: 200 });
    };

    const capture = call(
      "capture",
      { event: "preferences_opened" },
      sessionFor("analytics-user-a"),
    );
    await fetchStarted;
    let revokeFinished = false;
    const revoke = call("setPreference", { enabled: false }, sessionFor("analytics-user-a")).then(
      (result) => {
        revokeFinished = true;
        return result;
      },
    );
    let lockWaiters = 0;
    for (let attempt = 0; attempt < 50 && lockWaiters === 0; attempt += 1) {
      const result = await db.execute(sql`
        select count(*)::int as count
        from pg_stat_activity
        where datname = current_database()
          and pid <> pg_backend_pid()
          and wait_event_type = 'Lock'
          and query ilike '%analytics_consent%'
      `);
      lockWaiters = Number(result.rows[0]?.count ?? 0);
      if (lockWaiters === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(lockWaiters).toBeGreaterThan(0);
    expect(revokeFinished).toBe(false);
    finishFetch();
    expect((await capture).status).toBe(200);
    expect((await revoke).status).toBe(200);
    expect(
      (await call("capture", { event: "preferences_opened" }, sessionFor("analytics-user-a"))).json,
    ).toMatchObject({ json: { accepted: false } });
    expect(providerCalls).toBe(1);
  });
});
