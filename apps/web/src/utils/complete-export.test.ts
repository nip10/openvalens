import { describe, expect, test } from "bun:test";

import {
  completeExportDownloadUrl,
  completeExportPollInterval,
  shouldPollCompleteExport,
  type CompleteExportStatus,
} from "./complete-export";

const status = (state: CompleteExportStatus["state"]): CompleteExportStatus => ({
  id: "2d49e6d8-8d64-4d69-81c1-15e56a82ca43",
  state,
  createdAt: "2026-10-29T00:00:00Z",
  expiresAt: null,
  bytes: null,
  failure: null,
});

describe("complete export status helpers", () => {
  test.each(["queued", "running"] as const)("polls while %s", (state) => {
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

  test("builds only the fixed download path on the configured origin", () => {
    expect(
      completeExportDownloadUrl("https://records.example/", "2d49e6d8-8d64-4d69-81c1-15e56a82ca43"),
    ).toBe(
      "https://records.example/api/data-rights/exports/2d49e6d8-8d64-4d69-81c1-15e56a82ca43/download",
    );
  });

  test.each([
    "https://trusted.example/path",
    "https://user:pass@trusted.example/",
    "https://trusted.example/?token=secret",
  ])("rejects non-origin server input %s", (server) => {
    expect(() =>
      completeExportDownloadUrl(server, "2d49e6d8-8d64-4d69-81c1-15e56a82ca43"),
    ).toThrow();
  });

  test("rejects unsafe ids rather than allowing path segments", () => {
    expect(() => completeExportDownloadUrl("https://trusted.example/", "../../download")).toThrow();
  });
});
