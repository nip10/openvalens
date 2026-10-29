import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { sql, type Database } from "@openvalens/db";
import {
  resolveSubject,
  writeSubjectJsonFiles,
  exportSubjectPhotoFiles,
  rowFilter,
} from "@openvalens/data-rights";
import type { StorageService } from "@openvalens/storage";
import { ZipFile } from "yazl";

const MAX_CONTENT_BYTES = 1024 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1_100_000_000;
const LEASE_MS = 30_000;
const BUILD_MS = 15 * 60_000;
const RESERVE_BYTES = 3 * 1024 * 1024 * 1024;
export const DEFAULT_DATA_EXPORT_DIR = "/var/lib/openvalens/exports";

type Claimed = {
  id: string;
  subject_user_id: string;
  attempt_id: string;
  organization_ids: string[];
};
type DbRows<T> = { rows: T[] };

function safeRelative(value: string): string {
  if (
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("unsafe export entry");
  return value;
}

async function* fileChunks(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path)) yield new Uint8Array(chunk as Buffer);
}

export type DataExportWorker = { start(): void; stop(): Promise<void> };

export function createDataExportWorker(input: {
  db: Database;
  storage: StorageService | null;
  directory?: string;
}): DataExportWorker {
  const ROOT = resolve(input.directory ?? DEFAULT_DATA_EXPORT_DIR);
  let stopped = false;
  let active: Promise<void> | null = null;
  let activeAbort: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tick(): Promise<void> {
    if (stopped || active) return;
    active = runOne()
      .catch(() => undefined)
      .finally(() => {
        active = null;
      });
    await active;
  }

  async function runOne(): Promise<void> {
    if (stopped) return;
    try {
      await mkdir(ROOT, { recursive: true, mode: 0o700 });
      await chmod(ROOT, 0o700);
      await cleanupExportArtifacts(ROOT, input.db);
    } catch {
      // Claim and fail one request below with a value-free storage category.
    }
    await input.db
      .execute(sql`update data_export_job set state = 'failed', failure = 'INTERRUPTED', completed_at = now(), lease_until = null, cleanup_pending='job'
      where state = 'running' and lease_until < now()`);
    await input.db.execute(sql`update data_export_job set state = 'expired', cleanup_pending='job'
      where state = 'ready' and expires_at <= now()`);
    const id = randomUUID();
    const result = await input.db.execute(sql`with worker_lock as (
      select pg_try_advisory_xact_lock(hashtextextended('openvalens:data-export-worker', 0)) as acquired
    ), candidate as (
      select j.id from data_export_job j, worker_lock
      where worker_lock.acquired and j.state = 'queued'
        and not exists (select 1 from data_export_job active where active.state = 'running' and active.lease_until > now())
      order by j.created_at for update of j skip locked limit 1
    ) update data_export_job j set state = 'running', started_at = now(),
      lease_until = now() + interval '30 seconds', attempt_id = ${id}::uuid
      from candidate where j.id = candidate.id
      returning j.id, j.subject_user_id, j.attempt_id, j.organization_ids`);
    const job = (result as unknown as DbRows<Claimed>).rows[0];
    if (!job) return;
    if (!job.subject_user_id) {
      await finish(job, "failed", "INTERRUPTED");
      return;
    }
    const dir = join(ROOT, job.id);
    const staging = join(dir, "staging");
    const archiveTmp = join(dir, "archive.tmp");
    const archive = join(dir, "archive.zip");
    const controller = new AbortController();
    activeAbort = controller;
    if (stopped) controller.abort();
    const heartbeat = setInterval(() => {
      void input.db
        .execute(sql`update data_export_job set lease_until = now() + interval '30 seconds'
        where id = ${job.id} and state = 'running' and attempt_id = ${job.attempt_id}`)
        .then((updated) => {
          if (updated.rowCount !== 1) controller.abort();
        })
        .catch(() => controller.abort());
    }, LEASE_MS / 2);
    const buildTimeout = setTimeout(() => controller.abort(), BUILD_MS);
    const started = Date.now();
    let written = 0;
    let metadataWritten = 0;
    try {
      try {
        await mkdir(ROOT, { recursive: true, mode: 0o700 });
        await chmod(ROOT, 0o700);
      } catch {
        throw Object.assign(new Error(), { safeCode: "STORAGE_UNAVAILABLE" });
      }
      await mkdir(staging, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      await chmod(staging, 0o700);
      const fsStat = await import("node:fs/promises").then((m) => m.statfs(ROOT));
      if (fsStat.bavail * fsStat.bsize < RESERVE_BYTES)
        throw Object.assign(new Error(), { safeCode: "STORAGE_UNAVAILABLE" });
      const scope = await resolveSubject(input.db, job.subject_user_id);
      if (!job.organization_ids.every((organizationId) => scope.subject.organizationIds.includes(organizationId)))
        throw Object.assign(new Error(), { safeCode: "INTERRUPTED" });
      const subject = { userId: job.subject_user_id, organizationIds: [...job.organization_ids] };
      const paths: string[] = [];
      const sink = {
        async write(relative: string, chunks: AsyncIterable<Uint8Array>) {
          safeRelative(relative);
          const target = join(staging, relative);
          await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
          const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
          const limited = (async function* () {
            for await (const chunk of chunks) {
              if (controller.signal.aborted || Date.now() - started > BUILD_MS)
                throw Object.assign(new Error(), { name: "AbortError" });
              written += chunk.byteLength;
              if (written > MAX_CONTENT_BYTES)
                throw Object.assign(new Error(), { safeCode: "LIMIT_EXCEEDED" });
              if (
                relative === "manifest.json" ||
                relative.startsWith("entities/") ||
                relative.endsWith("/manifest.json")
              ) {
                metadataWritten += chunk.byteLength;
                if (metadataWritten > MAX_METADATA_BYTES)
                  throw Object.assign(new Error(), { safeCode: "LIMIT_EXCEEDED" });
              }
              yield chunk;
            }
          })();
          await pipeline(Readable.from(limited), out);
          paths.push(relative);
        },
      };
      const listAttachments = async () => {
        const result = await input.db.execute(sql`select id, organization_id, purpose, content_type, size_bytes, sha256
        from stored_object where ${rowFilter("stored_object", subject)} and purpose <> 'progress_photo'
        order by id limit 10001`);
        return result.rows as {
        id: string;
        organization_id: string;
        purpose: string;
        content_type: string;
        size_bytes: number;
        sha256: string;
      }[];
      };
      const objectRows = await listAttachments();
      if (objectRows.length > 10_000)
        throw Object.assign(new Error(), { safeCode: "LIMIT_EXCEEDED" });
      await writeSubjectJsonFiles(input.db, subject, sink, { signal: controller.signal });
      const attachmentsAfterWriter = await listAttachments();
      if (JSON.stringify(attachmentsAfterWriter) !== JSON.stringify(objectRows))
        throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
      let attachmentCount = objectRows.length;
      if (objectRows.length && !input.storage)
        throw Object.assign(new Error(), { safeCode: "STORAGE_UNAVAILABLE" });
      if (!input.storage) {
        const photos = await input.db.execute(sql`select count(*)::int as n from stored_object
          where created_by_user_id = ${scope.subject.userId} and purpose = 'progress_photo'`);
        if (Number((photos.rows[0] as { n: number }).n) > 0)
          throw Object.assign(new Error(), { safeCode: "STORAGE_UNAVAILABLE" });
      }
      const attachmentManifest: {
        objectId: string;
        path: string;
        bytes: number;
        sha256: string;
        contentType: string;
      }[] = [];
      for (const candidate of objectRows) {
        if (controller.signal.aborted)
          throw Object.assign(new Error("Export aborted."), { name: "AbortError" });
        const expectedSize = Number(candidate.size_bytes);
        if (!Number.isSafeInteger(expectedSize) || expectedSize < 0)
          throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
        const object = await input.storage!.getObject({
          organizationId: candidate.organization_id,
          objectId: candidate.id,
        }).catch(() => {
          throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
        });
        if (
          !object ||
          object.object.sizeBytes !== expectedSize ||
          object.object.sha256 !== candidate.sha256 ||
          object.object.contentType !== candidate.content_type
        )
          throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
        const ext = ({
          "application/pdf": "pdf",
          "application/zip": "zip",
          "application/json": "json",
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/heic": "heic",
        } as Record<string, string>)[candidate.content_type];
        if (!ext) throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
        const path = `attachments/${candidate.id}.${ext}`;
        const digest = createHash("sha256");
        let actualBytes = 0;
        const reader = object.body.getReader();
        const abortRead = () => {
          void reader.cancel().catch(() => undefined);
        };
        controller.signal.addEventListener("abort", abortRead, { once: true });
        if (controller.signal.aborted) abortRead();
        const verified = (async function* () {
          try {
            for (;;) {
              if (controller.signal.aborted)
                throw Object.assign(new Error("Export aborted."), { name: "AbortError" });
              let item: Awaited<ReturnType<typeof reader.read>>;
              try {
                item = await reader.read();
              } catch {
                if (controller.signal.aborted)
                  throw Object.assign(new Error("Export aborted."), { name: "AbortError" });
                throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
              }
              if (item.done) break;
              actualBytes += item.value.byteLength;
              if (actualBytes > expectedSize)
                throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
              digest.update(item.value);
              yield item.value;
            }
          } finally {
            controller.signal.removeEventListener("abort", abortRead);
            reader.releaseLock();
          }
          if (controller.signal.aborted)
            throw Object.assign(new Error("Export aborted."), { name: "AbortError" });
          if (actualBytes !== expectedSize || digest.digest("hex") !== candidate.sha256)
            throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
        })();
        await sink.write(path, verified);
        attachmentManifest.push({
          objectId: candidate.id,
          path,
          bytes: actualBytes,
          sha256: candidate.sha256,
          contentType: candidate.content_type,
        });
      }
      await sink.write(
        "attachments/manifest.json",
        (async function* () {
          yield new TextEncoder().encode(
            JSON.stringify(
              { format: "openvalens-attachment-export", attachments: attachmentManifest },
              null,
              2,
            ) + "\n",
          );
        })(),
      );
      if (input.storage) {
        const photoReader = {
          maxObjectBytes: input.storage.maxObjectBytes,
          getSubjectPhoto: (photo: { subjectUserId: string; objectId: string }) =>
            input.storage!.getSubjectPhoto(photo),
        };
        try {
          for await (const file of exportSubjectPhotoFiles(
            input.db,
            photoReader,
            subject,
            new Date(),
            { signal: controller.signal },
          )) {
            if (file.kind === "file" && ++attachmentCount > 10_000)
              throw Object.assign(new Error(), { safeCode: "LIMIT_EXCEEDED" });
            if (file.kind === "manifest" && file.manifest.status !== "complete")
              throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
            const body =
              file.kind === "file"
                ? file.content
                : new TextEncoder().encode(JSON.stringify(file.manifest, null, 2) + "\n");
            await sink.write(
              file.path,
              (async function* () {
                yield body;
              })(),
            );
          }
        } catch (error) {
          if (error && typeof error === "object" && "safeCode" in error) throw error;
          throw Object.assign(new Error(), { safeCode: "ATTACHMENT_UNAVAILABLE" });
        }
      }
      if (controller.signal.aborted)
        throw Object.assign(new Error("Export aborted."), { name: "AbortError" });
      await zipFiles(staging, paths, archiveTmp, controller.signal);
      if (controller.signal.aborted)
        throw Object.assign(new Error("Export aborted."), { name: "AbortError" });
      const archiveStat = await stat(archiveTmp);
      if (archiveStat.size > MAX_ARCHIVE_BYTES)
        throw Object.assign(new Error(), { safeCode: "LIMIT_EXCEEDED" });
      await rename(archiveTmp, archive);
      const checksum = createHash("sha256");
      for await (const chunk of fileChunks(archive)) checksum.update(chunk);
      if (controller.signal.aborted)
        throw Object.assign(new Error("Export aborted."), { name: "AbortError" });
      const published = await input.db
        .execute(sql`update data_export_job set state = 'ready', completed_at = now(),
        expires_at = now() + interval '24 hours', bytes = ${archiveStat.size}, checksum = ${checksum.digest("hex")},
        lease_until = null where id = ${job.id} and state = 'running' and attempt_id = ${job.attempt_id}
        and subject_user_id is not null returning id`);
      if ((published as unknown as DbRows<{ id: string }>).rows.length !== 1)
        throw Object.assign(new Error(), { safeCode: "INTERRUPTED" });
    } catch (error) {
      const code =
        error && typeof error === "object" && "safeCode" in error
          ? String(error.safeCode)
          : error &&
              typeof error === "object" &&
              "code" in error &&
              ["SUBJECT_EXPORT_LIMIT", "SUBJECT_PHOTO_EXPORT_LIMIT"].includes(String(error.code))
            ? "LIMIT_EXCEEDED"
            : error instanceof Error && error.name === "AbortError"
              ? "INTERRUPTED"
              : error &&
                  typeof error === "object" &&
                  "code" in error &&
                  ["ENOSPC", "EACCES", "EROFS"].includes(String(error.code))
                ? "STORAGE_UNAVAILABLE"
                : "INTERNAL";
      await finish(
        job,
        "failed",
        [
          "LIMIT_EXCEEDED",
          "ATTACHMENT_UNAVAILABLE",
          "STORAGE_UNAVAILABLE",
          "INTERRUPTED",
          "INTERNAL",
        ].includes(code)
          ? code
          : "INTERNAL",
      );
      try {
        await rm(dir, { recursive: true, force: true });
        await input.db.execute(sql`update data_export_job set cleanup_pending = 'done'
          where id = ${job.id} and attempt_id = ${job.attempt_id}`);
      } catch {
        await input.db
          .execute(sql`update data_export_job set cleanup_pending = 'job'
          where id = ${job.id} and attempt_id = ${job.attempt_id}`)
          .catch(() => undefined);
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(buildTimeout);
      if (activeAbort === controller) activeAbort = null;
      if (Date.now() - started > BUILD_MS) controller.abort();
      await rm(staging, { recursive: true, force: true }).catch(async () => {
        await input.db
          .execute(sql`update data_export_job set cleanup_pending = 'staging'
          where id = ${job.id} and attempt_id = ${job.attempt_id}`)
          .catch(() => undefined);
      });
    }
  }

  async function finish(job: Claimed, state: string, failure: string): Promise<void> {
    await input.db.execute(sql`update data_export_job set state = ${state}::data_export_job_state,
      failure = ${failure}::data_export_failure, completed_at = now(), lease_until = null,
      cleanup_pending = 'job'
      where id = ${job.id} and attempt_id = ${job.attempt_id} and state = 'running'`);
  }

  return {
    start() {
      timer ??= setInterval(() => {
        void tick();
      }, 1000);
      void tick();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      activeAbort?.abort();
      await active;
    },
  };
}

async function zipFiles(
  root: string,
  paths: string[],
  target: string,
  signal: AbortSignal,
): Promise<void> {
  const zip = new ZipFile();
  const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
  let totalBytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_ARCHIVE_BYTES) {
        callback(Object.assign(new Error(), { safeCode: "LIMIT_EXCEEDED" }));
        return;
      }
      callback(null, chunk);
    },
  });
  const done = pipeline(zip.outputStream, limit, out, { signal });
  for (const path of paths)
    zip.addFile(join(root, safeRelative(path)), safeRelative(path), { compress: true });
  zip.end();
  await done;
}

/** Remove only UUID-named job directories; DB readiness determines retention. */
export async function cleanupExportArtifacts(root: string, db?: Database): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  if (db) {
    const pending = await db.execute(sql`select id, cleanup_pending, state, subject_user_id from data_export_job
      where cleanup_pending in ('job','staging') or (subject_user_id is null and cleanup_pending is distinct from 'done')`);
    for (const row of pending.rows as { id: string; cleanup_pending: string | null; state: string; subject_user_id: string | null }[]) {
      const dir = join(root, row.id);
      const deleteWholeJob = row.cleanup_pending === "job" ||
        ["failed", "cancelled", "expired"].includes(row.state) || row.subject_user_id === null;
      const target = deleteWholeJob ? dir : join(dir, "staging");
      try {
        await rm(target, { recursive: true, force: true });
        await db.execute(sql`update data_export_job set cleanup_pending = ${deleteWholeJob ? "done" : null}
          where id = ${row.id}`);
      } catch {
        await db
          .execute(sql`update data_export_job set cleanup_pending = 'pending' where id = ${row.id}`)
          .catch(() => undefined);
      }
    }
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.name)
    )
      continue;
    const dir = join(root, entry.name);
    const age = Date.now() - (await stat(dir)).mtimeMs;
    if (age > 24 * 60 * 60_000)
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
