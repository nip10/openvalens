import { drizzle } from "drizzle-orm/node-postgres";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  return drizzle(env.DATABASE_URL, { relations });
}

export type Database = ReturnType<typeof createDb>;

/**
 * Re-export Drizzle's `sql` template tag.
 *
 * Consumers such as `@openvalens/api`'s readiness probe need the tag to issue
 * a raw `SELECT 1` ping without taking a direct `drizzle-orm` dependency (the
 * driver stays owned by this package).
 */
export { sql } from "drizzle-orm";
