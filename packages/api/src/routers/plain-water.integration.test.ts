import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { createPersonalGoalRepository } from "@openvalens/plans";
import { reconcileWaterLink } from "@openvalens/plans/goal-water-link";
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
async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
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
    const testOwners = sql`(organization_id, user_id) in (('org-a', 'user-a'), ('org-a', 'user-b'), ('org-a', 'user-c'), ('org-b', 'user-d'))`;
    await db.execute(sql`delete from goal_checkin where ${testOwners}`);
    await db.execute(sql`delete from goal_water_link where ${testOwners}`);
    await db.execute(sql`delete from goal_definition where ${testOwners}`);
    await db.execute(sql`delete from goal_lifecycle where ${testOwners}`);
    await db.execute(sql`delete from goal_mutation where ${testOwners}`);
    await db.execute(sql`delete from goal_water_cutover where ${testOwners}`);
    await db.execute(sql`delete from goal where ${testOwners}`);
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
    // Match the value as a JSON number so a timestamp ending in .999Z cannot trip it.
    expect(JSON.stringify(hiddenDay.body)).not.toMatch(/:999[,}]/);
    expect(JSON.stringify(hiddenDay.body)).not.toMatch(/:1400[,}]/);
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

  test("legacy water target writes conflict after Goals cutover", async () => {
    await call("updatePreferences", { enabled: true, personalGoal: 1300, personalGoalUnit: "ml" });
    const definition = {
      id: "api-water-goal",
      title: "Drink water",
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 1800 } },
      startDate: "2026-01-01",
      timeZone: "UTC",
      status: "active",
    };
    const inserted = await db.execute(sql`
      insert into goal (organization_id, user_id, title, category, status, source, definition, start_date)
      values ('org-a', 'user-a', 'Drink water', 'health', 'in_progress', 'water', ${JSON.stringify(definition)}::jsonb, '2026-01-01')
      returning id
    `);
    const goalId = Number(inserted.rows[0]?.id);
    await db.execute(sql`
      insert into goal_definition (organization_id, goal_id, user_id, revision, definition, effective_from)
      values ('org-a', ${goalId}, 'user-a', 1, ${JSON.stringify(definition)}::jsonb, '2026-01-01')
    `);
    await db.execute(
      sql`insert into goal_water_link (organization_id, user_id, goal_id, linked_at) values ('org-a', 'user-a', ${goalId}, '2026-01-01T00:00:00.000Z')`,
    );
    await db.execute(
      sql`insert into goal_water_cutover (organization_id, user_id) values ('org-a', 'user-a')`,
    );
    expect(await call("getDay", { date: "2026-10-01", timeZone: "UTC" })).toMatchObject({
      body: { personalGoalMl: 1800 },
    });
    expect(
      await call("updatePreferences", { personalGoal: 1900, personalGoalUnit: "ml" }),
    ).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
  });

  test("diary reads serialize with goal detail, pause, and effective-rule update", async () => {
    await call("updatePreferences", { enabled: true });
    const definition = {
      id: "concurrent-water-goal",
      title: "Concurrent water goal",
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 1800 } },
      startDate: "2026-01-01",
      timeZone: "UTC",
      status: "active",
    };
    const created = await call("goals/create", {
      definition,
      clientMutationId: "00000000-0000-4000-8000-000000000080",
    });
    expect(created.status).toBe(200);
    const goalId = (created.body as { id: number }).id;

    const pauseRace = await bounded(
      Promise.all([
        call("getDay", { date: new Date().toISOString().slice(0, 10), timeZone: "UTC" }),
        call("goals/detail", { id: goalId }),
        call("goals/setStatus", {
          id: goalId,
          version: 1,
          status: "paused",
          clientMutationId: "00000000-0000-4000-8000-000000000081",
        }),
      ]),
      "diary/detail/pause reconciliation",
    );
    expect(pauseRace[0]?.status).toBe(200);
    expect(pauseRace[1]?.status).toBe(200);
    expect(pauseRace[2]?.status).toBe(200);
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${goalId}`)).rows[0]
        ?.ended_at,
    ).not.toBeNull();

    await call("goals/setStatus", {
      id: goalId,
      version: 2,
      status: "active",
      clientMutationId: "00000000-0000-4000-8000-000000000082",
    });
    const updateRace = await bounded(
      Promise.all([
        call("getDay", { date: new Date().toISOString().slice(0, 10), timeZone: "UTC" }),
        call("goals/detail", { id: goalId }),
        call("goals/update", {
          id: goalId,
          version: 3,
          definition: {
            ...definition,
            rule: { kind: "average", target: { kind: "minimum", value: 1800 }, windowDays: 7 },
          },
          clientMutationId: "00000000-0000-4000-8000-000000000083",
        }),
      ]),
      "diary/detail/effective-rule reconciliation",
    );
    expect(updateRace.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${goalId}`)).rows[0]
        ?.ended_at,
    ).toBeNull();
  });

  test("unused measurement changes install an immediate water baseline without reinterpreting old targets", async () => {
    await call("updatePreferences", { enabled: true });
    const observedAt = new Date();
    const today = observedAt.toISOString().slice(0, 10);
    const manual = {
      id: "manual-water-baseline",
      title: "Manual measurement baseline",
      source: "manual",
      metric: "body_weight",
      unit: "kg",
      rule: { kind: "target", target: { kind: "minimum", value: 100 } },
      startDate: today,
      timeZone: "UTC",
      status: "active",
    };
    const water = {
      ...manual,
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: {
        kind: "recurring",
        cadence: "daily",
        completion: { kind: "minimum", value: 1000 },
      },
    };
    const created = await call("goals/create", {
      definition: manual,
      clientMutationId: "00000000-0000-4000-8000-000000000090",
    });
    expect(created.status).toBe(200);
    const goalId = (created.body as { id: number }).id;
    const changed = await call("goals/update", {
      id: goalId,
      version: 1,
      definition: water,
      clientMutationId: "00000000-0000-4000-8000-000000000091",
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      sourceLocked: false,
      definition: {
        source: "water",
        metric: "water_ml",
        unit: "ml",
        rule: { kind: "recurring", completion: { kind: "minimum", value: 1000 } },
      },
    });
    expect(await call("getDay", { date: today, timeZone: "UTC" })).toMatchObject({
      status: 200,
      body: { personalGoalMl: 1000 },
    });

    const added = await call("add", {
      quantity: 150,
      unit: "ml",
      observedAt: observedAt.toISOString(),
      timeZone: "UTC",
      clientMutationId: "00000000-0000-4000-8000-000000000092",
    });
    expect(added.status).toBe(200);
    const detail = await call("goals/detail", { id: goalId });
    expect(detail.status).toBe(200);
    const detailBody = detail.body as {
      sourceLocked: boolean;
      definition: { rule: { kind: string; completion: { value: number } } };
      evaluation: {
        achieved: boolean;
        currentValue: number | null;
        days: Array<{ date: string; state: string; value: number | null }>;
      };
    };
    expect(detailBody.sourceLocked).toBe(true);
    expect(detailBody.definition.rule.kind).toBe("recurring");
    expect(detailBody.definition.rule.completion.value).toBe(1000);
    expect(detailBody.evaluation.achieved).toBe(false);
    expect(detailBody.evaluation.currentValue).toBe(150);
    expect(Array.isArray(detailBody.evaluation.days)).toBe(true);
    const todayEvaluation = detailBody.evaluation.days.find((day) => day.date === today);
    expect(todayEvaluation?.date).toBe(today);
    expect(todayEvaluation?.state).toBe("does-not-qualify");
    expect(todayEvaluation?.value).toBe(150);

    const deleted = await call("goals/delete", {
      id: goalId,
      version: 2,
      clientMutationId: "00000000-0000-4000-8000-000000000093",
    });
    expect(deleted.status).toBe(200);

    const manualWithExistingWater = { ...manual, id: "manual-with-existing-water" };
    const waterWithExistingWater = { ...water, id: manualWithExistingWater.id };
    const withExistingWater = await call("goals/create", {
      definition: manualWithExistingWater,
      clientMutationId: "00000000-0000-4000-8000-000000000094",
    });
    expect(withExistingWater.status).toBe(200);
    const secondGoalId = (withExistingWater.body as { id: number }).id;
    const switchedWithHistory = await call("goals/update", {
      id: secondGoalId,
      version: 1,
      definition: waterWithExistingWater,
      clientMutationId: "00000000-0000-4000-8000-000000000095",
    });
    expect(switchedWithHistory.status).toBe(200);
    const switchedBody = switchedWithHistory.body as {
      sourceLocked: boolean;
      definition: {
        source: string;
        metric: string;
        unit: string;
        rule: { completion: { value: number } };
      };
    };
    expect(switchedBody.sourceLocked).toBe(true);
    expect(switchedBody.definition.source).toBe("water");
    expect(switchedBody.definition.metric).toBe("water_ml");
    expect(switchedBody.definition.unit).toBe("ml");
    expect(switchedBody.definition.rule.completion.value).toBe(1000);
    expect(await call("getDay", { date: today, timeZone: "UTC" })).toMatchObject({
      status: 200,
      body: { personalGoalMl: 1000 },
    });
    const secondDetail = await call("goals/detail", { id: secondGoalId });
    expect(secondDetail.status).toBe(200);
    const secondBody = secondDetail.body as {
      definition: { rule: { kind: string; completion: { value: number } } };
      evaluation: { currentValue: number | null; achieved: boolean };
    };
    expect(secondBody.definition.rule.kind).toBe("recurring");
    expect(secondBody.definition.rule.completion.value).toBe(1000);
    expect(secondBody.evaluation.currentValue).toBe(150);
    expect(secondBody.evaluation.achieved).toBe(false);
  });

  test("unused contract reset covers the retained start date across a cutoff change", async () => {
    const now = new Date("2026-01-05T02:00:00.000Z");
    const startDate = "2026-01-01";
    await call("updatePreferences", { enabled: true });
    const goals = createPersonalGoalRepository(db, "org-a", "user-a", undefined, () => now);
    const manual = {
      id: "cutoff-contract-reset",
      title: "Cutoff contract reset",
      source: "manual",
      metric: "water_ml",
      unit: "ml",
      rule: { kind: "target", target: { kind: "minimum", value: 100 } },
      startDate,
      timeZone: "UTC",
      status: "active",
    };
    const created = await goals.create({
      definition: manual,
      clientMutationId: "00000000-0000-4000-8000-000000000096",
    });
    const water = {
      ...manual,
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: {
        kind: "recurring",
        cadence: "daily",
        completion: { kind: "minimum", value: 1000 },
      },
      dayCutoff: "04:00",
    };
    const updated = await goals.update({
      id: created.id,
      version: created.version,
      definition: water,
      clientMutationId: "00000000-0000-4000-8000-000000000097",
    });
    const detail = await goals.detail(created.id);
    const preferenceAtBoundary = await db.transaction((tx) =>
      reconcileWaterLink(tx, { organizationId: "org-a", userId: "user-a" }, { now }),
    );

    expect(updated.sourceLocked).toBe(false);
    expect(detail.definition.startDate).toBe(startDate);
    expect(detail.evaluation.asOf).toBe("2026-01-04");
    expect(detail.evaluation.achieved).toBe(false);
    expect(detail.history).toHaveLength(2);
    expect(detail.history[0]).toMatchObject({
      revision: 1,
      effectiveFrom: startDate,
      effectiveUntil: "2026-01-05",
      definition: { source: "manual", metric: "water_ml", unit: "ml" },
    });
    expect(detail.history[1]).toMatchObject({
      revision: 2,
      effectiveFrom: startDate,
      effectiveUntil: null,
      definition: {
        source: "water",
        metric: "water_ml",
        unit: "ml",
        dayCutoff: "04:00",
        rule: { kind: "recurring", completion: { kind: "minimum", value: 1000 } },
      },
    });
    // This is the canonical no-date current-target resolution used by
    // resolvePlainWaterGoal/getPreferences, with its existing `now` seam fixed
    // to the same boundary instant as the goal repository above. The HTTP
    // getPreferences call below uses the live clock and is only a wiring check.
    expect(preferenceAtBoundary).toEqual({ linkedGoalId: created.id, targetMl: 1000 });

    expect(await call("getPreferences", {})).toMatchObject({
      status: 200,
      body: { enabled: true, personalGoalMl: 1000 },
    });
    const added = await call("add", {
      quantity: 150,
      unit: "ml",
      observedAt: now.toISOString(),
      timeZone: "UTC",
      clientMutationId: "00000000-0000-4000-8000-000000000098",
    });
    expect(added.status).toBe(200);
    const afterWaterEntry = await goals.detail(created.id);
    expect(afterWaterEntry.sourceLocked).toBe(true);
    expect(afterWaterEntry.evaluation.currentValue).toBe(150);
    expect(afterWaterEntry.evaluation.achieved).toBe(false);
    const preferenceAfterEntryAtBoundary = await db.transaction((tx) =>
      reconcileWaterLink(tx, { organizationId: "org-a", userId: "user-a" }, { now }),
    );
    expect(preferenceAfterEntryAtBoundary).toEqual({ linkedGoalId: created.id, targetMl: 1000 });

    // The goal cutoff puts Jan 5 at 02:00 UTC in goal day Jan 4, but the diary
    // keeps its independent UTC-midnight buckets: the entry is in Jan 5.
    // Jan 4 is a historical diary read before this link's real creation time,
    // so it has neither entries nor a historical target.
    const jan4Diary = await call("getDay", { date: "2026-01-04", timeZone: "UTC" });
    expect(jan4Diary.status).toBe(200);
    expect(jan4Diary.body).toMatchObject({
      date: "2026-01-04",
      quantityMl: 0,
      personalGoalMl: null,
    });
    expect((jan4Diary.body as { entries: unknown[] }).entries).toHaveLength(0);

    const addedEntryId = (added.body as { entry: { id: number } }).entry.id;
    const jan5Diary = await call("getDay", { date: "2026-01-05", timeZone: "UTC" });
    expect(jan5Diary.status).toBe(200);
    const jan5Body = jan5Diary.body as {
      date: string;
      quantityMl: number;
      personalGoalMl: number | null;
      entries: Array<{ id: number; quantityMl: number | null; observedAt: string }>;
    };
    expect(jan5Body.date).toBe("2026-01-05");
    expect(jan5Body.quantityMl).toBe(150);
    expect(jan5Body.personalGoalMl).toBeNull();
    expect(jan5Body.entries).toHaveLength(1);
    const diaryEntry = jan5Body.entries.find((entry) => entry.id === addedEntryId);
    expect(diaryEntry?.id).toBe(addedEntryId);
    expect(diaryEntry?.quantityMl).toBe(150);
    expect(diaryEntry?.observedAt).toBe(now.toISOString());
  });

  test("water measurement round-trip installs and projects the latest contract baseline", async () => {
    await call("updatePreferences", { enabled: true });
    const today = new Date().toISOString().slice(0, 10);
    const water = {
      id: "water-contract-round-trip",
      title: "Water measurement round-trip",
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: {
        kind: "recurring",
        cadence: "daily",
        completion: { kind: "minimum", value: 500 },
      },
      startDate: today,
      timeZone: "UTC",
      status: "active",
    };
    const created = await call("goals/create", {
      definition: water,
      clientMutationId: "00000000-0000-4000-8000-000000000096",
    });
    expect(created.status).toBe(200);
    const goalId = (created.body as { id: number }).id;
    const manual = {
      ...water,
      source: "manual",
      metric: "amount",
      unit: "reps",
      rule: { kind: "target", target: { kind: "minimum", value: 100 } },
    };
    const changedToManual = await call("goals/update", {
      id: goalId,
      version: 1,
      definition: manual,
      clientMutationId: "00000000-0000-4000-8000-000000000097",
    });
    expect(changedToManual.status).toBe(200);
    const changedBackToWater = await call("goals/update", {
      id: goalId,
      version: 2,
      definition: {
        ...water,
        rule: {
          kind: "recurring",
          cadence: "daily",
          completion: { kind: "minimum", value: 1200 },
        },
      },
      clientMutationId: "00000000-0000-4000-8000-000000000098",
    });
    expect(changedBackToWater.status).toBe(200);
    expect(changedBackToWater.body).toMatchObject({
      sourceLocked: false,
      definition: { rule: { kind: "recurring", completion: { value: 1200 } } },
    });
    expect(await call("getDay", { date: today, timeZone: "UTC" })).toMatchObject({
      status: 200,
      body: { personalGoalMl: 1200 },
    });
  });
});
