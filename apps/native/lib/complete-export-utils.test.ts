import { describe, expect, test } from "bun:test";

import {
  completeExportCacheNamespace,
  completeExportDownloadUrl,
  completeExportPollInterval,
  shouldPollCompleteExport,
  type CompleteExportStatus,
} from "./complete-export-utils";
import {
  isCompleteExportCacheFile,
  isExpiredCompleteExportCacheFile,
  shareCompleteExportFile,
  streamCompleteExport,
} from "./complete-export-transfer";

const id = "2d49e6d8-8d64-4d69-81c1-15e56a82ca43";
const status = (state: CompleteExportStatus["state"]): CompleteExportStatus => ({
  id,
  state,
  createdAt: "2026-10-29T00:00:00Z",
  expiresAt: null,
  bytes: null,
  failure: null,
});

describe("complete export helpers", () => {
  test.each(["queued", "running"] as const)("polls only while %s", (state) => {
    expect(shouldPollCompleteExport(status(state))).toBe(true);
    expect(completeExportPollInterval(status(state))).toBe(2_000);
  });

  test.each(["ready", "failed", "cancelled", "expired"] as const)(
    "stops polling at %s",
    (state) => {
      expect(shouldPollCompleteExport(status(state))).toBe(false);
      expect(completeExportPollInterval(status(state))).toBe(false);
    },
  );

  test("uses one fixed endpoint on the configured server origin", () => {
    expect(completeExportDownloadUrl("https://health.example/", id)).toBe(
      `https://health.example/api/data-rights/exports/${id}/download`,
    );
  });

  test.each([
    "https://user:password@health.example/",
    "https://health.example/path",
    "https://health.example/?token=secret",
    "javascript:alert(1)",
  ])("rejects unsafe server URL %s", (url) => {
    expect(() => completeExportDownloadUrl(url, id)).toThrow();
  });

  test("rejects path traversal in a job id", () => {
    expect(() =>
      completeExportDownloadUrl("https://health.example/", "../other/download"),
    ).toThrow();
  });

  test("namespaces local cache without exposing a server URL", () => {
    expect(completeExportCacheNamespace("https://one.example/")).not.toBe(
      completeExportCacheNamespace("https://two.example/"),
    );
    expect(completeExportCacheNamespace("https://one.example/")).toMatch(/^[a-f0-9]{8}$/);
  });

  test("only retains complete export ZIPs for 24 hours", () => {
    const now = 50_000_000;
    expect(isCompleteExportCacheFile(`openvalens-export-${id}.zip`)).toBe(true);
    expect(isCompleteExportCacheFile("other-file.zip")).toBe(false);
    expect(
      isExpiredCompleteExportCacheFile(`openvalens-export-${id}.zip`, now - 86_400_001, now),
    ).toBe(true);
    expect(isExpiredCompleteExportCacheFile(`openvalens-export-${id}.zip`, now - 60_000, now)).toBe(
      false,
    );
  });

  test("streams to the fixed endpoint with the session cookie, not a URL token", async () => {
    const file = {
      exists: true,
      deleted: false,
      delete() {
        this.deleted = true;
      },
    };
    let captured:
      | { url: string; options: { headers: { Cookie: string }; signal: AbortSignal } }
      | undefined;
    await streamCompleteExport({
      serverUrl: "https://health.example/",
      jobId: id,
      cookie: "session=private",
      signal: new AbortController().signal,
      file,
      download: async (url, _file, options) => {
        captured = { url, options };
        return file;
      },
    });
    expect(captured?.url).toBe(`https://health.example/api/data-rights/exports/${id}/download`);
    expect(captured?.url).not.toContain("session=");
    expect(captured?.options.headers.Cookie).toBe("session=private");
    expect(file.deleted).toBe(false);
  });

  test("deletes partial files and surfaces only a safe cancellation code", async () => {
    const file = {
      exists: true,
      deleted: false,
      delete() {
        this.deleted = true;
      },
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamCompleteExport({
        serverUrl: "https://health.example/",
        jobId: id,
        cookie: "session=private",
        signal: controller.signal,
        file,
        download: async () => {
          throw new Error("https://health.example/cache/path session=private");
        },
      }),
    ).rejects.toThrow("EXPORT_CANCELLED");
    expect(file.deleted).toBe(true);
  });

  test("maps an unauthorized download to a safe sign-in code and removes the partial file", async () => {
    const file = {
      exists: true,
      deleted: false,
      delete() {
        this.deleted = true;
      },
    };
    await expect(
      streamCompleteExport({
        serverUrl: "https://health.example/",
        jobId: id,
        cookie: "session=private",
        signal: new AbortController().signal,
        file,
        download: async () => {
          throw new Error("response has status 401 for /cache/file session=private");
        },
      }),
    ).rejects.toThrow("EXPORT_UNAUTHORIZED");
    expect(file.deleted).toBe(true);
  });

  test("shares only after availability and current-session checks", async () => {
    const file = { uri: "file:///private/cache/export.zip" };
    let shared = 0;
    const result = await shareCompleteExportFile(file, {
      isAvailable: async () => true,
      isCurrent: () => true,
      share: async (value) => {
        expect(value).toBe(file);
        shared += 1;
      },
    });
    expect(result).toBe(true);
    expect(shared).toBe(1);
  });

  test("does not share if the session/server changed, or if sharing is unavailable", async () => {
    let shared = 0;
    const file = { uri: "file:///private/cache/export.zip" };
    const adapters = {
      isAvailable: async () => true,
      isCurrent: () => false,
      share: async () => {
        shared += 1;
      },
    };
    expect(await shareCompleteExportFile(file, adapters)).toBe(false);
    await expect(
      shareCompleteExportFile(file, { ...adapters, isAvailable: async () => false }),
    ).rejects.toThrow("EXPORT_SHARING_UNAVAILABLE");
    expect(shared).toBe(0);
  });
});
