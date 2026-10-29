import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createDb, sql } from "@openvalens/db";
import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StorageService } from "@openvalens/storage";
import { cleanupExportArtifacts, createDataExportWorker } from "./data-export-worker";
import { openAuthorizedExportArchive } from "./data-export-download";

const url = process.env.DATA_EXPORT_JOB_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/data_export_job_test"
  )
    throw new Error("Disposable loopback data_export_job_test database required.");
}
const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_export_job_test" });
const describeDb = url ? describe : describe.skip;
const subject = "export-worker-subject";
const attachmentSubject = "export-worker-attachment-subject";
const subjectOrg = "export-worker-subject-org";

describeDb("private data export worker", () => {
  let directory: string;
  beforeAll(async () => {
    const { migrateEmptyDatabase } = await import("@openvalens/data-rights/testing");
    await migrateEmptyDatabase(db);
    directory = await mkdtemp(join(tmpdir(), "openvalens-export-test-"));
    await db.execute(sql`insert into "user" (id,email) values
      (${subject},'export-worker@example.test'),
      (${attachmentSubject},'export-worker-attachment@example.test')`);
    await db.execute(sql`insert into organization(id,name,slug) values
      (${subjectOrg},'Export Worker Subject','export-worker-subject-org')`);
    await db.execute(sql`insert into member(id,organization_id,user_id,role) values
      ('export-worker-subject-owner',${subjectOrg},${subject},'owner')`);
    await db.execute(sql`insert into plain_water_entry
      (organization_id,user_id,quantity_ml,observed_at,time_zone,client_mutation_id)
      select ${subjectOrg},${subject},200+n,now()+n*interval '1 minute','UTC','worker-'||n::text
      from generate_series(1,201) n`);
  });
  afterAll(async () => {
    await db.execute(sql`delete from "user" where id in (${subject},${attachmentSubject})`);
    await db.execute(
      sql`delete from organization where id in (${subjectOrg},'export-worker-attachment-org')`,
    );
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test("publishes a readable ZIP only after completion; missing attachments fail closed", async () => {
    const worker = createDataExportWorker({ db, storage: null, directory });
    worker.start();
    try {
      const readyJob =
        await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids)
        values (${subject},${JSON.stringify([subjectOrg])}::jsonb) returning id`);
      const readyId = (readyJob.rows[0] as { id: string }).id;
      const ready = await waitFor(readyId);
      expect(ready).toMatchObject({ state: "ready", failure: null });
      const archive = join(directory, readyId, "archive.zip");
      const archiveStat = await stat(archive);
      expect(archiveStat.size).toBe(Number(ready.bytes));
      const signature = new Uint8Array(await Bun.file(archive).slice(0, 4).arrayBuffer());
      expect(Array.from(signature)).toEqual([0x50, 0x4b, 0x03, 0x04]);
      expect(
        Bun.spawnSync(["unzip", "-t", archive], { stdout: "ignore", stderr: "ignore" }).exitCode,
      ).toBe(0);
      const entityFile = Bun.spawnSync(
        ["unzip", "-p", archive, "entities/plain_water_entry.json"],
        {
          stdout: "pipe",
          stderr: "ignore",
        },
      );
      expect(entityFile.exitCode).toBe(0);
      expect(JSON.parse(entityFile.stdout.toString())).toHaveLength(201);
      const authorized = await openAuthorizedExportArchive({
        db,
        directory,
        jobId: readyId,
        userId: subject,
        impersonatedBy: null,
      });
      expect(authorized?.size).toBe(archiveStat.size);
      authorized?.body.destroy();
      expect(
        await openAuthorizedExportArchive({
          db,
          directory,
          jobId: readyId,
          userId: "other-export-worker",
          impersonatedBy: null,
        }),
      ).toBeNull();
      expect(
        await openAuthorizedExportArchive({
          db,
          directory,
          jobId: readyId,
          userId: subject,
          impersonatedBy: "operator",
        }),
      ).toBeNull();
      await db.execute(sql`update "user" set banned=true where id=${subject}`);
      expect(
        await openAuthorizedExportArchive({
          db,
          directory,
          jobId: readyId,
          userId: subject,
          impersonatedBy: null,
        }),
      ).toBeNull();
      await db.execute(sql`update "user" set banned=false where id=${subject}`);
      await db.execute(
        sql`update data_export_job set expires_at=now()-interval '1 second' where id=${readyId}`,
      );
      expect(
        await openAuthorizedExportArchive({
          db,
          directory,
          jobId: readyId,
          userId: subject,
          impersonatedBy: null,
        }),
      ).toBeNull();

      const org = "export-worker-attachment-org";
      const objectId = "d5f3f4ea-0e0d-4c28-aee6-7c9ea7a0de73";
      await db.execute(
        sql`insert into organization(id,name,slug) values (${org},'Export Worker','export-worker-org')`,
      );
      await db.execute(sql`insert into member(id,organization_id,user_id,role) values
        ('export-worker-owner',${org},${attachmentSubject},'owner')`);
      await db.execute(sql`insert into stored_object(id,organization_id,created_by_user_id,purpose,storage_key,content_type,size_bytes,sha256)
        values (${objectId},${org},${attachmentSubject},'lab_document',${`org/${org}/${objectId}`},'application/pdf',3,${"0".repeat(64)})`);
      const failedJob =
        await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids)
        values (${attachmentSubject},${JSON.stringify([org])}::jsonb) returning id`);
      const failedId = (failedJob.rows[0] as { id: string }).id;
      const failed = await waitFor(failedId);
      expect(failed).toMatchObject({
        state: "failed",
        failure: "STORAGE_UNAVAILABLE",
        bytes: null,
      });
      expect(await Bun.file(join(directory, failedId, "archive.zip")).exists()).toBe(false);
      await db.execute(sql`delete from stored_object where id=${objectId}`);
      const scopedJob =
        await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids)
        values (${attachmentSubject},${JSON.stringify([org])}::jsonb) returning id`);
      const scopedId = (scopedJob.rows[0] as { id: string }).id;
      expect(await waitFor(scopedId)).toMatchObject({ state: "ready", failure: null });
      const scopedArchive = await openAuthorizedExportArchive({
        db,
        directory,
        jobId: scopedId,
        userId: attachmentSubject,
        impersonatedBy: null,
      });
      expect(scopedArchive).not.toBeNull();
      scopedArchive?.body.destroy();
      await db.execute(sql`delete from member where id='export-worker-owner'`);
      expect(
        await openAuthorizedExportArchive({
          db,
          directory,
          jobId: scopedId,
          userId: attachmentSubject,
          impersonatedBy: null,
        }),
      ).toBeNull();
      await worker.stop();
      await db.execute(sql`insert into member(id,organization_id,user_id,role) values
        ('export-worker-owner',${org},${attachmentSubject},'owner')`);
      const corruptObjectId = "e5f3f4ea-0e0d-4c28-aee6-7c9ea7a0de73";
      const expectedBytes = new Uint8Array([1, 2, 3]);
      const expectedSha = createHash("sha256").update(expectedBytes).digest("hex");
      await db.execute(sql`insert into stored_object(id,organization_id,created_by_user_id,purpose,storage_key,content_type,size_bytes,sha256)
        values (${corruptObjectId},${org},${attachmentSubject},'lab_document',${`org/${org}/${corruptObjectId}`},'application/pdf',3,${expectedSha})`);
      let reads = 0;
      const fakeStorage = {
        maxObjectBytes: 1024,
        getObject: async () => {
          const bytes = reads++ === 0 ? expectedBytes : new Uint8Array([3, 2, 1]);
          return {
            object: { sizeBytes: 3, sha256: expectedSha, contentType: "application/pdf" },
            body: new Response(bytes).body!,
          };
        },
        getSubjectPhoto: async () => null,
      } as unknown as StorageService;
      const corruptWorker = createDataExportWorker({ db, storage: fakeStorage, directory });
      corruptWorker.start();
      try {
        const validJob =
          await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids)
          values (${attachmentSubject},${JSON.stringify([org])}::jsonb) returning id`);
        const validId = (validJob.rows[0] as { id: string }).id;
        expect(await waitFor(validId)).toMatchObject({ state: "ready", failure: null });
        const validArchive = join(directory, validId, "archive.zip");
        expect(
          Bun.spawnSync(["unzip", "-t", validArchive], { stdout: "ignore", stderr: "ignore" })
            .exitCode,
        ).toBe(0);
        expect(
          Bun.spawnSync(["unzip", "-p", validArchive, `attachments/${corruptObjectId}.pdf`], {
            stdout: "pipe",
            stderr: "ignore",
          }).stdout,
        ).toEqual(Buffer.from(expectedBytes));
        const corruptJob =
          await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids)
          values (${attachmentSubject},${JSON.stringify([org])}::jsonb) returning id`);
        const corruptId = (corruptJob.rows[0] as { id: string }).id;
        expect(await waitFor(corruptId)).toMatchObject({
          state: "failed",
          failure: "ATTACHMENT_UNAVAILABLE",
          bytes: null,
        });
        expect(await Bun.file(join(directory, corruptId, "archive.zip")).exists()).toBe(false);
      } finally {
        await corruptWorker.stop();
      }
    } finally {
      await worker.stop();
    }
  });

  test("cleanup retries staging separately and removes cancelled job archives", async () => {
    const created =
      await db.execute(sql`insert into data_export_job(subject_user_id,organization_ids,state,expires_at)
      values (${subject},'[]'::jsonb,'ready',now()+interval '1 hour') returning id`);
    const id = (created.rows[0] as { id: string }).id;
    const jobDir = join(directory, id);
    const staging = join(jobDir, "staging");
    const archive = join(jobDir, "archive.zip");
    await mkdir(staging, { recursive: true, mode: 0o700 });
    await writeFile(join(staging, "partial"), "temporary");
    await writeFile(archive, "private archive");
    await db.execute(sql`update data_export_job set cleanup_pending='staging' where id=${id}`);
    await cleanupExportArtifacts(directory, db);
    await expect(access(join(staging, "partial"))).rejects.toThrow();
    // Bun resolves fs.promises.access with null, so assert existence directly.
    expect(existsSync(archive)).toBe(true);
    await db.execute(
      sql`update data_export_job set state='cancelled', cleanup_pending='job' where id=${id}`,
    );
    await cleanupExportArtifacts(directory, db);
    await expect(access(archive)).rejects.toThrow();
  });

  async function waitFor(
    id: string,
  ): Promise<{ state: string; failure: string | null; bytes: number | null }> {
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = await db.execute(
        sql`select state,failure,bytes from data_export_job where id=${id}`,
      );
      const row = result.rows[0] as { state: string; failure: string | null; bytes: number | null };
      if (row.state !== "queued" && row.state !== "running") return row;
      await Bun.sleep(100);
    }
    throw new Error("Export worker did not settle within the integration-test deadline.");
  }
});
