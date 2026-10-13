import { sql, type Database } from "@openvalens/db";
import { z } from "zod";

/**
 * Existing-account policy (Issue #63).
 *
 * A global administrator may invite an email that already has an account. The
 * lookup is deliberately strict so it can never be broadened into an
 * account-enumeration oracle or a way to merge distinct mailboxes:
 *
 * - normalisation is lower-casing only — no trimming, no dot removal, no
 *   plus-tag stripping;
 * - the query binds the canonical value as a parameter and matches
 *   `lower(email)` exactly;
 * - anything other than exactly one matching row (none, or an ambiguous
 *   duplicate) is treated as "no existing account".
 */

const emailSchema = z.email();

/** Lower-cases a syntactically valid email; `null` for anything else. */
export function canonicalizeExistingAccountEmail(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) {
    return null;
  }
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  return input.toLowerCase();
}

/**
 * Returns the single existing account for `email`, or `null` when the address
 * is malformed, unknown, or ambiguous. The caller maps `null` to a generic
 * denial — it must never echo the address or the query.
 */
export async function findExistingAccount(
  db: Database,
  email: unknown,
): Promise<{ id: string } | null> {
  const canonical = canonicalizeExistingAccountEmail(email);
  if (canonical === null) {
    return null;
  }

  const result = await db.execute<{ id: string }>(
    sql`select "id" from "user" where lower("email") = ${canonical} order by "id" limit 2`,
  );

  if (result.rows.length !== 1) {
    return null;
  }
  return { id: result.rows[0]!.id };
}

/** Whether a single, unambiguous existing account owns `email`. */
export async function hasExistingAccount(db: Database, email: unknown): Promise<boolean> {
  return (await findExistingAccount(db, email)) !== null;
}
