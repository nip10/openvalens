import { writeAuditLog } from "@openvalens/audit-security";
import { FOCUS_AREA_LABELS } from "@openvalens/api/wellness-profile-contract";
import { keepLocalTrialRunning } from "@openvalens/billing/trial";
import { eraseSubjectRecords } from "@openvalens/data-rights";
import { sql, type Database, type DbTransaction } from "@openvalens/db";

import { createDemoApi, type DemoActor } from "./api";
import { createCalendar } from "./dates";
import { seedPersonData } from "./person";
import { completeSetup } from "./profile";
import { createRandom } from "./random";

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
 * - that workspace holds no records yet. Setup rows don't count (see
 *   `ACCOUNT_SETUP_TABLES`), nor do up to `MAX_ONBOARDING_GOALS` bare goals
 *   from the onboarding or profile goal step (see `onboardingGoalsOnly`).
 *
 * It is idempotent: a successful run writes a `REVIEW_DEMO_SEEDED` audit entry
 * in the workspace, and a later run that finds it reports `already-seeded` and
 * writes nothing. The data is the same synthetic history as the demo instance
 * (Alex Morgan's: 90 days in every module, ending on `today`), written through
 * the same procedures as the apps, in one transaction: a run that fails
 * part-way leaves the workspace as it was.
 *
 * {@link refreshReviewAccount} (`--refresh`, the nightly job) replaces the
 * records of a workspace this seed filled with a fresh 90 days ending on
 * `today`, and keeps the account's trial running.
 */

export type ReviewSeedResult =
  | { status: "seeded"; userId: string; organizationId: string; today: string }
  | { status: "already-seeded"; userId: string; organizationId: string };

export type ReviewRefreshResult = {
  /** `seeded`: the workspace was empty and never seeded; `refreshed`: its records were replaced. */
  status: "seeded" | "refreshed";
  userId: string;
  organizationId: string;
  today: string;
  /** Rows erased before reseeding (zero on a first seed). */
  erasedRows: number;
  /** What happened to the subscription: see `keepLocalTrialRunning`. */
  trial: "extended" | "stripe" | "none";
};

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
  // The coach's tone and template; `coach.getConfig` writes a defaults row
  // the first time anything reads it.
  "coach_profile",
  "onboarding_state",
  "insight_preference",
  "metric_source_preference",
  "plain_water_preference",
  "preventive_care_setting",
  "telegram_connect_token",
  "wearable_oauth_state",
]);

/**
 * The onboarding goal step (web welcome flow, native onboarding) and the
 * profile goal section all create a goal the same way: a title, the first
 * focus area's label (or "General") as category, `not_started`, and nothing
 * else. There is no source column, so that exact shape is the discriminator.
 * Any edit (a target, date, baseline, note, status change) or a check-in (a
 * `goal_checkin` row, which counts as a record on its own) makes it a record.
 */
const ONBOARDING_GOAL_CATEGORIES = [...Object.values(FOCUS_AREA_LABELS), "General"];

/** More bare goals than this is someone using Goals, not finishing setup. */
export const MAX_ONBOARDING_GOALS = 3;

async function onboardingGoalsOnly(db: Executor, organizationId: string): Promise<boolean> {
  const categories = sql.join(
    ONBOARDING_GOAL_CATEGORIES.map((category) => sql`${category}`),
    sql`, `,
  );
  const rows = await db.execute<{ total: number; bare: number }>(sql`
    select count(*)::int as "total",
      (count(*) filter (where "status" = 'not_started'
        and "category" in (${categories})
        and "horizon" is null and "current_value" is null and "target_value" is null
        and "target_date" is null and "notes" is null and "direction" is null
        and "baseline_value" is null and "priority" is null))::int as "bare"
    from "goal" where "organization_id" = ${organizationId}
  `);
  const { total, bare } = rows.rows[0] ?? { total: 0, bare: 0 };
  return Number(total) === Number(bare) && Number(total) <= MAX_ONBOARDING_GOALS;
}

export const REVIEW_SEED_MARKER = "REVIEW_DEMO_SEEDED";
export const REVIEW_REFRESH_MARKER = "REVIEW_DEMO_REFRESHED";

type Executor = Pick<Database, "execute">;

async function findAccount(db: Executor, email: string) {
  if (!email) throw new ReviewSeedRefusal("REVIEW_ACCOUNT_EMAIL is not set.");
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

async function alreadySeeded(db: Executor, actor: DemoActor): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from "access_audit_log" where "organization_id" = ${actor.organizationId} and "event_type" = ${REVIEW_SEED_MARKER} limit 1`,
  );
  return rows.rows.length > 0;
}

/**
 * Workspace tables (by `organization_id`) outside account setup that have
 * rows. `goal` is left out while it holds only onboarding goals, and only
 * when no other table has records.
 */
export async function tablesWithRecords(db: Executor, organizationId: string): Promise<string[]> {
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
  if (found.length === 1 && found[0] === "goal" && (await onboardingGoalsOnly(db, organizationId)))
    return [];
  return found;
}

async function goalTitles(db: Executor, organizationId: string): Promise<Set<string>> {
  const rows = await db.execute<{ title: string }>(
    sql`select "title" from "goal" where "organization_id" = ${organizationId}`,
  );
  return new Set(rows.rows.map((row) => row.title.trim().toLowerCase()));
}

/**
 * Writes the synthetic history into the account's workspace. `db` is the
 * caller's transaction: the in-process router runs every procedure inside it
 * (their own transactions become savepoints). A procedure that runs reads in
 * parallel queues them on the transaction's one connection, which `pg` 8
 * allows with a deprecation warning.
 */
async function writeReviewDemoData(db: Database, actor: DemoActor, today: string): Promise<void> {
  const calendar = createCalendar(today);
  const random = createRandom();
  const api = createDemoApi(db);
  try {
    await completeSetup(api, actor, { sex: "female", birthYear: 1990 });
    // An onboarding goal stays as it is; a demo goal with the same title is
    // skipped rather than added twice.
    await seedPersonData(db, api, actor, calendar, random, {
      skipGoalTitles: await goalTitles(db, actor.organizationId),
    });
  } finally {
    api.close();
  }
}

/** The transaction as the database handle the seeders and router take. */
const asDatabase = (tx: DbTransaction) => tx as unknown as Database;

async function mark(
  tx: DbTransaction,
  actor: DemoActor,
  eventType: typeof REVIEW_SEED_MARKER | typeof REVIEW_REFRESH_MARKER,
  metadata: Record<string, string | number>,
) {
  const marker = await writeAuditLog({
    db: asDatabase(tx),
    organizationId: actor.organizationId,
    actorUserId: null,
    eventType,
    targetType: "organization",
    targetId: actor.organizationId,
    metadata,
  });
  if (marker === null) throw new Error("The completion record failed.");
}

export async function seedReviewAccount(
  db: Database,
  input: { email: string; today: string },
): Promise<ReviewSeedResult> {
  const email = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const actor = await findAccount(tx, email);
    await tx.execute(sql`select "id" from "user" where "id" = ${actor.userId} for update`);
    if (await alreadySeeded(tx, actor)) return { status: "already-seeded", ...actor };
    const existing = await tablesWithRecords(tx, actor.organizationId);
    if (existing.length > 0)
      throw new ReviewSeedRefusal(
        `the workspace already holds records (${existing.join(", ")}). It only seeds an empty workspace.`,
      );
    await writeReviewDemoData(asDatabase(tx), actor, input.today);
    await mark(tx, actor, REVIEW_SEED_MARKER, { source: "demo:seed:review", today: input.today });
    return { status: "seeded" as const, ...actor, today: input.today };
  });
}

/**
 * The nightly refresh (`bun run demo:seed:review --refresh`). Same account
 * guards as {@link seedReviewAccount}, then, in one transaction:
 *
 * - a workspace this seed filled before (it has `REVIEW_DEMO_SEEDED`) has its
 *   records erased through data rights' records-only erasure, which keeps the
 *   account, its sessions, consents, subscription and audit log, so reviewers
 *   stay signed in. Anything a reviewer entered goes with the old records, and
 *   so do the record-level audit rows (`RECORD_*`) that described them;
 * - an empty workspace that was never seeded is simply seeded;
 * - a workspace with records that this seed never filled is refused: those
 *   could be a real person's;
 * - then 90 fresh days ending on `today` are written, the run is recorded
 *   (`REVIEW_DEMO_REFRESHED`, or `REVIEW_DEMO_SEEDED` the first time), and a
 *   local trial is kept running for another 30 days.
 *
 * Readers never see a half-written workspace, and a failed run changes
 * nothing.
 */
export async function refreshReviewAccount(
  db: Database,
  input: { email: string; today: string },
): Promise<ReviewRefreshResult> {
  const email = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const actor = await findAccount(tx, email);
    await tx.execute(sql`select "id" from "user" where "id" = ${actor.userId} for update`);
    const seeded = await alreadySeeded(tx, actor);
    let erasedRows = 0;
    if (seeded) {
      const report = await eraseSubjectRecords(tx, {
        userId: actor.userId,
        organizationIds: [actor.organizationId],
      });
      erasedRows = Object.values(report.rowCounts).reduce((sum, n) => sum + n, 0);
      // The record-level audit rows describe records that are gone now. Each
      // run writes about 1,700 of them; without this they would pile up and
      // bury the review sign-ins. Every other audit row stays.
      const audit = await tx.execute<{ n: number }>(
        sql`with gone as (delete from "access_audit_log" where "organization_id" = ${actor.organizationId}
          and "event_type" in ('RECORD_CREATED', 'RECORD_UPDATED', 'RECORD_DELETED') returning 1)
          select count(*)::int as n from gone`,
      );
      erasedRows += Number(audit.rows[0]?.n ?? 0);
    } else {
      const existing = await tablesWithRecords(tx, actor.organizationId);
      if (existing.length > 0)
        throw new ReviewSeedRefusal(
          `the workspace holds records (${existing.join(", ")}) that demo:seed:review did not write.`,
        );
    }
    await writeReviewDemoData(asDatabase(tx), actor, input.today);
    if (seeded)
      await mark(tx, actor, REVIEW_REFRESH_MARKER, {
        source: "demo:seed:review --refresh",
        today: input.today,
        erasedRows,
      });
    else
      await mark(tx, actor, REVIEW_SEED_MARKER, {
        source: "demo:seed:review --refresh",
        today: input.today,
      });
    const trial = await keepLocalTrialRunning(tx, { userId: actor.userId });
    return {
      status: seeded ? ("refreshed" as const) : ("seeded" as const),
      ...actor,
      today: input.today,
      erasedRows,
      trial,
    };
  });
}
