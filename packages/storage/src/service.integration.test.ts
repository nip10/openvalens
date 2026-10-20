import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, sql, type Database } from "@openvalens/db";

import { buildObjectKey, newObjectId, parseObjectKey } from "./keys";
import { StorageError } from "./object-storage";
import { LocalObjectStorage } from "./providers/local";
import { S3ObjectStorage } from "./providers/s3";
import { createStorageService, type StorageService } from "./service";
import { deriveStorageSigningKey } from "./signed-url";

/**
 * Storage service against a disposable PostgreSQL (Issue #62): metadata,
 * tenant scoping, limits, signed downloads and erasure. Set
 * `STORAGE_TEST_DATABASE_URL` (see scripts/test-integration.sh). When
 * `STORAGE_S3_TEST_ENDPOINT` is also set, the S3 case runs against MinIO.
 */
const url = process.env.STORAGE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/storage_test")
    throw new Error("Empty disposable loopback storage_test database required.");
}

const MIGRATIONS_ROOT = new URL("../../db/src/migrations/", import.meta.url);

async function migrate(db: Database): Promise<void> {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) throw new Error("Integration database must be empty.");
  for (const directory of (await readdir(MIGRATIONS_ROOT)).filter((n) => /^\d/.test(n)).sort()) {
    const text = await Bun.file(new URL(`${directory}/migration.sql`, MIGRATIONS_ROOT)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const SIGNING_KEY = deriveStorageSigningKey("synthetic-server-secret-at-least-32-chars");
const BASE = "https://health.example.test";
const A = { organizationId: "org-a", createdByUserId: "user-a" };
const B = { organizationId: "org-b", createdByUserId: "user-b" };
const photo = new TextEncoder().encode("synthetic jpeg bytes");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe.skipIf(!url)("storage service against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/storage_test" });
  let root: string;
  let service: StorageService;
  let clock = new Date("2026-10-15T12:00:00Z");

  beforeAll(async () => {
    await migrate(db);
    await db.execute(sql`create table photo_link_test (object_id text primary key)`);
    for (const who of ["a", "b"]) {
      await db.execute(
        sql.raw(`
        insert into "user" (id, email) values ('user-${who}', '${who}@example.test');
        insert into organization (id, name, slug) values ('org-${who}', 'Record ${who}', 'record-${who}');
        insert into member (id, organization_id, user_id, role) values ('m-${who}', 'org-${who}', 'user-${who}', 'owner');
      `),
      );
    }
    root = await mkdtemp(join(tmpdir(), "ov-storage-svc-"));
    service = createStorageService({
      db,
      storage: new LocalObjectStorage(root),
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("putObject stores bytes under an opaque key with checksum metadata", async () => {
    const object = await service.putObject({
      ...A,
      purpose: "lab_document",
      contentType: "APPLICATION/PDF; charset=binary",
      body: photo,
    });
    expect(object).toMatchObject({
      organizationId: "org-a",
      createdByUserId: "user-a",
      purpose: "lab_document",
      contentType: "application/pdf",
      sizeBytes: photo.byteLength,
      sha256: sha(photo),
    });
    const [row] = (
      await db.execute(sql`select storage_key from stored_object where id = ${object.id}`)
    ).rows as { storage_key: string }[];
    expect(parseObjectKey(row!.storage_key)).toEqual({
      organizationId: "org-a",
      objectId: object.id,
    });

    const got = await service.getObject({ organizationId: "org-a", objectId: object.id });
    expect(new Uint8Array(await new Response(got!.body).arrayBuffer())).toEqual(photo);
  });

  test("accepts stream and blob bodies within the limit", async () => {
    const stream = new Blob([photo]).stream();
    const fromStream = await service.putObject({
      ...A,
      purpose: "lab_document",
      contentType: "application/pdf",
      body: stream,
    });
    expect(fromStream.sha256).toBe(sha(photo));
    const fromBlob = await service.putObject({
      ...A,
      purpose: "clinical_export",
      contentType: "application/pdf",
      body: new Blob([photo]),
    });
    expect(fromBlob.sizeBytes).toBe(photo.byteLength);
  });

  test("refuses disallowed types and oversized bodies before writing anything", async () => {
    const before = await service.listObjects({ organizationId: "org-a" });
    for (const [purpose, contentType] of [
      ["lab_document", "image/svg+xml"],
      ["lab_document", "text/html"],
      ["clinical_export", "image/jpeg"],
    ] as const) {
      const error = await service
        .putObject({ ...A, purpose, contentType, body: photo })
        .catch((e: unknown) => e);
      expect((error as StorageError).category).toBe("unsupported_type");
    }
    for (const body of [new Uint8Array(65), new Blob([new Uint8Array(65)]).stream()]) {
      const error = await service
        .putObject({ ...A, purpose: "lab_document", contentType: "application/pdf", body })
        .catch((e: unknown) => e);
      expect((error as StorageError).category).toBe("too_large");
    }
    expect(await service.listObjects({ organizationId: "org-a" })).toHaveLength(before.length);
  });

  test("another organization cannot find, read, sign or delete the object", async () => {
    const object = await service.putObject({
      ...A,
      purpose: "lab_document",
      contentType: "application/pdf",
      body: photo,
    });
    const asB = { organizationId: "org-b", objectId: object.id };
    expect(await service.findObject(asB)).toBeNull();
    expect(await service.getObject(asB)).toBeNull();
    expect(await service.createDownloadUrl(asB)).toBeNull();
    expect(await service.deleteObject(asB)).toBe("not_found");
    expect((await service.listObjects({ organizationId: "org-b" })).map((o) => o.id)).not.toContain(
      object.id,
    );
    expect(
      await service.findObject({ organizationId: "org-a", objectId: object.id }),
    ).not.toBeNull();
  });

  test("signed local downloads work once, then expire; forged ones are refused", async () => {
    const object = await service.putObject({
      ...A,
      purpose: "lab_document",
      contentType: "application/pdf",
      body: photo,
    });
    const link = await service.createDownloadUrl(
      { organizationId: "org-a", objectId: object.id },
      60,
    );
    expect(link!.url.startsWith(`/api/storage/objects/${object.id}?`)).toBe(true);
    expect(link!.expiresAt.getTime() - clock.getTime()).toBe(60_000);

    const ok = await service.serveSignedDownload(new URL(link!.url, BASE));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("content-disposition")).toBe("attachment");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(photo);

    const forged = new URL(link!.url, BASE);
    forged.searchParams.set("e", String(Number(forged.searchParams.get("e")) + 3600));
    expect((await service.serveSignedDownload(forged)).status).toBe(403);

    const saved = clock;
    clock = new Date(clock.getTime() + 61_000);
    expect((await service.serveSignedDownload(new URL(link!.url, BASE))).status).toBe(403);
    clock = saved;

    expect(await service.deleteObject({ organizationId: "org-a", objectId: object.id })).toBe(
      "deleted",
    );
    expect((await service.serveSignedDownload(new URL(link!.url, BASE))).status).toBe(404);
  });

  test("download TTL is capped at the configured maximum", async () => {
    const object = await service.putObject({
      ...A,
      purpose: "lab_document",
      contentType: "application/pdf",
      body: photo,
    });
    const link = await service.createDownloadUrl(
      { organizationId: "org-a", objectId: object.id },
      86_400,
    );
    expect(link!.expiresAt.getTime() - clock.getTime()).toBe(300_000);
  });

  test("subject erasure: collect keys before, delete bytes after", async () => {
    const object = await service.putObject({
      ...B,
      purpose: "lab_document",
      contentType: "application/pdf",
      body: photo,
    });
    const keys = await service.collectOrganizationKeys(["org-b"]);
    expect(keys).toHaveLength(1);
    await db.execute(sql`delete from organization where id = 'org-b'`);
    expect(await service.deleteKeys(keys)).toEqual({ deleted: 1, failed: 0 });
    expect(await new LocalObjectStorage(root).head(keys[0]!)).toBeNull();
    expect(await service.findObject({ organizationId: "org-b", objectId: object.id })).toBeNull();
    expect(await service.collectOrganizationKeys([])).toEqual([]);
  });

  test("an erased uploader is nulled; the object stays with its record", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-c', 'c@example.test');
      insert into member (id, organization_id, user_id, role) values ('m-c', 'org-a', 'user-c', 'member');
    `),
    );
    const object = await service.putObject({
      organizationId: "org-a",
      createdByUserId: "user-c",
      purpose: "lab_document",
      contentType: "application/pdf",
      body: photo,
    });
    await db.execute(sql`delete from member where id = 'm-c'`);
    await db.execute(sql`delete from "user" where id = 'user-c'`);
    expect(
      (await service.findObject({ organizationId: "org-a", objectId: object.id }))?.createdByUserId,
    ).toBeNull();
  });

  test("readiness probe reports writable and unwritable storage", async () => {
    expect(await service.probe()).toBe("ok");
    const file = join(root, "not-a-dir");
    await Bun.write(file, "x");
    const broken = createStorageService({
      db,
      storage: new LocalObjectStorage(file),
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
    });
    expect(await broken.probe()).toBe("unwritable");
  });

  test("photo reservation stays hidden until publication and links atomically", async () => {
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    expect(await service.findObject(ref)).toBeNull();
    expect(await service.getObject(ref)).toBeNull();
    expect(await service.createDownloadUrl(ref)).toBeNull();
    const [pending] = (
      await db.execute(
        sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
      )
    ).rows as { photo_state: string; photo_write_state: string }[];
    expect(pending).toEqual({ photo_state: "pending", photo_write_state: "not_started" });
    await service.writePhoto({
      ref,
      bytes: photo,
      linkPhoto: async (tx, object) => {
        await tx.execute(sql`insert into photo_link_test (object_id) values (${object.id})`);
      },
    });
    expect(
      (
        await db.execute(
          sql`select object_id from photo_link_test where object_id = ${ref.objectId}`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(await service.findObject(ref)).toMatchObject({
      purpose: "progress_photo",
      sha256: sha(photo),
    });
    expect(
      new Uint8Array(await new Response((await service.getObject(ref))!.body).arrayBuffer()),
    ).toEqual(photo);
  });

  test("deletePhoto removes a ready photo and is harmless when repeated", async () => {
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined });
    const [key] = (
      await db.execute(sql`select storage_key from stored_object where id = ${ref.objectId}`)
    ).rows as { storage_key: string }[];
    expect(await service.deletePhoto(ref)).toBe("deleted");
    expect(await new LocalObjectStorage(root).head(key!.storage_key)).toBeNull();
    expect(
      (await db.execute(sql`select id from stored_object where id = ${ref.objectId}`)).rows,
    ).toHaveLength(0);
    expect(
      (await db.execute(sql`select id from photo_cleanup_intent where id = ${ref.objectId}`)).rows,
    ).toHaveLength(0);
    expect(await service.deletePhoto(ref)).toBe("not_found");
  });

  test("delete failure persists for retry and cleanup succeeds after restart-equivalent retry", async () => {
    let failDelete = true;
    const adapter = new LocalObjectStorage(root);
    const wrapped = Object.create(adapter) as LocalObjectStorage;
    wrapped.put = (...args) => adapter.put(...args);
    wrapped.get = (...args) => adapter.get(...args);
    wrapped.head = (...args) => adapter.head(...args);
    wrapped.delete = (...args) => adapter.delete(...args);
    wrapped.deleteWithStaging = async (key, stagingId) => {
      if (failDelete) throw new Error("synthetic delete failure");
      return adapter.deleteWithStaging(key, stagingId);
    };
    const isolated = createStorageService({
      db,
      storage: wrapped,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const ref = await isolated.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/png",
      canonicalBytes: photo,
    });
    await isolated.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined });
    expect(await isolated.deletePhoto(ref)).toBe("pending");
    expect(
      (await db.execute(sql`select id from photo_cleanup_intent where id = ${ref.objectId}`)).rows,
    ).toHaveLength(1);
    const originalClock = clock;
    clock = new Date(clock.getTime() + 5000);
    failDelete = false;
    try {
      expect(await isolated.cleanupPhotos({ limit: 5 })).toMatchObject({
        deleted: 1,
        pending: 0,
        blocked: 0,
      });
    } finally {
      clock = originalClock;
    }
    expect(await isolated.deletePhoto(ref)).toBe("not_found");
  });

  test("database row-removal failure after DELETE retains intent for idempotent retry", async () => {
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined });
    const [key] = (
      await db.execute(sql`select storage_key from stored_object where id = ${ref.objectId}`)
    ).rows as { storage_key: string }[];
    await db.execute(
      sql`create function reject_photo_row_delete() returns trigger language plpgsql as $$ begin raise exception 'row removal blocked'; end $$`,
    );
    await db.execute(
      sql`create trigger reject_photo_row_delete_before before delete on stored_object for each row execute function reject_photo_row_delete()`,
    );
    try {
      expect(await service.deletePhoto(ref)).toBe("pending");
      expect(await new LocalObjectStorage(root).head(key!.storage_key)).toBeNull();
      expect(
        (await db.execute(sql`select id from stored_object where id = ${ref.objectId}`)).rows,
      ).toHaveLength(1);
      expect(
        (await db.execute(sql`select id from photo_cleanup_intent where id = ${ref.objectId}`))
          .rows,
      ).toHaveLength(1);
    } finally {
      await db.execute(sql`drop trigger reject_photo_row_delete_before on stored_object`);
      await db.execute(sql`drop function reject_photo_row_delete()`);
    }
    const originalClock = clock;
    clock = new Date(clock.getTime() + 5000);
    try {
      expect(await service.cleanupPhotos({ limit: 5 })).toMatchObject({ deleted: 1, pending: 0 });
    } finally {
      clock = originalClock;
    }
    expect(
      (await db.execute(sql`select id from stored_object where id = ${ref.objectId}`)).rows,
    ).toHaveLength(0);
    expect(
      (await db.execute(sql`select id from photo_cleanup_intent where id = ${ref.objectId}`)).rows,
    ).toHaveLength(0);
  });

  test("legacy unknown-provenance photo remains blocked without adapter I/O", async () => {
    const id = newObjectId();
    const key = buildObjectKey("org-a", id);
    const adapter = new LocalObjectStorage(root);
    await adapter.put(key, photo, { contentType: "image/jpeg", sha256: sha(photo) });
    await db.execute(
      sql`insert into stored_object (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256) values (${id}, 'org-a', 'user-a', 'progress_photo', ${key}, 'image/jpeg', ${photo.byteLength}, ${sha(photo)})`,
    );
    let ioCalls = 0;
    const wrapped = Object.create(adapter) as LocalObjectStorage;
    wrapped.delete = async (...args) => {
      ioCalls += 1;
      return adapter.delete(...args);
    };
    wrapped.deleteWithStaging = async (objectKey, stagingId) => {
      ioCalls += 1;
      return adapter.deleteWithStaging(objectKey, stagingId);
    };
    const isolated = createStorageService({
      db,
      storage: wrapped,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const ref = { organizationId: "org-a", objectId: id, createdByUserId: "user-a" };
    const oldLocalLink = await isolated.createDownloadUrl(ref);
    expect(await isolated.deletePhoto(ref)).toBe("pending");
    expect(
      await isolated.deleteObject({ organizationId: ref.organizationId, objectId: ref.objectId }),
    ).toBe("pending");
    expect(await isolated.findObject(ref)).toBeNull();
    expect(await isolated.getObject(ref)).toBeNull();
    expect(await isolated.createDownloadUrl(ref)).toBeNull();
    expect(
      (await isolated.listObjects({ organizationId: "org-a", purpose: "progress_photo" })).some(
        (row) => row.id === id,
      ),
    ).toBe(false);
    expect(
      (
        await isolated.serveSignedDownload(
          new URL(oldLocalLink!.url, "https://health.example.test"),
        )
      ).status,
    ).toBe(404);
    const originalClock = clock;
    clock = new Date(clock.getTime() + 5000);
    try {
      expect(await isolated.cleanupPhotos({ limit: 5 })).toMatchObject({ blocked: 1, deleted: 0 });
    } finally {
      clock = originalClock;
    }
    expect(ioCalls).toBe(0);
    expect(await adapter.head(key)).not.toBeNull();
    expect(
      (
        await db.execute(
          sql`select storage_provider, storage_store_id from photo_cleanup_intent where id = ${id}`,
        )
      ).rows,
    ).toEqual([{ storage_provider: null, storage_store_id: null }]);
  });

  test("store identity mismatch remains durably blocked without adapter I/O", async () => {
    const originalClock = clock;
    let ioCalls = 0;
    const adapter = new LocalObjectStorage(root);
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.deleteWithStaging = async (...args) => {
      ioCalls += 1;
      return adapter.deleteWithStaging(...args);
    };
    const isolated = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await db.execute(
      sql`update stored_object set storage_store_id = 'different-store' where id = ${ref.objectId}`,
    );
    expect(await isolated.deletePhoto(ref)).toBe("pending");
    try {
      clock = new Date(clock.getTime() + 5000);
      expect(await isolated.cleanupPhotos({ limit: 5 })).toMatchObject({ blocked: 1 });
    } finally {
      clock = originalClock;
    }
    expect(ioCalls).toBe(0);
    expect(
      (
        await db.execute(
          sql`select storage_store_id from photo_cleanup_intent where id = ${ref.objectId}`,
        )
      ).rows,
    ).toEqual([{ storage_store_id: "different-store" }]);
  });

  test("cleanup worker limits mixed due work to the requested batch", async () => {
    const originalClock = clock;
    const refs = await Promise.all(
      Array.from({ length: 3 }, () =>
        service.reservePhoto({
          organizationId: "org-a",
          createdByUserId: "user-a",
          contentType: "image/jpeg",
          canonicalBytes: photo,
        }),
      ),
    );
    for (const ref of refs) {
      await db.execute(
        sql`update stored_object set storage_store_id = 'mismatched-store' where id = ${ref.objectId}`,
      );
      expect(await service.deletePhoto(ref)).toBe("pending");
    }
    try {
      clock = new Date(clock.getTime() + 5000);
      const report = await service.cleanupPhotos({ limit: 2 });
      expect(report.scanned).toBeLessThanOrEqual(2);
      expect(
        report.blocked + report.pending + report.deleted + report.failed + report.skipped,
      ).toBe(report.scanned);
      expect(report.blocked).toBeGreaterThan(0);
    } finally {
      clock = originalClock;
    }
  });

  test("stale oversized writer cannot enqueue cleanup while publisher holds the row lock", async () => {
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    let insideLink!: () => void;
    let release!: () => void;
    const inLink = new Promise<void>((resolve) => {
      insideLink = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publisher = service.writePhoto({
      ref,
      bytes: photo,
      linkPhoto: async () => {
        insideLink();
        await held;
      },
    });
    await inLink;
    await expect(
      service.writePhoto({ ref, bytes: new Uint8Array(65), linkPhoto: async () => undefined }),
    ).rejects.toBeInstanceOf(StorageError);
    release();
    await publisher;
    const state = await db.execute(
      sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
    );
    const intents = await db.execute(
      sql`select id from photo_cleanup_intent where storage_key = (select storage_key from stored_object where id = ${ref.objectId})`,
    );
    expect(state.rows).toEqual([{ photo_state: "ready", photo_write_state: "settled" }]);
    expect(intents.rows).toHaveLength(0);
    expect(
      new Uint8Array(await new Response((await service.getObject(ref))!.body).arrayBuffer()),
    ).toEqual(photo);
  });

  test("publisher holds cleanup back until publication commits; delete then removes the one PUT", async () => {
    const originalClock = clock;
    const adapter = new LocalObjectStorage(root);
    let putCalls = 0;
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.put = async (...args) => {
      putCalls += 1;
      return adapter.put(...args);
    };
    counted.deleteWithStaging = (...args) => adapter.deleteWithStaging(...args);
    const publisherService = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const worker = createStorageService({
      db,
      storage: adapter,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const ref = await publisherService.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    let linkEntered!: () => void;
    let releaseLink!: () => void;
    const entered = new Promise<void>((resolve) => (linkEntered = resolve));
    const held = new Promise<void>((resolve) => (releaseLink = resolve));
    const publisher = publisherService.writePhoto({
      ref,
      bytes: photo,
      linkPhoto: async () => {
        linkEntered();
        await held;
      },
    });
    await entered;
    try {
      clock = new Date(clock.getTime() + 11 * 60_000);
      const workerReport = await worker.cleanupPhotos({ limit: 5 });
      expect(workerReport.skipped).toBe(1);
      expect(workerReport.scanned).toBeGreaterThanOrEqual(1);
      expect(
        (
          await db.execute(
            sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
          )
        ).rows,
      ).toEqual([{ photo_state: "pending", photo_write_state: "uncertain" }]);
      const deletion = publisherService.deletePhoto(ref);
      expect(putCalls).toBe(0);
      expect(await adapter.head(buildObjectKey(ref.organizationId, ref.objectId))).toBeNull();
      expect(await publisherService.getObject(ref)).toBeNull();
      releaseLink();
      await publisher;
      expect(await deletion).toBe("deleted");
      expect(putCalls).toBe(1);
      expect(await adapter.head(buildObjectKey(ref.organizationId, ref.objectId))).toBeNull();
    } finally {
      releaseLink();
      await publisher.catch(() => undefined);
      clock = originalClock;
    }
  });

  test("wrong creator and organization refs cannot mutate a reservation", async () => {
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/png",
      canonicalBytes: photo,
    });
    for (const wrong of [
      { ...ref, createdByUserId: "user-b" },
      { ...ref, organizationId: "org-b" },
    ]) {
      await expect(
        service.writePhoto({
          ref: wrong,
          bytes: new Uint8Array(65),
          linkPhoto: async () => undefined,
        }),
      ).rejects.toBeInstanceOf(StorageError);
    }
    expect(
      (
        await db.execute(
          sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
        )
      ).rows,
    ).toEqual([{ photo_state: "pending", photo_write_state: "not_started" }]);
    expect(
      (
        await db.execute(
          sql`select id from photo_cleanup_intent where storage_key = (select storage_key from stored_object where id = ${ref.objectId})`,
        )
      ).rows,
    ).toHaveLength(0);
  });

  test("wrong reserved bytes fail before PUT and retain cleanup tracking", async () => {
    let writes = 0;
    const adapter = new LocalObjectStorage(root);
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.put = async (...args: Parameters<LocalObjectStorage["put"]>) => {
      writes += 1;
      return adapter.put(...args);
    };
    const isolated = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
    });
    const ref = await isolated.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/png",
      canonicalBytes: photo,
    });
    await expect(
      isolated.writePhoto({
        ref,
        bytes: new TextEncoder().encode("different"),
        linkPhoto: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(StorageError);
    const [row] = (
      await db.execute(
        sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
      )
    ).rows as { photo_state: string; photo_write_state: string }[];
    expect(writes).toBe(0);
    expect(row).toEqual({ photo_state: "deleting", photo_write_state: "not_started" });
    const intents = await db.execute(
      sql`select storage_key from photo_cleanup_intent where storage_key = (select storage_key from stored_object where id = ${ref.objectId})`,
    );
    expect(intents.rows).toHaveLength(1);
  });

  test("ambiguous PUT is never retried and remains durably tracked", async () => {
    let writes = 0;
    const adapter = new LocalObjectStorage(root);
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.put = async (key, bytes, options) => {
      writes += 1;
      await adapter.put(key, bytes, options);
      throw new Error("ambiguous");
    };
    const isolated = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
    });
    const ref = await isolated.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await expect(
      isolated.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined }),
    ).rejects.toThrow("ambiguous");
    expect(writes).toBe(1);
    const [row] = (
      await db.execute(
        sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
      )
    ).rows as { photo_state: string; photo_write_state: string }[];
    expect(row).toEqual({ photo_state: "deleting", photo_write_state: "uncertain" });
    await expect(
      isolated.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(writes).toBe(1);
    const [cleanupKey] = (
      await db.execute(sql`select storage_key from stored_object where id = ${ref.objectId}`)
    ).rows as { storage_key: string }[];
    await db.execute(sql`delete from stored_object where id = ${ref.objectId}`);
    expect(
      (
        await db.execute(
          sql`select write_state from photo_cleanup_intent where storage_key = ${cleanupKey!.storage_key}`,
        )
      ).rows,
    ).toEqual([{ write_state: "uncertain" }]);
  });

  test("late publication after an early delete is removed again; uncertainty survives restart", async () => {
    const originalClock = clock;
    const adapter = new LocalObjectStorage(root);
    let putEntered!: () => void;
    let rejectClientPut!: () => void;
    let allowRemoteCompletion!: () => void;
    const entered = new Promise<void>((resolve) => (putEntered = resolve));
    const clientReject = new Promise<void>((resolve) => (rejectClientPut = resolve));
    const remoteGate = new Promise<void>((resolve) => (allowRemoteCompletion = resolve));
    let remoteCompletion!: Promise<void>;
    const delayed = Object.create(adapter) as LocalObjectStorage;
    delayed.deleteWithStaging = (...args) => adapter.deleteWithStaging(...args);
    delayed.put = async (key, bytes, options) => {
      remoteCompletion = (async () => {
        await remoteGate;
        await adapter.put(key, bytes, options);
      })();
      putEntered();
      await clientReject;
      throw new Error("request timed out while remote completion remained in flight");
    };
    const isolated = createStorageService({
      db,
      storage: delayed,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const ref = await isolated.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    const publication = isolated.writePhoto({
      ref,
      bytes: photo,
      linkPhoto: async () => undefined,
    });
    await entered;
    rejectClientPut();
    await expect(publication).rejects.toThrow("timed out");
    const [row] = (
      await db.execute(sql`select storage_key from stored_object where id = ${ref.objectId}`)
    ).rows as { storage_key: string }[];
    const key = row!.storage_key;
    expect(await adapter.head(key)).toBeNull();

    expect(await isolated.deletePhoto(ref)).toBe("pending");
    expect(await adapter.head(key)).toBeNull();
    expect(
      (
        await db.execute(
          sql`select write_state from photo_cleanup_intent where id = ${ref.objectId}`,
        )
      ).rows,
    ).toEqual([{ write_state: "uncertain" }]);

    allowRemoteCompletion();
    await remoteCompletion;
    expect(await adapter.head(key)).not.toBeNull();

    // Simulate restart and elapsed backoff: successful DELETE still cannot
    // establish that another delayed publication will never arrive.
    try {
      clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
      const restarted = createStorageService({
        db,
        storage: adapter,
        maxObjectBytes: 64,
        signedUrlTtlSeconds: 300,
        signingKey: SIGNING_KEY,
        now: () => clock,
      });
      expect(await restarted.cleanupPhotos({ limit: 5 })).toMatchObject({ pending: 1 });
      expect(await adapter.head(key)).toBeNull();
      expect(
        (
          await db.execute(
            sql`select write_state from photo_cleanup_intent where id = ${ref.objectId}`,
          )
        ).rows,
      ).toContainEqual({ write_state: "uncertain" });
    } finally {
      clock = originalClock;
    }
  });

  test("two cleanup workers do not delete the same intent concurrently", async () => {
    const adapter = new LocalObjectStorage(root);
    let failFirstDelete = true;
    let holdDeletes = false;
    let deleteStarted!: () => void;
    let releaseDelete!: () => void;
    const started = new Promise<void>((resolve) => (deleteStarted = resolve));
    const held = new Promise<void>((resolve) => (releaseDelete = resolve));
    let activeDeletes = 0;
    let maxActiveDeletes = 0;
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.put = (...args) => adapter.put(...args);
    counted.deleteWithStaging = async (key, stagingId) => {
      if (failFirstDelete) {
        failFirstDelete = false;
        throw new Error("create a durable retry intent");
      }
      activeDeletes += 1;
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
      deleteStarted();
      try {
        if (holdDeletes) await held;
        return await adapter.deleteWithStaging(key, stagingId);
      } finally {
        activeDeletes -= 1;
      }
    };
    const first = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const second = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    const ref = await first.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await first.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined });
    expect(await first.deletePhoto(ref)).toBe("pending");
    clock = new Date(clock.getTime() + 5000);
    holdDeletes = true;
    const firstWorker = first.cleanupPhotos({ limit: 5 });
    await started;
    const secondReport = await second.cleanupPhotos({ limit: 5 });
    expect(secondReport).toMatchObject({ scanned: 1, deleted: 0, skipped: 1 });
    expect(maxActiveDeletes).toBe(1);
    releaseDelete();
    await firstWorker;
    expect(maxActiveDeletes).toBe(1);
  });

  test("concurrent publication arms a reservation for only one PUT", async () => {
    let writes = 0;
    let putEntered!: () => void;
    let releasePut!: () => void;
    const entered = new Promise<void>((resolve) => (putEntered = resolve));
    const held = new Promise<void>((resolve) => (releasePut = resolve));
    const adapter = new LocalObjectStorage(root);
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.put = async (key, bytes, options) => {
      writes += 1;
      putEntered();
      await held;
      return adapter.put(key, bytes, options);
    };
    const isolated = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
    });
    const ref = await isolated.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    const first = isolated.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined });
    await entered;
    try {
      await expect(
        isolated.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined }),
      ).rejects.toBeInstanceOf(StorageError);
      expect(writes).toBe(1);
    } finally {
      releasePut();
    }
    await first;
    expect(writes).toBe(1);
  });

  test("denied publication callback fails before PUT and retains not-started cleanup", async () => {
    let writes = 0;
    const adapter = new LocalObjectStorage(root);
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.put = async (...args: Parameters<LocalObjectStorage["put"]>) => {
      writes += 1;
      return adapter.put(...args);
    };
    const isolated = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
    });
    const ref = await isolated.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await expect(
      isolated.writePhoto({
        ref,
        bytes: photo,
        linkPhoto: async (tx, object) => {
          await tx.execute(sql`insert into photo_link_test (object_id) values (${object.id})`);
          throw new Error("link rejected");
        },
      }),
    ).rejects.toThrow("link rejected");
    expect(
      (
        await db.execute(
          sql`select object_id from photo_link_test where object_id = ${ref.objectId}`,
        )
      ).rows,
    ).toHaveLength(0);
    const [row] = (
      await db.execute(
        sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
      )
    ).rows as { photo_state: string; photo_write_state: string }[];
    expect(row).toEqual({ photo_state: "deleting", photo_write_state: "not_started" });
    const intent = await db.execute(
      sql`select write_state from photo_cleanup_intent where storage_key = (select storage_key from stored_object where id = ${ref.objectId})`,
    );
    expect(intent.rows).toEqual([{ write_state: "not_started" }]);
    expect(writes).toBe(0);
    const [key] = (
      await db.execute(sql`select storage_key from stored_object where id = ${ref.objectId}`)
    ).rows as { storage_key: string }[];
    expect(await new LocalObjectStorage(root).head(key!.storage_key)).toBeNull();
  });

  test("acknowledged PUT with ready-activation database failure is settled and tracked", async () => {
    await db.execute(
      sql`create function reject_photo_ready() returns trigger language plpgsql as $$ begin if NEW.photo_state = 'ready' then raise exception 'activation blocked'; end if; return NEW; end $$`,
    );
    await db.execute(
      sql`create trigger reject_photo_ready_before_update before update on stored_object for each row execute function reject_photo_ready()`,
    );
    try {
      const ref = await service.reservePhoto({
        organizationId: "org-a",
        createdByUserId: "user-a",
        contentType: "image/jpeg",
        canonicalBytes: photo,
      });
      await expect(
        service.writePhoto({
          ref,
          bytes: photo,
          linkPhoto: async (tx, object) => {
            await tx.execute(sql`insert into photo_link_test (object_id) values (${object.id})`);
          },
        }),
      ).rejects.toBeDefined();
      expect(
        (
          await db.execute(
            sql`select photo_state, photo_write_state from stored_object where id = ${ref.objectId}`,
          )
        ).rows,
      ).toEqual([{ photo_state: "deleting", photo_write_state: "settled" }]);
      expect(
        (
          await db.execute(
            sql`select write_state from photo_cleanup_intent where storage_key = (select storage_key from stored_object where id = ${ref.objectId})`,
          )
        ).rows,
      ).toEqual([{ write_state: "settled" }]);
      expect(
        (
          await db.execute(
            sql`select object_id from photo_link_test where object_id = ${ref.objectId}`,
          )
        ).rows,
      ).toHaveLength(0);
      const [key] = (
        await db.execute(sql`select storage_key from stored_object where id = ${ref.objectId}`)
      ).rows as { storage_key: string }[];
      expect(await new LocalObjectStorage(root).head(key!.storage_key)).not.toBeNull();
    } finally {
      await db.execute(sql`drop trigger reject_photo_ready_before_update on stored_object`);
      await db.execute(sql`drop function reject_photo_ready()`);
    }
  });

  test("user cascade captures managed photo cleanup before creator erasure", async () => {
    await db.execute(
      sql`insert into "user" (id, email) values ('user-photo-delete', 'photo-delete@example.test')`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-photo-delete', 'org-a', 'user-photo-delete', 'member')`,
    );
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-photo-delete",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await expect(
      (async () =>
        await db.execute(
          sql`update stored_object set created_by_user_id = 'user-a' where id = ${ref.objectId}`,
        ))(),
    ).rejects.toThrow();
    await db.execute(sql`delete from "user" where id = 'user-photo-delete'`);
    const row = await db.execute(sql`select id from stored_object where id = ${ref.objectId}`);
    expect(row.rows).toHaveLength(0);
    const intent = await db.execute(
      sql`select subject_id, storage_provider, storage_store_id, write_state from photo_cleanup_intent where subject_id = 'user-photo-delete'`,
    );
    expect(intent.rows).toHaveLength(1);
    expect(intent.rows[0]).toMatchObject({
      subject_id: "user-photo-delete",
      storage_provider: "local",
      write_state: "not_started",
    });
  });

  test("organization cascade retains managed and unknown-photo cleanup intents", async () => {
    await db.execute(
      sql`insert into organization (id, name, slug) values ('org-photo-cascade', 'Cascade', 'photo-cascade')`,
    );
    const managed = await service.reservePhoto({
      organizationId: "org-photo-cascade",
      createdByUserId: "user-a",
      contentType: "image/png",
      canonicalBytes: photo,
    });
    const legacyId = newObjectId();
    const legacyKey = buildObjectKey("org-photo-cascade", legacyId);
    await db.execute(
      sql`insert into stored_object (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256) values (${legacyId}, 'org-photo-cascade', 'user-a', 'progress_photo', ${legacyKey}, 'image/png', ${photo.byteLength}, ${sha(photo)})`,
    );
    await db.execute(sql`delete from organization where id = 'org-photo-cascade'`);
    expect(
      (
        await db.execute(
          sql`select id from stored_object where organization_id = 'org-photo-cascade'`,
        )
      ).rows,
    ).toHaveLength(0);
    const intents = await db.execute(
      sql`select id, storage_provider, storage_store_id, subject_id, org_id from photo_cleanup_intent where org_id = 'org-photo-cascade' order by id`,
    );
    expect(intents.rows).toHaveLength(2);
    expect(intents.rows).toContainEqual({
      id: managed.objectId,
      storage_provider: "local",
      storage_store_id: service.storeIdentity!.storeId,
      subject_id: "user-a",
      org_id: "org-photo-cascade",
    });
    expect(intents.rows).toContainEqual({
      id: legacyId,
      storage_provider: null,
      storage_store_id: null,
      subject_id: "user-a",
      org_id: "org-photo-cascade",
    });
  });

  test("getSubjectPhoto returns only the subject's managed ready photo, with a safe record", async () => {
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined });
    const got = await service.getSubjectPhoto({
      subjectUserId: "user-a",
      objectId: ref.objectId,
    });
    expect(got).not.toBeNull();
    expect(got!.object).toMatchObject({
      id: ref.objectId,
      organizationId: "org-a",
      createdByUserId: "user-a",
      purpose: "progress_photo",
      contentType: "image/jpeg",
      sizeBytes: photo.byteLength,
      sha256: sha(photo),
    });
    expect(got!.object).not.toHaveProperty("storageKey");
    expect(got!.object).not.toHaveProperty("storageProvider");
    expect(got!.object).not.toHaveProperty("storageStoreId");
    expect(got!.object).not.toHaveProperty("photoState");
    expect(new Uint8Array(await new Response(got!.body).arrayBuffer())).toEqual(photo);
  });

  test("getSubjectPhoto fails closed with zero adapter reads for every non-exportable case", async () => {
    const adapter = new LocalObjectStorage(root);
    let reads = 0;
    const counted = Object.create(adapter) as LocalObjectStorage;
    counted.get = async (...args) => {
      reads += 1;
      return adapter.get(...args);
    };
    const isolated = createStorageService({
      db,
      storage: counted,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });

    const ready = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/png",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref: ready, bytes: photo, linkPhoto: async () => undefined });
    const pending = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    const deleting = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref: deleting, bytes: photo, linkPhoto: async () => undefined });
    await db.execute(
      sql`update stored_object set photo_state = 'deleting' where id = ${deleting.objectId}`,
    );
    const hidden = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref: hidden, bytes: photo, linkPhoto: async () => undefined });
    await db.execute(
      sql`update stored_object set photo_deletion_requested_at = now() where id = ${hidden.objectId}`,
    );
    const mismatched = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref: mismatched, bytes: photo, linkPhoto: async () => undefined });
    await db.execute(
      sql`update stored_object set storage_store_id = 'different-store' where id = ${mismatched.objectId}`,
    );

    const legacyId = newObjectId();
    const legacyKey = buildObjectKey("org-a", legacyId);
    await adapter.put(legacyKey, photo, { contentType: "image/jpeg", sha256: sha(photo) });
    await db.execute(
      sql`insert into stored_object (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256) values (${legacyId}, 'org-a', 'user-a', 'progress_photo', ${legacyKey}, 'image/jpeg', ${photo.byteLength}, ${sha(photo)})`,
    );

    for (const objectId of [
      ready.objectId, // wrong subject below
      pending.objectId,
      deleting.objectId,
      hidden.objectId,
      mismatched.objectId,
      legacyId,
      newObjectId(),
    ]) {
      expect(await isolated.getSubjectPhoto({ subjectUserId: "user-b", objectId })).toBeNull();
    }
    for (const objectId of [
      pending.objectId,
      deleting.objectId,
      hidden.objectId,
      mismatched.objectId,
      legacyId,
    ]) {
      expect(await isolated.getSubjectPhoto({ subjectUserId: "user-a", objectId })).toBeNull();
    }
    expect(reads).toBe(0);

    // The same row still reads for its real subject, proving the negatives
    // above were not caused by a broken fixture/service binding.
    expect(
      await isolated.getSubjectPhoto({ subjectUserId: "user-a", objectId: ready.objectId }),
    ).not.toBeNull();
    expect(reads).toBe(1);
  });

  test("getSubjectPhoto propagates a genuine adapter failure", async () => {
    const ref = await service.reservePhoto({
      organizationId: "org-a",
      createdByUserId: "user-a",
      contentType: "image/jpeg",
      canonicalBytes: photo,
    });
    await service.writePhoto({ ref, bytes: photo, linkPhoto: async () => undefined });
    const adapter = new LocalObjectStorage(root);
    const broken = Object.create(adapter) as LocalObjectStorage;
    broken.get = async () => {
      throw new Error("synthetic get failure");
    };
    const isolated = createStorageService({
      db,
      storage: broken,
      maxObjectBytes: 64,
      signedUrlTtlSeconds: 300,
      signingKey: SIGNING_KEY,
      now: () => clock,
    });
    await expect(
      isolated.getSubjectPhoto({ subjectUserId: "user-a", objectId: ref.objectId }),
    ).rejects.toThrow("synthetic get failure");
  });

  const s3Endpoint = process.env.STORAGE_S3_TEST_ENDPOINT;
  test.skipIf(!s3Endpoint)(
    "S3 (MinIO): put, presigned get and delete through the service",
    async () => {
      const bucket = `ov-svc-${Date.now()}`;
      const config = {
        endpoint: s3Endpoint ?? "",
        region: "us-east-1",
        bucket,
        accessKeyId: process.env.STORAGE_S3_TEST_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.STORAGE_S3_TEST_SECRET_ACCESS_KEY ?? "",
        forcePathStyle: true,
        sse: "none" as const,
      };
      // Bucket bootstrap through a presigned PUT (the adapter has no bucket API).
      const { presignUrl } = await import("./providers/s3");
      const created = await fetch(
        presignUrl(
          { method: "PUT", url: new URL(`${config.endpoint}/${bucket}`), expiresInSeconds: 60 },
          config,
          new Date(),
        ),
        { method: "PUT" },
      );
      expect(created.ok).toBe(true);

      const s3Service = createStorageService({
        db,
        storage: new S3ObjectStorage(config),
        maxObjectBytes: 64,
        signedUrlTtlSeconds: 300,
        signingKey: SIGNING_KEY,
      });
      const object = await s3Service.putObject({
        ...A,
        purpose: "clinical_export",
        contentType: "application/pdf",
        body: photo,
      });
      const link = await s3Service.createDownloadUrl({
        organizationId: "org-a",
        objectId: object.id,
      });
      expect(link!.url.startsWith(config.endpoint)).toBe(true);
      const response = await fetch(link!.url);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(photo);
      expect(await s3Service.deleteObject({ organizationId: "org-a", objectId: object.id })).toBe(
        "deleted",
      );
      const gone = await fetch(link!.url);
      await gone.body?.cancel();
      expect(gone.status).toBe(404);
      expect(await s3Service.probe()).toBe("ok");
    },
  );
});
