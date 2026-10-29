import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import type { Context } from "../context";
import { dataRightsRouter } from "./data-rights";

const url = process.env.DATA_EXPORT_JOB_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/data_export_job_test"
  )
    throw new Error("Empty disposable loopback data_export_job_test database required.");
}
const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_export_job_test" });
const describeDb = url ? describe : describe.skip;

describeDb("data export job persistence", () => {
  beforeAll(async () => {
    const { migrateEmptyDatabase } = await import("@openvalens/data-rights/testing");
    await migrateEmptyDatabase(db);
    await db.execute(
      sql`insert into "user" (id,email) values
        ('export-job-subject','export-job@example.test'),
        ('export-delete-subject','export-delete@example.test'),
        ('api-export-subject','api-export@example.test'),
        ('other-export-subject','other-export@example.test')`,
    );
  });
  afterAll(async () => {
    await db.execute(sql`delete from "user" where id in
      ('export-job-subject','export-delete-subject','api-export-subject','other-export-subject')`);
  });

  test("API requests are idempotent while active, subject-scoped, cancellable, and rate-limited", async () => {
    const contextFor = (userId: string) =>
      ({
        db,
        session: {
          user: { id: userId, email: `${userId}@example.test`, name: null },
          session: {
            id: `session-${userId}`,
            userId,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            impersonatedBy: null,
          },
        },
      }) as unknown as Context;
    const request = () =>
      dataRightsRouter.exportRequest.callable({ context: contextFor("api-export-subject") })({});
    const first = await request();
    const sameActive = await request();
    expect(sameActive.id).toBe(first.id);

    await dataRightsRouter.exportCancel.callable({ context: contextFor("other-export-subject") })({
      jobId: first.id,
    });
    const stillOwned = await db.execute(
      sql`select state from data_export_job where id=${first.id}`,
    );
    expect((stillOwned.rows[0] as { state: string }).state).toBe("queued");
    await dataRightsRouter.exportCancel.callable({ context: contextFor("api-export-subject") })({
      jobId: first.id,
    });

    const second = await request();
    await dataRightsRouter.exportCancel.callable({ context: contextFor("api-export-subject") })({
      jobId: second.id,
    });
    const third = await request();
    await dataRightsRouter.exportCancel.callable({ context: contextFor("api-export-subject") })({
      jobId: third.id,
    });
    await expect(request()).rejects.toMatchObject({ code: "CONFLICT" });
    const status = await dataRightsRouter.exportStatus.callable({
      context: contextFor("api-export-subject"),
    })({});
    expect(status).toMatchObject({ id: third.id, state: "cancelled" });
  });

  test("claims jobs once and fences stale/cancelled attempts", async () => {
    const created =
      await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids)
      values ('export-job-subject','[]'::jsonb) returning id`);
    const id = (created.rows[0] as { id: string }).id;
    const claim = () =>
      db.execute(sql`with candidate as (
        select id from data_export_job where state = 'queued' order by created_at for update skip locked limit 1
      ) update data_export_job j set state='running', attempt_id=gen_random_uuid(), lease_until=now()+interval '30 seconds'
      from candidate where j.id=candidate.id returning j.id,j.attempt_id`);
    const [a, b] = await Promise.all([claim(), claim()]);
    expect([...a.rows, ...b.rows].filter((row) => (row as { id: string }).id === id)).toHaveLength(
      1,
    );
    const current = await db.execute(sql`select attempt_id from data_export_job where id=${id}`);
    const attempt = (current.rows[0] as { attempt_id: string }).attempt_id;
    await db.execute(
      sql`update data_export_job set state='cancelled', attempt_id=null where id=${id}`,
    );
    const stalePublish =
      await db.execute(sql`update data_export_job set state='ready' where id=${id}
      and state='running' and attempt_id=${attempt} returning id`);
    expect(stalePublish.rows).toHaveLength(0);
  });

  test("subject deletion nulls owner and makes archive non-authorizable", async () => {
    const result =
      await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids,state,expires_at)
      values ('export-delete-subject','[]'::jsonb,'ready',now()+interval '1 hour') returning id`);
    const id = (result.rows[0] as { id: string }).id;
    await db.execute(sql`delete from "user" where id='export-delete-subject'`);
    const row = await db.execute(
      sql`select subject_user_id,state from data_export_job where id=${id}`,
    );
    expect(row.rows[0]).toMatchObject({ subject_user_id: null, state: "ready" });
  });
});
