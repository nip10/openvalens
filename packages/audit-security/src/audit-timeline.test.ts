import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";

import {
  AUDIT_TIMELINE_MAX_LIMIT,
  buildAuditTimeline,
  redactAuditTimelineRow,
  type AuditTimelineRow,
} from "./audit-timeline";

// Synthetic data only.
function row(overrides: Partial<AuditTimelineRow> = {}): AuditTimelineRow {
  return {
    id: 1,
    createdAt: "2026-03-08T10:00:00.000Z",
    eventType: "EXPORT_GENERATED",
    targetType: "records",
    targetId: "2026-03-08T10:00:00.000Z",
    actorUserId: "user-a",
    afterJson: {
      metadata: { format: "pdf", selectedDomains: ["blood", "body"], fileCount: 1 },
      correlationId: "corr-1",
    },
    ...overrides,
  };
}

describe("redactAuditTimelineRow", () => {
  test("keeps identifiers and allow-listed, identifier-shaped details", () => {
    expect(redactAuditTimelineRow(row())).toEqual({
      id: 1,
      occurredAt: "2026-03-08T10:00:00.000Z",
      eventType: "EXPORT_GENERATED",
      targetType: "records",
      targetId: "2026-03-08T10:00:00.000Z",
      actorUserId: "user-a",
      correlationId: "corr-1",
      details: { format: "pdf", selectedDomains: ["blood", "body"], fileCount: 1 },
      redacted: false,
    });
  });

  test("drops values, free text, network identifiers and unknown metadata keys", () => {
    const entry = redactAuditTimelineRow(
      row({
        afterJson: {
          after: { valueNumeric: 5.4, testName: "Synthetic marker" },
          metadata: {
            format: "pdf",
            metricCode: "synthetic_glucose",
            email: "someone@example.invalid",
            attemptedOrganizationId: "org-b",
            type: "doctor visit",
          },
          ipAddress: "192.0.2.1",
          userAgent: "SyntheticAgent/1.0",
        },
      }),
    );
    expect(entry.details).toEqual({ format: "pdf" });
    const serialized = JSON.stringify(entry);
    for (const leaked of [
      "5.4",
      "Synthetic marker",
      "synthetic_glucose",
      "example.invalid",
      "org-b",
      "doctor visit",
      "192.0.2.1",
      "SyntheticAgent",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  test("redacts allow-listed keys whose values are not identifier-shaped", () => {
    const entry = redactAuditTimelineRow(
      row({
        afterJson: {
          metadata: {
            format: "free text with spaces",
            selectedDomains: ["blood", "not a token"],
            fileCount: Number.NaN,
            purpose: { nested: true },
          },
        },
      }),
    );
    expect(entry.details).toEqual({});
    expect(entry.redacted).toBe(true);
  });

  test("redacts non-identifier column values instead of echoing them", () => {
    const entry = redactAuditTimelineRow(
      row({
        targetId: "Synthetic Person, 5.4 mmol/L",
        targetType: "blood panel",
        eventType: "something odd",
        afterJson: null,
      }),
    );
    expect(entry.targetId).toBeNull();
    expect(entry.targetType).toBeNull();
    expect(entry.eventType).toBe("UNKNOWN");
    expect(entry.correlationId).toBeNull();
    expect(entry.redacted).toBe(true);
  });
});

describe("buildAuditTimeline", () => {
  test("refuses to run without an organization id", async () => {
    await expect(buildAuditTimeline({ db: {} as Database, organizationId: "" })).rejects.toThrow(
      "organization id",
    );
  });

  test("clamps the limit and asks for one extra row to detect a next page", async () => {
    let requested = 0;
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async (value: number) => {
        requested = value;
        return [];
      },
    };
    const page = await buildAuditTimeline({
      db: chain as unknown as Database,
      organizationId: "org-a",
      limit: 10_000,
    });
    expect(requested).toBe(AUDIT_TIMELINE_MAX_LIMIT + 1);
    expect(page).toEqual({ entries: [], nextCursor: null });
  });
});
