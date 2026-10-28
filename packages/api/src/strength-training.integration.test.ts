import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";
import type { Context } from "./context";
import { appRouter } from "./routers/index";

/** Isolated API/database contract evidence for Epic 282. Intentionally not run until integration. */
const url = process.env.STRENGTH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/strength_training_test"
  )
    throw new Error("An empty disposable loopback strength_training_test database is required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-b", role: "owner" },
};
const actor = (h: Headers) => h.get("x-test-user") ?? "user-a";
const org = (h: Headers, user = actor(h)) => h.get("x-test-org") ?? MEMBERS[user]?.org ?? "org-a";
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
          activeOrganizationId: org(headers, id),
          impersonatedBy: null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      return MEMBERS[id]
        ? { id: `m-${id}`, userId: id, organizationId: org(headers, id), role: MEMBERS[id]!.role }
        : null;
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actor(headers)]?.role,
    }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

describe.skipIf(!url)("strength training isolated PostgreSQL + HTTP contract", () => {
  const db: Database = createDb({
    DATABASE_URL: url ?? "postgres://127.0.0.1/strength_training_test",
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
              activeOrganizationId: org(headers, id),
              impersonatedBy: null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-strength-test",
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
    const request = new Request(`http://test.local/rpc/plans/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error(`unmatched plans RPC ${path}`);
    const body = (await response.json()) as { json?: unknown; error?: unknown };
    return { status: response.status, body: Object.hasOwn(body, "json") ? body.json : body };
  }
  const scope = "user-a:org-a";
  const mutation = () => crypto.randomUUID();
  const routineExercise = (id: number | null, name: string) => ({
    key: crypto.randomUUID(),
    exerciseId: id,
    name,
    targetSets: 3,
    repsMin: 6,
    repsMax: 10,
    targetWeightKg: 40,
    restSeconds: 90,
    progression: { kind: "double" as const, incrementKg: 2.5 },
  });
  const session = (date: string, weight: number, exerciseId: number, name = "Bench press") => ({
    date,
    type: "weights",
    exercises: [
      {
        name,
        exerciseId,
        sets: [
          { reps: 8, weightKg: weight },
          { reps: 8, weightKg: weight },
          { reps: 6, weightKg: weight + 2.5 },
        ],
      },
    ],
  });

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
  });
  beforeEach(async () => {
    // Clear tenant-owned workout dependents before removing their member rows.
    await db.execute(sql`delete from workout`);
    await db.execute(sql`delete from workout_routine`);
    await db.execute(sql`delete from workout_mutation`);
    await db.execute(sql`delete from workout_operation`);
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(
      sql`insert into "user" (id, email) values ('user-a','a@example.test'),('user-b','b@example.test'),('user-c','c@example.test')`,
    );
    await db.execute(
      sql`insert into organization (id,name,slug) values ('org-a','Synthetic A','synthetic-a'),('org-b','Synthetic B','synthetic-b')`,
    );
    await db.execute(
      sql`insert into member (id,organization_id,user_id,role) values ('m-a','org-a','user-a','owner'),('m-b','org-a','user-b','collaborator'),('m-c','org-b','user-c','owner')`,
    );
  });
  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("private routine CRUD, owner-only access, preview and immutable session snapshot serialize through RPC", async () => {
    const [catalog] = (
      await db.execute(
        sql`insert into exercise (organization_id,source,name) values ('org-a','user','Bench press') returning id`,
      )
    ).rows as { id: number }[];
    const exercises = [
      routineExercise(catalog!.id, "Bench press"),
      routineExercise(null, "  Cable   fly "),
    ];
    const created = await call("routines/createRoutine", {
      clientMutationId: mutation(),
      expectedScope: scope,
      name: "Upper",
      notes: "private",
      exercises,
    });
    expect(created.status).toBe(200);
    const routineId = (created.body as { id: number }).id;
    expect((await call("routines/listRoutines", {})).body).toMatchObject([
      { id: routineId, version: 1, name: "Upper" },
    ]);
    expect((await call("routines/getRoutine", { id: routineId }, "user-b")).body).toBeNull();
    expect(
      (
        await call(
          "routines/updateRoutine",
          {
            clientMutationId: mutation(),
            expectedScope: scope,
            id: routineId,
            expectedVersion: 1,
            name: "Hijack",
            exercises,
          },
          "user-b",
        )
      ).status,
    ).toBe(409);
    const snapshot = {
      routineId,
      version: 1,
      name: "Upper",
      exercises: exercises.map((e) => ({
        ...e,
        suggestion: { weightKg: 40, reps: 8, reason: "target" },
      })),
    };
    const saved = await call("workouts/upsertWorkout", {
      ...session("2026-10-01", 40, catalog!.id),
      clientMutationId: mutation(),
      routineId,
      routineSnapshot: snapshot,
    });
    const detail = await call("workouts/getWorkout", { id: (saved.body as { id: number }).id });
    expect(detail.body).toMatchObject({
      routineId,
      routineSnapshot: snapshot,
      ownership: "mine",
      canEdit: true,
      version: 1,
      summary: { exerciseCount: 1, setCount: 3 },
    });
    const preview = await call("routines/startPreview", { id: routineId });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      routine: { id: routineId },
      suggestions: expect.arrayContaining([
        expect.objectContaining({
          key: exercises[0]!.key,
          suggestion: expect.objectContaining({
            reps: expect.any(Number),
            reason: expect.any(String),
          }),
        }),
      ]),
      previousPerformance: expect.arrayContaining([
        expect.objectContaining({
          key: exercises[0]!.key,
          performance: expect.objectContaining({
            exercises: [
              expect.objectContaining({
                sets: expect.arrayContaining([
                  expect.objectContaining({ reps: 8, weightKg: 40, sortOrder: 0 }),
                ]),
              }),
            ],
          }),
        }),
      ]),
    });
  });

  test("create retries preserve response; full replacement versions, conflicts, cascade deletion and receipt replay", async () => {
    const [cat] = (
      await db.execute(
        sql`insert into exercise (organization_id,source,name) values ('org-a','user','Squat') returning id`,
      )
    ).rows as { id: number }[];
    const createInput = { ...session("2026-10-03", 80, cat!.id), clientMutationId: mutation() };
    const first = await call("workouts/upsertWorkout", createInput),
      retry = await call("workouts/upsertWorkout", createInput);
    expect(retry.body).toEqual(first.body);
    const id = (first.body as { id: number }).id;
    const replacement = { ...session("2026-10-04", 85, cat!.id), notes: "updated" };
    const updateInput = {
      clientMutationId: mutation(),
      expectedScope: scope,
      id,
      expectedVersion: 1,
      workout: replacement,
    };
    const update = await call("workouts/updateWorkout", updateInput);
    expect(update.body).toMatchObject({ id, version: 2 });
    expect((await call("workouts/updateWorkout", updateInput)).body).toEqual(update.body);
    const auditAfterUpdate = await db.execute(
      sql`select count(*)::int as n from access_audit_log where target_type='workout' and target_id=${String(id)} and event_type='RECORD_UPDATED'`,
    );
    expect(auditAfterUpdate.rows[0]).toEqual({ n: 1 });
    expect(
      (
        await call("workouts/updateWorkout", {
          ...updateInput,
          clientMutationId: mutation(),
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("workouts/updateWorkout", {
          ...updateInput,
          clientMutationId: createInput.clientMutationId,
        })
      ).status,
    ).toBe(409);
    const del = { clientMutationId: mutation(), expectedScope: scope, id, expectedVersion: 2 };
    const deleted = await call("workouts/deleteWorkout", del);
    expect(deleted.body).toMatchObject({ id, version: 3, deleted: true });
    expect((await call("workouts/deleteWorkout", del)).body).toEqual(deleted.body);
    expect(
      (
        await db.execute(
          sql`select (select count(*)::int from workout where id=${id}) as workouts, (select count(*)::int from workout_exercise where workout_id=${id}) as exercises`,
        )
      ).rows[0],
    ).toEqual({ workouts: 0, exercises: 0 });

    const raceCreate = await call("workouts/upsertWorkout", {
      ...session("2026-10-07", 70, cat!.id),
      clientMutationId: mutation(),
    });
    const raceId = (raceCreate.body as { id: number }).id;
    const concurrentUpdates = await Promise.all([
      call("workouts/updateWorkout", {
        clientMutationId: mutation(),
        expectedScope: scope,
        id: raceId,
        expectedVersion: 1,
        workout: { ...replacement, notes: "race-a" },
      }),
      call("workouts/updateWorkout", {
        clientMutationId: mutation(),
        expectedScope: scope,
        id: raceId,
        expectedVersion: 1,
        workout: { ...replacement, notes: "race-b" },
      }),
    ]);
    expect(concurrentUpdates.map((x) => x.status).sort()).toEqual([200, 409]);
    const raceVersion = (
      concurrentUpdates.find((x) => x.status === 200)!.body as { version: number }
    ).version;
    const concurrentUpdateDelete = await Promise.all([
      call("workouts/updateWorkout", {
        clientMutationId: mutation(),
        expectedScope: scope,
        id: raceId,
        expectedVersion: raceVersion,
        workout: replacement,
      }),
      call("workouts/deleteWorkout", {
        clientMutationId: mutation(),
        expectedScope: scope,
        id: raceId,
        expectedVersion: raceVersion,
      }),
    ]);
    // Delete-first makes the update a legitimate 404; update-first makes the
    // delete conflict on its stale version. Either way one mutation must win.
    const raceStatuses = concurrentUpdateDelete.map((x) => x.status).sort();
    expect(raceStatuses[0]).toBe(200);
    expect(["200,404", "200,409"]).toContain(raceStatuses.join(","));
    const final = await call("workouts/getWorkout", { id: raceId });
    const deleteWon = concurrentUpdateDelete.some(
      (x) => x.status === 200 && (x.body as { deleted?: boolean }).deleted === true,
    );
    if (deleteWon) expect(final.body).toBeNull();
    else
      expect(final.body).toMatchObject({ id: raceId, version: raceVersion + 1, notes: "updated" });
  });

  test("session routine links are owner-safe, restrict deletion, and preserve routine provenance on omitted fields", async () => {
    const createdRoutine = await call("routines/createRoutine", {
      clientMutationId: mutation(),
      expectedScope: scope,
      name: "Link fixture",
      exercises: [],
    });
    const routineId = (createdRoutine.body as { id: number }).id;
    const [cat] = (
      await db.execute(
        sql`insert into exercise (organization_id,source,name) values ('org-a','user','Press') returning id`,
      )
    ).rows as { id: number }[];
    const snapshot = { routineId, version: 1, name: "Link fixture", exercises: [] };
    const created = await call("workouts/upsertWorkout", {
      ...session("2026-10-09", 30, cat!.id),
      clientMutationId: mutation(),
      routineId,
      routineSnapshot: snapshot,
    });
    const id = (created.body as { id: number }).id;
    const edit = await call("workouts/updateWorkout", {
      clientMutationId: mutation(),
      expectedScope: scope,
      id,
      expectedVersion: 1,
      workout: session("2026-10-10", 30, cat!.id),
    });
    expect(edit.status).toBe(200);
    expect((await call("workouts/getWorkout", { id })).body).toMatchObject({
      routineId,
      routineSnapshot: snapshot,
      version: 2,
    });
    expect(
      (
        await call("routines/deleteRoutine", {
          clientMutationId: mutation(),
          expectedScope: scope,
          id: routineId,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect((await call("workouts/getWorkout", { id })).body).toMatchObject({
      routineId: null,
      routineSnapshot: snapshot,
    });
  });

  test("owned sessions and routines are isolated even from same-org owner; expectedScope rejects before writes", async () => {
    const [cat] = (
      await db.execute(
        sql`insert into exercise (organization_id,source,name) values ('org-a','user','Deadlift') returning id`,
      )
    ).rows as { id: number }[];
    const r = await call("routines/createRoutine", {
      clientMutationId: mutation(),
      expectedScope: scope,
      name: "Private",
      exercises: [],
    });
    const workout = await call("workouts/upsertWorkout", {
      ...session("2026-10-05", 100, cat!.id),
      clientMutationId: mutation(),
    });
    const id = (workout.body as { id: number }).id;
    expect((await call("workouts/getWorkout", { id }, "user-b")).body).toBeNull();
    expect((await call("workouts/listWorkouts", {}, "user-b")).body).toEqual([]);
    expect(
      (
        await call(
          "workouts/updateWorkout",
          {
            clientMutationId: mutation(),
            expectedScope: "user-b:org-a",
            id,
            expectedVersion: 1,
            workout: session("2026-10-06", 1, cat!.id),
          },
          "user-b",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "workouts/deleteWorkout",
          { clientMutationId: mutation(), expectedScope: "user-b:org-a", id, expectedVersion: 1 },
          "user-b",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "workouts/updateWorkout",
          {
            clientMutationId: mutation(),
            expectedScope: scope,
            id,
            expectedVersion: 1,
            workout: session("2026-10-06", 1, cat!.id),
          },
          "user-b",
        )
      ).status,
    ).toBe(409);
    expect(
      (await call("routines/getRoutine", { id: (r.body as { id: number }).id }, "user-b")).body,
    ).toBeNull();
    const counts = await db.execute(sql`select count(*)::int as n from workout_operation`);
    const mismatch = await call("workouts/updateWorkout", {
      clientMutationId: mutation(),
      expectedScope: "user-b:org-a",
      id,
      expectedVersion: 1,
      workout: session("2026-10-06", 1, cat!.id),
    });
    expect(mismatch.status).toBe(409);
    expect((await db.execute(sql`select count(*)::int as n from workout_operation`)).rows).toEqual(
      counts.rows,
    );
    expect((await call("workouts/getWorkout", { id }, "user-c")).body).toBeNull();
    expect(
      (await call("workouts/lastPerformance", { exerciseIds: [cat!.id] }, "user-b")).body,
    ).toMatchObject({ items: [{ ref: { exerciseId: cat!.id }, performance: null }] });
    expect(
      (await call("workouts/exerciseHistory", { exercise: { exerciseId: cat!.id } }, "user-b"))
        .body,
    ).toMatchObject({ items: [], records: { heaviestWeightKg: null } });
  });

  test("history uses exact sets, Epley eligibility, strict chronological PRs and recomputes after edits/deletes", async () => {
    const [cat] = (
      await db.execute(
        sql`insert into exercise (organization_id,source,name) values ('org-a','user','Press') returning id`,
      )
    ).rows as { id: number }[];
    const create = async (date: string, reps: number, weight: number) =>
      call("workouts/upsertWorkout", {
        date,
        type: "weights",
        clientMutationId: mutation(),
        exercises: [{ name: "Press", exerciseId: cat!.id, sets: [{ reps, weightKg: weight }] }],
      });
    const a = await create("2026-01-01", 8, 50),
      b = await create("2026-01-02", 8, 50),
      c = await create("2026-01-03", 8, 60),
      invalid = await create("2026-01-04", 13, 90);
    const history = await call("workouts/exerciseHistory", { exercise: { exerciseId: cat!.id } });
    // Captured first: Bun's asymmetric matchers can overwrite matched fields on the received body.
    const historyItems = [
      ...(history.body as { items: Array<{ workoutId: number; prs: Array<{ kind: string }> }> })
        .items,
    ];
    expect(history.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          workoutId: (a.body as { id: number }).id,
          prs: expect.arrayContaining([
            expect.objectContaining({ kind: "heaviest_weight", weightKg: 50 }),
          ]),
        }),
        expect.objectContaining({ workoutId: (b.body as { id: number }).id, prs: [] }),
        expect.objectContaining({
          workoutId: (c.body as { id: number }).id,
          prs: expect.arrayContaining([
            expect.objectContaining({ kind: "heaviest_weight", weightKg: 60 }),
          ]),
        }),
      ]),
    });
    const invalidItem = historyItems.find(
      (item) => item.workoutId === (invalid.body as { id: number }).id,
    );
    expect(invalidItem).toBeDefined();
    expect(invalidItem!.prs.map((pr) => pr.kind)).not.toContain("estimated_1rm");
    expect(
      (history.body as { records: { heaviestWeightKg: number } }).records.heaviestWeightKg,
    ).toBe(90);
    expect(
      (history.body as { records: { bestEstimated1RmKg: number } }).records.bestEstimated1RmKg,
    ).toBeCloseTo(76);
    const id = (c.body as { id: number }).id;
    await call("workouts/updateWorkout", {
      clientMutationId: mutation(),
      expectedScope: scope,
      id,
      expectedVersion: 1,
      workout: {
        date: "2026-01-03",
        type: "weights",
        exercises: [{ name: "Press", exerciseId: cat!.id, sets: [{ reps: 8, weightKg: 40 }] }],
      },
    });
    // The 13-rep 90 kg session still holds the heaviest weight; the edit lowers the best e1RM.
    const afterEdit = await call("workouts/exerciseHistory", { exercise: { exerciseId: cat!.id } });
    const afterEditRecords = (
      afterEdit.body as { records: { heaviestWeightKg: number; bestEstimated1RmKg: number } }
    ).records;
    expect(afterEditRecords.heaviestWeightKg).toBe(90);
    expect(afterEditRecords.bestEstimated1RmKg).toBeCloseTo(63.33, 1);
    const replacementPr = await create("2026-01-05", 8, 100);
    expect(
      (await call("workouts/exerciseHistory", { exercise: { exerciseId: cat!.id } })).body,
    ).toMatchObject({ records: { heaviestWeightKg: 100 } });
    const prId = (replacementPr.body as { id: number }).id;
    await call("workouts/deleteWorkout", {
      clientMutationId: mutation(),
      expectedScope: scope,
      id: prId,
      expectedVersion: 1,
    });
    expect(
      (await call("workouts/exerciseHistory", { exercise: { exerciseId: cat!.id } })).body,
    ).toMatchObject({ records: { heaviestWeightKg: 90 } });
  });

  test("batched last performance separates catalog identity and normalized unlinked names", async () => {
    const [cat] = (
      await db.execute(
        sql`insert into exercise (organization_id,source,name) values ('org-a','user','Row') returning id`,
      )
    ).rows as { id: number }[];
    await call("workouts/upsertWorkout", {
      ...session("2026-02-01", 45, cat!.id),
      clientMutationId: mutation(),
    });
    await call("workouts/upsertWorkout", {
      ...session("2026-02-02", 30, cat!.id, "  CAFÉ   PRESS "),
      clientMutationId: mutation(),
      exercises: [{ name: "  CAFÉ   PRESS ", sets: [{ reps: 10, weightKg: 30 }] }],
    });
    const result = await call("workouts/lastPerformance", {
      exerciseIds: [cat!.id],
      names: [" café press ", "ROW"],
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: { exerciseId: cat!.id },
          performance: expect.objectContaining({
            exercises: [
              expect.objectContaining({
                sets: expect.arrayContaining([expect.objectContaining({ weightKg: 45 })]),
              }),
            ],
          }),
        }),
        expect.objectContaining({
          ref: { name: " café press " },
          performance: expect.objectContaining({
            exercises: [
              expect.objectContaining({
                sets: expect.arrayContaining([expect.objectContaining({ weightKg: 30 })]),
              }),
            ],
          }),
        }),
      ]),
    });
  });

  test("legacy null-owner rows remain readable but are not attributed to personal history", async () => {
    const [legacy] = (
      await db.execute(
        sql`insert into workout (organization_id,date,type,created_at,user_id) values ('org-a','2026-03-01','weights',now(),null) returning id`,
      )
    ).rows as { id: number }[];
    const [entry] = (
      await db.execute(
        sql`insert into workout_exercise (organization_id,workout_id,sort_order,name) values ('org-a',${legacy!.id},0,'Legacy row') returning id`,
      )
    ).rows as { id: number }[];
    await db.execute(
      sql`insert into workout_set (organization_id,exercise_id,sort_order,reps,weight_kg) values ('org-a',${entry!.id},0,8,100)`,
    );
    expect((await call("workouts/getWorkout", { id: legacy!.id })).body).toMatchObject({
      ownership: "legacy",
      canEdit: false,
    });
    expect(
      (
        await call("workouts/deleteWorkout", {
          clientMutationId: mutation(),
          expectedScope: scope,
          id: legacy!.id,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("workouts/exerciseHistory", { exercise: { name: "Legacy row" } })).body,
    ).toMatchObject({ items: [], records: { heaviestWeightKg: null } });
  });

  test("warm batched last-performance lookup is bounded with 730 realistic sessions", async () => {
    const [cat] = (
      await db.execute(
        sql`insert into exercise (organization_id,source,name) values ('org-a','user','Fixture catalog') returning id`,
      )
    ).rows as { id: number }[];
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`with sessions as (insert into workout (organization_id,user_id,date,type,created_at,version) select 'org-a','user-a',date '2024-01-01' + n,'weights',now(),1 from generate_series(0,729) n returning id,date), entries as (insert into workout_exercise (organization_id,workout_id,sort_order,name,exercise_id) select 'org-a',s.id,e,'Exercise '||e,case when e=1 then ${cat!.id} else null::integer end from sessions s cross join generate_series(1,6) e returning id), sets as (insert into workout_set (organization_id,exercise_id,sort_order,reps,weight_kg) select 'org-a',x.id,n,8,40+n from entries x cross join generate_series(1,3) n returning id) select count(*) from sets`,
      );
    });
    const input = {
      exerciseIds: [cat!.id],
      names: ["exercise 2", "exercise 3", "exercise 4", "exercise 5", "exercise 6"],
    };
    const warm = await call("workouts/lastPerformance", input);
    expect(warm.status).toBe(200);
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = await call("workouts/lastPerformance", input);
      timings.push(performance.now() - start);
      expect(result.status).toBe(200);
      expect((result.body as { items: unknown[] }).items).toHaveLength(6);
    }
    timings.sort((a, b) => a - b);
    expect(timings[2]).toBeLessThan(100);
    expect(
      (
        warm.body as { items: Array<{ performance: { exercises: Array<{ sets: unknown[] }> } }> }
      ).items.every((item) => item.performance.exercises[0]!.sets.length === 3),
    ).toBe(true);
  });
});
