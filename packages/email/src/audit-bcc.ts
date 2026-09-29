/**
 * Audit BCC policy (Issue #15).
 *
 * Sensitive access-control flows are copied to `EMAIL_AUDIT_BCC` so a
 * compliance mailbox receives a receipt of the outbound notification. These
 * templates mirror the anchovy allow-list.
 */

const AUDIT_BCC_TEMPLATES = new Set<string>([
  "invitation",
  "access-request-submitted",
  "access-request-approved",
  "access-request-denied",
]);

/** Returns `true` when the named template should be BCC'd to the audit mailbox. */
export function shouldAuditBcc(templateName: string): boolean {
  return AUDIT_BCC_TEMPLATES.has(templateName);
}
