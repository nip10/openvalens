import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";

/**
 * #clinical-3: a person adds, corrects and removes cardiac exams, imaging
 * studies and family history by hand, scoped to the active workspace and
 * audited without the record's content.
 */
const url = process.env.CLINICAL_RECORDS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/clinical_records_test"
  )
    throw new Error("Empty disposable loopback clinical_records_test database required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-v": { org: "org-a", role: "viewer" },
  "user-d": { org: "org-b", role: "owner" },
};
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
          impersonatedBy: null,
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
    // Viewers read; the other roles also write.
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const wantsWrite = Object.values(body.permissions).some((actions) =>
        actions.includes("write"),
      );
      return { success: !(wantsWrite && MEMBERS[actor(headers)]?.role === "viewer") };
    },
  },
} as unknown as Auth;

describe.skipIf(!url)("clinical record writes over RPC and PostgreSQL", () => {
  const db: Database = createDb({
    DATABASE_URL: url ?? "postgres://127.0.0.1/clinical_records_test",
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
              impersonatedBy: null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-clinical-records",
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
    const request = new Request(`http://test.local/rpc/clinical/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched clinical RPC path");
    const body = (await response.json()) as { json: unknown };
    return { status: response.status, body: body.json };
  }

  const idOf = (result: { body: unknown }) => (result.body as { id: number }).id;

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
  });

  beforeEach(async () => {
    await db.execute(sql`delete from access_audit_log`);
    await db.execute(sql`delete from cardiac_measurement`);
    await db.execute(sql`delete from cardiac_exam`);
    await db.execute(sql`delete from imaging_study`);
    await db.execute(sql`delete from family_history`);
    await db.execute(sql`delete from member`);
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(sql`insert into "user" (id, email) values
      ('user-a', 'user-a@example.test'), ('user-v', 'user-v@example.test'),
      ('user-d', 'user-d@example.test')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-a', 'Synthetic A', 'synthetic-a'), ('org-b', 'Synthetic B', 'synthetic-b')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', 'org-a', 'user-a', 'owner'), ('m-v', 'org-a', 'user-v', 'viewer'),
      ('m-d', 'org-b', 'user-d', 'owner')`);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("a cardiac exam is created, corrected and deleted with its measurements", async () => {
    const created = await call("upsertCardiacExam", {
      date: "2026-04-01",
      type: " echocardiogram ",
      facility: "Synthetic Clinic",
      conclusion: "Synthetic conclusion",
      physician: "",
    });
    expect(created).toMatchObject({ status: 200, body: { created: true } });
    const id = idOf(created);
    expect((await call("listCardiacExams", {})).body).toMatchObject([
      {
        id,
        organizationId: "org-a",
        date: "2026-04-01",
        type: "echocardiogram",
        facility: "Synthetic Clinic",
        physician: null,
      },
    ]);

    // An imported exam keeps its measurements and source file through an edit.
    await db.execute(sql`update cardiac_exam set source_file = 'synthetic.pdf' where id = ${id}`);
    await db.execute(sql`insert into cardiac_measurement (organization_id, exam_id, name, value, unit)
      values ('org-a', ${id}, 'EF', 60, '%')`);
    expect(
      await call("upsertCardiacExam", {
        id,
        date: "2026-04-02",
        type: "echocardiogram",
        facility: null,
        conclusion: "Corrected",
      }),
    ).toMatchObject({ status: 200, body: { id, created: false } });
    const detail = (await call("getCardiacExam", { id })).body as {
      exam: Record<string, unknown>;
      measurements: unknown[];
    };
    expect(detail.exam).toMatchObject({
      date: "2026-04-02",
      facility: null,
      conclusion: "Corrected",
      sourceFile: "synthetic.pdf",
    });
    expect(detail.measurements).toHaveLength(1);

    expect(await call("deleteCardiacExam", { id })).toMatchObject({
      status: 200,
      body: { id, targetId: String(id) },
    });
    expect((await call("listCardiacExams", {})).body).toEqual([]);
    const left = await db.execute(sql`select count(*)::int as n from cardiac_measurement`);
    expect(left.rows[0]).toEqual({ n: 0 });

    const audit = (
      await db.execute(
        sql`select event_type, target_type,
              concat(before_json::text, after_json::text) as payload
            from access_audit_log order by id`,
      )
    ).rows as Array<{ event_type: string; target_type: string; payload: string }>;
    expect(audit.map((row) => row.event_type)).toEqual([
      "RECORD_CREATED",
      "RECORD_UPDATED",
      "RECORD_DELETED",
    ]);
    for (const row of audit) {
      expect(row.target_type).toBe("cardiac_exam");
      expect(row.payload).not.toContain("Synthetic");
      expect(row.payload).not.toContain("Corrected");
    }
  });

  test("an imaging study is created, corrected and deleted", async () => {
    const created = await call("upsertImagingStudy", {
      date: "2026-02-10",
      type: "mri",
      bodyPart: "Right knee",
      findings: "Synthetic findings",
    });
    expect(created.status).toBe(200);
    const id = idOf(created);
    expect(
      (
        await call("upsertImagingStudy", {
          id,
          date: "2026-02-11",
          type: "mri",
          bodyPart: "Left knee",
          findings: null,
        })
      ).status,
    ).toBe(200);
    expect((await call("getImagingStudy", { id })).body).toMatchObject({
      date: "2026-02-11",
      bodyPart: "Left knee",
      findings: null,
    });
    expect((await call("deleteImagingStudy", { id })).status).toBe(200);
    expect((await call("listImagingStudies", {})).body).toEqual([]);
  });

  test("family history is created, corrected and deleted", async () => {
    const id = idOf(
      await call("upsertFamilyHistoryEntry", {
        relation: "Mother",
        condition: "High blood pressure",
        ageOfOnset: 52,
      }),
    );
    await call("upsertFamilyHistoryEntry", {
      id,
      relation: "Mother",
      condition: "High blood pressure",
      ageOfOnset: null,
      notes: "Synthetic note",
    });
    expect((await call("listFamilyHistory", {})).body).toMatchObject([
      { id, relation: "Mother", ageOfOnset: null, notes: "Synthetic note" },
    ]);
    expect(await call("deleteFamilyHistoryEntry", { id })).toMatchObject({
      status: 200,
      body: { id },
    });
    expect((await call("listFamilyHistory", {})).body).toEqual([]);
  });

  test("another workspace cannot see, correct or delete the records", async () => {
    const exam = idOf(await call("upsertCardiacExam", { date: "2026-04-01", type: "ecg" }));
    const study = idOf(
      await call("upsertImagingStudy", { date: "2026-04-01", type: "ct", bodyPart: "Chest" }),
    );
    expect((await call("listCardiacExams", {}, "user-d")).body).toEqual([]);
    expect((await call("listImagingStudies", {}, "user-d")).body).toEqual([]);
    const foreignExam = { id: exam, date: "2026-01-01", type: "x" };
    expect((await call("upsertCardiacExam", foreignExam, "user-d")).status).toBe(404);
    const foreignStudy = { id: study, date: "2026-01-01", type: "x", bodyPart: "y" };
    expect((await call("upsertImagingStudy", foreignStudy, "user-d")).status).toBe(404);
    expect((await call("deleteCardiacExam", { id: exam }, "user-d")).body).toBeNull();
    expect((await call("deleteImagingStudy", { id: study }, "user-d")).body).toBeNull();
    expect((await call("getCardiacExam", { id: exam })).body).toMatchObject({
      exam: { date: "2026-04-01", type: "ecg" },
    });
    expect((await call("getImagingStudy", { id: study })).body).toMatchObject({
      bodyPart: "Chest",
    });
  });

  test("viewers read but cannot write, and ownership fields are rejected", async () => {
    expect((await call("listCardiacExams", {}, "user-v")).status).toBe(200);
    const exam = { date: "2026-04-01", type: "ecg" };
    expect((await call("upsertCardiacExam", exam, "user-v")).status).toBe(403);
    const study = { date: "2026-04-01", type: "ct", bodyPart: "Chest" };
    expect((await call("upsertImagingStudy", study, "user-v")).status).toBe(403);
    expect((await call("upsertCardiacExam", { ...exam, organizationId: "org-b" })).status).toBe(
      400,
    );
    expect((await call("upsertCardiacExam", { ...exam, date: "2026-02-30" })).status).toBe(400);
    const rows = await db.execute(sql`select count(*)::int as n from cardiac_exam`);
    expect(rows.rows[0]).toEqual({ n: 0 });
  });
});
