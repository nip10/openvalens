import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  return drizzle(env.DATABASE_URL, { relations });
}

export type Database = ReturnType<typeof createDb>;
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Shared transaction-scoped serialization for user-owned nutrition safety inputs. */
export async function lockNutritionSafetyUser(tx: DbTransaction, userId: string): Promise<void> {
  await tx.execute(sql`set transaction isolation level read committed`);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`nutrition-safety-user:${userId}`}, 0))`,
  );
}

/**
 * Re-export Drizzle's `sql` template tag.
 *
 * Consumers such as `@openvalens/api`'s readiness probe need the tag to issue
 * a raw `SELECT 1` ping without taking a direct `drizzle-orm` dependency (the
 * driver stays owned by this package).
 */
export { sql } from "drizzle-orm";
