import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { executeGoals } from "@openvalens/ai/tools/goals";
import { executeTrackers } from "@openvalens/ai/tools/trackers";
import { ROLE_PERMISSION_PRESETS, isRole } from "@openvalens/auth/access/roles";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { deleteSubjectData } from "@openvalens/data-rights/delete";
import { exportSubjectData } from "@openvalens/data-rights/export";
import { createDb, sql, type Database } from "@openvalens/db";
import { createStructuredLogger } from "@openvalens/observability";
import { addDays, localDateIn } from "@openvalens/trackers/model";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { loadInsightEngineInput } from "./insights";
import { appRouter } from "./routers/index";

/**
 * `trackers.*` over HTTP against a disposable PostgreSQL (Issue #441):
 * private by default, shared trackers logged by collaborators with who logged
 * each entry, owner-only changes, type and unit locked after the first entry,
 * typed-confirmation delete, the timeline's member filter, the Coach's AI
 * switch, and data-rights export and erasure.
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
    // Goals restrict deleting their owner, so the organization (which
    // cascades to goals) goes first.
    await db.execute(sql`delete from organization`);
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

  // ─── Goals on trackers (#451) ───────────────────────────────

  let mutationSeq = 0;
  const mutationId = () =>
    `00000000-0000-4000-8000-${String((mutationSeq += 1)).padStart(12, "0")}`;
  const today = () => localDateIn(new Date(), ZONE);
  function trackerGoal(
    trackerId: string,
    rule: Record<string, unknown>,
    unit: string | null,
    extra: Record<string, unknown> = {},
  ) {
    return {
      id: "client-id",
      title: "Tracker goal",
      source: "tracker",
      metric: `tracker:${trackerId}`,
      unit,
      rule,
      startDate: addDays(today(), -1),
      timeZone: ZONE,
      status: "active",
      ...extra,
    };
  }
  const createGoal = (definition: unknown, user = "user-a") =>
    call("goals/create", { definition, clientMutationId: mutationId() }, user);
  const doneStreak = (targetDays: number) => ({
    kind: "streak",
    target: { kind: "minimum", value: 1 },
    targetDays,
  });

  test("a goal on a number tracker counts the day's entries combined the tracker's way", async () => {
    const reading = (await create({ name: "Reading", icon: "book", type: "number", unit: "pages" }))
      .body;
    await call("trackers/log", { trackerId: reading.id, value: 12, timeZone: ZONE });
    await call("trackers/log", { trackerId: reading.id, value: 10, timeZone: ZONE });

    const created = await createGoal(
      trackerGoal(
        reading.id,
        { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 20 } },
        "pages",
      ),
    );
    expect(created.status).toBe(200);
    expect(created.body.sourceLocked).toBe(true);
    expect(created.body.evaluation.days.at(-1)).toMatchObject({
      date: today(),
      state: "qualifies",
      value: 22,
    });
    const detail = await call("goals/detail", { id: created.body.id });
    expect(detail.status).toBe(200);
    expect(detail.body.evidence).toEqual([
      expect.objectContaining({ source: "tracker", dateOnly: today(), value: 22 }),
    ]);

    // A new entry updates the goal on the next read.
    await call("trackers/log", { trackerId: reading.id, value: 3, timeZone: ZONE });
    const listed = await call("goals/list", {});
    expect(listed.body[0].evaluation.days.at(-1)).toMatchObject({ value: 25 });

    // Goals stay owner-only: another member of the workspace never sees it.
    expect((await call("goals/detail", { id: created.body.id }, "user-b")).status).toBe(404);
    expect((await call("goals/list", {}, "user-b")).body).toEqual([]);

    // The unit must be the tracker's.
    expect(
      (
        await createGoal(
          trackerGoal(reading.id, { kind: "target", target: { kind: "minimum", value: 5 } }, "kg"),
        )
      ).status,
    ).toBe(400);
  });

  test("only the member's own trackers can back a goal, even a shared one", async () => {
    const shared = (await create({ ...sauna, name: "Bruno sauna", shared: true }, "user-b")).body;
    expect(
      (
        await createGoal(
          trackerGoal(shared.id, { kind: "target", target: { kind: "minimum", value: 20 } }, "min"),
        )
      ).status,
    ).toBe(400);
    const elsewhere = (await create(sauna, "user-d")).body;
    expect((await createGoal(trackerGoal(elsewhere.id, doneStreak(3), "min"))).status).toBe(400);
  });

  test("duration goals compare minutes; a 1-5 scale only gets a logged-it streak", async () => {
    const saunaId = (await create(sauna)).body.id as string;
    await call("trackers/log", { trackerId: saunaId, value: 900, timeZone: ZONE });
    await call("trackers/log", { trackerId: saunaId, value: 600, timeZone: ZONE });
    const minutes = await createGoal(
      trackerGoal(saunaId, { kind: "target", target: { kind: "minimum", value: 20 } }, "min"),
    );
    expect(minutes.status).toBe(200);
    expect(minutes.body.evaluation).toMatchObject({ achieved: true, currentValue: 25 });

    const mood = (await create({ template: "mood", name: "Mood", icon: "smile", type: "scale" }))
      .body;
    await call("trackers/log", { trackerId: mood.id, value: 2, timeZone: ZONE });
    for (const rule of [
      { kind: "average", target: { kind: "minimum", value: 4 }, windowDays: 7 },
      { kind: "target", target: { kind: "minimum", value: 4 } },
      { kind: "recurring", cadence: "daily" },
      { kind: "streak", target: { kind: "minimum", value: 4 }, targetDays: 3 },
    ])
      expect((await createGoal(trackerGoal(mood.id, rule, null))).status).toBe(400);
    const streak = await createGoal(trackerGoal(mood.id, doneStreak(5), null));
    expect(streak.status).toBe(200);
    expect(streak.body.evaluation.days.at(-1)).toMatchObject({ state: "qualifies", value: null });
    expect(streak.body.evaluation.currentStreak).toBe(1);

    // An edit cannot reach a value rule either.
    expect(
      (
        await call("goals/update", {
          id: streak.body.id,
          version: streak.body.version,
          definition: trackerGoal(
            mood.id,
            {
              kind: "average",
              target: { kind: "minimum", value: 4 },
            },
            null,
          ),
          clientMutationId: mutationId(),
        })
      ).status,
    ).toBe(400);
  });

  test("yes/no goals count yes days; a no-only day does not qualify", async () => {
    const flossed = (
      await create({ template: "flossed", name: "Flossed", icon: "sparkles", type: "yes_no" })
    ).body;
    const yesterday = addDays(today(), -1);
    await call("trackers/log", {
      trackerId: flossed.id,
      value: 0,
      timeZone: ZONE,
      loggedAt: `${yesterday}T12:00:00+00:00`,
    });
    await call("trackers/log", { trackerId: flossed.id, value: 0, timeZone: ZONE });
    await call("trackers/log", { trackerId: flossed.id, value: 1, timeZone: ZONE });
    expect(
      (
        await createGoal(
          trackerGoal(
            flossed.id,
            { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 1 } },
            null,
          ),
        )
      ).status,
    ).toBe(400);
    const goal = await createGoal(
      trackerGoal(flossed.id, { kind: "recurring", cadence: "daily" }, null),
    );
    expect(goal.status).toBe(200);
    expect(
      goal.body.evaluation.days.map((day: { date: string; state: string }) => [
        day.date,
        day.state,
      ]),
    ).toEqual([
      [yesterday, "does-not-qualify"],
      [today(), "qualifies"],
    ]);
  });

  test("tracker goals count toward goal progress, and AI-private ones stay away from the Coach", async () => {
    const mood = (await create({ template: "mood", name: "Mood", icon: "smile", type: "scale" }))
      .body;
    expect(mood.aiVisible).toBe(false);
    await call("trackers/log", { trackerId: mood.id, value: 3, timeZone: ZONE });
    const goal = await createGoal({
      ...trackerGoal(mood.id, doneStreak(4), null),
      title: "Mood check-in streak",
    });
    expect(goal.status).toBe(200);

    const input = await loadInsightEngineInput(
      db,
      { organizationId: "org-a", userId: "user-a" },
      { weight: false, goals: true },
      today(),
    );
    expect(input.goals?.result).toMatchObject({
      status: "available",
      score: 25,
      goals: [
        {
          goalId: goal.body.id,
          title: "Mood check-in streak",
          state: "scored",
          currentValue: 1,
          targetValue: 4,
        },
      ],
    });
    // Another member's goal progress never includes it.
    const other = await loadInsightEngineInput(
      db,
      { organizationId: "org-a", userId: "user-b" },
      { weight: false, goals: true },
      today(),
    );
    expect(other.goals?.result.goals).toEqual([]);

    // A goal on a tracker with the AI switch on reaches the goals tool (#500).
    const reading = (await create({ name: "Reading", icon: "book", type: "number", unit: "pages" }))
      .body;
    expect(reading.aiVisible).toBe(true);
    const readable = await createGoal({
      ...trackerGoal(
        reading.id,
        { kind: "target", target: { kind: "minimum", value: 20 } },
        "pages",
      ),
      title: "Read 20 pages",
    });
    expect(readable.status).toBe(200);

    const goalsWith = async (grant: { trackers?: boolean }) =>
      executeGoals(
        {
          db,
          organizationId: "org-a",
          userId: "user-a",
          canReadRecords: async () => true,
          accessGate: async () => ({ allowed: true, includeNutritionNumbers: true, ...grant }),
          logger: createStructuredLogger({ level: "error" }),
        },
        {},
      );
    const withScope = await goalsWith({ trackers: true });
    expect(withScope).toMatchObject({
      status: "ok",
      goals: [{ title: "Read 20 pages", source: "tracker", unit: "pages" }],
    });
    expect(JSON.stringify(withScope)).not.toContain("Mood check-in streak");
    // A connected AI app without trackers:read sees no tracker goal at all.
    const withoutScope = await goalsWith({});
    expect(JSON.stringify(withoutScope)).not.toMatch(/Read 20 pages|Mood check-in streak/);
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
});
