import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLE_PERMISSION_PRESETS, isRole } from "@openvalens/auth/access/roles";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { englishI18n } from "@openvalens/i18n/testing";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import {
  groupTimelineByDay,
  sourceLabel,
  timelineSummary,
  timelineTitle,
  type TimelineItemLike,
} from "./presenters/timeline";
import { appRouter } from "./routers/index";

/**
 * `timeline.list` over HTTP against a disposable PostgreSQL (Issue #493):
 * plain water, supplement intakes and logged workouts appear with their
 * source, only for the member who logged them, and leave with their module,
 * their read permission, the water card, or an impersonated session.
 * Hide-numbers mode drops the water amounts. Synthetic data only.
 */

const url = process.env.TIMELINE_DIARIES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/timeline_diaries_test"
  )
    throw new Error("Empty disposable loopback timeline_diaries_test database required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-d": { org: "org-b", role: "owner" },
};
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
/** Resources the test denies on top of the role preset (a reduced custom role). */
const denied = (headers: Headers) => (headers.get("x-test-deny") ?? "").split(",");
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
      const success = Object.entries(body.permissions).every(
        ([resource, actions]) =>
          !denied(headers).includes(resource) &&
          actions.every((action) => matrix[resource]?.[action] === true),
      );
      return { success };
    },
  },
} as unknown as Auth;

const IMPERSONATED = { "x-test-impersonated": "admin" };
type Item = TimelineItemLike & { canonical: Record<string, unknown> };

describe.skipIf(!url)("water, supplement intakes and workouts on the timeline", () => {
  const db: Database = createDb({
    DATABASE_URL: url ?? "postgres://127.0.0.1/timeline_diaries_test",
  });
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
      correlationId: "corr-timeline-diaries",
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

  /** The three new kinds on the viewer's timeline, plus device workouts. */
  async function diaries(user = "user-a", extra: Record<string, string> = {}) {
    const page = await call("timeline/list", { limit: 200 }, user, extra);
    expect(page.status).toBe(200);
    return (page.body.items as Item[]).filter(
      (item) =>
        /^(plain_water_entry|supplement_intake|workout):/.test(item.id) ||
        (item.id.startsWith("health_event:") && item.canonical.type === "workout"),
    );
  }
  const ids = (items: Item[]) => items.map((item) => item.id.split(":")[0]).sort();
  const modules = (user: string, enabled: string[] | null) =>
    db.execute(
      sql`insert into wellness_profile (user_id, enabled_modules) values (${user}, ${enabled === null ? null : sql`${`{${enabled.join(",")}}`}::text[]`})
          on conflict (user_id) do update set enabled_modules = excluded.enabled_modules`,
    );

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
  });

  beforeEach(async () => {
    for (const table of [
      "supplement_intake",
      "workout",
      "health_event",
      "supplement",
      "plain_water_entry",
      "plain_water_preference",
      "nutrition_target_settings",
      "wellness_profile",
      "weekly_review",
    ])
      await db.execute(sql.raw(`delete from ${table}`));
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(sql`insert into "user" (id, email, name) values
      ('user-a', 'user-a@example.test', 'Ana'), ('user-b', 'user-b@example.test', 'Bruno'),
      ('user-d', 'user-d@example.test', 'Duarte')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-a', 'Synthetic A', 'synthetic-a'), ('org-b', 'Synthetic B', 'synthetic-b')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', 'org-a', 'user-a', 'owner'), ('m-b', 'org-a', 'user-b', 'collaborator'),
      ('m-d', 'org-b', 'user-d', 'owner')`);
    await db.execute(sql`insert into plain_water_preference (organization_id, user_id, enabled) values
      ('org-a', 'user-a', true), ('org-a', 'user-b', true), ('org-b', 'user-d', true)`);
    await db.execute(sql`insert into plain_water_entry
      (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id, deleted_at) values
      ('org-a', 'user-a', 250, '2026-10-01T08:00:00Z', 'Europe/Lisbon', 'water-a-1', null),
      ('org-a', 'user-a', 999, '2026-10-01T09:00:00Z', 'Europe/Lisbon', 'water-a-deleted', now()),
      ('org-a', 'user-b', 300, '2026-10-01T08:30:00Z', 'Europe/Lisbon', 'water-b-1', null),
      ('org-b', 'user-d', 400, '2026-10-01T08:30:00Z', 'Europe/Lisbon', 'water-d-1', null)`);
    const [magnesium] = (
      await db.execute(sql`insert into supplement (name) values ('Magnesium') returning id`)
    ).rows as Array<{ id: number }>;
    await db.execute(sql`insert into supplement_intake
      (organization_id, user_id, supplement_id, occurred_at, timezone, dose, deleted_at) values
      ('org-a', 'user-a', ${magnesium!.id}, '2026-10-01T10:00:00Z', 'Europe/Lisbon', '1 cap', null),
      ('org-a', 'user-a', ${magnesium!.id}, '2026-10-01T10:05:00Z', 'Europe/Lisbon', '2 caps', now()),
      ('org-a', 'user-b', ${magnesium!.id}, '2026-10-01T10:00:00Z', 'Europe/Lisbon', '1 cap', null)`);
    await db.execute(sql`insert into workout (organization_id, user_id, date, type, duration, created_at) values
      ('org-a', 'user-a', '2026-10-01', 'running', 45, '2026-10-01T19:00:00Z'),
      ('org-a', 'user-b', '2026-10-01', 'cycling', 60, '2026-10-01T19:00:00Z'),
      ('org-a', null, '2026-09-20', 'tennis', 90, '2026-09-20T19:00:00Z'),
      ('org-b', 'user-d', '2026-10-01', 'swimming', 30, '2026-10-01T19:00:00Z')`);
    // A workout the phone synced: already a timeline event before #493.
    await db.execute(sql`insert into health_event (organization_id, user_id, event_type, event_at, payload_json, dedupe_hash)
      values ('org-a', 'user-a', 'workout', '2026-10-01T07:00:00Z', '{"provider":"health_connect"}'::jsonb, 'device-workout')`);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("a water entry, a supplement intake and a workout appear with their source", async () => {
    const items = await diaries();
    // The member's own entries (deleted ones never), the workspace's session
    // saved before workouts had an owner, and the device workout.
    expect(ids(items)).toEqual([
      "health_event",
      "plain_water_entry",
      "supplement_intake",
      "workout",
      "workout",
    ]);
    const read = (prefix: string) => {
      const item = items.find((entry) => entry.id.startsWith(prefix))!;
      return {
        title: timelineTitle(item, englishI18n),
        summary: timelineSummary(item, englishI18n),
        source: sourceLabel(item, englishI18n),
        domain: item.domain,
      };
    };
    expect(read("plain_water_entry:")).toEqual({
      title: "Plain water",
      summary: "250 ml",
      source: "Manual",
      domain: "water",
    });
    expect(read("supplement_intake:")).toEqual({
      title: "Magnesium",
      summary: "1 cap",
      source: "Manual",
      domain: "meds_supplements",
    });
    const run = items.find((item) => item.canonical.workoutType === "running")!;
    expect({
      title: timelineTitle(run, englishI18n),
      summary: timelineSummary(run, englishI18n),
      source: sourceLabel(run, englishI18n),
    }).toEqual({ title: "Run", summary: "45 min", source: "Manual" });
    // A session sits on its own day, with no time of day, in any time zone.
    const [day] = groupTimelineByDay([run], "Pacific/Kiritimati");
    expect(day).toMatchObject({ day: "2026-10-01", items: [{ time: "" }] });
    expect(items.some((item) => item.canonical.workoutType === "tennis")).toBe(true);

    // Another member sees only their own water and intakes; another workspace none of these.
    const other = await diaries("user-b");
    expect(other.find((item) => item.domain === "water")?.canonical.quantityMl).toBe(300);
    expect(other.some((item) => item.canonical.workoutType === "running")).toBe(false);
    const foreign = await diaries("user-d");
    expect(foreign.map((item) => item.canonical.quantityMl ?? item.canonical.workoutType)).toEqual(
      expect.arrayContaining([400, "swimming"]),
    );
    expect(foreign.some((item) => item.canonical.workoutType === "tennis")).toBe(false);

    // The new kinds page with their cursors.
    const first = await call("timeline/list", { limit: 1 });
    const seen = [first.body.items[0].id];
    let cursor = first.body.nextCursor as string | null;
    while (cursor) {
      const page = await call("timeline/list", { limit: 1, cursor });
      expect(page.status).toBe(200);
      seen.push(...page.body.items.map((item: Item) => item.id));
      cursor = page.body.nextCursor;
    }
    expect(seen).toHaveLength(new Set(seen).size);
    expect(seen).toEqual(expect.arrayContaining(items.map((item) => item.id)));
  });

  test("turning a module off hides its items", async () => {
    await modules("user-a", ["sleep", "heart"]);
    expect(await diaries()).toEqual([]);

    await modules("user-a", ["food"]);
    expect(ids(await diaries())).toEqual(["plain_water_entry"]);
    await modules("user-a", ["supplements"]);
    expect(ids(await diaries())).toEqual(["supplement_intake"]);
    // Activity brings logged sessions and device workouts back together.
    await modules("user-a", ["activity"]);
    expect(ids(await diaries())).toEqual(["health_event", "workout", "workout"]);

    // The water card off keeps its entries off the timeline too.
    await modules("user-a", null);
    await db.execute(
      sql`update plain_water_preference set enabled = false where user_id = 'user-a'`,
    );
    expect((await diaries()).some((item) => item.domain === "water")).toBe(false);
    // Another member's choice is their own.
    expect((await diaries("user-b")).some((item) => item.domain === "water")).toBe(true);
  });

  test("hide-numbers mode hides the water amounts", async () => {
    await db.execute(sql`insert into nutrition_target_settings (organization_id, user_id, hide_numbers)
      values ('org-a', 'user-a', true)`);
    const items = await diaries();
    const water = items.find((item) => item.domain === "water")!;
    expect(water.canonical).toMatchObject({ quantityMl: null, hidden: true });
    expect(JSON.stringify(water)).not.toContain("250");
    expect(timelineSummary(water, englishI18n)).toBe("Hidden");
    // Hide-numbers covers food and water only: the dose and session stay.
    const intake = items.find((item) => item.domain === "meds_supplements")!;
    expect(timelineSummary(intake, englishI18n)).toBe("1 cap");
    // Another member's mode is their own.
    const other = (await diaries("user-b")).find((item) => item.domain === "water")!;
    expect(other.canonical.quantityMl).toBe(300);
  });

  test("each kind needs the read permission of its own screen", async () => {
    expect(ids(await diaries("user-a", { "x-test-deny": "supplements" }))).toEqual([
      "health_event",
      "plain_water_entry",
      "workout",
      "workout",
    ]);
    // Device workouts follow records:read, as before #493.
    expect(ids(await diaries("user-a", { "x-test-deny": "workout" }))).toEqual([
      "health_event",
      "plain_water_entry",
      "supplement_intake",
    ]);
  });

  test("an impersonated session sees none of the member's own entries", async () => {
    expect(ids(await diaries("user-a", IMPERSONATED))).toEqual(["health_event"]);
  });

  test("changes since the last review count them by domain", async () => {
    await db.execute(
      sql`insert into weekly_review (organization_id, week_start, created_at) values ('org-a', '2026-09-28', '2026-09-28T20:00:00Z')`,
    );
    const changes = await call("timeline/changesSinceReview", { limit: 200 });
    expect(changes.status).toBe(200);
    expect(changes.body.summary.byDomain).toMatchObject({
      water: 1,
      meds_supplements: 1,
      activity: 2,
    });
  });
});
