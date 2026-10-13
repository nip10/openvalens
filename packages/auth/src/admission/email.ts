import { z } from "zod";

/**
 * Canonical admission email (Issue #63).
 *
 * The only normalisation applied is lower-casing. There is no trimming, no
 * dot removal and no plus-tag stripping, because the canonical value is used
 * to bind an immutable identity to a grant: silently rewriting an address
 * could merge two distinct mailboxes into one admission. A value that Zod
 * does not recognise as an email is rejected as `null`; callers turn that into
 * a generic denial (never a Zod error payload).
 */
const emailSchema = z.email();

export function canonicalizeEmail(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) {
    return null;
  }
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  return input.toLowerCase();
}
