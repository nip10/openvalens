import { sql, type Database } from "@openvalens/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Resets the demo database to an empty, fully migrated schema (Issue #301).
 *
 * The seed always starts from scratch, so running it twice gives the same
 * result. Only call this after `assertDisposableDemoDatabase`: it drops every
 * table in the database. Migrations go through Drizzle's migrator, which
 * records them the way `bun run db:migrate` does, so the server and a later
 * `db:migrate` see an up-to-date database.
 */
export async function resetDemoDatabase(db: Database): Promise<void> {
  await db.execute(sql`drop schema if exists "drizzle" cascade`);
  await db.execute(sql`drop schema if exists "public" cascade`);
  await db.execute(sql`create schema "public"`);
  await migrate(db, {
    migrationsFolder: new URL("../../db/src/migrations", import.meta.url).pathname,
  });
}
