/**
 * One-time backfill script: sets organization_id on all health data tables.
 *
 * Usage:
 *   bun run db:backfill-org
 *
 * Run AFTER the nullable-column migration and BEFORE the NOT NULL migration.
 *
 * Ported from anchovy's `apps/web/src/lib/db/backfill-org-id.ts`. The original
 * used `drizzle-orm/postgres-js`; this port uses the `pg` driver already in
 * this package so no extra dependency is required. The table list and
 * behavior are preserved verbatim.
 */
import "@openvalens/config/file-secrets-preload.database";
import "varlock/auto-load";
import { Client } from "pg";
import { ENV } from "./env";

const TABLES = [
  "blood_panel",
  "blood_marker",
  "dexa_scan",
  "dexa_regional",
  "cardiac_exam",
  "cardiac_measurement",
  "imaging_study",
  "consultation",
  "supplement_schedule",
  "supplement_change",
  "medication",
  "telegram_account",
  "telegram_connect_token",
  "daily_reminder",
  "goal",
  "goal_checkin",
  "weight_checkin",
  "workout",
  "weekly_review",
  "health_connect_sync",
  "health_connect_record",
  "family_history",
  "ai_feedback",
  "coach_profile",
  "calendar_event",
  "insight",
  "scheduled_event",
  "chat_message",
  "ingestion_log",
] as const;

async function main() {
  const databaseUrl = ENV.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // 1. Find the single existing organization (the owner's personal workspace)
    const orgs = await client.query<{ id: string }>(
      "SELECT id FROM organization ORDER BY created_at ASC LIMIT 1",
    );

    if (orgs.rows.length === 0) {
      console.log("No organizations found — nothing to backfill.");
      return;
    }

    const orgId = orgs.rows[0]?.id;
    if (!orgId) {
      console.log("No organizations found — nothing to backfill.");
      return;
    }

    console.log(`Backfilling organization_id = ${orgId}`);

    // 2. Update every table
    for (const table of TABLES) {
      const result = await client.query(
        `UPDATE "${table}" SET organization_id = $1 WHERE organization_id IS NULL`,
        [orgId],
      );
      console.log(`  ${table}: ${result.rowCount ?? 0}`);
    }

    console.log("Backfill complete.");
  } finally {
    await client.end();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
