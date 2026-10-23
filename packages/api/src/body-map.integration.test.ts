import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { englishI18n } from "@openvalens/i18n/testing";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import type { BodyMapComposition, BodyMapTraining } from "./contracts/body-map";
import { compositionLayer, trainingLayer } from "./presenters/body-map";
import { appRouter } from "./routers/index";

/**
 * `bodyMap.*` over HTTP against a disposable PostgreSQL (Issue #94): measured
 * DEXA regions only, compare mode limited to scans of the same record, and
 * weekly sets per muscle from logged sessions with unlinked exercises listed.
 */

const url = process.env.BODY_MAP_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/body_map_test")
    throw new Error("Empty disposable loopback body_map_test database required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-a", role: "owner" },
  "user-d": { org: "org-b", role: "owner" },
};
const noAccess = new Set<string>();
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
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
    hasPermission: async ({ headers }: { headers: Headers }) => ({
      success: !noAccess.has(actor(headers)),
    }),
  },
} as unknown as Auth;

describe.skipIf(!url)("body map over RPC and PostgreSQL", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/body_map_test" });
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
      correlationId: "corr-body-map",
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
    const request = new Request(`http://test.local/rpc/bodyMap/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched body map RPC path");
    const body = (await response.json()) as { json: unknown };
    return { status: response.status, body: body.json };
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
    noAccess.clear();
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(sql`insert into "user" (id, email) values
      ('user-a', 'user-a@example.test'), ('user-b', 'user-b@example.test'),
      ('user-c', 'user-c@example.test'), ('user-d', 'user-d@example.test')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-a', 'Synthetic A', 'synthetic-a'), ('org-b', 'Synthetic B', 'synthetic-b')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', 'org-a', 'user-a', 'owner'), ('m-b', 'org-a', 'user-b', 'collaborator'),
      ('m-c', 'org-a', 'user-c', 'owner'), ('m-d', 'org-b', 'user-d', 'owner')`);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  async function seedScans() {
    await db.execute(sql`delete from dexa_scan`);
    const scan = async (org: string, date: string, regions: [string, string, number][]) => {
      const [row] = (
        await db.execute(
          sql`insert into dexa_scan (organization_id, date, body_fat_pct, source_file, created_at) values (${org}, ${date}, 25, 'IMG_private_report.pdf', ${date}) returning id`,
        )
      ).rows as { id: number }[];
      for (const [region, measurementType, value] of regions)
        await db.execute(
          sql`insert into dexa_regional (organization_id, scan_id, measurement_type, region, value) values (${org}, ${row!.id}, ${measurementType}, ${region}, ${value})`,
        );
      return row!.id;
    };
    return {
      earlier: await scan("org-a", "2026-01-10", [
        ["left_arm", "fat_pct", 24],
        ["trunk", "fat_pct", 28],
      ]),
      latest: await scan("org-a", "2026-07-10", [
        ["left_arm", "fat_pct", 20],
        ["Right Arm", "fat_pct", 22],
        ["trunk", "fat_pct", 30],
        ["head", "bmd", 2.1],
      ]),
      otherRecord: await scan("org-b", "2026-07-11", [["left_arm", "fat_pct", 40]]),
    };
  }

  test("composition returns only the measured regions of one of this record's scans", async () => {
    const scans = await seedScans();
    const result = await call("composition", { scanId: scans.latest });
    expect(result.status).toBe(200);
    const body = result.body as BodyMapComposition;
    expect(body.scan).toEqual({
      id: scans.latest,
      date: "2026-07-10",
      source: "Imported DEXA report",
    });
    expect(JSON.stringify(body)).not.toContain("IMG_private_report");
    expect(body.values).toHaveLength(4);
    expect(body.compare).toBeNull();

    const { fills } = compositionLayer(
      { measurementType: "fat_pct", values: body.values },
      englishI18n,
    );
    expect(fills["front.biceps_left"]!.valueText).toBe("20.0%");
    expect(fills["front.biceps_right"]!.valueText).toBe("22.0%");
    // Legs were not scanned: neutral, never filled in from anything else.
    expect(fills["front.thigh_left"]!.valueText).toBeNull();
    expect(fills["back.calf_right"]!.valueText).toBeNull();
  });

  test("compare mode works for two scans of the same record only", async () => {
    const scans = await seedScans();
    const same = await call("composition", { scanId: scans.latest, compareScanId: scans.earlier });
    expect(same.status).toBe(200);
    const body = same.body as BodyMapComposition;
    const { fills } = compositionLayer(
      { measurementType: "fat_pct", values: body.values, compareValues: body.compare!.values },
      englishI18n,
    );
    expect(fills["front.biceps_left"]!.valueText).toBe("-4.0%");
    // The right arm is only in the newer scan, so there is no change to show.
    expect(fills["front.biceps_right"]!.valueText).toBeNull();

    expect(
      (await call("composition", { scanId: scans.latest, compareScanId: scans.otherRecord }))
        .status,
    ).toBe(404);
    expect((await call("composition", { scanId: scans.otherRecord })).status).toBe(404);
    // The other record's owner cannot read this record's scans either.
    expect((await call("composition", { scanId: scans.latest }, "user-d")).status).toBe(404);
  });

  async function seedWorkouts() {
    await db.execute(sql`delete from workout`);
    await db.execute(sql`delete from exercise`);
    const exercise = async (name: string, muscles: [string, "primary" | "secondary"][]) => {
      const [row] = (
        await db.execute(
          sql`insert into exercise (organization_id, source, name) values ('org-a', 'user', ${name}) returning id`,
        )
      ).rows as { id: number }[];
      for (const [muscle, role] of muscles)
        await db.execute(
          sql`insert into exercise_muscle (exercise_id, name, role) values (${row!.id}, ${muscle}, ${role})`,
        );
      return row!.id;
    };
    const bench = await exercise("Bench press", [
      ["Chest", "primary"],
      ["Triceps", "secondary"],
    ]);
    const plank = await exercise("Plank", []);
    const session = async (org: string, date: string, items: [string, number | null, number][]) => {
      const [row] = (
        await db.execute(
          sql`insert into workout (organization_id, date, type, created_at) values (${org}, ${date}, 'weights', ${date}) returning id`,
        )
      ).rows as { id: number }[];
      for (const [position, [name, catalogId, sets]] of items.entries()) {
        const [entry] = (
          await db.execute(
            sql`insert into workout_exercise (organization_id, workout_id, sort_order, name, exercise_id) values (${org}, ${row!.id}, ${position}, ${name}, ${catalogId}) returning id`,
          )
        ).rows as { id: number }[];
        for (let index = 0; index < sets; index++)
          await db.execute(
            sql`insert into workout_set (organization_id, exercise_id, sort_order, reps) values (${org}, ${entry!.id}, ${index}, 8)`,
          );
      }
    };
    // Fixture week ending 2026-10-23: two bench sessions, a plank with no
    // muscle data and a free-text exercise; plus rows that must not count.
    await session("org-a", "2026-10-17", [["Bench press", bench, 3]]);
    await session("org-a", "2026-10-23", [
      ["Bench press", bench, 2],
      ["Plank", plank, 2],
      ["Farmer carry", null, 4],
    ]);
    await session("org-a", "2026-10-16", [["Bench press", bench, 10]]);
    await session("org-a", "2026-10-24", [["Bench press", bench, 10]]);
    await session("org-b", "2026-10-20", [["Bench press", null, 10]]);
  }

  test("training counts a fixture week of logged sets per muscle and lists unmapped exercises", async () => {
    await seedWorkouts();
    const result = await call("training", { today: "2026-10-23" });
    expect(result.status).toBe(200);
    const body = result.body as BodyMapTraining;
    expect(body.from).toBe("2026-10-17");
    expect(body.to).toBe("2026-10-23");
    expect(body.exercises).toEqual([
      {
        exerciseId: expect.any(Number),
        name: "Bench press",
        sets: 5,
        muscles: [
          { name: "Chest", role: "primary" },
          { name: "Triceps", role: "secondary" },
        ],
      },
    ]);
    expect(body.unmapped).toEqual([
      { name: "Farmer carry", sets: 4 },
      { name: "Plank", sets: 2 },
    ]);
    const layer = trainingLayer(body.exercises, englishI18n);
    expect(layer.setsByGroup).toMatchObject({ chest: 5, triceps: 2.5, quads: 0 });
    expect(layer.fills["front.chest_left"]!.valueText).toBe("5 sets");
    expect(layer.fills["back.triceps_right"]!.valueText).toBe("2.5 sets");
  });

  test("rejects bad input, other tenants' fields, missing permission and signed-out callers", async () => {
    expect((await call("training", { today: "23/10/2026" })).status).toBe(400);
    expect((await call("training", { today: "2026-10-23", organizationId: "org-b" })).status).toBe(
      400,
    );
    expect((await call("composition", { scanId: 1, organizationId: "org-b" })).status).toBe(400);
    noAccess.add("user-b");
    expect((await call("training", { today: "2026-10-23" }, "user-b")).status).toBe(403);
    expect((await call("composition", { scanId: 1 }, "user-b")).status).toBe(403);
    expect((await call("training", { today: "2026-10-23" }, "nobody")).status).toBe(401);
  });
});
