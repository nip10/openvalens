import { describe, expect, test } from "bun:test";

import {
  describeStorageIntegration,
  parseStorageConfig,
  STORAGE_DEFAULT_LOCAL_DIR,
  STORAGE_DEFAULT_MAX_OBJECT_BYTES,
  StorageConfigError,
} from "./config";

const S3_ENV = {
  STORAGE_PROVIDER: "s3",
  STORAGE_S3_ENDPOINT: "http://127.0.0.1:9000",
  STORAGE_S3_BUCKET: "synthetic-bucket",
  STORAGE_S3_ACCESS_KEY_ID: "synthetic-access-key",
  STORAGE_S3_SECRET_ACCESS_KEY: "synthetic-secret-key",
  STORAGE_S3_FORCE_PATH_STYLE: "true",
};

describe("parseStorageConfig", () => {
  test("defaults to private local disk with no env", () => {
    const config = parseStorageConfig({});
    expect(config).toEqual({
      provider: "local",
      s3: null,
      localDir: STORAGE_DEFAULT_LOCAL_DIR,
      maxObjectBytes: STORAGE_DEFAULT_MAX_OBJECT_BYTES,
      signedUrlTtlSeconds: 300,
    });
    expect(describeStorageIntegration(config)).toEqual({ provider: "local", state: "configured" });
  });

  test("selects S3 when bucket and credentials are present", () => {
    const config = parseStorageConfig(S3_ENV);
    expect(config.provider).toBe("s3");
    expect(config.s3).toEqual({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: "synthetic-bucket",
      accessKeyId: "synthetic-access-key",
      secretAccessKey: "synthetic-secret-key",
      forcePathStyle: true,
      sse: "AES256",
    });
    expect(describeStorageIntegration(config)).toEqual({ provider: "s3", state: "configured" });
  });

  test("S3 without credentials is off, never a boot failure", () => {
    for (const missing of [
      "STORAGE_S3_BUCKET",
      "STORAGE_S3_ACCESS_KEY_ID",
      "STORAGE_S3_SECRET_ACCESS_KEY",
    ]) {
      const config = parseStorageConfig({ ...S3_ENV, [missing]: "" });
      expect(config.provider).toBeNull();
      expect(config.s3).toBeNull();
      expect(describeStorageIntegration(config)).toEqual({ provider: null, state: "off" });
    }
  });

  test("defaults the endpoint to the AWS regional endpoint", () => {
    const config = parseStorageConfig({
      ...S3_ENV,
      STORAGE_S3_ENDPOINT: "",
      STORAGE_S3_REGION: "eu-west-1",
    });
    expect(config.s3?.endpoint).toBe("https://s3.eu-west-1.amazonaws.com");
  });

  test("status is value-free", () => {
    const status = JSON.stringify(describeStorageIntegration(parseStorageConfig(S3_ENV)));
    for (const value of Object.values(S3_ENV)) {
      if (value !== "s3" && value !== "true") expect(status).not.toContain(value);
    }
  });

  test("rejects malformed values naming the key only", () => {
    const cases: Record<string, string>[] = [
      { STORAGE_PROVIDER: "gcs" },
      { ...S3_ENV, STORAGE_S3_ENDPOINT: "ftp://example.test" },
      { ...S3_ENV, STORAGE_S3_ENDPOINT: "https://user:pw@example.test" },
      { ...S3_ENV, STORAGE_S3_ENDPOINT: "https://example.test/bucket" },
      { ...S3_ENV, STORAGE_S3_BUCKET: "Bad_Bucket" },
      { ...S3_ENV, STORAGE_S3_FORCE_PATH_STYLE: "yes" },
      { ...S3_ENV, STORAGE_S3_SSE: "aws:kms" },
      { STORAGE_MAX_OBJECT_BYTES: "0" },
      { STORAGE_MAX_OBJECT_BYTES: "1e12" },
      { STORAGE_SIGNED_URL_TTL_SECONDS: "86400" },
    ];
    for (const env of cases) {
      const error = (() => {
        try {
          parseStorageConfig(env);
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(StorageConfigError);
      expect((error as Error).message).not.toContain("synthetic-secret-key");
      expect((error as Error).message).not.toContain("pw@");
    }
  });
});
