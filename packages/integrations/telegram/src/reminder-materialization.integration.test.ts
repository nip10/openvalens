import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openvalens/db";
import type { EmailService, SendEmailInput } from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";

import { createDueDailyReminders, listReminderOrganizations } from "./reminder-materialization";
import { materializeDailyReminders } from "./reminders";

const url = process.env.REMINDER_MATERIALIZATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/reminder_materialization_test"
  )
    throw new Error("Empty disposable loopback reminder_materialization_test database required.");
}

function capturingLogger() {
  const lines: string[] = [];
  const logger = createStructuredLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  return { logger, lines };
}

type ReminderRow = {
  organization_id: string;
  user_id: string;
  date: string;
  source_type: string;
  source_id: number;
  label: string;
  status: string;
};

describe.skipIf(!url)("createDueDailyReminders", () => {
  const db = createDb({
    DATABASE_URL: url ?? "postgres://127.0.0.1/reminder_materialization_test",
  });
  const migrationsRoot = new URL("../../../db/src/migrations/", import.meta.url);
  // 08:05 UTC on the 14th is still the 13th in Honolulu (UTC-10).
  const now = new Date("2026-10-14T08:05:00.000Z");

  async function reminders(organizationId?: string): Promise<ReminderRow[]> {
    const result = await db.execute<ReminderRow>(sql`
      select organization_id, user_id, date, source_type::text as source_type, source_id, label,
             status::text as status
        from daily_reminder
       where ${organizationId ?? null}::text is null or organization_id = ${organizationId ?? null}
       order by user_id, source_id`);
    return result.rows;
  }

  function run(organizationId: string, telegramAvailable = true) {
    return createDueDailyReminders({
      db,
      logger: capturingLogger().logger,
      correlationId: `corr-${organizationId}`,
      organizationId,
      telegramAvailable,
      now,
    });
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");

    for (const directory of (await readdir(migrationsRoot)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, migrationsRoot)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }

    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values
        ('u-tg',     'tg@example.test',     false),
        ('u-mail',   'mail@example.test',   false),
        ('u-none',   'none@example.test',   false),
        ('u-weekly', 'weekly@example.test', false),
        ('u-banned', 'banned@example.test', true),
        ('u-b',      'b@example.test',      false),
        ('u-c',      'c@example.test',      false);
      insert into "organization" (id, name, slug) values
        ('org-a', 'A', 'a'), ('org-b', 'B', 'b'), ('org-c', 'C', 'c');
      insert into "member" (id, organization_id, user_id, role) values
        ('m-tg',     'org-a', 'u-tg',     'owner'),
        ('m-mail',   'org-a', 'u-mail',   'member'),
        ('m-none',   'org-a', 'u-none',   'member'),
        ('m-weekly', 'org-a', 'u-weekly', 'member'),
        ('m-banned', 'org-a', 'u-banned', 'member'),
        ('m-b',      'org-b', 'u-b',      'owner'),
        ('m-c',      'org-c', 'u-c',      'owner');
      insert into "telegram_account"
        (organization_id, user_id, telegram_chat_id, telegram_user_id, connected_at, created_at)
      values
        ('org-a', 'u-tg',     'chat-tg',     'tg-1', '2026-10-01', '2026-10-01'),
        ('org-a', 'u-banned', 'chat-banned', 'tg-2', '2026-10-01', '2026-10-01'),
        ('org-b', 'u-b',      'chat-b',      'tg-3', '2026-10-01', '2026-10-01');
      -- u-mail turned on daily reminders by email only. u-weekly has the weekly
      -- insight email and preventive-care reminders on, but not daily reminders.
      insert into "insight_preference"
        (organization_id, user_id, email_enabled, email_acknowledged_version, time_zone,
         disabled_channels, daily_reminder_email)
      values
        ('org-a', 'u-mail',   false, null, 'Pacific/Honolulu', '{}', true),
        ('org-a', 'u-weekly', true,  'v1', 'UTC',              '{}', false);
      insert into "supplement" (id, name) values (1, 'Vitamin D'), (2, 'Magnesium');
      insert into "supplement_schedule"
        (id, organization_id, user_id, supplement_id, time_of_day, frequency, status)
      values
        (11, 'org-a', 'u-tg',     1, 'morning', 'daily',  'active'),
        (12, 'org-a', 'u-tg',     2, 'morning', 'weekly', 'active'),
        (13, 'org-a', 'u-tg',     2, 'dinner',  'daily',  'paused'),
        (14, 'org-a', 'u-mail',   1, 'morning', null,     'active'),
        (15, 'org-a', 'u-none',   1, 'morning', 'daily',  'active'),
        (16, 'org-a', 'u-weekly', 1, 'morning', 'daily',  'active'),
        (17, 'org-a', 'u-banned', 1, 'morning', 'daily',  'active'),
        (18, 'org-b', 'u-b',      1, 'morning', 'daily',  'active'),
        (19, 'org-c', 'u-c',      1, 'morning', 'daily',  'active');
      insert into "medication" (id, organization_id, user_id, name, frequency, status) values
        (21, 'org-a', 'u-tg',   'Metformin',     'daily',         'active'),
        (22, 'org-a', 'u-tg',   'Old Rx',        'daily',         'completed'),
        (23, 'org-a', 'u-mail', 'Levothyroxine', 'training_days', 'active');
      insert into "scheduled_event"
        (id, organization_id, user_id, title, type, start_date, end_date, frequency, interval,
         created_at)
      values
        (31, 'org-a', 'u-tg',   'Blood test', 'lab',    '2026-10-14', null,         'once',   1, '2026-10-01'),
        (32, 'org-a', 'u-tg',   'Physio',     'custom', '2026-10-01', '2026-10-10', 'daily',  1, '2026-10-01'),
        (33, 'org-a', 'u-mail', 'Stretch',    'custom', '2026-10-13', null,         'daily',  1, '2026-10-01'),
        (34, 'org-a', 'u-mail', 'Lab',        'lab',    '2026-10-14', null,         'once',   1, '2026-10-01');
    `),
    );
  }, 120000);

  beforeEach(async () => {
    await db.execute(sql`delete from daily_reminder`);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  test("creates today's due items for opted-in members only, on their local date", async () => {
    const result = await run("org-a");

    expect(result).toEqual({ organizationId: "org-a", recipients: 2, created: 5 });
    expect(await reminders()).toEqual([
      {
        organization_id: "org-a",
        user_id: "u-mail",
        date: "2026-10-13",
        source_type: "supplement",
        source_id: 14,
        label: "Vitamin D",
        status: "pending",
      },
      {
        organization_id: "org-a",
        user_id: "u-mail",
        date: "2026-10-13",
        source_type: "activity",
        source_id: 33,
        label: "Stretch",
        status: "pending",
      },
      {
        organization_id: "org-a",
        user_id: "u-tg",
        date: "2026-10-14",
        source_type: "supplement",
        source_id: 11,
        label: "Vitamin D",
        status: "pending",
      },
      {
        organization_id: "org-a",
        user_id: "u-tg",
        date: "2026-10-14",
        source_type: "medication",
        source_id: 21,
        label: "Metformin",
        status: "pending",
      },
      {
        organization_id: "org-a",
        user_id: "u-tg",
        date: "2026-10-14",
        source_type: "activity",
        source_id: 31,
        label: "Blood test",
        status: "pending",
      },
    ]);
  });

  test("never logs a label", async () => {
    const { logger, lines } = capturingLogger();
    await createDueDailyReminders({
      db,
      logger,
      correlationId: "corr-log",
      organizationId: "org-a",
      telegramAvailable: true,
      now,
    });
    const serialized = lines.join("\n");
    for (const label of ["Vitamin D", "Metformin", "Blood test", "Stretch"])
      expect(serialized).not.toContain(label);
  });

  test("rerunning creates nothing new and keeps the member's reaction", async () => {
    await run("org-a");
    await db.execute(
      sql`update daily_reminder set status = 'done' where user_id = 'u-tg' and source_id = 11`,
    );

    const again = await run("org-a");

    expect(again.created).toBe(0);
    const rows = await reminders("org-a");
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.source_id === 11)?.status).toBe("done");
  });

  test("a run is bound to its organization", async () => {
    await run("org-a");
    expect(await reminders("org-b")).toEqual([]);

    const orgB = await run("org-b");
    expect(orgB.created).toBe(1);
    expect(await reminders("org-b")).toEqual([
      {
        organization_id: "org-b",
        user_id: "u-b",
        date: "2026-10-14",
        source_type: "supplement",
        source_id: 18,
        label: "Vitamin D",
        status: "pending",
      },
    ]);
    expect(await reminders("org-a")).toHaveLength(5);
  });

  test("without a Telegram bot only members who turned on reminder emails get reminders", async () => {
    const result = await run("org-a", false);

    expect(result).toEqual({ organizationId: "org-a", recipients: 1, created: 2 });
    expect(new Set((await reminders()).map((row) => row.user_id))).toEqual(new Set(["u-mail"]));
  });

  test("the weekly email and preventive-care reminders do not opt in to daily reminder email", async () => {
    await run("org-a");
    expect(await reminders("org-a")).not.toContainEqual(
      expect.objectContaining({ user_id: "u-weekly" }),
    );
    const sent: SendEmailInput[] = [];
    await materializeDailyReminders({
      db,
      client: null,
      logger: capturingLogger().logger,
      correlationId: "corr-weekly",
      organizationId: "org-a",
      email: {
        sendEmail: async (input) => {
          sent.push(input);
          return { id: "email-1", dryRun: false };
        },
        organizationName: "Health",
      },
    });
    expect(sent.map((input) => input.to)).not.toContain("weekly@example.test");
  });

  test("the email fallback delivers without a Telegram bot", async () => {
    // Leftover reminders for a Telegram-only member and for a member with only
    // the weekly email on must not be emailed.
    await db.execute(sql`
      insert into daily_reminder (organization_id, user_id, date, source_type, source_id, label, created_at)
      values ('org-a', 'u-tg', '2026-10-13', 'supplement', 11, 'Vitamin D', '2026-10-13'),
             ('org-a', 'u-weekly', '2026-10-13', 'supplement', 16, 'Vitamin D', '2026-10-13')`);
    await run("org-a", false);

    const sent: SendEmailInput[] = [];
    const email: EmailService = {
      sendEmail: async (input) => {
        sent.push(input);
        return { id: "email-1", dryRun: false };
      },
      organizationName: "Health",
    };
    const { logger, lines } = capturingLogger();
    const delivery = await materializeDailyReminders({
      db,
      client: null,
      logger,
      correlationId: "corr-email",
      organizationId: "org-a",
      email,
    });

    expect(delivery).toMatchObject({ sent: 2, skipped: 2, failed: 0 });
    expect(sent.map((input) => input.to)).toEqual(["mail@example.test", "mail@example.test"]);
    expect(sent.map((input) => input.text).sort()).toEqual(["Stretch", "Vitamin D"]);
    expect(lines.join("\n")).toContain("telegram_client_unconfigured");
    expect(lines.join("\n")).toContain("email_not_opted_in");

    const notEmailed = await db.execute<{ telegram_message_id: number | null }>(
      sql`select telegram_message_id from daily_reminder where user_id in ('u-tg', 'u-weekly')`,
    );
    expect(notEmailed.rows).toEqual([{ telegram_message_id: null }, { telegram_message_id: null }]);
  });

  test("the cron worklist has workspaces with opted-in members or pending reminders", async () => {
    expect(await listReminderOrganizations(db)).toEqual(["org-a", "org-b"]);

    await db.execute(sql`
      insert into daily_reminder (organization_id, user_id, date, source_type, source_id, label, created_at)
      values ('org-c', 'u-c', '2026-10-14', 'supplement', 19, 'Vitamin D', '2026-10-14')`);
    expect(await listReminderOrganizations(db)).toEqual(["org-a", "org-b", "org-c"]);
  });
});
