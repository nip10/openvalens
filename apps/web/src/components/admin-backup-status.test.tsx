import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import type { AdminBackupStatusOutput } from "@/utils/admin-settings-keys";

import { AdminBackupStatus } from "./admin-backup-status";

function render(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const healthy: AdminBackupStatusOutput = {
  state: "ok",
  lastBackup: {
    id: "20261025T030000Z-daily",
    trigger: "daily",
    sizeBytes: 5 * 1024 * 1024,
    at: "2026-10-25T03:00:09.000Z",
  },
  lastVerify: { id: "20261025T030000Z-daily", outcome: "ok", at: "2026-10-25T03:00:20.000Z" },
  lastFailure: null,
  schedule: { nextRunAt: "2026-10-26T03:00:00.000Z", hourUtc: 3, dailyRetain: 14 },
};

describe("AdminBackupStatus (Issue #64)", () => {
  test("shows the last backup, verify, next run and the key escrow reminder", () => {
    const html = render(<AdminBackupStatus status="ready" backups={healthy} />);
    expect(html).toContain("Backups healthy");
    expect(html).toContain("5.0 MB encrypted");
    expect(html).toContain("daily");
    expect(html).toContain(`Passed ${new Date("2026-10-25T03:00:20.000Z").toLocaleString()}`);
    expect(html).toContain("keeping 14 daily");
    expect(html).toContain("deploy/secrets/backup/age-identity");
  });

  test("flags a failed verify with its step", () => {
    const html = render(
      <AdminBackupStatus
        status="ready"
        backups={{
          ...healthy,
          state: "failing",
          lastVerify: { id: null, outcome: "failed", at: "2026-10-25T03:00:20.000Z" },
          lastFailure: {
            operation: "verify",
            trigger: "daily",
            step: "row-counts",
            at: "2026-10-25T03:00:20.000Z",
          },
        }}
      />,
    );
    expect(html).toContain("Backups failing");
    expect(html).toContain("Failed ");
    expect(html).toContain("row-counts");
  });

  test("says so when no backup service ever reported", () => {
    const html = render(
      <AdminBackupStatus
        status="ready"
        backups={{
          state: "off",
          lastBackup: null,
          lastVerify: null,
          lastFailure: null,
          schedule: null,
        }}
      />,
    );
    expect(html).toContain("Not reported");
    expect(html).toContain("No backup has been reported");
  });

  test("loading and error states", () => {
    expect(render(<AdminBackupStatus status="loading" />)).toContain("Backups");
    expect(render(<AdminBackupStatus status="error" onRetry={() => {}} />)).toContain(
      "Could not load the backup status.",
    );
  });
});
