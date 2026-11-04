import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { createWorkoutRepository } from "@openvalens/plans";
import { RPCHandler } from "@orpc/server/fetch";
import type { Context } from "../context";
import { appRouter } from "./index";

const url = process.env.GOALS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/goals_test")
    throw new Error("Empty disposable loopback goals_test database required.");
}
const members: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-b", role: "owner" },
};
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = headers.get("x-test-user") ?? "user-a";
      const member = members[id];
      return member
        ? {
            user: { id, email: `${id}@example.test`, name: null },
            session: {
              id: `session-${id}`,
              userId: id,
              activeOrganizationId: member.org,
              impersonatedBy: null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null;
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = headers.get("x-test-user") ?? "user-a";
      const member = members[id];
      return member
        ? { id: `member-${id}`, userId: id, organizationId: member.org, role: member.role }
        : null;
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: members[headers.get("x-test-user") ?? "user-a"]?.role,
    }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

describe.skipIf(!url)("personal goals authenticated PostgreSQL API", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/goals_test" });
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
  function context(headers: Headers): Context {
    const id = headers.get("x-test-user") ?? "user-a",
      member = members[id];
    return {
      session: member
        ? {
            user: { id },
            session: {
              id: `s-${id}`,
              userId: id,
              activeOrganizationId: member.org,
              impersonatedBy: null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-goals",
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
  async function call(path: string, input: unknown, user = "user-a") {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/goals/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: context(headers),
    });
    if (!matched || !response) throw new Error("unmatched goals RPC path");
    const body = (await response.json()) as { json?: unknown; message?: string; error?: unknown };
    return { status: response.status, body: body.json ?? body };
  }
  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname='public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
  });
  beforeEach(async () => {
    await db.execute(sql`delete from organization`);
    await db.execute(sql`delete from "user"`);
    await db.execute(
      sql`insert into "user" (id,email) values ('user-a','a@example.test'),('user-b','b@example.test'),('user-c','c@example.test')`,
    );
    await db.execute(
      sql`insert into organization (id,name,slug) values ('org-a','A','a'),('org-b','B','b')`,
    );
    await db.execute(
      sql`insert into member (id,organization_id,user_id,role) values ('ma','org-a','user-a','owner'),('mb','org-a','user-b','collaborator'),('mc','org-b','user-c','owner')`,
    );
  });
  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("atomic receipts, owner privacy, completion correction history, and soft-delete replay", async () => {
    const mutation = "00000000-0000-4000-8000-000000000001";
    const definition = {
      id: "client-id-is-ignored",
      title: "Daily practice",
      source: "manual",
      metric: "practice",
      unit: null,
      rule: { kind: "recurring", cadence: "daily" },
      startDate: "2026-10-01",
      timeZone: "UTC",
      status: "active",
    };
    const created = await call("create", { definition, clientMutationId: mutation });
    expect(created.status).toBe(200);
    expect(await call("create", { definition, clientMutationId: mutation })).toMatchObject(created);
    expect(
      (
        await call("create", {
          definition: { ...definition, title: "Different payload" },
          clientMutationId: mutation,
        })
      ).status,
    ).toBe(409);
    const goalId = (created.body as { id: number }).id;
    expect((await call("detail", { id: goalId }, "user-b")).status).toBe(404);
    const checkin = await call("createCheckin", {
      goalId,
      date: "2026-10-31",
      completed: false,
      clientMutationId: "00000000-0000-4000-8000-000000000002",
    });
    const checkinId = (checkin.body as { id: number }).id;
    const knownNonqualification = await call("createCheckin", {
      goalId,
      date: "2026-10-30",
      completed: false,
      clientMutationId: "00000000-0000-4000-8000-000000000051",
    });
    const knownNonqualificationId = (knownNonqualification.body as { id: number }).id;
    const corrected = await call("updateCheckin", {
      id: checkinId,
      goalId,
      version: 1,
      date: "2026-11-01",
      completed: true,
      clientMutationId: "00000000-0000-4000-8000-000000000003",
    });
    const correctedId = (corrected.body as { id: number }).id;
    const detail = await call("detail", { id: goalId });
    expect(detail.body).toMatchObject({
      checkins: [
        { id: knownNonqualificationId, completed: false },
        { id: correctedId, completed: true },
      ],
      checkinHistory: [
        { id: knownNonqualificationId, completed: false, deletedAt: null, correctedFromId: null },
        { id: checkinId, completed: false, deletedAt: expect.any(String), correctedFromId: null },
        { id: correctedId, completed: true, deletedAt: null, correctedFromId: checkinId },
      ],
    });
    expect(
      (
        detail.body as { evaluation: { days: Array<{ date: string; state: string }> } }
      ).evaluation.days.find((day) => day.date === "2026-10-31")?.state,
    ).toBe("unknown");
    expect(
      (
        detail.body as { evaluation: { days: Array<{ date: string; state: string }> } }
      ).evaluation.days.find((day) => day.date === "2026-10-30")?.state,
    ).toBe("does-not-qualify");
    expect(
      (
        await call("update", {
          id: goalId,
          version: 1,
          definition: {
            ...definition,
            source: "water",
            metric: "water_ml",
            unit: "ml",
            rule: {
              kind: "recurring",
              cadence: "daily",
              completion: { kind: "minimum", value: 1000 },
            },
          },
          clientMutationId: "00000000-0000-4000-8000-000000000023",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          "deleteCheckin",
          {
            id: correctedId,
            goalId,
            version: 1,
            clientMutationId: "00000000-0000-4000-8000-000000000020",
          },
          "user-b",
        )
      ).status,
    ).toBe(404);
    const changedDefinition = { ...definition, title: "Updated title" };
    expect(
      (
        await call("update", {
          id: goalId,
          version: 1,
          definition: changedDefinition,
          clientMutationId: "00000000-0000-4000-8000-000000000021",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("update", {
          id: goalId,
          version: 1,
          definition: changedDefinition,
          clientMutationId: "00000000-0000-4000-8000-000000000022",
        })
      ).status,
    ).toBe(409);
    const deleted = await call("deleteCheckin", {
      id: correctedId,
      goalId,
      version: 1,
      clientMutationId: "00000000-0000-4000-8000-000000000004",
    });
    expect(
      await call("deleteCheckin", {
        id: correctedId,
        goalId,
        version: 1,
        clientMutationId: "00000000-0000-4000-8000-000000000004",
      }),
    ).toMatchObject(deleted);
    expect(
      (
        await call("update", {
          id: goalId,
          version: 2,
          definition: {
            ...definition,
            source: "water",
            metric: "water_ml",
            unit: "ml",
            rule: {
              kind: "recurring",
              cadence: "daily",
              completion: { kind: "minimum", value: 1000 },
            },
          },
          clientMutationId: "00000000-0000-4000-8000-000000000024",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await db.execute(
          sql`select count(*)::int as count from goal_mutation where user_id='user-a'`,
        )
      ).rows[0]?.count,
    ).toBe(6);
    expect(
      (
        await db.execute(
          sql`select count(*)::int as count from goal_checkin where goal_id=${goalId} and deleted_at is not null`,
        )
      ).rows[0]?.count,
    ).toBe(2);
  });

  test("owner-admin legacy assignment requires membership and exposes configuration state", async () => {
    const inserted = await db.execute(
      sql`insert into goal (organization_id,title,category) values ('org-a','Legacy title','health') returning id`,
    );
    const id = inserted.rows[0]!.id as number;
    expect((await call("detail", { id }, "user-a")).status).toBe(404);
    const assigned = await call("assignLegacy", {
      id,
      assigneeUserId: "user-b",
      reason: "Confirmed by account holder",
      clientMutationId: "00000000-0000-4000-8000-000000000010",
    });
    expect(assigned.status).toBe(200);
    expect(await call("listNeedsConfiguration", {}, "user-b")).toMatchObject({
      body: [{ id, title: "Legacy title" }],
    });
    const configured = await call(
      "configureLegacy",
      {
        id,
        version: 2,
        definition: {
          id: "legacy-client",
          title: "Configured legacy goal",
          source: "manual",
          metric: "practice",
          unit: null,
          rule: { kind: "recurring", cadence: "daily" },
          startDate: "2026-10-01",
          timeZone: "UTC",
          status: "active",
        },
        clientMutationId: "00000000-0000-4000-8000-000000000012",
      },
      "user-b",
    );
    expect(configured.status).toBe(200);
    expect(await call("detail", { id }, "user-b")).toMatchObject({
      status: 200,
      body: { title: "Configured legacy goal" },
    });
    expect(
      (
        await call("assignLegacy", {
          id,
          assigneeUserId: "user-c",
          reason: "Not a member target",
          clientMutationId: "00000000-0000-4000-8000-000000000011",
        })
      ).status,
    ).toBe(400);
  });

  test("daily water links pause/resume atomically and achieved stricter targets require replacement", async () => {
    const waterDefinition = {
      id: "x",
      title: "Water daily",
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: { kind: "recurring", cadence: "daily", completion: { kind: "minimum", value: 2000 } },
      startDate: "2026-10-01",
      timeZone: "UTC",
      status: "active",
    };
    const water = await call("create", {
      definition: waterDefinition,
      clientMutationId: "00000000-0000-4000-8000-000000000030",
    });
    const waterId = (water.body as { id: number }).id;
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${waterId}`)).rows[0]
        ?.ended_at,
    ).toBeNull();
    await call("setStatus", {
      id: waterId,
      version: 1,
      status: "paused",
      clientMutationId: "00000000-0000-4000-8000-000000000031",
    });
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${waterId}`)).rows[0]
        ?.ended_at,
    ).not.toBeNull();
    await call("setStatus", {
      id: waterId,
      version: 2,
      status: "active",
      clientMutationId: "00000000-0000-4000-8000-000000000032",
    });
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${waterId}`)).rows[0]
        ?.ended_at,
    ).toBeNull();
    expect(
      (await db.execute(sql`select definition->'pauses' as pauses from goal where id=${waterId}`))
        .rows[0]?.pauses,
    ).toMatchObject([
      {
        startDate: expect.any(String),
        endDate: expect.any(String),
        resumedOn: expect.any(String),
        pausedAt: expect.any(String),
        resumedAt: expect.any(String),
      },
    ]);
    const updateStartedAt = Date.now();
    const ruleUpdate = await call("update", {
      id: waterId,
      version: 3,
      definition: {
        ...waterDefinition,
        rule: { kind: "average", target: { kind: "minimum", value: 2000 }, windowDays: 7 },
      },
      clientMutationId: "00000000-0000-4000-8000-000000000038",
    });
    expect(ruleUpdate.status).toBe(200);
    const effectiveFrom = (
      await db.execute(
        sql`select effective_from from goal_definition where goal_id=${waterId} order by revision desc limit 1`,
      )
    ).rows[0]?.effective_from as string;
    expect(Date.parse(`${effectiveFrom}T00:00:00.000Z`)).toBeGreaterThan(updateStartedAt);
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${waterId}`)).rows[0]
        ?.ended_at,
    ).toBeNull();

    const effectivePast = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await db.execute(
      sql`update goal_definition set effective_until=${effectivePast} where goal_id=${waterId} and revision=1`,
    );
    await db.execute(
      sql`update goal_definition set effective_from=${effectivePast} where goal_id=${waterId} and revision=2`,
    );
    await call("detail", { id: waterId });
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${waterId}`)).rows[0]
        ?.ended_at,
    ).not.toBeNull();

    const competitor = await call("create", {
      definition: { ...waterDefinition, title: "Competing water goal" },
      clientMutationId: "00000000-0000-4000-8000-000000000045",
    });
    const competitorId = (competitor.body as { id: number }).id;
    await call("update", {
      id: waterId,
      version: 4,
      definition: waterDefinition,
      clientMutationId: "00000000-0000-4000-8000-000000000046",
    });
    await db.execute(
      sql`update goal_definition set effective_until=${effectivePast} where goal_id=${waterId} and revision=2`,
    );
    await db.execute(
      sql`update goal_definition set effective_from=${effectivePast} where goal_id=${waterId} and revision=3`,
    );
    expect((await call("detail", { id: waterId })).status).toBe(200);
    expect(
      (
        await db.execute(
          sql`select goal_id from goal_water_link where organization_id='org-a' and user_id='user-a' and ended_at is null`,
        )
      ).rows[0]?.goal_id,
    ).toBe(competitorId);
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${waterId}`)).rows[0]
        ?.ended_at,
    ).not.toBeNull();
    await call("setStatus", {
      id: competitorId,
      version: 1,
      status: "paused",
      clientMutationId: "00000000-0000-4000-8000-000000000047",
    });
    await call("detail", { id: waterId });
    expect(
      (await db.execute(sql`select ended_at from goal_water_link where goal_id=${waterId}`)).rows[0]
        ?.ended_at,
    ).toBeNull();

    await call("setStatus", {
      id: waterId,
      version: 5,
      status: "paused",
      clientMutationId: "00000000-0000-4000-8000-000000000048",
    });
    await call("setStatus", {
      id: waterId,
      version: 6,
      status: "active",
      clientMutationId: "00000000-0000-4000-8000-000000000049",
    });
    await call("setStatus", {
      id: waterId,
      version: 7,
      status: "active",
      clientMutationId: "00000000-0000-4000-8000-000000000050",
    });
    expect(
      (
        await db.execute(
          sql`select event,count(*)::int as count from goal_lifecycle where goal_id=${waterId} and event in ('paused','resumed') group by event order by event`,
        )
      ).rows,
    ).toMatchObject([
      { event: "paused", count: 2 },
      { event: "resumed", count: 2 },
    ]);

    const targetDefinition = {
      id: "x",
      title: "Reach seven",
      source: "manual",
      metric: "score",
      unit: null,
      rule: { kind: "target", target: { kind: "minimum", value: 5 } },
      startDate: "2026-10-01",
      timeZone: "UTC",
      status: "active",
    };
    const target = await call("create", {
      definition: targetDefinition,
      clientMutationId: "00000000-0000-4000-8000-000000000033",
    });
    const targetId = (target.body as { id: number }).id;
    await call("createCheckin", {
      goalId: targetId,
      date: "2026-11-01",
      value: 7,
      clientMutationId: "00000000-0000-4000-8000-000000000034",
    });
    expect(
      (
        await call("update", {
          id: targetId,
          version: 1,
          definition: {
            ...targetDefinition,
            rule: { kind: "target", target: { kind: "minimum", value: 6 } },
          },
          clientMutationId: "00000000-0000-4000-8000-000000000035",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("update", {
          id: targetId,
          version: 1,
          definition: {
            ...targetDefinition,
            rule: { kind: "target", target: { kind: "range", minimum: 8, maximum: 9 } },
          },
          clientMutationId: "00000000-0000-4000-8000-000000000037",
        })
      ).status,
    ).toBe(409);
    const replacement = await call("create", {
      definition: {
        ...targetDefinition,
        rule: { kind: "target", target: { kind: "minimum", value: 6 } },
      },
      replacesId: targetId,
      replacesVersion: 1,
      clientMutationId: "00000000-0000-4000-8000-000000000036",
    });
    expect(replacement.status).toBe(200);
    expect(await call("detail", { id: targetId })).toMatchObject({
      status: 200,
      body: {
        replacement: { replacedById: (replacement.body as { id: number }).id },
        evaluation: { achieved: true },
      },
    });
    expect(await call("detail", { id: (replacement.body as { id: number }).id })).toMatchObject({
      status: 200,
      body: { replacement: { replacesId: targetId } },
    });
    expect(
      (await db.execute(sql`select deleted_at,status from goal where id=${targetId}`)).rows[0],
    ).toMatchObject({ deleted_at: null, status: "completed" });
    expect(
      (
        await db.execute(
          sql`select count(*)::int as count from goal_definition where goal_id=${targetId}`,
        )
      ).rows[0]?.count,
    ).toBe(1);
    expect(
      (
        await db.execute(
          sql`select count(*)::int as count from goal_lifecycle where goal_id=${targetId} and event='cancelled'`,
        )
      ).rows[0]?.count,
    ).toBe(1);

    const unfinished = await call("create", {
      definition: { ...targetDefinition, metric: "unfinished-score", title: "Unfinished target" },
      clientMutationId: "00000000-0000-4000-8000-000000000043",
    });
    const unfinishedId = (unfinished.body as { id: number }).id;
    const ended = await call("create", {
      definition: { ...targetDefinition, metric: "replacement-score", title: "Replacement target" },
      replacesId: unfinishedId,
      replacesVersion: 1,
      clientMutationId: "00000000-0000-4000-8000-000000000044",
    });
    expect(await call("detail", { id: unfinishedId })).toMatchObject({
      status: 200,
      body: {
        evaluation: { state: "completed", achieved: false },
        replacement: { replacedById: (ended.body as { id: number }).id },
      },
    });
  });

  test("same-day resume admits date-only evidence, resets streaks and starts fresh average coverage", async () => {
    const expectSuccess = async (responsePromise: ReturnType<typeof call>) => {
      const response = await responsePromise;
      expect(response).toMatchObject({ status: 200 });
      return response;
    };
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);
    const daily = {
      id: "resume-daily",
      title: "Daily after pause",
      source: "manual",
      metric: "practice",
      unit: null,
      rule: { kind: "recurring", cadence: "daily" },
      startDate: "2026-01-01",
      timeZone: "UTC",
      status: "active",
    };
    const dailyCreated = await expectSuccess(
      call("create", {
        definition: daily,
        clientMutationId: "00000000-0000-4000-8000-000000000060",
      }),
    );
    const dailyId = (dailyCreated.body as { id: number }).id;
    const unsupportedPause = await call("update", {
      id: dailyId,
      version: 1,
      definition: {
        ...daily,
        pauses: [{ startDate: today, endDate: today, unsupported: true }],
      },
      clientMutationId: "00000000-0000-4000-8000-000000000073",
    });
    expect(unsupportedPause).toMatchObject({ status: 400 });
    await expectSuccess(
      call("createCheckin", {
        goalId: dailyId,
        date: yesterday,
        completed: true,
        clientMutationId: "00000000-0000-4000-8000-000000000061",
      }),
    );
    await expectSuccess(
      call("setStatus", {
        id: dailyId,
        version: 1,
        status: "paused",
        clientMutationId: "00000000-0000-4000-8000-000000000062",
      }),
    );
    await expectSuccess(
      call("setStatus", {
        id: dailyId,
        version: 2,
        status: "active",
        clientMutationId: "00000000-0000-4000-8000-000000000063",
      }),
    );
    const todayCheckinResponse = await expectSuccess(
      call("createCheckin", {
        goalId: dailyId,
        date: today,
        completed: true,
        clientMutationId: "00000000-0000-4000-8000-000000000064",
      }),
    );
    const todayCheckin = todayCheckinResponse.body as { id: number; version: number };
    const dailyDetail = await call("detail", { id: dailyId });
    expect(dailyDetail.status).toBe(200);
    const detailCheckins = (dailyDetail.body as { checkins: unknown }).checkins;
    if (!Array.isArray(detailCheckins))
      throw new Error(
        `Goal detail returned non-array checkins: ${JSON.stringify(dailyDetail.body)}`,
      );
    // Bun 1.4.3's asymmetric matchers mutate matched arrays; preserve this raw
    // RPC payload because the evidence and check-ins are inspected below.
    expect(structuredClone(dailyDetail.body)).toMatchObject({
      checkins: expect.arrayContaining([expect.objectContaining({ date: today, completed: true })]),
      evidence: expect.arrayContaining([
        expect.objectContaining({ dateOnly: today, completed: true }),
      ]),
      evaluation: {
        currentStreak: 1,
        days: expect.arrayContaining([
          expect.objectContaining({ date: today, state: "qualifies" }),
        ]),
      },
      definition: {
        pauses: [
          {
            startDate: today,
            endDate: today,
            resumedOn: today,
            pausedAt: expect.any(String),
            resumedAt: expect.any(String),
          },
        ],
      },
    });
    const todayEvidence = (
      dailyDetail.body as { evidence: Array<Record<string, unknown>> }
    ).evidence.find((item) => item.dateOnly === today);
    expect(todayEvidence).toMatchObject({ dateOnly: today, completed: true });
    expect(todayEvidence).not.toHaveProperty("occurredAt");
    await expectSuccess(
      call("updateCheckin", {
        id: todayCheckin.id,
        goalId: dailyId,
        version: todayCheckin.version,
        date: today,
        completed: true,
        clientMutationId: "00000000-0000-4000-8000-000000000074",
      }),
    );

    const average = {
      ...daily,
      id: "resume-average",
      title: "Fresh average window",
      rule: { kind: "average", target: { kind: "minimum", value: 1 }, windowDays: 7 },
    };
    const averageCreated = await expectSuccess(
      call("create", {
        definition: average,
        clientMutationId: "00000000-0000-4000-8000-000000000065",
      }),
    );
    const averageId = (averageCreated.body as { id: number }).id;
    await expectSuccess(
      call("createCheckin", {
        goalId: averageId,
        date: yesterday,
        value: 9,
        clientMutationId: "00000000-0000-4000-8000-000000000066",
      }),
    );
    await expectSuccess(
      call("setStatus", {
        id: averageId,
        version: 1,
        status: "paused",
        clientMutationId: "00000000-0000-4000-8000-000000000067",
      }),
    );
    await expectSuccess(
      call("setStatus", {
        id: averageId,
        version: 2,
        status: "active",
        clientMutationId: "00000000-0000-4000-8000-000000000068",
      }),
    );
    await expectSuccess(
      call("createCheckin", {
        goalId: averageId,
        date: today,
        value: 2,
        clientMutationId: "00000000-0000-4000-8000-000000000069",
      }),
    );
    const averageDetail = await call("detail", { id: averageId });
    expect(averageDetail.status).toBe(200);
    expect(averageDetail).toMatchObject({
      body: {
        checkins: expect.arrayContaining([expect.objectContaining({ date: today, value: 2 })]),
        evaluation: { currentValue: 2, windowCoverage: { complete: false, coveredDays: 1 } },
      },
    });

    const weekly = {
      ...daily,
      id: "resume-weekly",
      title: "Weekly resume",
      rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 2 },
    };
    const weeklyCreated = await call("create", {
      definition: weekly,
      clientMutationId: "00000000-0000-4000-8000-000000000070",
    });
    const weeklyId = (weeklyCreated.body as { id: number }).id;
    await call("setStatus", {
      id: weeklyId,
      version: 1,
      status: "paused",
      clientMutationId: "00000000-0000-4000-8000-000000000071",
    });
    await call("setStatus", {
      id: weeklyId,
      version: 2,
      status: "active",
      clientMutationId: "00000000-0000-4000-8000-000000000072",
    });
    const monday = new Date(`${today}T00:00:00.000Z`);
    monday.setUTCDate(
      monday.getUTCDate() + (monday.getUTCDay() === 1 ? 7 : (8 - monday.getUTCDay()) % 7),
    );
    expect(await call("detail", { id: weeklyId })).toMatchObject({
      body: { definition: { pauses: [{ resumedOn: monday.toISOString().slice(0, 10) }] } },
    });
  });

  test("workout evidence latches source immutability before a workout is retired", async () => {
    const catalog = await db.execute(
      sql`insert into exercise (organization_id,source,name) values ('org-a','user','Test deadlift') returning id`,
    );
    const exerciseId = catalog.rows[0]!.id as number;
    const definition = {
      id: "ignored",
      title: "Deadlift",
      source: "workout",
      metric: `exercise:${exerciseId}`,
      unit: "kg",
      rule: { kind: "target", target: { kind: "minimum", value: 100 } },
      startDate: "2026-10-01",
      timeZone: "UTC",
      status: "active",
    };
    const created = await call("create", {
      definition,
      clientMutationId: "00000000-0000-4000-8000-000000000040",
    });
    const goalId = (created.body as { id: number }).id;
    const workouts = createWorkoutRepository(db);
    const workout = await db.transaction((tx) =>
      workouts.upsertWorkout(tx, "org-a", {
        userId: "user-a",
        date: "2026-11-01",
        type: "weights",
        exercises: [{ name: "Test deadlift", exerciseId, sets: [{ reps: 1, weightKg: 100 }] }],
      }),
    );
    expect(
      (await db.execute(sql`select ever_had_evidence from goal where id=${goalId}`)).rows[0]
        ?.ever_had_evidence,
    ).toBe(true);
    await db.transaction((tx) =>
      workouts.mutateWorkout(tx, {
        organizationId: "org-a",
        userId: "user-a",
        clientMutationId: "00000000-0000-4000-8000-000000000041",
        expectedScope: "user-a:org-a",
        operation: "delete",
        id: workout.id,
        expectedVersion: workout.version,
      }),
    );
    expect(
      (await db.execute(sql`select ever_had_evidence from goal where id=${goalId}`)).rows[0]
        ?.ever_had_evidence,
    ).toBe(true);
    expect(
      (
        await call("update", {
          id: goalId,
          version: 1,
          definition: { ...definition, source: "manual", metric: "score", unit: null },
          clientMutationId: "00000000-0000-4000-8000-000000000042",
        })
      ).status,
    ).toBe(409);
  });

  test("sourceLocked is a durable summary of evidence history, not current evidence rows", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const manualDefinition = {
      id: "source-lock-lifecycle",
      title: "Source lock lifecycle",
      source: "manual",
      metric: "practice",
      unit: null,
      rule: { kind: "target", target: { kind: "minimum", value: 100 } },
      startDate: today,
      timeZone: "UTC",
      status: "active",
    };
    const created = await call("create", {
      definition: manualDefinition,
      clientMutationId: "00000000-0000-4000-8000-000000000043",
    });
    expect(created.status).toBe(200);
    const goalId = (created.body as { id: number }).id;
    expect(created.body).toMatchObject({ sourceLocked: false });

    const waterDefinition = {
      ...manualDefinition,
      source: "water",
      metric: "water_ml",
      unit: "ml",
      rule: {
        kind: "recurring",
        cadence: "daily",
        completion: { kind: "minimum", value: 1000 },
      },
    };
    const changedToWater = await call("update", {
      id: goalId,
      version: 1,
      definition: waterDefinition,
      clientMutationId: "00000000-0000-4000-8000-000000000044",
    });
    expect(changedToWater.status).toBe(200);
    expect(changedToWater.body).toMatchObject({ sourceLocked: false });

    const changedBackToManual = await call("update", {
      id: goalId,
      version: 2,
      definition: {
        ...manualDefinition,
        rule: { kind: "target", target: { kind: "minimum", value: 5 } },
      },
      clientMutationId: "00000000-0000-4000-8000-000000000045",
    });
    expect(changedBackToManual.status).toBe(200);
    expect(changedBackToManual.body).toMatchObject({ sourceLocked: false });
    expect(await call("detail", { id: goalId })).toMatchObject({
      status: 200,
      body: { definition: { rule: { target: { value: 5 } } } },
    });

    const checkin = await call("createCheckin", {
      goalId,
      date: today,
      value: 1,
      clientMutationId: "00000000-0000-4000-8000-000000000046",
    });
    expect(checkin.status).toBe(200);
    const checkinId = (checkin.body as { id: number }).id;
    expect(await call("detail", { id: goalId })).toMatchObject({
      status: 200,
      body: { sourceLocked: true },
    });
    expect(
      await call("update", {
        id: goalId,
        version: 3,
        definition: {
          ...manualDefinition,
          rule: { kind: "target", target: { kind: "minimum", value: 5 } },
          unit: "reps",
        },
        clientMutationId: "00000000-0000-4000-8000-000000000049",
      }),
    ).toMatchObject({ status: 409 });

    const deleted = await call("deleteCheckin", {
      id: checkinId,
      goalId,
      version: 1,
      clientMutationId: "00000000-0000-4000-8000-000000000047",
    });
    expect(deleted.status).toBe(200);
    expect(await call("detail", { id: goalId })).toMatchObject({
      status: 200,
      body: { sourceLocked: true },
    });

    expect(
      await call("update", {
        id: goalId,
        version: 3,
        definition: waterDefinition,
        clientMutationId: "00000000-0000-4000-8000-000000000048",
      }),
    ).toMatchObject({ status: 409 });
  });

  test("retained deleted evidence locks the previous contract even when its latch is false", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const definition = {
      id: "retained-deleted-evidence-contract",
      title: "Retained evidence contract",
      source: "manual",
      metric: "water_ml",
      unit: "ml",
      rule: { kind: "target", target: { kind: "minimum", value: 100 } },
      startDate: today,
      timeZone: "UTC",
      status: "active",
    };
    const created = await call("create", {
      definition,
      clientMutationId: "00000000-0000-4000-8000-000000000050",
    });
    expect(created.status).toBe(200);
    const goalId = (created.body as { id: number }).id;
    const createdAt = `${today}T08:00:00.000Z`;
    const deletedAt = `${today}T09:00:00.000Z`;
    await db.execute(sql`
      insert into goal_checkin
        (organization_id, user_id, goal_id, date, value, created_at, deleted_at)
      values
        ('org-a', 'user-a', ${goalId}, ${today}, '150', ${createdAt}, ${deletedAt})
    `);
    expect(
      (await db.execute(sql`select ever_had_evidence from goal where id=${goalId}`)).rows[0]
        ?.ever_had_evidence,
    ).toBe(false);

    const sourceChanged = await call("update", {
      id: goalId,
      version: 1,
      definition: { ...definition, source: "water" },
      clientMutationId: "00000000-0000-4000-8000-000000000051",
    });
    expect(sourceChanged.status).toBe(409);
    const metricChanged = await call("update", {
      id: goalId,
      version: 1,
      definition: { ...definition, metric: "amount" },
      clientMutationId: "00000000-0000-4000-8000-000000000052",
    });
    expect(metricChanged.status).toBe(409);
    const unitChanged = await call("update", {
      id: goalId,
      version: 1,
      definition: { ...definition, unit: "kg" },
      clientMutationId: "00000000-0000-4000-8000-000000000053",
    });
    expect(unitChanged.status).toBe(409);

    expect(await call("detail", { id: goalId })).toMatchObject({
      status: 200,
      body: {
        sourceLocked: true,
        definition: { source: "manual", metric: "water_ml", unit: "ml" },
      },
    });
  });
});
