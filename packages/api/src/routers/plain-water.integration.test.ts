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
  async function call(path: string, input: unknown, user = "user-a", impersonated?: string) {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    if (impersonated) headers.set("x-test-impersonated", impersonated);
    const request = new Request(`http://test.local/rpc/plainWater/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched plainWater RPC path");
    const body = (await response.json()) as { json?: unknown; message?: string };
    return { status: response.status, body: body.json ?? body };
  }
  function contextFor(headers: Headers): Context {
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
      db,
      correlationId: "corr-water",
      cronSecret: "synthetic-cron-secret-long-enough",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "synthetic", connectTokenTtlSeconds: 600 },
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

  test("default opt-out, own goal set/clear, create and all display responses hide quantities", async () => {
    expect(await call("getPreferences", {})).toMatchObject({
      status: 200,
      body: { enabled: false, personalGoalMl: null },
    });
    expect(
      await call("updatePreferences", {
        personalGoal: 1500,
        personalGoalUnit: "ml",
        enabled: true,
      }),
    ).toMatchObject({ status: 200 });
    expect(await call("updatePreferences", { personalGoal: null })).toMatchObject({ status: 200 });
    const add = await call("add", {
      quantity: 999,
      unit: "ml",
      observedAt: "2026-03-29T01:00:00Z",
      timeZone: "Europe/Lisbon",
      clientMutationId: "add-1",
    });
    expect(add.status).toBe(200);
    expect(JSON.stringify(add.body)).not.toContain("999");
    expect(JSON.stringify(add.body)).not.toContain('quantityMl":999');
    const id = (add.body as { entry: { id: number } }).entry.id;
    const day = await call("getDay", { date: "2026-03-29", timeZone: "Europe/Lisbon" });
    expect(day.body).toMatchObject({
      label: "Plain water subtotal",
      enabled: true,
      quantityMl: null,
      personalGoalMl: null,
    });
    expect(JSON.stringify(day.body)).not.toContain("999");
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
    ).not.toContain("999");
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
      entry: { quantityMl: null },
    });
    expect((await call("change", editInput)).body).toMatchObject({
      outcome: "replayed",
      entry: { quantityMl: null },
    });
    const conflict = await call("change", {
      ...editInput,
      clientMutationId: "stale-1",
      expectedRevision: 1,
      quantity: 400,
    });
    expect(conflict.body).toMatchObject({ outcome: "conflict", entry: { quantityMl: null } });
    expect(JSON.stringify(conflict.body)).not.toContain("500");
    const deleted = { id, expectedRevision: 2, clientMutationId: "delete-1" };
    expect((await call("delete", deleted)).body).toMatchObject({
      outcome: "applied",
      entry: { deleted: true, quantityMl: null },
    });
    expect((await call("delete", deleted)).body).toMatchObject({
      outcome: "replayed",
      entry: { quantityMl: null },
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
    expect(
      (await call("getDay", { date: "2026-03-29", timeZone: "UTC", userId: "user-a" })).status,
    ).not.toBe(200);
    expect((await call("getPreferences", {}, "user-b", "user-a")).status).not.toBe(200);
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
        )
      ).status,
    ).not.toBe(200);
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
