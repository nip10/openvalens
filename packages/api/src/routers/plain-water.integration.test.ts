import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import { appRouter } from "./index";

const url = process.env.WATER_ROUTER_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/water_router_test"
  )
    throw new Error("Empty disposable loopback water_router_test database required.");
}
const members: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-a", role: "owner" },
  "user-d": { org: "org-b", role: "owner" },
};
const deniedRecords = new Set<string>();
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      if (!members[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `session-${id}`,
          userId: id,
          activeOrganizationId: members[id]!.org,
          impersonatedBy: headers.get("x-test-impersonated") ?? null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      const m = members[id];
      return m ? { id: `member-${id}`, userId: id, organizationId: m.org, role: m.role } : null;
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: members[actor(headers)]?.role,
    }),
    hasPermission: async ({ headers }: { headers: Headers }) => ({
      success: !deniedRecords.has(actor(headers)),
    }),
  },
} as unknown as Auth;

describe.skipIf(!url)("plainWater authenticated HTTP/PG API", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/water_router_test" });
  const rpc = new RPCHandler(appRouter);
  async function migrate() {
    const root = new URL("../../../db/src/migrations/", import.meta.url);
    for (const folder of (await readdir(root)).sort()) {
      if (!/^\d/.test(folder)) continue;
      const contents = await Bun.file(new URL(`${folder}/migration.sql`, root)).text();
      for (const statement of contents.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }
  async function call(
    path: string,
    input: unknown,
    user = "user-a",
    impersonated?: string,
    requestDb: Database = db,
  ) {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    if (impersonated) headers.set("x-test-impersonated", impersonated);
    const request = new Request(
      `http://test.local/rpc/${path.includes("/") ? path : `plainWater/${path}`}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ json: input }),
      },
    );
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers, requestDb),
    });
    if (!matched || !response) throw new Error("unmatched plainWater RPC path");
    const body = (await response.json()) as { json?: unknown; message?: string };
    return { status: response.status, body: body.json ?? body };
  }
  function contextFor(headers: Headers, requestDb: Database = db): Context {
    const id = actor(headers);
    const m = members[id];
    return {
      session: m
        ? {
            user: { id },
            session: {
              id: `session-${id}`,
              userId: id,
              activeOrganizationId: m.org,
              impersonatedBy: headers.get("x-test-impersonated") ?? null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db: requestDb,
      correlationId: "corr-water",
      cronSecret: "synthetic-cron-secret-long-enough",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }
  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
  });
  beforeEach(async () => {
    deniedRecords.clear();
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(
      sql`insert into "user" (id,email) values ('user-a','a@example.test'),('user-b','b@example.test'),('user-c','c@example.test'),('user-d','d@example.test')`,
    );
    await db.execute(
      sql`insert into organization (id,name,slug) values ('org-a','A','a'),('org-b','B','b')`,
    );
    await db.execute(
      sql`insert into member (id,organization_id,user_id,role) values ('ma','org-a','user-a','owner'),('mb','org-a','user-b','collaborator'),('mc','org-a','user-c','owner'),('md','org-b','user-d','owner')`,
    );
  });
  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("HTTP CRUD, exact replay, stale-conflict privacy, and DST reads", async () => {
    expect(await call("getPreferences", {})).toMatchObject({
      status: 200,
      body: { enabled: false, personalGoalMl: null },
    });
    expect(
      await call("nutritionTargets/updateSettings", { expectedRevision: 0, hideNumbers: false }),
    ).toMatchObject({ status: 200 });
    expect(
      await call("updatePreferences", {
        personalGoal: 1500,
        personalGoalUnit: "ml",
        enabled: true,
      }),
    ).toMatchObject({ status: 200 });
    expect(await call("updatePreferences", { personalGoal: null })).toMatchObject({ status: 200 });
    expect(
      await call("updatePreferences", { personalGoal: 1200, personalGoalUnit: "ml" }),
    ).toMatchObject({
      status: 200,
      body: { personalGoalMl: 1200 },
    });
    expect(await call("getPreferences", {})).toMatchObject({
      status: 200,
      body: { personalGoalMl: 1200 },
    });
    const add = await call("add", {
      quantity: 999,
      unit: "ml",
      observedAt: "2026-03-29T01:00:00Z",
      timeZone: "Europe/Lisbon",
      clientMutationId: "add-1",
    });
    expect(add.status).toBe(200);
    expect(add.body).toMatchObject({ entry: { quantityMl: 999 } });
    const id = (add.body as { entry: { id: number } }).entry.id;
    const day = await call("getDay", { date: "2026-03-29", timeZone: "Europe/Lisbon" });
    expect(day.body).toMatchObject({
      label: "Plain water subtotal",
      enabled: true,
      quantityMl: 999,
      personalGoalMl: 1200,
    });
    expect(JSON.stringify(day.body)).toContain("999");
    expect(
      (
        await call("add", {
          quantity: 999,
          unit: "ml",
          observedAt: "2026-03-29T01:00:00Z",
          timeZone: "Europe/Lisbon",
          clientMutationId: "add-1",
        })
      ).body,
    ).toMatchObject({ outcome: "replayed" });
    expect(
      JSON.stringify(
        (
          await call("add", {
            quantity: 999,
            unit: "ml",
            observedAt: "2026-03-29T01:00:00Z",
            timeZone: "Europe/Lisbon",
            clientMutationId: "add-1",
          })
        ).body,
      ),
    ).toContain("999");
    expect(
      (
        await call("add", {
          quantity: 998,
          unit: "ml",
          observedAt: "2026-03-29T01:00:00Z",
          timeZone: "Europe/Lisbon",
          clientMutationId: "add-1",
        })
      ).status,
    ).not.toBe(200);
    const concurrent = await Promise.all(
      Array.from({ length: 6 }, () =>
        call("add", {
          quantity: 700,
          unit: "ml",
          observedAt: "2026-03-29T01:00:00Z",
          timeZone: "Europe/Lisbon",
          clientMutationId: "parallel-add",
        }),
      ),
    );
    expect(
      concurrent.filter((result) => (result.body as { outcome: string }).outcome === "applied"),
    ).toHaveLength(1);
    expect(
      new Set(concurrent.map((result) => (result.body as { targetId: string }).targetId)).size,
    ).toBe(1);
    const editInput = {
      id,
      expectedRevision: 1,
      clientMutationId: "edit-1",
      quantity: 500,
      unit: "ml",
    };
    expect((await call("change", editInput)).body).toMatchObject({
      outcome: "applied",
      entry: { quantityMl: 500 },
    });
    expect((await call("change", editInput)).body).toMatchObject({
      outcome: "replayed",
      entry: { quantityMl: 500 },
    });
    const staleEdit = {
      ...editInput,
      clientMutationId: "stale-1",
      expectedRevision: 1,
      quantity: 400,
    };
    const conflict = await call("change", staleEdit);
    expect(conflict.body).toMatchObject({ outcome: "conflict", entry: { quantityMl: 500 } });
    expect(await call("change", staleEdit)).toMatchObject({
      status: 200,
      body: { outcome: "conflict", entry: { revision: 2, quantityMl: 500 } },
    });
    const deleted = { id, expectedRevision: 2, clientMutationId: "delete-1" };
    expect((await call("delete", deleted)).body).toMatchObject({
      outcome: "applied",
      entry: { deleted: true, quantityMl: 500 },
    });
    expect((await call("delete", deleted)).body).toMatchObject({
      outcome: "replayed",
      entry: { quantityMl: 500 },
    });
    const staleDeleteCreated = await call("add", {
      quantity: 321,
      unit: "ml",
      observedAt: "2026-03-29T01:00:00Z",
      timeZone: "Europe/Lisbon",
      clientMutationId: "stale-delete-create",
    });
    const staleDeleteId = (staleDeleteCreated.body as { entry: { id: number } }).entry.id;
    await call("change", {
      id: staleDeleteId,
      expectedRevision: 1,
      clientMutationId: "stale-delete-edit",
      quantity: 222,
      unit: "ml",
    });
    const staleDelete = {
      id: staleDeleteId,
      expectedRevision: 1,
      clientMutationId: "stale-delete",
    };
    expect(await call("delete", staleDelete)).toMatchObject({
      status: 200,
      body: { outcome: "conflict", entry: { revision: 2, quantityMl: 222 } },
    });
    const staleDeleteRetry = await call("delete", staleDelete);
    expect(staleDeleteRetry.body).toMatchObject({
      outcome: "conflict",
      entry: { revision: 2, quantityMl: 222 },
    });
    expect(JSON.stringify(staleDeleteRetry.body)).toContain("222");
    expect(
      await call("nutritionTargets/updateSettings", { expectedRevision: 1, hideNumbers: true }),
    ).toMatchObject({ status: 200 });
    const hiddenPreferences = await call("getPreferences", {});
    expect(hiddenPreferences).toMatchObject({ body: { personalGoalMl: null } });
    expect(JSON.stringify(hiddenPreferences.body)).not.toContain("1200");
    const hiddenGoalUpdate = await call("updatePreferences", {
      personalGoal: 1400,
      personalGoalUnit: "ml",
    });
    expect(hiddenGoalUpdate).toMatchObject({ status: 200, body: { personalGoalMl: null } });
    expect(JSON.stringify(hiddenGoalUpdate.body)).not.toContain("1400");
    const hiddenDay = await call("getDay", { date: "2026-03-29", timeZone: "Europe/Lisbon" });
    expect(hiddenDay.body).toMatchObject({ quantityMl: null, personalGoalMl: null });
    expect(
      (hiddenDay.body as { entries: { quantityMl: number | null }[] }).entries.length,
    ).toBeGreaterThan(0);
    expect(
      (hiddenDay.body as { entries: { quantityMl: number | null }[] }).entries.every(
        (entry) => entry.quantityMl === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(hiddenDay.body)).not.toContain("999");
    expect(JSON.stringify(hiddenDay.body)).not.toContain("1400");
    expect(
      await call("add", {
        quantity: 999,
        unit: "ml",
        observedAt: "2026-03-29T01:00:00Z",
        timeZone: "Europe/Lisbon",
        clientMutationId: "add-1",
      }),
    ).toMatchObject({ body: { outcome: "replayed", entry: { quantityMl: null } } });
    expect(await call("change", editInput)).toMatchObject({
      body: { outcome: "replayed", entry: { quantityMl: null } },
    });
    expect(await call("change", staleEdit)).toMatchObject({
      body: { outcome: "conflict", entry: { quantityMl: null } },
    });
    expect(await call("delete", deleted)).toMatchObject({
      body: { outcome: "replayed", entry: { quantityMl: null } },
    });
    const hiddenAdd = await call("add", {
      quantity: 7319,
      unit: "ml",
      observedAt: "2026-11-01T05:30:00Z",
      timeZone: "America/New_York",
      clientMutationId: "hidden-applied-add",
    });
    expect(hiddenAdd.body).toMatchObject({ outcome: "applied", entry: { quantityMl: null } });
    expect(JSON.stringify(hiddenAdd.body)).not.toContain("7319");
    const hiddenId = (hiddenAdd.body as { entry: { id: number } }).entry.id;
    const hiddenChange = {
      id: hiddenId,
      expectedRevision: 1,
      clientMutationId: "hidden-applied-change",
      quantity: 6721,
      unit: "ml",
    };
    const hiddenChangeApplied = await call("change", hiddenChange);
    expect(hiddenChangeApplied).toMatchObject({
      body: { outcome: "applied", entry: { quantityMl: null } },
    });
    expect(JSON.stringify(hiddenChangeApplied.body)).not.toContain("6721");
    const hiddenChangeReplay = await call("change", hiddenChange);
    expect(hiddenChangeReplay).toMatchObject({
      body: { outcome: "replayed", entry: { quantityMl: null } },
    });
    expect(JSON.stringify(hiddenChangeReplay.body)).not.toContain("6721");
    const hiddenConflict = {
      ...hiddenChange,
      expectedRevision: 1,
      clientMutationId: "hidden-conflict",
      quantity: 5137,
    };
    const hiddenConflictApplied = await call("change", hiddenConflict);
    expect(hiddenConflictApplied).toMatchObject({
      body: { outcome: "conflict", entry: { quantityMl: null } },
    });
    expect(JSON.stringify(hiddenConflictApplied.body)).not.toContain("6721");
    const hiddenConflictReplay = await call("change", hiddenConflict);
    expect(hiddenConflictReplay).toMatchObject({
      body: { outcome: "conflict", entry: { quantityMl: null } },
    });
    expect(JSON.stringify(hiddenConflictReplay.body)).not.toContain("6721");
    const hiddenDelete = {
      id: hiddenId,
      expectedRevision: 2,
      clientMutationId: "hidden-applied-delete",
    };
    const hiddenDeleteApplied = await call("delete", hiddenDelete);
    expect(hiddenDeleteApplied).toMatchObject({
      body: { outcome: "applied", entry: { deleted: true, quantityMl: null } },
    });
    expect(JSON.stringify(hiddenDeleteApplied.body)).not.toContain("6721");
    const hiddenDeleteReplay = await call("delete", hiddenDelete);
    expect(hiddenDeleteReplay).toMatchObject({
      body: { outcome: "replayed", entry: { deleted: true, quantityMl: null } },
    });
    expect(JSON.stringify(hiddenDeleteReplay.body)).not.toContain("6721");
    const hiddenThenVisibleAdd = {
      quantity: 2468,
      unit: "ml",
      observedAt: "2026-11-02T12:00:00Z",
      timeZone: "UTC",
      clientMutationId: "hidden-then-visible-add",
    };
    expect(await call("add", hiddenThenVisibleAdd)).toMatchObject({
      body: { outcome: "applied", entry: { quantityMl: null } },
    });
    expect(
      await call("nutritionTargets/updateSettings", { expectedRevision: 2, hideNumbers: false }),
    ).toMatchObject({ status: 200 });
    expect(await call("getPreferences", {})).toMatchObject({ body: { personalGoalMl: 1400 } });
    // A replay is projected with the setting in effect now, not the one at apply time.
    expect(await call("add", hiddenThenVisibleAdd)).toMatchObject({
      body: { outcome: "replayed", entry: { quantityMl: 2468 } },
    });
    const disabledSetup = await call("add", {
      quantity: 91,
      unit: "ml",
      observedAt: "2026-11-01T05:30:00Z",
      timeZone: "America/New_York",
      clientMutationId: "disabled-delete-setup",
    });
    expect(disabledSetup).toMatchObject({ status: 200, body: { entry: { quantityMl: 91 } } });
    const visibleDay = await call("getDay", {
      date: "2026-11-01",
      timeZone: "America/New_York",
    });
    expect(visibleDay.body).toMatchObject({ quantityMl: 91, personalGoalMl: 1400 });
    expect(JSON.stringify(visibleDay.body)).toContain("91");
    const disabledEntryId = (disabledSetup.body as { entry: { id: number } }).entry.id;
    const visibleChange = {
      id: disabledEntryId,
      expectedRevision: 1,
      clientMutationId: "visible-change",
      quantity: 92,
      unit: "ml",
    };
    expect(await call("change", visibleChange)).toMatchObject({
      status: 200,
      body: { outcome: "applied", entry: { quantityMl: 92 } },
    });
    expect(await call("change", visibleChange)).toMatchObject({
      status: 200,
      body: { outcome: "replayed", entry: { quantityMl: 92 } },
    });
    expect(await call("updatePreferences", { enabled: false })).toMatchObject({ status: 200 });
    expect(await call("updatePreferences", { personalGoal: null })).toMatchObject({
      body: { personalGoalMl: null },
    });
    expect(
      await call("delete", {
        id: disabledEntryId,
        expectedRevision: 2,
        clientMutationId: "delete-while-disabled",
      }),
    ).toMatchObject({
      status: 200,
      body: { outcome: "applied", entry: { deleted: true, quantityMl: 92 } },
    });
    expect(
      (
        await call("delete", {
          ...deleted,
          clientMutationId: "empty-delete",
          quantity: 3,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (
        await call("add", {
          quantity: 1,
          unit: "ml",
          observedAt: "2026-03-29T01:00:00Z",
          timeZone: "Europe/Lisbon",
          clientMutationId: "spoof",
          userId: "user-b",
        })
      ).status,
    ).not.toBe(200);
  });

  test("self, membership, role, tenant and impersonation boundaries apply to reads and writes", async () => {
    await call("updatePreferences", { enabled: true });
    const privateAdd = await call("add", {
      quantity: 4567,
      unit: "ml",
      observedAt: "2026-03-29T01:00:00Z",
      timeZone: "UTC",
      clientMutationId: "private-seed",
    });
    const privateId = (privateAdd.body as { entry: { id: number } }).entry.id;
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC", userId: "user-a" })).status,
    ).not.toBe(200);
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC" }, "ghost")).status,
    ).not.toBe(200);
    expect((await call("getPreferences", {}, "ghost")).status).not.toBe(200);
    expect((await call("getPreferences", {}, "user-b", "user-a")).status).not.toBe(200);
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC" }, "user-b", "user-a")).status,
    ).not.toBe(200);
    let handlerDbCalls = 0;
    const countedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (["select", "insert", "update", "delete"].includes(String(property))) {
          return (...args: unknown[]) => {
            handlerDbCalls++;
            const method = Reflect.get(target, property, target) as (
              ...values: unknown[]
            ) => unknown;
            return method.apply(target, args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as Database;
    expect(
      (
        await call(
          "add",
          {
            quantity: 1,
            unit: "ml",
            observedAt: "2026-03-29T01:00:00Z",
            timeZone: "UTC",
            clientMutationId: "imp",
          },
          "user-a",
          "user-c",
          countedDb,
        )
      ).status,
    ).not.toBe(200);
    expect(handlerDbCalls).toBe(0);
    deniedRecords.add("user-b");
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC" }, "user-b")).status,
    ).not.toBe(200);
    deniedRecords.delete("user-b");
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC" }, "user-b")).body,
    ).toMatchObject({ entries: [] });
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC" }, "user-c")).body,
    ).toMatchObject({ entries: [] });
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC" }, "user-d")).body,
    ).toMatchObject({ entries: [] });
    const crossTenantEdit = await call(
      "change",
      {
        id: privateId,
        expectedRevision: 1,
        clientMutationId: "wrong-org",
        quantity: 9999,
        unit: "ml",
      },
      "user-d",
    );
    expect(crossTenantEdit.status).not.toBe(200);
    expect(JSON.stringify(crossTenantEdit.body)).not.toContain("4567");
    const crossTenantAdd = await call(
      "add",
      {
        quantity: 8888,
        unit: "ml",
        observedAt: "2026-03-29T01:00:00Z",
        timeZone: "UTC",
        clientMutationId: "wrong-org-add",
      },
      "user-d",
    );
    expect(crossTenantAdd.status).not.toBe(200);
    expect(JSON.stringify(crossTenantAdd.body)).not.toContain("8888");
    const afterDeniedCalls = await db.execute(
      sql`select quantity_ml from plain_water_entry where organization_id = 'org-a' and user_id = 'user-a' and id = ${privateId}`,
    );
    expect(afterDeniedCalls.rows).toEqual([{ quantity_ml: 4567 }]);
    const deniedReceipts = await db.execute(
      sql`select client_mutation_id from plain_water_mutation where (user_id = 'user-a' and client_mutation_id = 'imp') or (user_id = 'user-d' and client_mutation_id in ('wrong-org', 'wrong-org-add'))`,
    );
    expect(deniedReceipts.rows).toEqual([]);
  });

  test("strict bounded inputs reject malformed units, dates, goals and no-op changes", async () => {
    expect((await call("getDay", { date: "2026-02-30", timeZone: "UTC" })).status).not.toBe(200);
    expect(
      (
        await call("add", {
          quantity: 1,
          unit: "cups",
          observedAt: "2026-03-29",
          timeZone: "UTC",
          clientMutationId: "bad",
        })
      ).status,
    ).not.toBe(200);
    expect((await call("updatePreferences", { personalGoal: 100 })).status).not.toBe(200);
    expect(
      (await call("change", { id: 1, expectedRevision: 1, clientMutationId: "noop" })).status,
    ).not.toBe(200);
  });
});
