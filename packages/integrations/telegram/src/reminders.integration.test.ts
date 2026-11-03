import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openvalens/db";
import type { EmailService, SendEmailInput } from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";

import type { TelegramClient } from "./client";
import { materializeDailyReminders } from "./reminders";

const url = process.env.REMINDERS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/reminders_issue125"
  )
    throw new Error("Empty disposable loopback reminders_issue125 database required.");
}

type SentCall = {
  chatId?: string;
  email?: string;
  text: string;
};

function fakeChannels(): {
  client: TelegramClient;
  email: EmailService;
  calls: SentCall[];
} {
  const calls: SentCall[] = [];
  const sendMessage = mock(async (chatId: string, text: string) => {
    calls.push({ chatId, text });
    return { ok: true, result: { message_id: calls.length } };
  });
  const sendEmail = async (input: SendEmailInput) => {
    const to = Array.isArray(input.to) ? input.to[0]! : input.to;
    calls.push({ email: to, text: input.text });
    return { id: "email-1", dryRun: false };
  };
  return {
    client: { sendMessage } as unknown as TelegramClient,
    email: {
      sendEmail,
      prepareEmail: (input: SendEmailInput) => input,
      organizationName: "Health",
    } as unknown as EmailService,
    calls,
  };
}

function capturingLogger() {
  const lines: string[] = [];
  const logger = createStructuredLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  return { logger, lines };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe.skipIf(!url)("materializeDailyReminders cross-tenant", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/reminders_issue125" });
  const migrationsRoot = new URL("../../../db/src/migrations/", import.meta.url);
  const date = "2026-10-14";
  // Midday UTC on that date: every member here is on UTC and past the default 08:00.
  const now = new Date(`${date}T12:00:00.000Z`);

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
        ('user-a',     'a@example.test',     false),
        ('user-b',     'b@example.test',     false),
        ('user-c',     'c@example.test',     false),
        ('user-banned','banned@example.test', true);
      insert into "organization" (id, name, slug) values
        ('org-a', 'A', 'a'),
        ('org-b', 'B', 'b');
      insert into "member" (id, organization_id, user_id, role) values
        ('m-a',      'org-a', 'user-a',      'owner'),
        ('m-c',      'org-a', 'user-c',      'member'),
        ('m-banned', 'org-a', 'user-banned', 'member'),
        ('m-b',      'org-b', 'user-b',      'owner');
      insert into "telegram_account"
        (organization_id, user_id, telegram_chat_id, telegram_user_id, connected_at, created_at)
      values
        ('org-a', 'user-a',      'chat-a',      'tg-user-a',      '${date}', '${date}'),
        ('org-a', 'user-c',      'chat-c',      'tg-user-c',      '${date}', '${date}'),
        ('org-a', 'user-banned', 'chat-banned', 'tg-user-banned', '${date}', '${date}'),
        ('org-b', 'user-b',      'chat-b',      'tg-user-b',      '${date}', '${date}');
      insert into "daily_reminder"
        (organization_id, user_id, date, source_type, source_id, label, created_at)
      values
        ('org-a', 'user-a',      '${date}', 'supplement', 1, 'Secret Vitamin D',   '${date}'),
        ('org-a', 'user-c',      '${date}', 'supplement', 2, 'Top Secret Med C',   '${date}'),
        ('org-a', 'user-banned', '${date}', 'supplement', 3, 'Banned Should Skip', '${date}'),
        ('org-b', 'user-b',      '${date}', 'supplement', 1, 'Hidden Rx B',        '${date}');
    `),
    );
  }, 120000);

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        `delete from daily_reminder_email_digest; update daily_reminder set status = 'pending', telegram_message_id = null`,
      ),
    );
  });

  afterAll(async () => {
    await db.$client.end();
  });

  test("only the bound organization's reminders are delivered", async () => {
    const { client, email, calls } = fakeChannels();
    const { logger, lines } = capturingLogger();

    const result = await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-fanout",
      organizationId: "org-a",
      now,
      attemptNow: () => now,
      email,
    });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(calls.map((c) => c.chatId).sort()).toEqual(["chat-a", "chat-c"]);

    // Cross-tenant row stays pending and undelivered.
    const orgB = await db
      .select({ telegramMessageId: sql<number | null>`telegram_message_id` })
      .from(sql`daily_reminder`)
      .where(sql`organization_id = 'org-b'`);
    expect(orgB[0]?.telegramMessageId).toBeNull();

    // Log lines never include raw labels, chat ids, or emails.
    const serialized = lines.join("\n");
    for (const forbidden of [
      "Secret Vitamin D",
      "Top Secret Med C",
      "chat-a",
      "chat-c",
      "a@example.test",
      "c@example.test",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("banned recipients are skipped, not delivered", async () => {
    const { client, email, calls } = fakeChannels();
    const { logger, lines } = capturingLogger();

    const result = await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-banned",
      organizationId: "org-a",
      now,
      attemptNow: () => now,
      email,
    });

    // user-banned has a Telegram chat but is banned → skip, not send.
    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls.map((c) => c.chatId).sort()).toEqual(["chat-a", "chat-c"]);

    expect(lines.join("\n")).toContain("recipient_banned");
    expect(lines.join("\n")).not.toContain("Banned Should Skip");

    // The banned row remains pending + undelivered (status is owned by the
    // reaction webhook; we never mutate it on delivery).
    const bannedRow = await db
      .select({
        status: sql<string>`status`,
        telegramMessageId: sql<number | null>`telegram_message_id`,
      })
      .from(sql`daily_reminder`)
      .where(sql`user_id = 'user-banned'`);
    expect(bannedRow[0]?.status).toBe("pending");
    expect(bannedRow[0]?.telegramMessageId).toBeNull();
  });

  test("re-running for the same org does not re-deliver", async () => {
    const first = fakeChannels();
    await materializeDailyReminders({
      db,
      client: first.client,
      logger: capturingLogger().logger,
      correlationId: "corr-idem-1",
      organizationId: "org-a",
      now,
      attemptNow: () => now,
      email: first.email,
    });
    expect(first.calls.length).toBe(2);

    const second = fakeChannels();
    const passTwo = await materializeDailyReminders({
      db,
      client: second.client,
      logger: capturingLogger().logger,
      correlationId: "corr-idem-2",
      organizationId: "org-a",
      now,
      attemptNow: () => now,
      email: second.email,
    });

    expect(passTwo.sent).toBe(0);
    expect(second.calls.length).toBe(0);
  });

  test("running for org-a does not deliver org-b reminders", async () => {
    const { client, email, calls } = fakeChannels();
    const { logger } = capturingLogger();

    await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-iso",
      organizationId: "org-a",
      now,
      attemptNow: () => now,
      email,
    });

    const chats = new Set(calls.map((c) => c.chatId));
    expect(chats.has("chat-b")).toBe(false);

    const orgBRow = await db
      .select({
        status: sql<string>`status`,
        telegramMessageId: sql<number | null>`telegram_message_id`,
      })
      .from(sql`daily_reminder`)
      .where(sql`organization_id = 'org-b'`);
    expect(orgBRow[0]?.status).toBe("pending");
    expect(orgBRow[0]?.telegramMessageId).toBeNull();
  });

  test("concurrent cron runs against the same org deliver each row exactly once", async () => {
    const sentPerRun: string[][] = [];

    await Promise.all(
      Array.from({ length: 3 }, async (_, idx) => {
        const { client, email, calls } = fakeChannels();
        const result = await materializeDailyReminders({
          db,
          client,
          logger: capturingLogger().logger,
          correlationId: `corr-concurrent-${idx}`,
          organizationId: "org-a",
          now,
          attemptNow: () => now,
          email,
        });
        sentPerRun.push(calls.map((c) => String(c.chatId)));
        return result;
      }),
    );

    // The three org-a sends (user-a, user-c; user-banned skipped) are split
    // across the concurrent runs. Together they cover each recipient exactly
    // once even when many sibling crons race.
    const allChats = sentPerRun.flat();
    expect(allChats.length).toBe(2);
    expect(new Set(allChats)).toEqual(new Set(["chat-a", "chat-c"]));

    const finalRows = await db
      .select({
        userId: sql<string>`user_id`,
        telegramMessageId: sql<number | null>`telegram_message_id`,
      })
      .from(sql`daily_reminder`)
      .where(sql`organization_id = 'org-a' and status = 'pending'`);
    for (const row of finalRows) {
      if (row.userId === "user-banned") {
        expect(row.telegramMessageId).toBeNull();
      } else {
        expect(row.telegramMessageId).not.toBeNull();
      }
    }
  });

  test("per-org failure isolation: one tenant's provider failure does not roll back peers", async () => {
    // Telegram sends for org-a chats succeed; org-b's chat always throws.
    let orgASends = 0;
    let chatBRuns = 0;
    const sendMessage = async (chatId: string) => {
      if (chatId !== "chat-b") {
        orgASends += 1;
        return { ok: true, result: { message_id: orgASends } };
      }
      chatBRuns += 1;
      throw new Error("telegram.unreachable");
    };
    const client = { sendMessage } as unknown as TelegramClient;
    const email: EmailService = {
      sendEmail: async () => ({ id: "email-1", dryRun: false }),
      prepareEmail: (input) => input,
      organizationName: "Health",
    };

    // Pretend the cron loop manually: run for org-a, then org-b, isolating
    // failures like the cron router does.
    const log = capturingLogger();
    const runA = await materializeDailyReminders({
      db,
      client,
      logger: log.logger,
      correlationId: "corr-a",
      organizationId: "org-a",
      now,
      attemptNow: () => now,
      email,
    });

    let runBerr: unknown;
    const runB = await materializeDailyReminders({
      db,
      client,
      logger: log.logger,
      correlationId: "corr-b",
      organizationId: "org-b",
      now,
      attemptNow: () => now,
      email,
    }).catch((error: unknown) => {
      runBerr = error;
    });

    expect(runA.sent).toBe(2);
    expect(runBerr).toBeUndefined();
    expect(runB).toBeDefined();
    expect(runB!.failed).toBeGreaterThan(0);

    // Org-a's deliveries are committed; org-b's are not double-counted.
    expect(orgASends).toBe(2);
    expect(chatBRuns).toBe(1);

    // The cron should never itself throw on a per-org failure — it surfaces
    // a result with the org-failed counter. That contract is exercised in
    // cron.test.ts (orchestration in isolation); here we confirm each
    // per-org call returns a typed outcome either way.
  });

  test("the email fallback subject is in the member's language; the label is sent as written (#231)", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values
        ('user-pt', 'pt@example.test', false),
        ('user-en', 'en@example.test', false);
      insert into "organization" (id, name, slug) values ('org-l', 'L', 'l');
      insert into "member" (id, organization_id, user_id, role) values
        ('m-pt', 'org-l', 'user-pt', 'owner'),
        ('m-en', 'org-l', 'user-en', 'member');
      insert into "user_preference" (user_id, locale) values ('user-pt', 'pt-PT');
      insert into "insight_preference" (organization_id, user_id, daily_reminder_email) values
        ('org-l', 'user-pt', true),
        ('org-l', 'user-en', true);
      insert into "daily_reminder"
        (organization_id, user_id, date, source_type, source_id, label, created_at)
      values
        ('org-l', 'user-pt', '${date}', 'supplement', 7, 'Vitamina D <manhã>', '${date}'),
        ('org-l', 'user-en', '${date}', 'supplement', 8, 'Vitamin D', '${date}');
    `),
    );
    const sent: SendEmailInput[] = [];
    const { client } = fakeChannels();
    const result = await materializeDailyReminders({
      db,
      client,
      logger: capturingLogger().logger,
      correlationId: "corr-locale",
      organizationId: "org-l",
      now,
      attemptNow: () => now,
      email: {
        sendEmail: async (input) => {
          sent.push(input);
          return { id: "email-1", dryRun: false };
        },
        prepareEmail: (input) => input,
        organizationName: "Health",
      },
    });

    expect(result.sent).toBe(2);
    const byRecipient = Object.fromEntries(sent.map((input) => [String(input.to), input]));
    expect(byRecipient["pt@example.test"]?.subject).toBe("Os seus lembretes diários");
    expect(byRecipient["pt@example.test"]?.text).toContain("Vitamina D <manhã>");
    expect(byRecipient["pt@example.test"]?.html).toContain("Vitamina D &lt;manhã&gt;");
    expect(byRecipient["en@example.test"]?.subject).toBe("Your daily reminders");
    expect(byRecipient["en@example.test"]?.text).toContain("Vitamin D");
  });

  test("email-only member gets one mixed-source digest and every included row is marked", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values ('digest-user', 'digest@example.test', false);
      insert into "organization" (id, name, slug) values ('org-digest', 'Digest Org', 'digest-org');
      insert into "member" (id, organization_id, user_id, role) values ('m-digest', 'org-digest', 'digest-user', 'member');
      insert into "insight_preference" (organization_id, user_id, daily_reminder_email) values ('org-digest', 'digest-user', true);
      insert into "daily_reminder" (organization_id, user_id, date, source_type, source_id, label, created_at) values
        ('org-digest', 'digest-user', '${date}', 'supplement', 81, 'D3', '${date}'),
        ('org-digest', 'digest-user', '${date}', 'medication', 82, 'Rx', '${date}'),
        ('org-digest', 'digest-user', '${date}', 'activity', 83, 'Walk', '${date}');
    `),
    );
    const { client, email, calls } = fakeChannels();
    const result = await materializeDailyReminders({
      db,
      client,
      email,
      logger: capturingLogger().logger,
      correlationId: "corr-digest",
      organizationId: "org-digest",
      now,
      attemptNow: () => now,
    });
    expect(result.sent).toBe(3);
    expect(calls.filter((call) => call.email === "digest@example.test")).toHaveLength(1);
    expect(calls.find((call) => call.email === "digest@example.test")?.text).toContain("D3");
    expect(calls.find((call) => call.email === "digest@example.test")?.text).toContain("Rx");
    expect(calls.find((call) => call.email === "digest@example.test")?.text).toContain("Walk");
    const saved = await db.execute(
      sql`select reminder_ids, delivered_at from daily_reminder_email_digest where organization_id = 'org-digest'`,
    );
    expect(saved.rows).toHaveLength(1);
    expect((saved.rows[0] as { reminder_ids: number[] }).reminder_ids).toHaveLength(3);
    expect((saved.rows[0] as { delivered_at: string | null }).delivered_at).not.toBeNull();
    const includedRows = await db.execute(
      sql`select telegram_message_id, status::text as status, acted_at, acted_via from daily_reminder where organization_id = 'org-digest' order by id`,
    );
    expect(includedRows.rows).toHaveLength(3);
    for (const row of includedRows.rows as {
      telegram_message_id: number;
      status: string;
      acted_at: string | null;
      acted_via: string | null;
    }[]) {
      expect(row.telegram_message_id).toBe(-2);
      expect(row.status).toBe("pending");
      expect(row.acted_at).toBeNull();
      expect(row.acted_via).toBeNull();
    }
  });

  test("provider retry reuses the frozen digest and does not include late rows", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values ('retry-user', 'retry@example.test', false);
      insert into "organization" (id, name, slug) values ('org-retry', 'Retry Org', 'retry-org');
      insert into "member" (id, organization_id, user_id, role) values ('m-retry', 'org-retry', 'retry-user', 'member');
      insert into "insight_preference" (organization_id, user_id, daily_reminder_email) values ('org-retry', 'retry-user', true);
      insert into "daily_reminder" (organization_id, user_id, date, source_type, source_id, label, created_at)
      values ('org-retry', 'retry-user', '${date}', 'supplement', 91, 'Original item', '${date}');
    `),
    );
    const captured: SendEmailInput[] = [];
    const keys: string[] = [];
    let attempt = 0;
    const email = {
      organizationName: "Retry Org",
      prepareEmail: (input: SendEmailInput) => input,
      sendEmail: async (input: SendEmailInput) => {
        captured.push(input);
        keys.push(input.idempotencyKey ?? "");
        if (attempt++ === 0) throw new Error("provider unavailable");
        return { id: "accepted-on-retry", dryRun: false };
      },
    } as unknown as EmailService;
    const run = () =>
      materializeDailyReminders({
        db,
        client: null,
        email,
        logger: capturingLogger().logger,
        correlationId: "corr-retry",
        organizationId: "org-retry",
        now,
        attemptNow: () => now,
      });
    expect((await run()).failed).toBe(1);
    await db.execute(
      sql.raw(
        `insert into daily_reminder (organization_id,user_id,date,source_type,source_id,label,created_at) values ('org-retry','retry-user','${date}','activity',92,'Late item','${date}')`,
      ),
    );
    expect((await run()).sent).toBe(1);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.text).toBe(captured[1]?.text);
    expect(captured[1]?.text).toContain("Original item");
    expect(captured[1]?.text).not.toContain("Late item");
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^daily-reminder-digest\//);
    const rows = await db.execute(
      sql.raw(
        `select label, telegram_message_id from daily_reminder where user_id = 'retry-user' order by id`,
      ),
    );
    expect((rows.rows[0] as { telegram_message_id: number }).telegram_message_id).toBe(-2);
    expect((rows.rows[1] as { telegram_message_id: number | null }).telegram_message_id).toBeNull();
  });

  test("parallel workers claim and deliver one complete snapshot only", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values ('parallel-user', 'parallel@example.test', false);
      insert into "organization" (id, name, slug) values ('org-parallel', 'Parallel', 'parallel');
      insert into "member" (id, organization_id, user_id, role) values ('m-parallel', 'org-parallel', 'parallel-user', 'member');
      insert into "insight_preference" (organization_id, user_id, daily_reminder_email) values ('org-parallel', 'parallel-user', true);
      insert into "daily_reminder" (organization_id, user_id, date, source_type, source_id, label, created_at) values
        ('org-parallel', 'parallel-user', '${date}', 'supplement', 101, 'Parallel A', '${date}'),
        ('org-parallel', 'parallel-user', '${date}', 'activity', 102, 'Parallel B', '${date}'),
        ('org-parallel', 'parallel-user', '${date}', 'medication', 103, 'Parallel C', '${date}');
    `),
    );
    const held = await db.execute(
      sql`select id from daily_reminder where organization_id = 'org-parallel' order by id limit 1`,
    );
    const acquired = deferred();
    const releaseRow = deferred();
    const rowHolder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from daily_reminder where id = ${(held.rows[0] as { id: number }).id} for update`,
      );
      acquired.resolve();
      await releaseRow.promise;
    });
    await acquired.promise;
    const providerEntered = deferred();
    const releaseProvider = deferred();
    let sends = 0;
    const email = {
      organizationName: "Parallel",
      prepareEmail: (input: SendEmailInput) => input,
      sendEmail: async () => {
        sends += 1;
        providerEntered.resolve();
        await releaseProvider.promise;
        return { id: "parallel-accepted", dryRun: false };
      },
    } as unknown as EmailService;
    const worker = (id: string) =>
      materializeDailyReminders({
        db,
        client: null,
        email,
        logger: capturingLogger().logger,
        correlationId: id,
        organizationId: "org-parallel",
        now,
        attemptNow: () => now,
      });

    const first = worker("parallel-one");
    const second = worker("parallel-two");
    let waitingWorkers = 0;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const activity = await db.execute(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      );
      waitingWorkers = (activity.rows[0] as { count: number }).count;
      if (waitingWorkers >= 2) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    releaseRow.resolve();
    await rowHolder;
    expect(waitingWorkers).toBeGreaterThanOrEqual(2);
    await providerEntered.promise;
    releaseProvider.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.sent + secondResult.sent).toBe(3);
    expect(sends).toBe(1);
    const digest = await db.execute(
      sql`select reminder_ids, delivered_at from daily_reminder_email_digest where organization_id = 'org-parallel'`,
    );
    expect(digest.rows).toHaveLength(1);
    expect((digest.rows[0] as { reminder_ids: number[] }).reminder_ids).toHaveLength(3);
    expect((digest.rows[0] as { delivered_at: string | null }).delivered_at).not.toBeNull();
    const receipts = await db.execute(
      sql`select count(*)::int as count from daily_reminder where organization_id = 'org-parallel' and telegram_message_id = -2`,
    );
    expect((receipts.rows[0] as { count: number }).count).toBe(3);
  });

  test("preparation waits for a held reminder row lock and captures all rows after release", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values ('locked-user', 'locked@example.test', false);
      insert into "organization" (id, name, slug) values ('org-locked', 'Locked', 'locked');
      insert into "member" (id, organization_id, user_id, role) values ('m-locked', 'org-locked', 'locked-user', 'member');
      insert into "insight_preference" (organization_id, user_id, daily_reminder_email) values ('org-locked', 'locked-user', true);
      insert into "daily_reminder" (organization_id, user_id, date, source_type, source_id, label, created_at) values
        ('org-locked', 'locked-user', '${date}', 'supplement', 111, 'Locked A', '${date}'),
        ('org-locked', 'locked-user', '${date}', 'activity', 112, 'Locked B', '${date}');
    `),
    );
    const lockedId = await db.execute(
      sql`select id from daily_reminder where organization_id = 'org-locked' and source_id = 111`,
    );
    const acquired = deferred();
    const releaseRow = deferred();
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from daily_reminder where id = ${(lockedId.rows[0] as { id: number }).id} for update`,
      );
      acquired.resolve();
      await releaseRow.promise;
    });
    await acquired.promise;

    const { email, calls } = fakeChannels();
    const run = materializeDailyReminders({
      db,
      client: null,
      email,
      logger: capturingLogger().logger,
      correlationId: "locked-worker",
      organizationId: "org-locked",
      now,
      attemptNow: () => now,
    });
    let observedLockWait = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const activity = await db.execute(
        sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%daily_reminder%' and query ilike '%for update%' limit 1`,
      );
      if (activity.rows.length) {
        observedLockWait = true;
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    releaseRow.resolve();
    await holder;
    expect(observedLockWait).toBe(true);
    const result = await run;
    expect(result.sent).toBe(2);
    expect(calls.filter((call) => call.email === "locked@example.test")).toHaveLength(1);
    expect(calls.find((call) => call.email === "locked@example.test")?.text).toContain("Locked A");
    expect(calls.find((call) => call.email === "locked@example.test")?.text).toContain("Locked B");
  });

  test("attempt-time clock crossing midnight after preparation suppresses yesterday's digest", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id,email,banned) values ('attempt-clock-user','attempt-clock@example.test',false);
      insert into "organization" (id,name,slug) values ('org-attempt-clock','Attempt clock','attempt-clock');
      insert into "member" (id,organization_id,user_id,role) values ('m-attempt-clock','org-attempt-clock','attempt-clock-user','member');
      insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('org-attempt-clock','attempt-clock-user',true);
      insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
      values ('org-attempt-clock','attempt-clock-user','${date}','supplement',118,'Yesterday only','${date}');
    `),
    );
    let attemptClock = now;
    let sends = 0;
    const email = {
      organizationName: "Attempt clock",
      prepareEmail: (input: SendEmailInput) => {
        attemptClock = new Date("2026-10-15T00:01:00.000Z");
        return input;
      },
      sendEmail: async () => {
        sends += 1;
        return { id: "unexpected", dryRun: false };
      },
    } as unknown as EmailService;
    const result = await materializeDailyReminders({
      db,
      client: null,
      email,
      logger: capturingLogger().logger,
      correlationId: "attempt-clock",
      organizationId: "org-attempt-clock",
      now,
      attemptNow: () => attemptClock,
    });
    expect(result.sent).toBe(0);
    expect(sends).toBe(0);
    const receipt = await db.execute(
      sql`select telegram_message_id from daily_reminder where organization_id = 'org-attempt-clock'`,
    );
    expect(
      (receipt.rows[0] as { telegram_message_id: number | null }).telegram_message_id,
    ).toBeNull();
  });

  test("one recipient's prepare failure does not block retry delivery for another recipient", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id,email,banned) values ('isolation-good','isolation-good@example.test',false);
      insert into "organization" (id,name,slug) values ('org-isolation','Isolation','isolation');
      insert into "member" (id,organization_id,user_id,role) values
        ('m-isolation-good','org-isolation','isolation-good','member');
      insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('org-isolation','isolation-good',true);
      insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
      values ('org-isolation','isolation-good','${date}','supplement',119,'Good recipient item','${date}');
    `),
    );
    const sendCalls: SendEmailInput[] = [];
    const firstEmail = {
      organizationName: "Isolation",
      prepareEmail: (input: SendEmailInput) => input,
      sendEmail: async () => {
        throw new Error("provider temporarily unavailable");
      },
    } as unknown as EmailService;
    const run = (email: EmailService) =>
      materializeDailyReminders({
        db,
        client: null,
        email,
        logger: capturingLogger().logger,
        correlationId: "failure-isolation",
        organizationId: "org-isolation",
        now,
        attemptNow: () => now,
      });
    expect((await run(firstEmail)).failed).toBe(1);
    await db.execute(
      sql.raw(`
      insert into "user" (id,email,banned) values ('isolation-bad','isolation-bad@example.test',false);
      insert into "member" (id,organization_id,user_id,role) values ('m-isolation-bad','org-isolation','isolation-bad','member');
      insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('org-isolation','isolation-bad',true);
      insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
      values ('org-isolation','isolation-bad','${date}','supplement',120,'Bad prepare recipient','${date}');
    `),
    );
    const logger = capturingLogger();
    const secondEmail = {
      organizationName: "Isolation",
      prepareEmail: (input: SendEmailInput) => {
        if (input.to === "isolation-bad@example.test") throw new Error("prepare failed");
        return input;
      },
      sendEmail: async (input: SendEmailInput) => {
        sendCalls.push(input);
        return { id: "good-accepted", dryRun: false };
      },
    } as unknown as EmailService;
    const result = await materializeDailyReminders({
      db,
      client: null,
      email: secondEmail,
      logger: logger.logger,
      correlationId: "failure-isolation-retry",
      organizationId: "org-isolation",
      now,
      attemptNow: () => now,
    });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.to).toBe("isolation-good@example.test");
    expect(logger.lines.join("\n")).not.toContain("Bad prepare recipient");
    const rows = await db.execute(
      sql`select user_id, telegram_message_id from daily_reminder where organization_id = 'org-isolation' order by user_id`,
    );
    expect((rows.rows[0] as { telegram_message_id: number | null }).telegram_message_id).toBeNull();
    expect((rows.rows[1] as { telegram_message_id: number | null }).telegram_message_id).toBe(-2);
  });

  test("accepted provider send with receipt transaction rollback retries same key and payload", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values ('rollback-user', 'rollback@example.test', false);
      insert into "organization" (id, name, slug) values ('org-rollback', 'Rollback', 'rollback');
      insert into "member" (id, organization_id, user_id, role) values ('m-rollback', 'org-rollback', 'rollback-user', 'member');
      insert into "insight_preference" (organization_id, user_id, daily_reminder_email) values ('org-rollback', 'rollback-user', true);
      insert into "user_preference" (user_id, locale) values ('rollback-user', 'pt-PT');
      insert into "daily_reminder" (organization_id, user_id, date, source_type, source_id, label, created_at)
      values ('org-rollback', 'rollback-user', '${date}', 'supplement', 121, 'Rollback item', '${date}');
      create function fail_digest_receipt_once() returns trigger language plpgsql as $$
      begin
        if new.delivered_at is not null then
          raise exception 'test receipt failure';
        end if;
        return new;
      end $$;
      create trigger fail_digest_receipt_once_trigger before update on daily_reminder_email_digest
      for each row execute function fail_digest_receipt_once();
    `),
    );
    const accepted = new Set<string>();
    let acceptedDeliveries = 0;
    const requests: SendEmailInput[] = [];
    let senderDefaults = { from: "before@example.test", replyTo: "before-reply@example.test" };
    const email = {
      organizationName: "Rollback",
      prepareEmail: (input: SendEmailInput) => ({ ...input, ...senderDefaults }),
      sendEmail: async (input: SendEmailInput) => {
        requests.push(input);
        if (!accepted.has(input.idempotencyKey ?? "")) {
          accepted.add(input.idempotencyKey ?? "");
          acceptedDeliveries += 1;
        }
        return { id: "accepted-once", dryRun: false };
      },
    } as unknown as EmailService;
    const run = () =>
      materializeDailyReminders({
        db,
        client: null,
        email,
        logger: capturingLogger().logger,
        correlationId: "rollback-worker",
        organizationId: "org-rollback",
        now,
        attemptNow: () => now,
      });
    try {
      expect((await run()).failed).toBe(1);
      const uncommittedReceipt = await db.execute(
        sql`select delivered_at from daily_reminder_email_digest where organization_id = 'org-rollback'`,
      );
      expect(
        (uncommittedReceipt.rows[0] as { delivered_at: string | null }).delivered_at,
      ).toBeNull();
      const receiptRow = await db.execute(
        sql`select telegram_message_id from daily_reminder where organization_id = 'org-rollback'`,
      );
      expect(
        (receiptRow.rows[0] as { telegram_message_id: number | null }).telegram_message_id,
      ).toBeNull();
      await db.execute(
        sql`update daily_reminder set label = 'Changed after snapshot' where organization_id = 'org-rollback'`,
      );
      await db.execute(
        sql`update user_preference set locale = 'en' where user_id = 'rollback-user'`,
      );
      senderDefaults = { from: "after@example.test", replyTo: "after-reply@example.test" };
      await db.execute(
        sql`drop trigger fail_digest_receipt_once_trigger on daily_reminder_email_digest`,
      );
      expect((await run()).sent).toBe(1);
      expect(accepted.size).toBe(1);
      expect(acceptedDeliveries).toBe(1);
      expect(requests).toHaveLength(2);
      for (const key of [
        "to",
        "subject",
        "html",
        "text",
        "from",
        "replyTo",
        "idempotencyKey",
      ] as const) {
        expect(requests[0]?.[key]).toBe(requests[1]?.[key]);
      }
      expect(requests[0]?.from).toBe("before@example.test");
      expect(requests[0]?.replyTo).toBe("before-reply@example.test");
      expect(requests[0]?.text).toContain("Rollback item");
      expect(requests[0]?.text).not.toContain("Changed after snapshot");
    } finally {
      await db.execute(
        sql`drop trigger if exists fail_digest_receipt_once_trigger on daily_reminder_email_digest`,
      );
      await db.execute(sql`drop function if exists fail_digest_receipt_once()`);
    }
  });

  test("a successfully sent digest never picks up late rows as a second email", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, banned) values ('late-user', 'late@example.test', false);
      insert into "organization" (id, name, slug) values ('org-late', 'Late', 'late');
      insert into "member" (id, organization_id, user_id, role) values ('m-late', 'org-late', 'late-user', 'member');
      insert into "insight_preference" (organization_id, user_id, daily_reminder_email) values ('org-late', 'late-user', true);
      insert into "daily_reminder" (organization_id, user_id, date, source_type, source_id, label, created_at)
      values ('org-late', 'late-user', '${date}', 'supplement', 131, 'First item', '${date}');
    `),
    );
    const { email, calls } = fakeChannels();
    const run = () =>
      materializeDailyReminders({
        db,
        client: null,
        email,
        logger: capturingLogger().logger,
        correlationId: "late-worker",
        organizationId: "org-late",
        now,
        attemptNow: () => now,
      });
    expect((await run()).sent).toBe(1);
    await db.execute(
      sql.raw(
        `insert into daily_reminder (organization_id,user_id,date,source_type,source_id,label,created_at) values ('org-late','late-user','${date}','activity',132,'Second item','${date}')`,
      ),
    );
    expect((await run()).sent).toBe(0);
    expect(calls.filter((call) => call.email === "late@example.test")).toHaveLength(1);
    expect(calls.find((call) => call.email === "late@example.test")?.text).not.toContain(
      "Second item",
    );
    const rows = await db.execute(
      sql`select label, telegram_message_id from daily_reminder where organization_id = 'org-late' order by id`,
    );
    expect((rows.rows[0] as { telegram_message_id: number }).telegram_message_id).toBe(-2);
    expect((rows.rows[1] as { telegram_message_id: number | null }).telegram_message_id).toBeNull();
  });

  test("opt-out, changed recipient, ban, and module hiding suppress immutable retries", async () => {
    const cases = [
      {
        suffix: "off",
        mutate: `update insight_preference set daily_reminder_email = false where user_id = 'guard-off'`,
      },
      {
        suffix: "address",
        mutate: `update "user" set email = 'changed@example.test' where id = 'guard-address'`,
      },
      { suffix: "banned", mutate: `update "user" set banned = true where id = 'guard-banned'` },
      {
        suffix: "module",
        mutate: `insert into wellness_profile (user_id, enabled_modules) values ('guard-module', array[]::text[])`,
      },
    ];
    for (const scenario of cases) {
      const userId = `guard-${scenario.suffix}`;
      const orgId = `org-${scenario.suffix}`;
      await db.execute(
        sql.raw(`
        insert into "user" (id,email,banned) values ('${userId}','guard-${scenario.suffix}@example.test',false);
        insert into "organization" (id,name,slug) values ('${orgId}','Guard','${scenario.suffix}');
        insert into "member" (id,organization_id,user_id,role) values ('m-guard-${scenario.suffix}','${orgId}','${userId}','member');
        insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('${orgId}','${userId}',true);
        insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
        values ('${orgId}','${userId}','${date}','${scenario.suffix === "module" ? "activity" : "supplement"}',141,'Frozen ${scenario.suffix}','${date}');
      `),
      );
      const requests: SendEmailInput[] = [];
      let calls = 0;
      const email = {
        organizationName: "Guard",
        prepareEmail: (input: SendEmailInput) => input,
        sendEmail: async (input: SendEmailInput) => {
          requests.push(input);
          calls += 1;
          if (calls === 1) throw new Error("retry later");
          return { id: "should-not-send", dryRun: false };
        },
      } as unknown as EmailService;
      const run = () =>
        materializeDailyReminders({
          db,
          client: null,
          email,
          logger: capturingLogger().logger,
          correlationId: `guard-${scenario.suffix}`,
          organizationId: orgId,
          now,
          attemptNow: () => now,
        });
      expect((await run()).failed).toBe(1);
      await db.execute(sql.raw(scenario.mutate));
      const retry = await run();
      expect(retry.sent).toBe(0);
      expect(retry.skipped).toBe(1);
      expect(requests).toHaveLength(1);
      const item = await db.execute(
        sql`select telegram_message_id from daily_reminder where organization_id = ${orgId}`,
      );
      expect(
        (item.rows[0] as { telegram_message_id: number | null }).telegram_message_id,
      ).toBeNull();
    }
  });

  test("newly active Telegram suppresses email and cannot deliver reserved reminders", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id,email,banned) values ('reserved-user','reserved@example.test',false);
      insert into "organization" (id,name,slug) values ('org-reserved','Reserved','reserved');
      insert into "member" (id,organization_id,user_id,role) values ('m-reserved','org-reserved','reserved-user','member');
      insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('org-reserved','reserved-user',true);
      insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
      values ('org-reserved','reserved-user','${date}','supplement',151,'Reserved item','${date}');
    `),
    );
    let emailCalls = 0;
    const email = {
      organizationName: "Reserved",
      prepareEmail: (input: SendEmailInput) => input,
      sendEmail: async () => {
        emailCalls += 1;
        throw new Error("retry later");
      },
    } as unknown as EmailService;
    expect(
      (
        await materializeDailyReminders({
          db,
          client: null,
          email,
          logger: capturingLogger().logger,
          correlationId: "reserved-first",
          organizationId: "org-reserved",
          now,
          attemptNow: () => now,
        })
      ).failed,
    ).toBe(1);
    await db.execute(
      sql.raw(
        `insert into telegram_account (organization_id,user_id,telegram_chat_id,telegram_user_id,connected_at,created_at) values ('org-reserved','reserved-user','reserved-chat','reserved-tg','${date}','${date}')`,
      ),
    );
    const sentChats: string[] = [];
    const client = {
      sendMessage: async (chatId: string) => {
        sentChats.push(chatId);
        return { ok: true, result: { message_id: 1 } };
      },
    } as unknown as TelegramClient;
    const result = await materializeDailyReminders({
      db,
      client,
      email,
      logger: capturingLogger().logger,
      correlationId: "reserved-retry",
      organizationId: "org-reserved",
      now,
      attemptNow: () => now,
    });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sentChats).toEqual([]);
    expect(emailCalls).toBe(1);
    const row = await db.execute(
      sql`select telegram_message_id from daily_reminder where organization_id = 'org-reserved'`,
    );
    expect((row.rows[0] as { telegram_message_id: number | null }).telegram_message_id).toBeNull();
  });

  test("Telegram row lock wins a race with digest preparation without creating a partial digest", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id,email,banned) values ('telegram-race-user','telegram-race@example.test',false);
      insert into "organization" (id,name,slug) values ('org-telegram-race','Telegram race','telegram-race');
      insert into "member" (id,organization_id,user_id,role) values ('m-telegram-race','org-telegram-race','telegram-race-user','member');
      insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('org-telegram-race','telegram-race-user',true);
      insert into "telegram_account" (organization_id,user_id,telegram_chat_id,telegram_user_id,connected_at,created_at)
      values ('org-telegram-race','telegram-race-user','telegram-race-chat','telegram-race-tg','${date}','${date}');
      insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
      values ('org-telegram-race','telegram-race-user','${date}','supplement',155,'Telegram wins','${date}');
    `),
    );
    const telegramEntered = deferred();
    const releaseTelegram = deferred();
    const sentChats: string[] = [];
    const client = {
      sendMessage: async (chatId: string) => {
        sentChats.push(chatId);
        telegramEntered.resolve();
        await releaseTelegram.promise;
        return { ok: true, result: { message_id: 155 } };
      },
    } as unknown as TelegramClient;
    const telegramWorker = materializeDailyReminders({
      db,
      client,
      email: fakeChannels().email,
      logger: capturingLogger().logger,
      correlationId: "telegram-race-first",
      organizationId: "org-telegram-race",
      now,
      attemptNow: () => now,
    });
    await telegramEntered.promise;
    const { email, calls } = fakeChannels();
    const emailWorker = materializeDailyReminders({
      db,
      client: null,
      email,
      logger: capturingLogger().logger,
      correlationId: "telegram-race-email",
      organizationId: "org-telegram-race",
      now,
      attemptNow: () => now,
    });
    let sawBlockedPreparation = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const activity = await db.execute(
        sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%daily_reminder%' and query ilike '%for update%' limit 1`,
      );
      if (activity.rows.length) {
        sawBlockedPreparation = true;
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(sawBlockedPreparation).toBe(true);
    releaseTelegram.resolve();
    const [telegramResult, emailResult] = await Promise.all([telegramWorker, emailWorker]);
    expect(telegramResult.sent).toBe(1);
    expect(emailResult.sent).toBe(0);
    expect(sentChats).toEqual(["telegram-race-chat"]);
    expect(calls.filter((call) => call.email === "telegram-race@example.test")).toHaveLength(0);
    const snapshots = await db.execute(
      sql`select count(*)::int as count from daily_reminder_email_digest where organization_id = 'org-telegram-race'`,
    );
    expect((snapshots.rows[0] as { count: number }).count).toBe(0);
    const receipt = await db.execute(
      sql`select telegram_message_id from daily_reminder where organization_id = 'org-telegram-race'`,
    );
    expect((receipt.rows[0] as { telegram_message_id: number }).telegram_message_id).toBe(155);
  });

  test("provider failure, 409, and dry-run retain pending rows without a receipt", async () => {
    for (const scenario of [
      {
        suffix: "fail",
        send: async () => {
          throw new Error("provider unavailable");
        },
      },
      {
        suffix: "conflict",
        send: async () => {
          throw Object.assign(new Error("duplicate"), { code: "409" });
        },
      },
      { suffix: "dry", send: async () => ({ id: "dry-run", dryRun: true }) },
    ]) {
      const userId = `provider-${scenario.suffix}`;
      const orgId = `org-provider-${scenario.suffix}`;
      await db.execute(
        sql.raw(`
        insert into "user" (id,email,banned) values ('${userId}','${scenario.suffix}@example.test',false);
        insert into "organization" (id,name,slug) values ('${orgId}','Provider','provider-${scenario.suffix}');
        insert into "member" (id,organization_id,user_id,role) values ('m-provider-${scenario.suffix}','${orgId}','${userId}','member');
        insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('${orgId}','${userId}',true);
        insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
        values ('${orgId}','${userId}','${date}','supplement',161,'Provider item','${date}');
      `),
      );
      const email = {
        organizationName: "Provider",
        prepareEmail: (input: SendEmailInput) => input,
        sendEmail: scenario.send,
      } as unknown as EmailService;
      const result = await materializeDailyReminders({
        db,
        client: null,
        email,
        logger: capturingLogger().logger,
        correlationId: `provider-${scenario.suffix}`,
        organizationId: orgId,
        now,
        attemptNow: () => now,
      });
      expect(result.sent).toBe(0);
      expect(result.failed + result.skipped).toBe(1);
      const values = await db.execute(
        sql`select telegram_message_id from daily_reminder where organization_id = ${orgId}`,
      );
      expect(
        (values.rows[0] as { telegram_message_id: number | null }).telegram_message_id,
      ).toBeNull();
      const digest = await db.execute(
        sql`select delivered_at from daily_reminder_email_digest where organization_id = ${orgId}`,
      );
      expect((digest.rows[0] as { delivered_at: string | null }).delivered_at).toBeNull();
    }
  });

  test("undelivered snapshots expire at 23 hours and legacy email sentinels never produce another digest", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id,email,banned) values ('expired-user','expired@example.test',false),('legacy-user','legacy@example.test',false);
      insert into "organization" (id,name,slug) values ('org-expired','Expired','expired'),('org-legacy','Legacy','legacy');
      insert into "member" (id,organization_id,user_id,role) values ('m-expired','org-expired','expired-user','member'),('m-legacy','org-legacy','legacy-user','member');
      insert into "insight_preference" (organization_id,user_id,daily_reminder_email) values ('org-expired','expired-user',true),('org-legacy','legacy-user',true);
      insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at,telegram_message_id) values
        ('org-expired','expired-user','${date}','supplement',171,'Expired item','${date}',null),
        ('org-legacy','legacy-user','${date}','supplement',172,'Legacy sent item','${date}',-2),
        ('org-legacy','legacy-user','${date}','activity',173,'Legacy pending item','${date}',null);
    `),
    );
    const captured: SendEmailInput[] = [];
    const email = {
      organizationName: "Expiry",
      prepareEmail: (input: SendEmailInput) => input,
      sendEmail: async (input: SendEmailInput) => {
        captured.push(input);
        throw new Error("provider unavailable");
      },
    } as unknown as EmailService;
    const initial = await materializeDailyReminders({
      db,
      client: null,
      email,
      logger: capturingLogger().logger,
      correlationId: "expiry-initial",
      organizationId: "org-expired",
      now,
      attemptNow: () => now,
    });
    expect(initial.failed).toBe(1);
    expect(captured).toHaveLength(1);
    const later = new Date(now.getTime() + 23 * 60 * 60_000);
    const expiredResult = await materializeDailyReminders({
      db,
      client: null,
      email,
      logger: capturingLogger().logger,
      correlationId: "expiry-later",
      organizationId: "org-expired",
      now: later,
      attemptNow: () => later,
    });
    expect(expiredResult.sent).toBe(0);
    expect(captured).toHaveLength(1);

    const legacy = await materializeDailyReminders({
      db,
      client: null,
      email,
      logger: capturingLogger().logger,
      correlationId: "legacy",
      organizationId: "org-legacy",
      now,
      attemptNow: () => now,
    });
    expect(legacy.sent).toBe(0);
    expect(captured).toHaveLength(1);
    const legacyDigests = await db.execute(
      sql`select count(*)::int as count from daily_reminder_email_digest where organization_id = 'org-legacy'`,
    );
    expect((legacyDigests.rows[0] as { count: number }).count).toBe(0);
  });

  test("the 23-hour cap expires during the DST fall-back day while the local date is still current", async () => {
    const start = new Date("2026-11-01T07:30:00.000Z"); // 00:30 PDT, before the repeated hour
    const after23h = new Date(start.getTime() + 23 * 60 * 60_000); // 22:30 PST, still Nov 1 locally
    await db.execute(
      sql.raw(`
      insert into "user" (id,email,banned) values ('dst-expiry-user','dst-expiry@example.test',false);
      insert into "organization" (id,name,slug) values ('org-dst-expiry','DST Expiry','dst-expiry');
      insert into "member" (id,organization_id,user_id,role) values ('m-dst-expiry','org-dst-expiry','dst-expiry-user','member');
      insert into "insight_preference" (organization_id,user_id,daily_reminder_email,time_zone,daily_reminder_hour)
      values ('org-dst-expiry','dst-expiry-user',true,'America/Los_Angeles',0);
      insert into "daily_reminder" (organization_id,user_id,date,source_type,source_id,label,created_at)
      values ('org-dst-expiry','dst-expiry-user','2026-11-01','supplement',181,'DST item','${date}');
    `),
    );
    let sends = 0;
    const email = {
      organizationName: "DST Expiry",
      prepareEmail: (input: SendEmailInput) => input,
      sendEmail: async () => {
        sends += 1;
        throw new Error("provider unavailable");
      },
    } as unknown as EmailService;
    const run = (at: Date, correlationId: string) =>
      materializeDailyReminders({
        db,
        client: null,
        email,
        logger: capturingLogger().logger,
        correlationId,
        organizationId: "org-dst-expiry",
        now: at,
        attemptNow: () => at,
      });
    expect((await run(start, "dst-before-expiry")).failed).toBe(1);
    const beforeBoundary = new Date(start.getTime() + 22 * 60 * 60_000 + 59 * 60_000);
    expect((await run(beforeBoundary, "dst-at-22h59")).failed).toBe(1);
    const retry = await run(after23h, "dst-after-expiry");
    expect(retry.sent).toBe(0);
    expect(sends).toBe(2);
    const snapshot = await db.execute(
      sql`select delivered_at from daily_reminder_email_digest where organization_id = 'org-dst-expiry'`,
    );
    expect((snapshot.rows[0] as { delivered_at: string | null }).delivered_at).toBeNull();
  });
});
