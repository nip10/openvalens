import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@openvalens/db";
import { exerciseCatalogBootstrap } from "@openvalens/db/schema/exercises";

export type CatalogBootstrapState = typeof exerciseCatalogBootstrap.$inferSelect;
export type CatalogBootstrapMode = CatalogBootstrapState["mode"];

/** Creates the singleton row once (`upstream` unless the demo seed made it `sample`). */
export async function ensureBootstrapState(
  db: Database,
  mode: CatalogBootstrapMode = "upstream",
): Promise<CatalogBootstrapState> {
  await db.insert(exerciseCatalogBootstrap).values({ id: 1, mode }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(exerciseCatalogBootstrap)
    .where(eq(exerciseCatalogBootstrap.id, 1))
    .limit(1);
  if (!row) throw new Error("Exercise catalog bootstrap state is missing.");
  return row;
}

/** Takes the setup lease; `null` when another server holds it. */
export async function acquireBootstrapLease(
  db: Database,
  now: Date,
  leaseMs: number,
): Promise<CatalogBootstrapState | null> {
  const [row] = await db
    .update(exerciseCatalogBootstrap)
    .set({
      leaseUntil: new Date(now.getTime() + leaseMs),
      attempts: sql`${exerciseCatalogBootstrap.attempts} + 1`,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(exerciseCatalogBootstrap.id, 1),
        or(
          isNull(exerciseCatalogBootstrap.leaseUntil),
          lt(exerciseCatalogBootstrap.leaseUntil, now),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

export async function updateBootstrapState(
  db: Database,
  values: Partial<
    Pick<
      CatalogBootstrapState,
      "catalogImportedAt" | "mediaPublishedAt" | "lastError" | "leaseUntil" | "mode"
    >
  >,
): Promise<void> {
  await db
    .update(exerciseCatalogBootstrap)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(exerciseCatalogBootstrap.id, 1));
}
