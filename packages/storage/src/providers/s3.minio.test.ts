import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { S3StorageConfig } from "../config";
import { buildObjectKey, newObjectId } from "../keys";
import { amzDate, S3ObjectStorage, signSigV4 } from "./s3";

/**
 * S3 adapter against a real, disposable MinIO (Issue #62). Opt-in: set
 * `STORAGE_S3_TEST_ENDPOINT` (loopback only) plus `STORAGE_S3_TEST_ACCESS_KEY_ID`
 * and `STORAGE_S3_TEST_SECRET_ACCESS_KEY`; CI runs it in the `storage` job.
 * The suite creates its own bucket and uses synthetic bytes only.
 */
const endpoint = process.env.STORAGE_S3_TEST_ENDPOINT;
if (endpoint && !["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname))
  throw new Error("STORAGE_S3_TEST_ENDPOINT must be a disposable loopback MinIO.");

const config: S3StorageConfig = {
  endpoint: endpoint ?? "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: `ov-test-${Date.now()}`,
  accessKeyId: process.env.STORAGE_S3_TEST_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.STORAGE_S3_TEST_SECRET_ACCESS_KEY ?? "",
  forcePathStyle: true,
  // MinIO without a KMS rejects SSE-S3; R2 and AWS keep the default `AES256`.
  sse: "none",
};

async function createBucket(): Promise<void> {
  const url = new URL(`${config.endpoint}/${config.bucket}`);
  const now = new Date();
  const payloadHash = createHash("sha256").update("").digest("hex");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate(now),
  };
  const { signature, scope, signedHeaders } = signSigV4(
    { method: "PUT", path: url.pathname, query: {}, headers, payloadHash },
    config,
    now,
  );
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": headers["x-amz-date"],
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  if (!response.ok) throw new Error(`bucket create failed: ${response.status}`);
}

describe.skipIf(!endpoint)("S3ObjectStorage against MinIO", () => {
  const storage = new S3ObjectStorage(config);
  const bytes = new TextEncoder().encode("synthetic progress photo bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = buildObjectKey("org-minio", newObjectId());

  beforeAll(createBucket);

  test("put, head, get and delete", async () => {
    await storage.put(key, bytes, { contentType: "image/jpeg", sha256 });
    expect(await storage.head(key)).toEqual({ contentType: "image/jpeg", size: bytes.byteLength });
    const blob = await storage.get(key);
    expect(new Uint8Array(await new Response(blob!.body).arrayBuffer())).toEqual(bytes);
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    expect(await storage.get(key)).toBeNull();
  });

  test("objects are private: an anonymous GET is refused", async () => {
    await storage.put(key, bytes, { contentType: "image/jpeg", sha256 });
    const response = await fetch(storage.objectUrl(key));
    await response.body?.cancel();
    expect(response.status).toBe(403);
  });

  test("a presigned URL downloads; tampered and expired ones are refused", async () => {
    await storage.put(key, bytes, { contentType: "image/jpeg", sha256 });
    const signed = await storage.signedGetUrl(key, {
      expiresInSeconds: 60,
      contentType: "image/jpeg",
    });
    const ok = await fetch(signed);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toBe("attachment");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(bytes);

    const tampered = new URL(signed);
    tampered.pathname = tampered.pathname.replace(/[0-9a-f]{12}$/, "000000000000");
    const forged = await fetch(tampered);
    await forged.body?.cancel();
    expect(forged.status).toBe(403);

    const past = new S3ObjectStorage(config, { now: () => new Date(Date.now() - 2 * 3600_000) });
    const expired = await fetch(
      await past.signedGetUrl(key, { expiresInSeconds: 60, contentType: "image/jpeg" }),
    );
    await expired.body?.cancel();
    expect(expired.status).toBe(403);
    await storage.delete(key);
  });

  test("wrong credentials are a typed auth error", async () => {
    const bad = new S3ObjectStorage({ ...config, secretAccessKey: "wrong-synthetic-secret" });
    const error = (await bad.head(key).catch((e: unknown) => e)) as { category?: string };
    expect(error.category).toBe("auth");
  });
});
