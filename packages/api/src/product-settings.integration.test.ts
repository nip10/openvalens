import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Session } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { productSettings } from "@openvalens/db/schema/product-settings";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { createProductSettingsService, type ProductSettingsService } from "./product-settings";
import { appRouter } from "./routers/index";

/**
 * Issue #58 — product display settings against a real, disposable PostgreSQL.
 *
 * Guarded by `PRODUCT_SETTINGS_TEST_DATABASE_URL`, which must point at an
 * *empty* loopback database named `product_settings_test`. The full migration
 * set is applied before the suite runs, so the settings tables must exist in the
 * DB lane. When the schema is not present the suite skips rather than declaring
 * a pass.
 *
 * Registered in `scripts/test-integration.sh` (`PRODUCT_SETTINGS_TEST_DATABASE_URL
 * | product_settings_test`), so normal main CI runs it against a fresh database.
 */
const url = process.env.PRODUCT_SETTINGS_TEST_DATABASE_URL;

if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/product_settings_test"
  ) {
    throw new Error("Empty disposable loopback product_settings_test database required.");
  }
}

const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/product_settings_test" });

let schemaReady = false;
if (url) {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) {
    throw new Error("Integration database must be empty.");
  }
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }
  const settingsTable = await db.execute(
    sql`select to_regclass('public.product_settings') is not null as present`,
  );
  schemaReady = Boolean((settingsTable.rows[0] as { present: boolean } | undefined)?.present);
  if (!schemaReady) {
    console.warn(
      "product-settings.integration.test: product_settings missing; DB lane not ready — skipping.",
    );
  }
}

const ORIGIN = "https://app.test";

function future(ms = 60 * 60 * 1000): Date {
  return new Date(Date.now() + ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionFor(
  userId: string,
  sessionId = `sess-${userId}`,
  overrides: { impersonatedBy?: string | null; expiresAt?: Date } = {},
): Session {
  return {
    user: { id: userId, email: `${userId}@example.test`, name: null },
    session: {
      id: sessionId,
      userId,
      impersonatedBy: overrides.impersonatedBy ?? null,
      expiresAt: overrides.expiresAt ?? future(),
    },
  } as unknown as Session;
}

async function seedUser(
  id: string,
  role: string,
  banned: boolean,
  emailVerified: boolean,
): Promise<void> {
  await db.execute(
    sql`insert into "user" ("id", "email", "email_verified", "role", "banned") values (${id}, ${`${id}@example.test`}, ${emailVerified}, ${role}, ${banned})`,
  );
}

async function seedSession(
  id: string,
  userId: string,
  expiresAt: Date,
  impersonatedBy: string | null = null,
): Promise<void> {
  await db.execute(
    sql`insert into "session" ("id", "user_id", "token", "expires_at", "impersonated_by") values (${id}, ${userId}, ${`token-${id}`}, ${expiresAt.toISOString()}, ${impersonatedBy})`,
  );
}

async function reset(): Promise<void> {
  await db.execute(sql`delete from "product_settings_audit"`);
  await db.execute(sql`delete from "session"`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`update "product_settings" set "units" = 'metric', "locale" = 'en-US', "revision" = 0, "updated_at" = clock_timestamp() where "id" = 'instance'`,
  );
}

async function loadSettings(): Promise<{ units: string; locale: string; revision: number }> {
  const result = await db.execute<{ units: string; locale: string; revision: number }>(
    sql`select "units", "locale", "revision" from "product_settings" where "id" = 'instance'`,
  );
  return result.rows[0]!;
}

async function auditRows(): Promise<
  { actor_user_id: string | null; changed_keys: string; revision: number }[]
> {
  const result = await db.execute<{
    actor_user_id: string | null;
    changed_keys: string;
    revision: number;
  }>(
    sql`select "actor_user_id", "changed_keys", "revision" from "product_settings_audit" order by "revision" asc`,
  );
  return result.rows;
}

async function lockWaiters(): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return (result.rows[0] as { n: number }).n;
}

async function waitForLockWaiter(timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await lockWaiters()) > 0) return true;
    await sleep(50);
  }
  return false;
}

async function clockNow(): Promise<Date> {
  const result = await db.execute(sql`select clock_timestamp() as now`);
  return new Date(String((result.rows[0] as { now: unknown }).now));
}

/** Opens a second connection that holds a lock, runs a mutation, then waits. */
async function withBlocker(
  run: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<void>,
): Promise<{
  release: () => void;
  holding: Promise<void>;
  end: () => Promise<void>;
}> {
  const blocker = createDb({ DATABASE_URL: url! });
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired = () => {};
  const lockAcquired = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const holding = blocker.transaction(async (tx) => {
    await run(tx);
    acquired();
    await released;
  });
  await lockAcquired;
  return {
    release,
    holding,
    end: async () => {
      await (blocker as unknown as { $client?: { end: () => Promise<void> } }).$client?.end();
    },
  };
}

const UPDATE = { units: "imperial", locale: "en-US", expectedRevision: 0 } as const;

describe.skipIf(!url || !schemaReady)("product settings against disposable PostgreSQL", () => {
  let service: ProductSettingsService;

  beforeAll(() => {
    service = createProductSettingsService({ db });
  });

  test("migration seeds the singleton; ORM reads defaults; the seed is idempotent", async () => {
    const rows = await db.select().from(productSettings);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe("instance");
    expect(row.units).toBe("metric");
    expect(row.locale).toBe("en-US");
    expect(row.revision).toBe(0);

    // Re-running the seed statement verbatim never resets the row.
    const text = await Bun.file(
      new URL(
        "../../db/src/migrations/20261014120000_product_settings/migration.sql",
        import.meta.url,
      ),
    ).text();
    const seed = text
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes('INSERT INTO "product_settings"'));
    expect(seed).toBeDefined();
    await db.execute(sql.raw(seed!));

    const again = await db.select().from(productSettings);
    expect(again).toHaveLength(1);
    expect(again[0]!.revision).toBe(0);
  });

  test("read returns effective values for any authenticated user; canEdit true only for a fully authorized live admin", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());
    await seedUser("user-1", "user", false, true);
    await seedSession("sess-user-1", "user-1", future());
    await seedUser("owner-1", "owner", false, true);
    await seedSession("sess-owner-1", "owner-1", future());

    expect(await service.read(sessionFor("admin-1"))).toEqual({
      units: "metric",
      locale: "en-US",
      revision: 0,
      canEdit: true,
    });
    // A non-admin still gets the effective safe values, with canEdit false.
    expect(await service.read(sessionFor("user-1"))).toEqual({
      units: "metric",
      locale: "en-US",
      revision: 0,
      canEdit: false,
    });
    // A workspace owner is not an instance administrator.
    expect(await service.read(sessionFor("owner-1"))).toEqual({
      units: "metric",
      locale: "en-US",
      revision: 0,
      canEdit: false,
    });

    await db.execute(sql`update "user" set "role" = 'user' where "id" = 'admin-1'`);
    expect((await service.read(sessionFor("admin-1"))).canEdit).toBe(false);
  });

  test("read.canEdit mirrors every write requirement (unverified/banned/impersonated/expired/malformed/missing-session)", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());
    await seedUser("unverified-1", "admin", false, false);
    await seedSession("sess-unverified-1", "unverified-1", future());
    await seedUser("banned-1", "admin", true, true);
    await seedSession("sess-banned-1", "banned-1", future());
    await seedUser("no-session-1", "admin", false, true);
    await seedUser("expired-row-1", "admin", false, true);
    await seedSession("sess-expired-row-1", "expired-row-1", new Date(Date.now() - 60_000));
    await seedUser("imp-row-1", "admin", false, true);
    await seedSession("sess-imp-row-1", "imp-row-1", future(), "admin-1");

    const expectCap = async (sessionValue: Session, canEdit: boolean): Promise<void> => {
      const snapshot = await service.read(sessionValue);
      expect(snapshot.canEdit).toBe(canEdit);
      // Values are still returned regardless of capability.
      expect(snapshot).toMatchObject({ units: "metric", locale: "en-US", revision: 0 });
    };

    await expectCap(sessionFor("unverified-1"), false);
    await expectCap(sessionFor("banned-1"), false);
    await expectCap(sessionFor("no-session-1"), false); // missing persisted session row
    await expectCap(sessionFor("expired-row-1"), false); // persisted row expired
    await expectCap(sessionFor("imp-row-1"), false); // persisted row impersonated
    await expectCap(sessionFor("admin-1", "sess-admin-1", { impersonatedBy: "other" }), false);
    await expectCap(
      sessionFor("admin-1", "sess-admin-1", { expiresAt: new Date(Date.now() - 1000) }),
      false,
    );
    await expectCap(sessionFor("admin-1", ""), false); // malformed: no session id
    await expectCap(sessionFor("admin-1", "sess-missing"), false); // no matching row

    // A fully authorized live admin remains true.
    await expectCap(sessionFor("admin-1"), true);
  });

  test("update writes settings and a single value-free audit row per real change", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    const first = await service.update(
      { units: "imperial", locale: "en-US", expectedRevision: 0 },
      sessionFor("admin-1"),
    );
    expect(first).toEqual({ units: "imperial", locale: "en-US", revision: 1, canEdit: true });

    const second = await service.update(
      { units: "metric", locale: "en-GB", expectedRevision: 1 },
      sessionFor("admin-1"),
    );
    expect(second).toEqual({ units: "metric", locale: "en-GB", revision: 2, canEdit: true });

    expect(await auditRows()).toEqual([
      { actor_user_id: "admin-1", changed_keys: "units", revision: 1 },
      { actor_user_id: "admin-1", changed_keys: "units,locale", revision: 2 },
    ]);

    // The audit schema is value-free: no value/email/input/metadata column.
    const columns = await db.execute<{ column_name: string }>(
      sql`select "column_name" from information_schema.columns where table_name = 'product_settings_audit' order by "column_name"`,
    );
    expect(columns.rows.map((entry) => entry.column_name)).toEqual([
      "actor_user_id",
      "changed_keys",
      "id",
      "occurred_at",
      "revision",
    ]);
  });

  test("identical values with the current revision is a no-op (no bump, no audit)", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    const out = await service.update(
      { units: "metric", locale: "en-US", expectedRevision: 0 },
      sessionFor("admin-1"),
    );
    expect(out).toEqual({ units: "metric", locale: "en-US", revision: 0, canEdit: true });
    expect(await loadSettings()).toMatchObject({ revision: 0 });
    expect(await auditRows()).toHaveLength(0);
  });

  test("a stale expectedRevision is a stable CONFLICT with no mutation or audit", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    await expect(
      service.update(
        { units: "imperial", locale: "en-US", expectedRevision: 7 },
        sessionFor("admin-1"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await loadSettings()).toMatchObject({ units: "metric", revision: 0 });
    expect(await auditRows()).toHaveLength(0);
  });

  test("two concurrent edits: one wins, the other conflicts", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    const results = await Promise.allSettled([
      service.update(
        { units: "imperial", locale: "en-US", expectedRevision: 0 },
        sessionFor("admin-1"),
      ),
      service.update(
        { units: "metric", locale: "en-GB", expectedRevision: 0 },
        sessionFor("admin-1"),
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });

    expect(await loadSettings()).toMatchObject({ revision: 1 });
    expect(await auditRows()).toHaveLength(1);
  });

  test("a fresh service instance sees the persisted value (no startup cache)", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    await createProductSettingsService({ db }).update(
      { units: "imperial", locale: "en-CA", expectedRevision: 0 },
      sessionFor("admin-1"),
    );

    const fresh = createProductSettingsService({ db });
    expect(await fresh.read(sessionFor("admin-1"))).toEqual({
      units: "imperial",
      locale: "en-CA",
      revision: 1,
      canEdit: true,
    });
  });

  test("an audit insert failure rolls back the settings write atomically", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    await db.execute(
      sql`create or replace function deny_ps_audit() returns trigger as $$ begin raise exception 'blocked'; end; $$ language plpgsql`,
    );
    await db.execute(
      sql`create trigger deny_ps_audit before insert on "product_settings_audit" for each row execute function deny_ps_audit()`,
    );

    await expect(service.update(UPDATE, sessionFor("admin-1"))).rejects.toMatchObject({
      code: "INTERNAL",
    });

    expect(await loadSettings()).toMatchObject({ units: "metric", revision: 0 });
    expect(await auditRows()).toHaveLength(0);

    await db.execute(sql`drop trigger deny_ps_audit on "product_settings_audit"`);
    await db.execute(sql`drop function deny_ps_audit()`);
  });

  test("deleting the actor retains the audit with a null actor", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    await service.update(UPDATE, sessionFor("admin-1"));
    await db.execute(sql`delete from "user" where "id" = 'admin-1'`);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: null, changed_keys: "units", revision: 1 });
  });

  test("rejects non-admin, workspace-owner, banned, unverified, demoted, impersonated, malformed, expired and missing-session actors", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedUser("user-1", "user", false, true);
    await seedUser("owner-1", "owner", false, true);
    await seedUser("banned-1", "admin", true, true);
    await seedUser("unverified-1", "admin", false, false);
    for (const id of ["admin-1", "user-1", "owner-1", "banned-1", "unverified-1"]) {
      await seedSession(`sess-${id}`, id, future());
    }

    await expect(service.update(UPDATE, sessionFor("user-1"))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(service.update(UPDATE, sessionFor("owner-1"))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(service.update(UPDATE, sessionFor("banned-1"))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(service.update(UPDATE, sessionFor("unverified-1"))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(
      service.update(UPDATE, sessionFor("admin-1", "sess-admin-1", { impersonatedBy: "other" })),
    ).rejects.toMatchObject({ code: "DENIED" });
    // Malformed: no session id → no live session row.
    await expect(service.update(UPDATE, sessionFor("admin-1", ""))).rejects.toMatchObject({
      code: "DENIED",
    });
    // Object expiry already in the past.
    await expect(
      service.update(
        UPDATE,
        sessionFor("admin-1", "sess-admin-1", { expiresAt: new Date(Date.now() - 1000) }),
      ),
    ).rejects.toMatchObject({ code: "DENIED" });
    // No matching session row.
    await expect(
      service.update(UPDATE, sessionFor("admin-1", "sess-missing")),
    ).rejects.toMatchObject({ code: "DENIED" });
    // Demoted after seeding.
    await db.execute(sql`update "user" set "role" = 'user' where "id" = 'admin-1'`);
    await expect(service.update(UPDATE, sessionFor("admin-1"))).rejects.toMatchObject({
      code: "DENIED",
    });

    expect(await loadSettings()).toMatchObject({ units: "metric", revision: 0 });
    expect(await auditRows()).toHaveLength(0);
  });

  test("denies a demotion committed while queued on the actor lock", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    const blocker = await withBlocker(async (tx) => {
      await tx.execute(sql`select "id" from "user" where "id" = 'admin-1' for update`);
      await tx.execute(sql`update "user" set "role" = 'user' where "id" = 'admin-1'`);
    });

    let settled = false;
    const update = service.update(UPDATE, sessionFor("admin-1")).finally(() => {
      settled = true;
    });

    expect(await waitForLockWaiter()).toBe(true);
    expect(settled).toBe(false);

    blocker.release();
    await blocker.holding;
    await expect(update).rejects.toMatchObject({ code: "DENIED" });
    await blocker.end();

    expect(await loadSettings()).toMatchObject({ units: "metric", revision: 0 });
    expect(await auditRows()).toHaveLength(0);
  });

  test("denies a ban committed while queued on the actor lock", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());

    const blocker = await withBlocker(async (tx) => {
      await tx.execute(sql`select "id" from "user" where "id" = 'admin-1' for update`);
      await tx.execute(sql`update "user" set "banned" = true where "id" = 'admin-1'`);
    });

    let settled = false;
    const update = service.update(UPDATE, sessionFor("admin-1")).finally(() => {
      settled = true;
    });

    expect(await waitForLockWaiter()).toBe(true);
    expect(settled).toBe(false);

    blocker.release();
    await blocker.holding;
    await expect(update).rejects.toMatchObject({ code: "DENIED" });
    await blocker.end();

    expect(await loadSettings()).toMatchObject({ units: "metric", revision: 0 });
    expect(await auditRows()).toHaveLength(0);
  });

  test("denies a session that expires while queued on the settings lock", async () => {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    const expiresAt = future(2000);
    await seedSession("sess-admin-1", "admin-1", expiresAt);

    const blocker = await withBlocker(async (tx) => {
      await tx.execute(sql`select "id" from "product_settings" where "id" = 'instance' for update`);
    });

    let settled = false;
    const update = service
      .update(UPDATE, sessionFor("admin-1", "sess-admin-1", { expiresAt }))
      .finally(() => {
        settled = true;
      });

    expect(await waitForLockWaiter()).toBe(true);
    const until = Date.now() + 4000;
    while (Date.now() < until && (await clockNow()).getTime() < expiresAt.getTime() + 100) {
      await sleep(50);
    }
    expect(settled).toBe(false);

    blocker.release();
    await blocker.holding;
    await expect(update).rejects.toMatchObject({ code: "DENIED" });
    await blocker.end();

    expect(await loadSettings()).toMatchObject({ units: "metric", revision: 0 });
    expect(await auditRows()).toHaveLength(0);
  });
});

// ─── HTTP boundary: exact origin guard on RPC + OpenAPI ────────

describe.skipIf(!url || !schemaReady)("product settings HTTP origin guard", () => {
  const rpc = new RPCHandler(appRouter);
  const openapi = new OpenAPIHandler(appRouter);
  const httpService = createProductSettingsService({ db });

  function contextFor(headers: Headers, sessionValue: unknown, admissionOrigin?: string): Context {
    return {
      session: sessionValue,
      db,
      correlationId: "corr-1",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {
        ANTHROPIC_API_KEY: null,
        AI_MODEL: "claude-sonnet-5-5",
        AI_RATE_LIMIT_PER_MINUTE: 20,
      },
      aiRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
      admissionOrigin,
      productSettingsService: httpService,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  type CallOptions = { origin?: string; sessionValue?: unknown; omitOrigin?: boolean };

  async function callRpc(
    body: unknown,
    options: CallOptions = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers = new Headers({ "content-type": "application/json" });
    if (options.origin !== undefined) headers.set("origin", options.origin);
    const request = new Request("http://test.local/rpc/adminSettings/updateProductSettings", {
      method: "POST",
      headers,
      body: JSON.stringify({ json: body }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(
        headers,
        options.sessionValue ?? null,
        options.omitOrigin ? undefined : ORIGIN,
      ),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: Record<string, unknown> };
    return { status: response.status, json: parsed.json };
  }

  async function callOpenApi(
    body: unknown,
    options: CallOptions = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers = new Headers({ "content-type": "application/json" });
    if (options.origin !== undefined) headers.set("origin", options.origin);
    const request = new Request("http://test.local/api/adminSettings/updateProductSettings", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const { matched, response } = await openapi.handle(request, {
      prefix: "/api",
      context: contextFor(
        headers,
        options.sessionValue ?? null,
        options.omitOrigin ? undefined : ORIGIN,
      ),
    });
    if (!matched || !response) throw new Error("unmatched OpenAPI path");
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function seedAdmin(): Promise<unknown> {
    await reset();
    await seedUser("admin-1", "admin", false, true);
    await seedSession("sess-admin-1", "admin-1", future());
    return sessionFor("admin-1");
  }

  test("RPC: anonymous is 401; missing/null/foreign origin is 403", async () => {
    const adminSession = await seedAdmin();

    const anon = await callRpc(UPDATE);
    expect(anon.status).toBe(401);

    for (const origin of [undefined, "null", "https://evil.test"]) {
      const result = await callRpc(UPDATE, { origin, sessionValue: adminSession });
      expect(result.status).toBe(403);
      expect(result.json).toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });

  test("RPC: missing origin binding fails closed with INTERNAL", async () => {
    const adminSession = await seedAdmin();
    const result = await callRpc(UPDATE, {
      origin: ORIGIN,
      sessionValue: adminSession,
      omitOrigin: true,
    });
    expect(result.status).toBe(500);
    expect(result.json).toMatchObject({ code: "INTERNAL" });
  });

  test("RPC: a valid admin + origin writes and returns the snapshot", async () => {
    const adminSession = await seedAdmin();
    const result = await callRpc(UPDATE, { origin: ORIGIN, sessionValue: adminSession });
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ units: "imperial", locale: "en-US", revision: 1, canEdit: true });
  });

  test("OpenAPI: foreign origin is 403; valid origin writes the same snapshot", async () => {
    const adminSession = await seedAdmin();

    const foreign = await callOpenApi(UPDATE, {
      origin: "https://evil.test",
      sessionValue: adminSession,
    });
    expect(foreign.status).toBe(403);
    expect(foreign.json).toMatchObject({ code: "PERMISSION_DENIED" });

    const valid = await callOpenApi(UPDATE, { origin: ORIGIN, sessionValue: adminSession });
    expect(valid.status).toBe(200);
    expect(valid.json).toEqual({ units: "imperial", locale: "en-US", revision: 1, canEdit: true });
  });

  test("RPC: an unknown secret canary key is a value-free INVALID_INPUT and writes nothing", async () => {
    const adminSession = await seedAdmin();
    const result = await callRpc(
      { units: "imperial", locale: "en-US", expectedRevision: 0, secretCanary: "CANARY_LEAK_9f3a" },
      { origin: ORIGIN, sessionValue: adminSession },
    );
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(result.json)).not.toContain("CANARY_LEAK");
    expect(await auditRows()).toHaveLength(0);
    expect(await loadSettings()).toMatchObject({ units: "metric", revision: 0 });
  });
});
