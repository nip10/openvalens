import { sql, type Database } from "@openvalens/db";

/**
 * Pure predicate for the global Better Auth user role claim (Issue #58).
 *
 * Better Auth's admin plugin splits a comma-separated role claim into tokens
 * *without trimming*, so an instance administrator must appear as the exact
 * token `admin`:
 *
 * - `'admin'` and `'admin,user'` are instance admins.
 * - `'user, admin'`, `' admin '`, `'superadmin'`, `'owner'` and `'ADMIN'` are
 *   not. There is no substring match, no case folding and no whitespace
 *   trimming, so a role string cannot be broadened into an admin claim.
 *
 * Non-string input (a malformed row) is never an admin.
 */
export function isInstanceAdminRole(role: unknown): boolean {
  if (typeof role !== "string") {
    return false;
  }

  return role.split(",").some((token) => token === "admin");
}

type InstanceAdminRow = {
  role: string | null;
  banned: boolean | null;
};

/**
 * Fresh, request-scoped instance-administrator lookup (Issue #58).
 *
 * Reads only `role` and `banned` for the given user id from the global auth
 * `user` table. The caller must pass the *trusted* session user id resolved
 * from the server context — never a client-supplied id, an active organization
 * role, a session role claim or a cached value.
 *
 * A missing row, a banned user, a malformed row, or a role without the exact
 * `admin` token is not an instance admin. Database failures are thrown so the
 * API layer can map them to a generic internal error (never a fake `false`).
 */
export async function isInstanceAdmin(db: Database, userId: string): Promise<boolean> {
  const result = await db.execute<InstanceAdminRow>(
    sql`select "role", "banned" from "user" where "id" = ${userId} limit 1`,
  );

  const row = result.rows[0];
  if (!row) {
    return false;
  }

  // Reject an explicitly banned user; `false`/`null` (the column default) pass.
  if (row.banned === true) {
    return false;
  }
  if (row.banned !== false && row.banned !== null) {
    return false;
  }

  return isInstanceAdminRole(row.role);
}
