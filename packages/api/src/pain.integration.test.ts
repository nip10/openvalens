import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { executePain } from "@openvalens/ai/tools/pain";
import { ROLE_PERMISSION_PRESETS, isRole } from "@openvalens/auth/access/roles";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { deleteSubjectData } from "@openvalens/data-rights/delete";
import { exportSubjectData } from "@openvalens/data-rights/export";
import { createDb, sql, type Database } from "@openvalens/db";
import { createMcpDataSources } from "@openvalens/mcp/sources";
import { findTool, toolsForScopes } from "@openvalens/mcp/tools";
import { createStructuredLogger } from "@openvalens/observability";
import { addDays, localDateIn } from "@openvalens/pain/model";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";

/**
 * `pain.*` over HTTP against a disposable PostgreSQL (Issue #442): the
 * acceptance flow (left knee, 4/10, ache, with the previous day's run), the
 * member-only boundary (other members, other tenants, impersonation), the
 * separate AI switch and the `pain:read` scope for the Coach and MCP, turning
 * the log off, and data-rights export and erasure.
 */

const url = process.env.PAIN_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/pain_test")
    throw new Error("Empty disposable loopback pain_test database required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-a", role: "viewer" },
  "user-d": { org: "org-b", role: "owner" },
};
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: `Name ${id}` },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          impersonatedBy: headers.get("x-test-impersonated") ?? null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      const member = MEMBERS[id];
      return member
        ? { id: `m-${id}`, userId: id, organizationId: member.org, role: member.role }
        : null;
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actor(headers)]?.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const role = MEMBERS[actor(headers)]?.role;
      if (!isRole(role)) return { success: false };
      const matrix = ROLE_PERMISSION_PRESETS[role] as unknown as Record<
        string,
        Record<string, boolean>
      >;
      const success = Object.entries(body.permissions).every(([resource, actions]) =>
        actions.every((action) => matrix[resource]?.[action] === true),
      );
      return { success };
    },
  },
} as unknown as Auth;

const ZONE = "Europe/Lisbon";
const IMPERSONATED = { "x-test-impersonated": "admin" };

describe.skipIf(!url)("pain log over RPC and PostgreSQL", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/pain_test" });
  const rpc = new RPCHandler(appRouter);
  const logger = createStructuredLogger({ level: "error" });

  async function migrate() {
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const folder of (await readdir(root)).sort()) {
      if (!/^\d/.test(folder)) continue;
      const contents = await Bun.file(new URL(`${folder}/migration.sql`, root)).text();
      for (const statement of contents.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }

  function contextFor(headers: Headers): Context {
    const id = actor(headers);
    return {
      session: MEMBERS[id]
        ? {
            user: { id },
            session: {
              id: `s-${id}`,
              userId: id,
              activeOrganizationId: MEMBERS[id]!.org,
              impersonatedBy: headers.get("x-test-impersonated") ?? null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-pain",
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

  async function call(
    path: string,
    input: unknown,
    user = "user-a",
    extra: Record<string, string> = {},
  ) {
    const headers = new Headers({
      "content-type": "application/json",
      "x-test-user": user,
      ...extra,
    });
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error(`unmatched RPC path ${path}`);
    const body = (await response.json()) as { json: unknown };
    return { status: response.status, body: body.json as any };
  }

  const turnOn = (user = "user-a") => call("pain/setPreference", { enabled: true }, user);
  const logKnee = (user = "user-a", extra: Record<string, unknown> = {}) =>
    call(
      "pain/log",
      {
        regions: ["joint.knee_left"],
        rating: 4,
        type: "ache",
        timeZone: ZONE,
        note: "stairs-note-secret",
        ...extra,
      },
      user,
    );
  const map = (user = "user-a", extra: Record<string, string> = {}) =>
    call("pain/map", { days: 7, timeZone: ZONE }, user, extra);
  const history = (user = "user-a", region = "joint.knee_left") =>
    call("pain/history", { region, timeZone: ZONE }, user);
  const timelinePain = async (user = "user-a", extra: Record<string, string> = {}) =>
    ((await call("timeline/list", {}, user, extra)).body.items as any[]).filter(
      (item) => item.domain === "pain",
    );

  function coach(userId: string, organizationId: string, trustedSelf = true) {
    return executePain(
      {
        db,
        organizationId,
        userId,
        canReadRecords: async () => true,
        // Stands in for the Coach consent gates, as in the trackers suite.
        accessGate: async () => ({ allowed: true, includeNutritionNumbers: true }),
        trustedSelf,
        logger,
      },
      { days: 30 },
    );
  }

  async function mcpEntries(scopes: string[], withRange = true) {
    const tool = findTool("pain.entries")!;
    if (!toolsForScopes(["records:read", ...scopes]).includes(tool)) return null;
    const today = localDateIn(new Date(), ZONE);
    const run = await tool.run(
      {
        db,
        principal: {
          grantId: "grant-a",
          kind: "personal_key",
          userId: "user-a",
          organizationId: "org-a",
          scopes: ["records:read", ...scopes],
          label: "Test",
        },
        sources: createMcpDataSources(db, async () => []),
        now: new Date(),
        timeZone: ZONE,
        units: "metric",
        logger,
      },
      withRange ? { from: addDays(today, -30), to: today } : {},
    );
    return (run.result as { entries: Array<Record<string, unknown>> }).entries;
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
    await db.execute(sql`delete from workout`);
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(sql`insert into "user" (id, email, name) values
      ('user-a', 'user-a@example.test', 'Ana'), ('user-b', 'user-b@example.test', 'Bruno'),
      ('user-c', 'user-c@example.test', 'Carla'), ('user-d', 'user-d@example.test', 'Duarte')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-a', 'Synthetic A', 'synthetic-a'), ('org-b', 'Synthetic B', 'synthetic-b')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', 'org-a', 'user-a', 'owner'), ('m-b', 'org-a', 'user-b', 'collaborator'),
      ('m-c', 'org-a', 'user-c', 'viewer'), ('m-d', 'org-b', 'user-d', 'owner')`);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("a member logs left knee, 4/10, ache and sees it on the pain layer, in the knee's history with the previous day's run, on the timeline and in the export", async () => {
    // Off by default: nothing to read, and logging is refused.
    expect((await call("pain/preference", {})).body).toEqual({ enabled: false, aiVisible: false });
    expect((await logKnee()).status).toBe(409);
    expect((await map()).body).toMatchObject({ enabled: false, regions: [] });

    expect((await turnOn()).body).toEqual({ enabled: true, aiVisible: false });
    const today = localDateIn(new Date(), ZONE);
    await db.execute(sql`insert into workout (organization_id, user_id, date, type, duration, created_at)
      values ('org-a', 'user-a', ${addDays(today, -1)}, 'running', 50, now()),
             ('org-a', 'user-a', ${addDays(today, -5)}, 'cycling', 60, now()),
             ('org-a', 'user-b', ${addDays(today, -1)}, 'tennis', 60, now())`);

    const logged = await logKnee();
    expect(logged.status).toBe(200);
    expect(logged.body).toMatchObject([
      { region: "joint.knee_left", rating: 4, type: "ache", localDate: today },
    ]);

    const layer = await map();
    expect(layer.body).toMatchObject({
      enabled: true,
      to: today,
      from: addDays(today, -6),
      regions: [{ region: "joint.knee_left", highest: 4, entryCount: 1 }],
    });

    const knee = await history();
    expect(knee.status).toBe(200);
    expect(knee.body.entries).toHaveLength(1);
    // Only the member's own run the day before; not the older ride or another member's game.
    expect(knee.body.entries[0].workoutsBefore).toEqual([
      expect.objectContaining({ type: "running", durationMinutes: 50, daysBefore: 1 }),
    ]);

    const timeline = await timelinePain();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      domain: "pain",
      canonical: { table: "pain_entry", region: "joint.knee_left", rating: 4, type: "ache" },
    });
    // The timeline pages past a pain entry with its cursor.
    await call("pain/log", { regions: ["joint.neck"], rating: 2, timeZone: ZONE });
    const page = await call("timeline/list", { limit: 1 });
    expect(page.body.nextCursor).toMatch(/\|pain_entry:/);
    const next = await call("timeline/list", { cursor: page.body.nextCursor });
    expect(next.status).toBe(200);
    expect(next.body.items).toHaveLength(1);

    const exported = await exportSubjectData(db, { userId: "user-a", organizationIds: ["org-a"] });
    const entries = exported.files.find((file) => file.path === "entities/pain_entry.json");
    const preference = exported.files.find((file) => file.path === "entities/pain_preference.json");
    expect(JSON.parse(entries!.content)).toHaveLength(2);
    expect(JSON.parse(preference!.content)).toMatchObject([{ enabled: true }]);
  });

  test("several regions make one entry each; ratings, regions and times are checked", async () => {
    await turnOn();
    const several = await call("pain/log", {
      regions: ["joint.knee_left", "joint.knee_right", "back.lower_back_left"],
      rating: 2,
      timeZone: ZONE,
    });
    expect(several.body).toHaveLength(3);
    expect(several.body.every((entry: any) => entry.type === null && entry.note === null)).toBe(
      true,
    );
    for (const input of [
      { regions: ["joint.knee_left"], rating: 11, timeZone: ZONE },
      { regions: ["joint.knee_left"], rating: -1, timeZone: ZONE },
      { regions: ["joint.knee_left"], rating: 2.5, timeZone: ZONE },
      { regions: ["joint.tail"], rating: 2, timeZone: ZONE },
      { regions: [], rating: 2, timeZone: ZONE },
      { regions: ["joint.neck", "joint.neck"], rating: 2, timeZone: ZONE },
      { regions: ["joint.neck"], rating: 2, type: "stabbing", timeZone: ZONE },
      { regions: ["joint.neck"], rating: 2, timeZone: "Mars/Olympus" },
      {
        regions: ["joint.neck"],
        rating: 2,
        timeZone: ZONE,
        loggedAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      { regions: ["joint.neck"], rating: 2, timeZone: ZONE, userId: "user-b" },
    ])
      expect([input, (await call("pain/log", input)).status]).toEqual([input, 400]);
    // A rating with a past time lands on that day; the 30-day layer still shows it.
    const earlier = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await call("pain/log", {
      regions: ["joint.neck"],
      rating: 7,
      timeZone: ZONE,
      loggedAt: earlier,
    });
    expect((await map()).body.regions.map((row: any) => row.region)).not.toContain("joint.neck");
    const thirty = await call("pain/map", { days: 30, timeZone: ZONE });
    expect(thirty.body.regions).toContainEqual(
      expect.objectContaining({ region: "joint.neck", highest: 7 }),
    );
  });

  test("other members, other tenants and impersonated sessions never see a member's pain log", async () => {
    await turnOn();
    const id = (await logKnee()).body[0].id as string;
    for (const user of ["user-b", "user-c", "user-d"]) {
      // Each sees only their own (empty, off) pain log.
      expect((await map(user)).body).toMatchObject({ enabled: false, regions: [] });
      expect((await history(user)).body.entries).toEqual([]);
      expect(await timelinePain(user)).toEqual([]);
    }
    // Even with their own log on, another member reads only their own rows.
    await turnOn("user-b");
    expect((await map("user-b")).body.regions).toEqual([]);
    expect((await history("user-b")).body.entries).toEqual([]);
    expect((await call("pain/delete", { id }, "user-b")).status).toBe(404);
    // A viewer's role cannot write at all.
    expect((await call("pain/delete", { id }, "user-c")).status).toBe(403);
    // The owner of the workspace cannot read a collaborator's log either.
    await logKnee("user-b", { rating: 8 });
    expect((await map()).body.regions).toEqual([
      expect.objectContaining({ region: "joint.knee_left", highest: 4 }),
    ]);

    // An impersonating admin gets nothing: no procedure, no timeline row.
    for (const [path, input] of [
      ["pain/preference", {}],
      ["pain/map", { days: 7, timeZone: ZONE }],
      ["pain/history", { region: "joint.knee_left", timeZone: ZONE }],
      ["pain/setPreference", { enabled: false }],
      ["pain/delete", { id }],
    ] as const)
      expect([path, (await call(path, input, "user-a", IMPERSONATED)).status]).toEqual([path, 403]);
    expect(await timelinePain("user-a", IMPERSONATED)).toEqual([]);
    expect(await coach("user-a", "org-a", false)).toMatchObject({ status: "unavailable" });
  });

  test("Coach and MCP read the pain log only with its AI switch on and the pain:read scope", async () => {
    await turnOn();
    await logKnee();
    await turnOn("user-b");
    await call("pain/setPreference", { aiVisible: true }, "user-b");
    await logKnee("user-b", { rating: 9 });

    // The AI switch is off by default.
    expect(await coach("user-a", "org-a")).toMatchObject({ status: "no_data" });
    expect(await mcpEntries(["pain:read"])).toEqual([]);
    // No scope, no tool.
    expect(await mcpEntries([])).toBeNull();
    expect(toolsForScopes(["records:read"]).map((tool) => tool.name)).not.toContain("pain.entries");

    expect((await call("pain/setPreference", { aiVisible: true })).body).toEqual({
      enabled: true,
      aiVisible: true,
    });
    const result = await coach("user-a", "org-a");
    expect(result).toMatchObject({
      status: "ok",
      entries: [{ region: "Left knee", rating: 4, outOf: 10, type: "ache" }],
    });
    // Never notes, never another member's rows.
    expect(JSON.stringify(result)).not.toContain("stairs-note-secret");
    expect(result.status === "ok" && result.entries).toHaveLength(1);
    // Impersonated sessions never reach it, AI switch or not.
    expect(await coach("user-a", "org-a", false)).toMatchObject({ status: "unavailable" });

    const entries = await mcpEntries(["pain:read"]);
    expect(entries).toEqual([
      expect.objectContaining({ region: "joint.knee_left", regionName: "Left knee", rating: 4 }),
    ]);
    expect(JSON.stringify(entries)).not.toContain("stairs-note-secret");
    expect(JSON.stringify(await mcpEntries(["pain:read", "notes:read"]))).toContain(
      "stairs-note-secret",
    );

    // Turning the switch off hides it at once.
    await call("pain/setPreference", { aiVisible: false });
    expect(await coach("user-a", "org-a")).toMatchObject({ status: "no_data" });
    expect(await mcpEntries(["pain:read"])).toEqual([]);
  });

  test("turning the pain log off hides it everywhere and deletes nothing", async () => {
    await turnOn();
    await logKnee();
    await call("pain/setPreference", { aiVisible: true });

    expect((await call("pain/setPreference", { enabled: false })).body).toEqual({
      enabled: false,
      aiVisible: true,
    });
    expect((await map()).body).toMatchObject({ enabled: false, regions: [] });
    expect((await history()).body).toMatchObject({ enabled: false, entries: [] });
    expect(await timelinePain()).toEqual([]);
    expect(await coach("user-a", "org-a")).toMatchObject({ status: "no_data" });
    expect(await mcpEntries(["pain:read"])).toEqual([]);
    expect((await logKnee()).status).toBe(409);
    const kept = await db.execute(sql`select count(*)::int as n from pain_entry`);
    expect(kept.rows[0]).toEqual({ n: 1 });

    await turnOn();
    expect((await map()).body.regions).toHaveLength(1);
  });

  test("a member deletes their own rating", async () => {
    await turnOn();
    const id = (await logKnee()).body[0].id as string;
    expect((await call("pain/delete", { id })).body).toEqual({ deleted: true });
    expect((await call("pain/delete", { id })).status).toBe(404);
    expect((await history()).body.entries).toEqual([]);
  });

  test("erasure removes the member's entries and opt-in, and no one else's", async () => {
    await turnOn();
    await logKnee();
    await turnOn("user-b");
    await logKnee("user-b");

    await deleteSubjectData(db, { userId: "user-a", organizationIds: [] });
    const entries = await db.execute(sql`select user_id from pain_entry`);
    expect(entries.rows).toEqual([{ user_id: "user-b" }]);
    const preferences = await db.execute(sql`select user_id from pain_preference`);
    expect(preferences.rows).toEqual([{ user_id: "user-b" }]);
  });
});
