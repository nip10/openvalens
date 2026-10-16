import { describe, expect, test } from "bun:test";

import {
  AUDIT_EVENT_FILTER_OPTIONS,
  auditActorLabel,
  auditDetailsLabel,
  auditEventLabel,
  auditTargetLabel,
  isAuditPermissionDenied,
} from "./audit-timeline";

describe("audit timeline presenter", () => {
  test("labels every event type and falls back for unknown ones", () => {
    expect(AUDIT_EVENT_FILTER_OPTIONS.every((option) => option.label.length > 0)).toBe(true);
    expect(auditEventLabel("EXPORT_GENERATED")).toBe("Export downloaded");
    expect(auditEventLabel("SOMETHING_NEW")).toBe("Other event");
  });

  test("target and actor labels use identifiers only", () => {
    expect(auditTargetLabel("blood_panel", "101")).toBe("Blood panel 101");
    expect(auditTargetLabel("records", null)).toBe("Records");
    expect(auditTargetLabel(null, "x")).toBe("");
    expect(auditActorLabel("user-a", "user-a")).toBe("You");
    expect(auditActorLabel("user-b-1234567890", "user-a")).toBe("Member user-b-1");
    expect(auditActorLabel(null, "user-a")).toBe("System");
  });

  test("details summarize format and section count, not domain values", () => {
    expect(
      auditDetailsLabel({ format: "pdf", selectedDomains: ["blood", "body"], fileCount: 1 }),
    ).toBe("PDF · 2 sections");
    expect(auditDetailsLabel({ resource: "medications", action: "write" })).toBe("medications");
    expect(auditDetailsLabel({})).toBe("");
  });

  test("permission denial detection", () => {
    expect(isAuditPermissionDenied({ code: "PERMISSION_DENIED" })).toBe(true);
    expect(isAuditPermissionDenied({ status: 403 })).toBe(true);
    expect(isAuditPermissionDenied({ code: "INTERNAL", status: 500 })).toBe(false);
    expect(isAuditPermissionDenied(null)).toBe(false);
  });
});
