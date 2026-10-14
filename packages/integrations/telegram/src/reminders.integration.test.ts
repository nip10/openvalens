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
    email: { sendEmail, organizationName: "Health" } as unknown as EmailService,
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

describe.skipIf(!url)("materializeDailyReminders cross-tenant", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/reminders_issue125" });
  const migrationsRoot = new URL("../../../../db/src/migrations/", import.meta.url);
  const date = "2026-10-14";

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
        (organization_id, user_id, telegram_chat_id, telegram_user_id)
      values
        ('org-a', 'user-a',      'chat-a', 'tg-user-a'),
        ('org-a', 'user-c',      'chat-c', 'tg-user-c'),
        ('org-a', 'user-banned', 'chat-banned', 'tg-user-banned'),
        ('org-b', 'user-b',      'chat-b', 'tg-user-b');
      insert into "daily_reminder"
        (organization_id, user_id, date, source_type, source_id, label)
      values
        ('org-a', 'user-a',      '${date}', 'supplement', 1, 'Secret Vitamin D'),
        ('org-a', 'user-c',      '${date}', 'supplement', 2, 'Top Secret Med C'),
        ('org-a', 'user-banned', '${date}', 'supplement', 3, 'Banned Should Skip'),
        ('org-b', 'user-b',      '${date}', 'supplement', 1, 'Hidden Rx B');
    `),
    );
  }, 120000);

  beforeEach(async () => {
    await db.execute(
      sql.raw(`update daily_reminder set status = 'pending', telegram_message_id = null`),
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
      date,
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
      date,
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
      date,
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
      date,
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
      date,
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
          date,
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
    // Telegram client for org-a succeeds; for org-b every send throws.
    let chatARuns = 0;
    let chatBRuns = 0;
    const sendMessage = async (chatId: string) => {
      if (chatId === "chat-a") {
        chatARuns += 1;
        return { ok: true, result: { message_id: chatARuns } };
      }
      chatBRuns += 1;
      throw new Error("telegram.unreachable");
    };
    const client = { sendMessage } as unknown as TelegramClient;
    const email: EmailService = {
      sendEmail: async () => ({ id: "email-1", dryRun: false }),
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
      date,
      email,
    });

    let runBerr: unknown;
    const runB = await materializeDailyReminders({
      db,
      client,
      logger: log.logger,
      correlationId: "corr-b",
      organizationId: "org-b",
      date,
      email,
    }).catch((error: unknown) => {
      runBerr = error;
    });

    expect(runA.sent).toBe(2);
    expect(runBerr).toBeUndefined();
    expect(runB).toBeDefined();
    expect(runB!.failed).toBeGreaterThan(0);

    // Org-a's deliveries are committed; org-b's are not double-counted.
    expect(chatARuns).toBeGreaterThanOrEqual(2);
    expect(chatBRuns).toBe(1);

    // The cron should never itself throw on a per-org failure — it surfaces
    // a result with the org-failed counter. That contract is exercised in
    // cron.test.ts (orchestration in isolation); here we confirm each
    // per-org call returns a typed outcome either way.
  });
});
