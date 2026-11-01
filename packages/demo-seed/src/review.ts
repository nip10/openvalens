import { writeAuditLog } from "@openvalens/audit-security";
import { sql, type Database } from "@openvalens/db";

import { createDemoApi, type DemoActor } from "./api";
import {
  seedBodyComposition,
  seedClinical,
  seedCycle,
  seedGoals,
  seedPreventiveCare,
  seedSupplements,
} from "./care";
import { createCalendar } from "./dates";
import { planDeviceDays, seedDeviceData } from "./device";
import { seedNutrition } from "./nutrition";
import { completeSetup } from "./profile";
import { createRandom } from "./random";
import { seedLabs, seedRecoveryMetrics } from "./records";
import { seedStrengthTraining } from "./training";

/**
 * Seeds the synthetic demo data into the app store review account, on a real
 * database (`bun run demo:seed:review`).
 *
 * The disposable demo seed (`seedDemo`) wipes its database first. This one
 * never deletes anything and writes into one place only: the own workspace of
 * the existing account whose email is `REVIEW_ACCOUNT_EMAIL`. It refuses,
 * changing nothing, unless all of these hold:
 *
 * - exactly one account has that email (it is never created here);
 * - the account is not an instance administrator;
 * - the account belongs to exactly one workspace, which it owns alone (no
 *   other member), so no one else's records can be touched;
 * - that workspace holds no records yet.
 *
 * It is idempotent: a successful run writes a `REVIEW_DEMO_SEEDED` audit entry
 * in the workspace, and a later run that finds it reports `already-seeded` and
 * writes nothing. The data is the same synthetic history as the demo instance
 * (Alex Morgan's: 90 days in every module, ending on `today`), written through
 * the same procedures as the apps.
 */

export type ReviewSeedResult =
  | { status: "seeded"; userId: string; organizationId: string; today: string }
  | { status: "already-seeded"; userId: string; organizationId: string };

/** Value-free refusal: never echoes the email, a URL or an id. */
export class ReviewSeedRefusal extends Error {
  constructor(message: string) {
    super(`Refusing to seed the review account: ${message}`);
    this.name = "ReviewSeedRefusal";
  }
}

/**
 * Workspace tables that hold membership, audit, onboarding and preferences
 * rather than records: a brand-new account (or one that only signed in and
 * looked around) has rows here. Rows in any other table with an
 * `organization_id` mean the workspace holds records.
 */
const ACCOUNT_SETUP_TABLES = new Set([
  "member",
  "invitation",
  "organization_role",
  "access_audit_log",
  "admin_notification",
  "onboarding_state",
  "insight_preference",
  "metric_source_preference",
  "plain_water_preference",
  "preventive_care_setting",
  "telegram_connect_token",
  "wearable_oauth_state",
]);

export const REVIEW_SEED_MARKER = "REVIEW_DEMO_SEEDED";

async function findAccount(db: Database, email: string) {
  const users = (
    await db.execute<{ id: string; role: string | null }>(
      sql`select "id", "role" from "user" where lower("email") = ${email} limit 2`,
    )
  ).rows;
  if (users.length === 0)
    throw new ReviewSeedRefusal(
      "no account has REVIEW_ACCOUNT_EMAIL. Create it first (on Cloud, through the normal sign-up).",
    );
  if (users.length > 1) throw new ReviewSeedRefusal("more than one account matches.");
  const account = users[0]!;
  if (account.role === "admin")
    throw new ReviewSeedRefusal("the account is an instance administrator.");

  const memberships = (
    await db.execute<{ organization_id: string; role: string; members: number }>(sql`
      select m."organization_id", m."role",
        (select count(*)::int from "member" o where o."organization_id" = m."organization_id") as "members"
      from "member" m where m."user_id" = ${account.id}
    `)
  ).rows;
  if (memberships.length !== 1)
    throw new ReviewSeedRefusal("the account must belong to exactly one workspace, its own.");
  const [own] = memberships;
  if (own!.role !== "owner" || Number(own!.members) !== 1)
    throw new ReviewSeedRefusal("the account must be the only member and owner of its workspace.");
  return { userId: account.id, organizationId: own!.organization_id };
}

async function alreadySeeded(db: Database, actor: DemoActor): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from "access_audit_log" where "organization_id" = ${actor.organizationId} and "event_type" = ${REVIEW_SEED_MARKER} limit 1`,
  );
  return rows.rows.length > 0;
}

/** Workspace tables (by `organization_id`) outside account setup that have rows. */
export async function tablesWithRecords(db: Database, organizationId: string): Promise<string[]> {
  const tables = (
    await db.execute<{ table_name: string }>(sql`
      select c."table_name" from information_schema.columns c
      join information_schema.tables t
        on t."table_schema" = c."table_schema" and t."table_name" = c."table_name"
      where c."table_schema" = 'public' and c."column_name" = 'organization_id'
        and t."table_type" = 'BASE TABLE'
      order by c."table_name"
    `)
  ).rows.map((row) => row.table_name);
  const found: string[] = [];
  for (const table of tables) {
    if (ACCOUNT_SETUP_TABLES.has(table)) continue;
    const rows = await db.execute(
      sql`select 1 from ${sql.identifier(table)} where "organization_id" = ${organizationId} limit 1`,
    );
    if (rows.rows.length > 0) found.push(table);
  }
  return found;
}

export async function seedReviewAccount(
  db: Database,
  input: { email: string; today: string },
): Promise<ReviewSeedResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new ReviewSeedRefusal("REVIEW_ACCOUNT_EMAIL is not set.");
  const actor = await findAccount(db, email);

  if (await alreadySeeded(db, actor)) return { status: "already-seeded", ...actor };
  const existing = await tablesWithRecords(db, actor.organizationId);
  if (existing.length > 0)
    throw new ReviewSeedRefusal(
      `the workspace already holds records (${existing.join(", ")}). It only seeds an empty workspace.`,
    );

  const calendar = createCalendar(input.today);
  const random = createRandom();
  const api = createDemoApi(db);
  try {
    await completeSetup(api, actor, { sex: "female", birthYear: 1990 });
    const days = planDeviceDays(calendar, random.fork("plan"));
    await seedDeviceData(api, actor, calendar, days, random.fork("device"));
    await seedRecoveryMetrics(api, actor, calendar, random.fork("recovery"));
    await seedLabs(db, api, actor, calendar);
    await seedStrengthTraining(db, api, actor, calendar, random.fork("training"));
    await seedNutrition(api, actor, calendar, random.fork("nutrition"));
    await seedGoals(api, actor, calendar, random.fork("goals"));
    await seedSupplements(api, actor);
    await seedCycle(api, actor, calendar, random.fork("cycle"));
    await seedPreventiveCare(api, actor, calendar);
    await seedClinical(db, api, actor, calendar);
    await seedBodyComposition(db, api, actor, calendar, random.fork("body"));
  } finally {
    api.close();
  }

  const marker = await writeAuditLog({
    db,
    organizationId: actor.organizationId,
    actorUserId: null,
    eventType: REVIEW_SEED_MARKER,
    targetType: "organization",
    targetId: actor.organizationId,
    metadata: { source: "demo:seed:review", today: input.today },
  });
  if (marker === null) throw new Error("The data was seeded but the completion record failed.");
  return { status: "seeded", ...actor, today: input.today };
}
