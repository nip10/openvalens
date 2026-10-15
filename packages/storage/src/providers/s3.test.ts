import { describe, expect, test } from "bun:test";

import type { S3StorageConfig } from "../config";
import { StorageError } from "../object-storage";
import { presignUrl, S3ObjectStorage, signSigV4 } from "./s3";

// AWS documentation example credentials (not a real account).
const AWS_EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};
const EXAMPLE_DATE = new Date("2013-05-24T00:00:00Z");
const KEY = "org/org-a/0b6f3a52-9b5e-4c1e-8d7a-1f2e3d4c5b6a";

const CONFIG: S3StorageConfig = {
  endpoint: "http://127.0.0.1:9",
  region: "us-east-1",
  bucket: "synthetic-bucket",
  accessKeyId: "synthetic-access-key",
  secretAccessKey: "synthetic-secret-key",
  forcePathStyle: true,
  sse: "AES256",
};

describe("SigV4 against the published AWS S3 examples", () => {
  test("header-signed GET (Range example)", () => {
    const { signature, signedHeaders } = signSigV4(
      {
        method: "GET",
        path: "/test.txt",
        query: {},
        headers: {
          host: "examplebucket.s3.amazonaws.com",
          range: "bytes=0-9",
          "x-amz-content-sha256":
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "x-amz-date": "20130524T000000Z",
        },
        payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
      AWS_EXAMPLE,
      EXAMPLE_DATE,
    );
    expect(signedHeaders).toBe("host;range;x-amz-content-sha256;x-amz-date");
    expect(signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  test("query-string presigned GET", () => {
    const url = presignUrl(
      {
        method: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        expiresInSeconds: 86400,
      },
      AWS_EXAMPLE,
      EXAMPLE_DATE,
    );
    expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

describe("S3ObjectStorage request shape (mock fetch)", () => {
  function recording(
    status = 200,
    body: ConstructorParameters<typeof Response>[0] = null,
    headers: ResponseInit["headers"] = {},
  ) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: URL | string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(body, { status, headers });
    }) as typeof fetch;
    return { calls, fetcher };
  }

  test("PUT is private: SSE header, checksum metadata, never an ACL", async () => {
    const { calls, fetcher } = recording();
    const storage = new S3ObjectStorage(CONFIG, { fetch: fetcher });
    await storage.put(KEY, new Uint8Array([1, 2, 3]), {
      contentType: "image/jpeg",
      sha256: "a".repeat(64),
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(`http://127.0.0.1:9/synthetic-bucket/${KEY}`);
    expect(calls[0]!.init.method).toBe("PUT");
    expect(headers["x-amz-server-side-encryption"]).toBe("AES256");
    expect(headers["x-amz-meta-sha256"]).toBe("a".repeat(64));
    expect(Object.keys(headers).some((name) => name.toLowerCase().includes("acl"))).toBe(false);
    expect(headers.authorization).toContain("SignedHeaders=content-type;host;x-amz-content-sha256");
  });

  test("SSE can be disabled for endpoints without KMS", async () => {
    const { calls, fetcher } = recording();
    const storage = new S3ObjectStorage({ ...CONFIG, sse: "none" }, { fetch: fetcher });
    await storage.put(KEY, new Uint8Array([1]), {
      contentType: "image/png",
      sha256: "b".repeat(64),
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-amz-server-side-encryption"]).toBeUndefined();
  });

  test("virtual-hosted style puts the bucket in the host", () => {
    const storage = new S3ObjectStorage({
      ...CONFIG,
      endpoint: "https://s3.eu-west-1.amazonaws.com",
      forcePathStyle: false,
    });
    expect(storage.objectUrl(KEY).toString()).toBe(
      `https://synthetic-bucket.s3.eu-west-1.amazonaws.com/${KEY}`,
    );
  });

  test("GET/HEAD 404 map to null; DELETE 404 succeeds", async () => {
    const { fetcher } = recording(404);
    const storage = new S3ObjectStorage(CONFIG, { fetch: fetcher });
    expect(await storage.get(KEY)).toBeNull();
    expect(await storage.head(KEY)).toBeNull();
    await storage.delete(KEY);
  });

  test("errors are typed and value-free", async () => {
    const cases: [number, string, boolean][] = [
      [403, "auth", false],
      [400, "rejected", false],
      [429, "rate_limited", true],
      [503, "rate_limited", true],
      [500, "provider_unavailable", true],
    ];
    for (const [status, category, retryable] of cases) {
      const { fetcher } = recording(status, "<Error><Key>secret-looking-key</Key></Error>");
      const storage = new S3ObjectStorage(CONFIG, { fetch: fetcher });
      const error = await storage.head(KEY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).category).toBe(category as StorageError["category"]);
      expect((error as StorageError).retryable).toBe(retryable);
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).not.toContain("synthetic-bucket");
    }
  });

  test("a network failure is a retryable network error", async () => {
    const storage = new S3ObjectStorage(CONFIG, {
      fetch: (async () => {
        throw new TypeError("connect ECONNREFUSED synthetic-bucket");
      }) as unknown as typeof fetch,
    });
    const error = (await storage.delete(KEY).catch((e: unknown) => e)) as StorageError;
    expect(error.category).toBe("network");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("synthetic-bucket");
  });

  test("keys outside the opaque grammar are refused before any request", async () => {
    const { calls, fetcher } = recording();
    const storage = new S3ObjectStorage(CONFIG, { fetch: fetcher });
    for (const bad of ["../escape", "org/a/../../b", "org/a/blood panel.pdf", "", "a//b"]) {
      expect(storage.get(bad)).rejects.toThrow(StorageError);
    }
    expect(calls).toHaveLength(0);
  });

  test("presigned download URL is short-lived and forces a download", async () => {
    const storage = new S3ObjectStorage(CONFIG, { now: () => EXAMPLE_DATE });
    const url = new URL(
      await storage.signedGetUrl(KEY, { expiresInSeconds: 300, contentType: "application/pdf" }),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.toString()).not.toContain("synthetic-secret-key");
  });
});
