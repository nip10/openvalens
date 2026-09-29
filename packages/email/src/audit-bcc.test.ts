import { describe, expect, test } from "bun:test";

import { shouldAuditBcc } from "./audit-bcc";

describe("shouldAuditBcc", () => {
  test("returns true for the sensitive access-control templates", () => {
    for (const templateName of [
      "invitation",
      "access-request-submitted",
      "access-request-approved",
      "access-request-denied",
    ]) {
      expect(shouldAuditBcc(templateName)).toBe(true);
    }
  });

  test("returns false for other templates", () => {
    for (const templateName of [
      "magic-link",
      "invitation-reminder",
      "invitation-revoked",
      "unknown",
    ]) {
      expect(shouldAuditBcc(templateName)).toBe(false);
    }
  });
});
