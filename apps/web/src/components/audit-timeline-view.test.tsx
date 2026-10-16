import { describe, expect, test } from "bun:test";
import type { AuditTimelineEntryView } from "@openvalens/api/presenters/audit-timeline";
import { renderToStaticMarkup } from "react-dom/server";

import { AuditTimelineView } from "./audit-timeline-view";

const ENTRIES: AuditTimelineEntryView[] = [
  {
    id: 2,
    occurredAt: "2026-03-08T10:00:00.000Z",
    eventType: "EXPORT_GENERATED",
    targetType: "records",
    targetId: "2026-03-08T10:00:00.000Z",
    actorUserId: "user-a",
    details: { format: "pdf", selectedDomains: ["blood", "body"], fileCount: 1 },
    redacted: false,
  },
  {
    id: 1,
    occurredAt: "2026-03-07T09:30:00.000Z",
    eventType: "RECORD_UPDATED",
    targetType: "medication",
    targetId: "7",
    actorUserId: "user-collaborator",
    details: { resource: "medications" },
    redacted: true,
  },
];

describe("AuditTimelineView", () => {
  test("lists events with actor, target and value-free details", () => {
    const html = renderToStaticMarkup(
      <AuditTimelineView state="ready" entries={ENTRIES} viewerUserId="user-a" hasMore />,
    );
    expect(html).toInclude("Export downloaded");
    expect(html).toInclude("You · Records 2026-03-08T10:00:00.000Z · PDF · 2 sections");
    expect(html).toInclude("Record changed");
    expect(html).toInclude("Member user-col · Medication 7 · medications");
    expect(html).toInclude("2026-03-08 10:00 UTC");
    expect(html).toInclude("Redacted");
    expect(html).toInclude("Load more");
  });

  test("permission denial, error and empty states", () => {
    expect(
      renderToStaticMarkup(<AuditTimelineView state="denied" entries={[]} viewerUserId={null} />),
    ).toInclude("Only workspace owners can view the audit log.");
    expect(
      renderToStaticMarkup(
        <AuditTimelineView state="error" entries={[]} viewerUserId={null} onRetry={() => {}} />,
      ),
    ).toInclude("Could not load the audit log.");
    expect(
      renderToStaticMarkup(<AuditTimelineView state="ready" entries={[]} viewerUserId={null} />),
    ).toInclude("No events");
  });
});
