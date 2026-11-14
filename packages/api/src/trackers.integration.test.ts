import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { executeTrackers } from "@openvalens/ai/tools/trackers";
import { ROLE_PERMISSION_PRESETS, isRole } from "@openvalens/auth/access/roles";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { deleteSubjectData } from "@openvalens/data-rights/delete";
import { exportSubjectData } from "@openvalens/data-rights/export";
import { createDb, sql, type Database } from "@openvalens/db";
import { createStructuredLogger } from "@openvalens/observability";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";

/**
 * `trackers.*` over HTTP against a disposable PostgreSQL (Issue #441):
 * private by default, shared trackers logged by collaborators with who logged
 * each entry, owner-only changes, type and unit locked after the first entry,
 * typed-confirmation delete, the timeline's member filter, the Coach's AI
 * switch, and data-rights export and erasure. Phone feeds (#452): one
 * tracker per feed, type checks, idempotent imports on the platform record id,
 * and unlinking that stops imports and keeps the entries.
 */

const url = process.env.TRACKERS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/trackers_test")
    throw new Error("Empty disposable loopback trackers_test database required.");
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

describe.skipIf(!url)("custom trackers over RPC and PostgreSQL", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/trackers_test" });
  const rpc = new RPCHandler(appRouter);

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
      correlationId: "corr-trackers",
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

  const create = (input: Record<string, unknown>, user = "user-a") =>
    call("trackers/create", input, user);
  const sauna = {
    template: "sauna",
    name: "Sauna (min)",
    icon: "flame",
    type: "duration",
    target: { value: 1200, period: "day" },
  };

  async function coachTrackerNames(userId: string, organizationId: string) {
    const result = await executeTrackers(
      {
        db,
        organizationId,
        userId,
        canReadRecords: async () => true,
        accessGate: async () => ({ allowed: true, includeNutritionNumbers: true }),
        logger: createStructuredLogger({ level: "error" }),
      },
      { days: 30 },
    );
    return result.status === "ok" ? result.trackers.map((tracker) => tracker.name) : [];
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

  test("a member creates Sauna (min), logs it, and sees it on the timeline, a 30-day chart and the export", async () => {
    const created = await create(sauna);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: "Sauna (min)",
      type: "duration",
      shared: false,
      aiVisible: true,
      locked: false,
      canEdit: true,
      owner: { userId: "user-a", name: "Ana", isYou: true },
    });
    const id = created.body.id as string;

    const logged = await call("trackers/log", { trackerId: id, value: 1500, timeZone: ZONE });
    expect(logged.status).toBe(200);
    expect(logged.body).toMatchObject({ value: 1500, loggedBy: { userId: "user-a", isYou: true } });
    await call("trackers/log", { trackerId: id, value: 300, timeZone: ZONE });

    const list = await call("trackers/list", { timeZone: ZONE });
    expect(list.body).toMatchObject([
      { id, today: 1800, locked: true, progress: { period: "day", target: 1200, met: true } },
    ]);

    const chart = await call("trackers/chart", { trackerId: id, days: 30, timeZone: ZONE });
    expect(chart.status).toBe(200);
    expect(chart.body.days).toHaveLength(30);
    expect(chart.body.days.at(-1)).toMatchObject({ value: 1800, count: 2 });
    expect(chart.body).toMatchObject({ loggedDays: 1, total: 1800, progress: { metCount: 1 } });

    const timeline = await call("timeline/list", { domain: "custom" });
    expect(timeline.status).toBe(200);
    expect(timeline.body.items).toHaveLength(2);
    expect(timeline.body.items[0]).toMatchObject({
      domain: "custom",
      title: "Sauna (min)",
      canonical: { table: "custom_tracker_entry", trackerId: id, trackerType: "duration" },
    });

    const exported = await exportSubjectData(db, { userId: "user-a", organizationIds: ["org-a"] });
    const trackers = exported.files.find((file) => file.path === "entities/custom_tracker.json");
    const entries = exported.files.find(
      (file) => file.path === "entities/custom_tracker_entry.json",
    );
    expect(JSON.parse(trackers!.content)).toMatchObject([{ id, name: "Sauna (min)" }]);
    expect(JSON.parse(entries!.content)).toHaveLength(2);
  });

  test("a private tracker is invisible to other members, the timeline of others, and other tenants", async () => {
    const id = (await create(sauna)).body.id as string;
    await call("trackers/log", { trackerId: id, value: 600, timeZone: ZONE });
    for (const user of ["user-b", "user-c", "user-d"]) {
      expect((await call("trackers/list", { timeZone: ZONE }, user)).body).toEqual([]);
      expect((await call("trackers/get", { id }, user)).status).toBe(404);
      expect((await call("trackers/entries", { trackerId: id }, user)).status).toBe(404);
      expect(
        (await call("trackers/chart", { trackerId: id, days: 30, timeZone: ZONE }, user)).status,
      ).toBe(404);
      // A viewer's role cannot write at all; the others are told it does not exist.
      expect(
        (await call("trackers/log", { trackerId: id, value: 60, timeZone: ZONE }, user)).status,
      ).toBe(user === "user-c" ? 403 : 404);
      const timeline = await call("timeline/list", {}, user);
      expect(timeline.body.items.filter((item: any) => item.domain === "custom")).toEqual([]);
    }
    // An impersonated session sees no tracker entries at all.
    const impersonated = await call("timeline/list", {}, "user-a", {
      "x-test-impersonated": "admin",
    });
    expect(impersonated.body.items.filter((item: any) => item.domain === "custom")).toEqual([]);
    expect(
      (
        await call("trackers/list", { timeZone: ZONE }, "user-a", {
          "x-test-impersonated": "admin",
        })
      ).status,
    ).toBe(403);
  });

  test("a shared tracker lets a collaborator log, records who logged, and only the owner changes it", async () => {
    const id = (await create({ ...sauna, shared: true })).body.id as string;
    const byCollaborator = await call(
      "trackers/log",
      { trackerId: id, value: 900, timeZone: ZONE, note: "synthetic" },
      "user-b",
    );
    expect(byCollaborator.status).toBe(200);
    expect(byCollaborator.body).toMatchObject({
      loggedBy: { userId: "user-b", name: "Bruno", isYou: true },
      canEdit: true,
    });

    // The viewer sees it but cannot log or change it.
    const asViewer = await call("trackers/list", { timeZone: ZONE }, "user-c");
    expect(asViewer.body).toMatchObject([{ id, canLog: false, canEdit: false }]);
    expect(
      (await call("trackers/log", { trackerId: id, value: 60, timeZone: ZONE }, "user-c")).status,
    ).toBe(403);
    const entriesForOwner = await call("trackers/entries", { trackerId: id });
    expect(entriesForOwner.body.entries).toMatchObject([
      { loggedBy: { userId: "user-b", name: "Bruno", isYou: false }, canEdit: true },
    ]);

    // Only the owner changes, archives or deletes the tracker.
    expect((await call("trackers/update", { id, name: "Mine now" }, "user-b")).status).toBe(403);
    expect((await call("trackers/update", { id, shared: false }, "user-b")).status).toBe(403);
    expect((await call("trackers/setArchived", { id, archived: true }, "user-b")).status).toBe(403);
    expect(
      (await call("trackers/delete", { id, confirmation: "Sauna (min)" }, "user-b")).status,
    ).toBe(403);

    // A collaborator's own entry stays theirs to change; others' are not.
    const ownerEntry = await call("trackers/log", { trackerId: id, value: 120, timeZone: ZONE });
    expect((await call("trackers/deleteEntry", { id: ownerEntry.body.id }, "user-b")).status).toBe(
      403,
    );
    expect(
      (
        await call(
          "trackers/updateEntry",
          { id: byCollaborator.body.id, value: 1000, timeZone: ZONE },
          "user-b",
        )
      ).body,
    ).toMatchObject({ value: 1000 });

    // Shared entries follow workspace roles on the timeline.
    const viewerTimeline = await call("timeline/list", { domain: "custom" }, "user-c");
    expect(viewerTimeline.body.items).toHaveLength(2);

    // Turning sharing off hides it from the others and deletes nothing.
    expect((await call("trackers/update", { id, shared: false })).body).toMatchObject({
      shared: false,
    });
    expect((await call("trackers/list", { timeZone: ZONE }, "user-b")).body).toEqual([]);
    expect((await call("trackers/entries", { trackerId: id }, "user-b")).status).toBe(404);
    expect((await call("timeline/list", { domain: "custom" }, "user-c")).body.items).toEqual([]);
    expect((await call("trackers/entries", { trackerId: id })).body.entries).toHaveLength(2);
  });

  test("type and unit lock after the first entry; name, icon and target always change", async () => {
    const created = await create({ name: "Pages", icon: "book", type: "number", unit: "pages" });
    const id = created.body.id as string;
    expect((await call("trackers/update", { id, unit: "chapters" })).body).toMatchObject({
      unit: "chapters",
    });
    await call("trackers/log", { trackerId: id, value: 12, timeZone: ZONE });
    expect((await call("trackers/update", { id, unit: "pages" })).status).toBe(409);
    expect((await call("trackers/update", { id, type: "scale" })).status).toBe(409);
    expect((await call("trackers/update", { id, aggregation: "average" })).status).toBe(409);
    expect(
      (
        await call("trackers/update", {
          id,
          name: "Books",
          icon: "star",
          target: { value: 20, period: "week" },
        })
      ).body,
    ).toMatchObject({ name: "Books", icon: "star", target: { value: 20, period: "week" } });
  });

  test("values are checked against the tracker type", async () => {
    const mood = (await create({ template: "mood", name: "Mood", icon: "smile", type: "scale" }))
      .body;
    expect(mood.aiVisible).toBe(false);
    for (const value of [0, 6, 2.5]) {
      expect(
        (await call("trackers/log", { trackerId: mood.id, value, timeZone: ZONE })).status,
      ).toBe(400);
    }
    expect(
      (await call("trackers/log", { trackerId: mood.id, value: 4, timeZone: ZONE })).status,
    ).toBe(200);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (
        await call("trackers/log", {
          trackerId: mood.id,
          value: 4,
          timeZone: ZONE,
          loggedAt: future,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("trackers/log", { trackerId: mood.id, value: 4, timeZone: "Mars/Olympus" }))
        .status,
    ).toBe(400);
    expect((await create({ ...sauna, userId: "user-b" })).status).toBe(400);
  });

  test("archive hides a tracker and keeps its data; 50 active trackers at most", async () => {
    const id = (await create(sauna)).body.id as string;
    await call("trackers/log", { trackerId: id, value: 60, timeZone: ZONE });
    await call("trackers/setArchived", { id, archived: true });
    expect((await call("trackers/list", { timeZone: ZONE })).body).toEqual([]);
    expect(
      (await call("trackers/list", { timeZone: ZONE, includeArchived: true })).body,
    ).toHaveLength(1);
    expect((await call("trackers/log", { trackerId: id, value: 60, timeZone: ZONE })).status).toBe(
      409,
    );
    expect((await call("trackers/entries", { trackerId: id })).body.entries).toHaveLength(1);

    for (let index = 0; index < 50; index += 1)
      expect((await create({ name: `T${index}`, icon: "check", type: "yes_no" })).status).toBe(200);
    expect((await create({ name: "One more", icon: "check", type: "yes_no" })).status).toBe(409);
    expect((await call("trackers/setArchived", { id, archived: false })).status).toBe(409);
  });

  test("delete needs the name typed back and erases the entries", async () => {
    const id = (await create(sauna)).body.id as string;
    await call("trackers/log", { trackerId: id, value: 60, timeZone: ZONE });
    expect((await call("trackers/delete", { id, confirmation: "sauna" })).status).toBe(400);
    expect((await call("trackers/delete", { id, confirmation: " Sauna (min) " })).body).toEqual({
      deleted: true,
      deletedEntries: 1,
    });
    const left = await db.execute(sql`select count(*)::int as n from custom_tracker_entry`);
    expect(left.rows[0]).toEqual({ n: 0 });
  });

  test("the Coach reads only the member's own trackers with AI on, and never notes", async () => {
    const visible = (await create(sauna)).body;
    const mood = (await create({ template: "mood", name: "Mood", icon: "smile", type: "scale" }))
      .body;
    await call("trackers/log", {
      trackerId: visible.id,
      value: 600,
      timeZone: ZONE,
      note: "secret-note",
    });
    await call("trackers/log", { trackerId: mood.id, value: 2, timeZone: ZONE });
    const shared = (await create({ ...sauna, name: "Bruno shared", shared: true }, "user-b")).body;
    await call("trackers/log", { trackerId: shared.id, value: 60, timeZone: ZONE }, "user-b");

    expect(await coachTrackerNames("user-a", "org-a")).toEqual(["Sauna (min)"]);
    // The collaborator's Coach sees their own tracker, never user-a's.
    expect(await coachTrackerNames("user-b", "org-a")).toEqual(["Bruno shared"]);
    expect(await coachTrackerNames("user-d", "org-b")).toEqual([]);

    const result = await executeTrackers(
      {
        db,
        organizationId: "org-a",
        userId: "user-a",
        canReadRecords: async () => true,
        accessGate: async () => ({ allowed: true, includeNutritionNumbers: true }),
        logger: createStructuredLogger({ level: "error" }),
      },
      { days: 30 },
    );
    expect(JSON.stringify(result)).not.toContain("secret-note");
    expect(result).toMatchObject({
      status: "ok",
      trackers: [{ name: "Sauna (min)", total: 10, target: { value: 20, per: "day" } }],
    });

    // Turning the switch off hides it at once.
    await call("trackers/update", { id: visible.id, aiVisible: false });
    expect(await coachTrackerNames("user-a", "org-a")).toEqual([]);
  });

  test("erasure covers both tables for the member only", async () => {
    const mine = (await create({ ...sauna, shared: true })).body.id as string;
    await call("trackers/log", { trackerId: mine, value: 60, timeZone: ZONE });
    await call("trackers/log", { trackerId: mine, value: 60, timeZone: ZONE }, "user-b");
    const theirs = (await create(sauna, "user-b")).body.id as string;
    await call("trackers/log", { trackerId: theirs, value: 60, timeZone: ZONE }, "user-b");

    await deleteSubjectData(db, { userId: "user-a", organizationIds: [] });
    const trackers = await db.execute(sql`select user_id from custom_tracker`);
    expect(trackers.rows).toEqual([{ user_id: "user-b" }]);
    const entries = await db.execute(sql`select user_id from custom_tracker_entry`);
    expect(entries.rows).toEqual([{ user_id: "user-b" }]);
  });

  // ─── Phone feeds (#452) ─────────────────────────────────────

  const meditation = {
    template: "meditation",
    name: "Meditation",
    icon: "leaf",
    type: "duration",
  };
  const mood = { template: "mood", name: "Mood", icon: "smile", type: "scale" };
  const session = (id: string, value = 600, loggedAt = "2026-11-10T07:00:00.000Z") => ({
    sourceRecordId: id,
    value,
    loggedAt,
  });
  const importFeed = (
    trackerId: string,
    entries: unknown[],
    feed = "healthkit_mindful_sessions",
    user = "user-a",
  ) => call("trackers/importFeed", { feed, trackerId, timeZone: ZONE, entries }, user);

  test("a linked feed imports once: re-importing the same records never duplicates", async () => {
    const id = (await create(meditation)).body.id as string;
    const linked = await call("trackers/linkFeed", {
      trackerId: id,
      feed: "healthkit_mindful_sessions",
    });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({
      feed: "healthkit_mindful_sessions",
      trackerId: id,
      trackerName: "Meditation",
      trackerArchived: false,
    });

    const first = await importFeed(id, [session("HK-1"), session("HK-2", 900)]);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ imported: 2, duplicates: 0, skipped: 0 });

    // The phone re-reads after a cursor reset, with one new session.
    const again = await importFeed(id, [
      session("HK-1"),
      session("HK-2", 900),
      session("HK-3", 300, "2026-11-10T21:00:00.000Z"),
    ]);
    expect(again.body).toEqual({ imported: 1, duplicates: 2, skipped: 0 });

    const rows = await db.execute(
      sql`select source, source_record_id, value, logged_by_user_id, local_date from custom_tracker_entry order by source_record_id`,
    );
    expect(rows.rows).toEqual([
      {
        source: "healthkit",
        source_record_id: "HK-1",
        value: 600,
        logged_by_user_id: "user-a",
        local_date: "2026-11-10",
      },
      {
        source: "healthkit",
        source_record_id: "HK-2",
        value: 900,
        logged_by_user_id: "user-a",
        local_date: "2026-11-10",
      },
      {
        source: "healthkit",
        source_record_id: "HK-3",
        value: 300,
        logged_by_user_id: "user-a",
        local_date: "2026-11-10",
      },
    ]);

    // A member's edit to an imported entry survives a re-import.
    const entries = await call("trackers/entries", { trackerId: id });
    const hk1 = entries.body.entries.find((entry: { value: number }) => entry.value === 600);
    expect(hk1.source).toBe("healthkit");
    await call("trackers/updateEntry", { id: hk1.id, value: 660, timeZone: ZONE });
    await importFeed(id, [session("HK-1")]);
    const kept = await db.execute(
      sql`select value from custom_tracker_entry where source_record_id = 'HK-1'`,
    );
    expect(kept.rows).toEqual([{ value: 660 }]);

    // Duplicates inside one batch count once.
    const inBatch = await importFeed(id, [session("HK-4"), session("HK-4")]);
    expect(inBatch.body).toEqual({ imported: 1, duplicates: 0, skipped: 0 });
  });

  test("the same record id from Health Connect is a different entry than from HealthKit", async () => {
    const id = (await create(meditation)).body.id as string;
    await call("trackers/linkFeed", { trackerId: id, feed: "healthkit_mindful_sessions" });
    await call("trackers/linkFeed", { trackerId: id, feed: "health_connect_mindfulness" });
    expect((await importFeed(id, [session("same-id")])).body.imported).toBe(1);
    expect(
      (await importFeed(id, [session("same-id")], "health_connect_mindfulness")).body.imported,
    ).toBe(1);
    const sources = await db.execute(sql`select source from custom_tracker_entry order by source`);
    expect(sources.rows).toEqual([{ source: "health_connect" }, { source: "healthkit" }]);
  });

  test("State of Mind fills a 1-5 tracker only; meditation feeds fill a duration tracker only", async () => {
    const moodId = (await create(mood)).body.id as string;
    const meditationId = (await create(meditation)).body.id as string;
    const sauna = (await create({ name: "Count", icon: "check", type: "number", unit: "x" })).body
      .id as string;
    expect(
      (
        await call("trackers/linkFeed", {
          trackerId: meditationId,
          feed: "healthkit_state_of_mind",
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("trackers/linkFeed", { trackerId: moodId, feed: "healthkit_mindful_sessions" }))
        .status,
    ).toBe(400);
    expect(
      (await call("trackers/linkFeed", { trackerId: sauna, feed: "health_connect_mindfulness" }))
        .status,
    ).toBe(400);

    expect(
      (await call("trackers/linkFeed", { trackerId: moodId, feed: "healthkit_state_of_mind" }))
        .status,
    ).toBe(200);
    // Moods stay off for AI reads, as the template set them.
    expect((await call("trackers/get", { id: moodId })).body.aiVisible).toBe(false);
    const result = await importFeed(
      moodId,
      [session("SOM-1", 4), session("SOM-2", 6), session("SOM-3", 2.5)],
      "healthkit_state_of_mind",
    );
    // Out-of-range values are skipped, not stored.
    expect(result.body).toEqual({ imported: 1, duplicates: 0, skipped: 2 });
  });

  test("one tracker per feed: linking another tracker moves it, and the first keeps its entries", async () => {
    const first = (await create(meditation)).body.id as string;
    const second = (await create({ ...meditation, name: "Breathing" })).body.id as string;
    await call("trackers/linkFeed", { trackerId: first, feed: "healthkit_mindful_sessions" });
    await importFeed(first, [session("HK-1")]);

    await call("trackers/linkFeed", { trackerId: second, feed: "healthkit_mindful_sessions" });
    const feeds = await call("trackers/feeds", undefined);
    expect(feeds.body).toEqual([
      expect.objectContaining({ feed: "healthkit_mindful_sessions", trackerId: second }),
    ]);
    // The old tracker no longer takes imports.
    expect((await importFeed(first, [session("HK-2")])).status).toBe(409);
    expect((await importFeed(second, [session("HK-2")])).body.imported).toBe(1);
    const counts = await db.execute(
      sql`select tracker_id, count(*)::int as n from custom_tracker_entry group by tracker_id order by tracker_id`,
    );
    expect(counts.rows).toHaveLength(2);
  });

  test("unlinking stops imports and keeps the imported entries", async () => {
    const id = (await create(meditation)).body.id as string;
    await call("trackers/linkFeed", { trackerId: id, feed: "healthkit_mindful_sessions" });
    await importFeed(id, [session("HK-1"), session("HK-2")]);

    const unlinked = await call("trackers/unlinkFeed", { feed: "healthkit_mindful_sessions" });
    expect(unlinked.body).toEqual({ unlinked: true });
    expect((await call("trackers/feeds", undefined)).body).toEqual([]);
    expect((await importFeed(id, [session("HK-3")])).status).toBe(409);
    const entries = await call("trackers/entries", { trackerId: id });
    expect(entries.body.entries).toHaveLength(2);

    // Unlinking with a tracker id that is not linked changes nothing.
    await call("trackers/linkFeed", { trackerId: id, feed: "healthkit_mindful_sessions" });
    const other = (await create({ ...meditation, name: "Other" })).body.id as string;
    expect(
      (
        await call("trackers/unlinkFeed", {
          feed: "healthkit_mindful_sessions",
          trackerId: other,
        })
      ).body,
    ).toEqual({ unlinked: false });
    expect((await call("trackers/feeds", undefined)).body).toHaveLength(1);
  });

  test("only the owner links and imports; never into another member's tracker", async () => {
    const id = (await create({ ...meditation, shared: true })).body.id as string;
    expect(
      (
        await call(
          "trackers/linkFeed",
          { trackerId: id, feed: "healthkit_mindful_sessions" },
          "user-b",
        )
      ).status,
    ).toBe(403);
    await call("trackers/linkFeed", { trackerId: id, feed: "healthkit_mindful_sessions" });
    expect((await importFeed(id, [session("HK-1")], undefined, "user-b")).status).toBe(403);
    expect((await importFeed(id, [session("HK-1")], undefined, "user-d")).status).toBe(404);
    // Another member's links are not theirs to see.
    expect((await call("trackers/feeds", undefined, "user-b")).body).toEqual([]);
    expect((await call("trackers/feeds", undefined, "user-c")).status).toBe(200);
  });

  test("an archived tracker takes no imports; deleting it removes the link", async () => {
    const id = (await create(meditation)).body.id as string;
    await call("trackers/linkFeed", { trackerId: id, feed: "healthkit_mindful_sessions" });
    await call("trackers/setArchived", { id, archived: true });
    expect((await call("trackers/feeds", undefined)).body).toMatchObject([
      { trackerId: id, trackerArchived: true },
    ]);
    expect((await importFeed(id, [session("HK-1")])).status).toBe(409);
    expect(
      (await call("trackers/linkFeed", { trackerId: id, feed: "healthkit_mindful_sessions" }))
        .status,
    ).toBe(409);
    await call("trackers/delete", { id, confirmation: "Meditation" });
    expect((await call("trackers/feeds", undefined)).body).toEqual([]);
  });

  test("feed links are exported and erased with the member", async () => {
    const id = (await create(meditation)).body.id as string;
    await call("trackers/linkFeed", { trackerId: id, feed: "healthkit_mindful_sessions" });
    const exported = await exportSubjectData(db, { userId: "user-a", organizationIds: ["org-a"] });
    const feeds = exported.files.find((file) => file.path === "entities/custom_tracker_feed.json");
    expect(JSON.parse(feeds!.content)).toMatchObject([
      { feed: "healthkit_mindful_sessions", tracker_id: id },
    ]);
    await deleteSubjectData(db, { userId: "user-a", organizationIds: [] });
    expect((await db.execute(sql`select 1 from custom_tracker_feed`)).rows).toEqual([]);
  });
});
