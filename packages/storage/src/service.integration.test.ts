import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, sql, type Database } from "@openvalens/db";

import { parseObjectKey } from "./keys";
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
      purpose: "progress_photo",
      contentType: "IMAGE/JPEG; charset=binary",
      body: photo,
    });
    expect(object).toMatchObject({
      organizationId: "org-a",
      createdByUserId: "user-a",
      purpose: "progress_photo",
      contentType: "image/jpeg",
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
      ["progress_photo", "image/svg+xml"],
      ["progress_photo", "text/html"],
      ["clinical_export", "image/jpeg"],
    ] as const) {
      const error = await service
        .putObject({ ...A, purpose, contentType, body: photo })
        .catch((e: unknown) => e);
      expect((error as StorageError).category).toBe("unsupported_type");
    }
    for (const body of [new Uint8Array(65), new Blob([new Uint8Array(65)]).stream()]) {
      const error = await service
        .putObject({ ...A, purpose: "progress_photo", contentType: "image/png", body })
        .catch((e: unknown) => e);
      expect((error as StorageError).category).toBe("too_large");
    }
    expect(await service.listObjects({ organizationId: "org-a" })).toHaveLength(before.length);
  });

  test("another organization cannot find, read, sign or delete the object", async () => {
    const object = await service.putObject({
      ...A,
      purpose: "progress_photo",
      contentType: "image/png",
      body: photo,
    });
    const asB = { organizationId: "org-b", objectId: object.id };
    expect(await service.findObject(asB)).toBeNull();
    expect(await service.getObject(asB)).toBeNull();
    expect(await service.createDownloadUrl(asB)).toBeNull();
    expect(await service.deleteObject(asB)).toBe(false);
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
      purpose: "progress_photo",
      contentType: "image/png",
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
    expect(ok.headers.get("content-type")).toBe("image/png");
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

    expect(await service.deleteObject({ organizationId: "org-a", objectId: object.id })).toBe(true);
    expect((await service.serveSignedDownload(new URL(link!.url, BASE))).status).toBe(404);
  });

  test("download TTL is capped at the configured maximum", async () => {
    const object = await service.putObject({
      ...A,
      purpose: "progress_photo",
      contentType: "image/png",
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
      purpose: "progress_photo",
      contentType: "image/png",
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
      purpose: "progress_photo",
      contentType: "image/png",
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
        true,
      );
      const gone = await fetch(link!.url);
      await gone.body?.cancel();
      expect(gone.status).toBe(404);
      expect(await s3Service.probe()).toBe("ok");
    },
  );
});
