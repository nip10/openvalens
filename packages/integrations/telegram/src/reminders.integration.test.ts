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

type SentCall = { chatId?: string; email?: string; text: string };

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
      insert into "user" (id, email) values
        ('user-a',     'a@example.test'),
        ('user-b',     'b@example.test'),
        ('user-extra', 'extra@example.test');
      insert into "organization" (id, name, slug) values
        ('org-a', 'A', 'a'),
        ('org-b', 'B', 'b');
      insert into "member" (id, organization_id, user_id, role) values
        ('m-a',     'org-a', 'user-a',     'owner'),
        ('m-extra', 'org-a', 'user-extra', 'member'),
        ('m-b',     'org-b', 'user-b',     'owner');
      insert into "telegram_account"
        (organization_id, user_id, telegram_chat_id, telegram_user_id)
      values
        ('org-a', 'user-a',     'chat-a', 'tg-user-a'),
        ('org-a', 'user-extra', 'chat-extra', 'tg-user-extra'),
        ('org-b', 'user-b',     'chat-b', 'tg-user-b');
      insert into "daily_reminder"
        (organization_id, user_id, date, source_type, source_id, label)
      values
        ('org-a', 'user-a',     '${date}', 'supplement', 1, 'Secret Vitamin D'),
        ('org-a', 'user-extra', '${date}', 'supplement', 2, 'Top Secret Med B'),
        ('org-b', 'user-b',     '${date}', 'supplement', 1, 'Hidden Rx C');
    `),
    );
  }, 120000);

  // Each test starts from the seed state: every reminder is pending, every
  // user is still a member of the listed org. Tests that mutate state restore
  // it themselves.
  beforeEach(async () => {
    await db.execute(
      sql.raw(`delete from "member" where user_id = 'user-extra' and organization_id = 'org-a'`),
    );
    await db.execute(
      sql.raw(
        `insert into "member" (id, organization_id, user_id, role) values ('m-extra', 'org-a', 'user-extra', 'member') on conflict do nothing`,
      ),
    );
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
    // Every delivery originates from an org-a chat.
    expect(calls.map((c) => c.chatId).sort()).toEqual(["chat-a", "chat-extra"]);

    // Cross-tenant row stays pending and undelivered.
    const orgB = await db
      .select({ telegramMessageId: sql<string | null>`telegram_message_id` })
      .from(sql`daily_reminder`)
      .where(sql`organization_id = 'org-b'`);
    expect(orgB[0]?.telegramMessageId).toBeNull();

    // Log lines never include the recipient-bound PHI fields.
    const serialized = lines.join("\n");
    for (const forbidden of [
      "Secret Vitamin D",
      "Top Secret Med B",
      "chat-a",
      "chat-extra",
      "a@example.test",
      "extra@example.test",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("a reminder whose recipient is not a member is marked skipped and not delivered", async () => {
    await db.execute(
      sql.raw(`delete from "member" where user_id = 'user-extra' and organization_id = 'org-a'`),
    );

    const { client, email, calls } = fakeChannels();
    const { logger, lines } = capturingLogger();

    const result = await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-skip",
      organizationId: "org-a",
      date,
      email,
    });

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(calls.map((c) => c.chatId)).toEqual(["chat-a"]);

    const skipped = await db
      .select({ status: sql<string>`status` })
      .from(sql`daily_reminder`)
      .where(sql`user_id = 'user-extra'`);
    expect(skipped[0]?.status).toBe("skipped");

    expect(lines.join("\n")).not.toContain("Top Secret Med B");
    expect(lines.join("\n")).toContain("recipient_not_member");
  });

  test("re-running the same per-org pass does not re-deliver", async () => {
    const first = fakeChannels();
    const passOne = await materializeDailyReminders({
      db,
      client: first.client,
      logger: capturingLogger().logger,
      correlationId: "corr-idem-1",
      organizationId: "org-a",
      date,
      email: first.email,
    });
    expect(passOne.sent).toBe(2);
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

  test("contended advisory lock returns zeros without sending", async () => {
    const { email } = fakeChannels();

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"openvalens:daily-reminder:run:org-a:" + date}, 0))`,
      );

      const { client, calls } = fakeChannels();
      const { logger } = capturingLogger();

      const result = await materializeDailyReminders({
        db,
        client,
        logger,
        correlationId: "corr-contended",
        organizationId: "org-a",
        date,
        email,
      });

      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(calls.length).toBe(0);
    });
  });

  test("fan-out across organizations is bounded per-org", async () => {
    const organizations = (
      await db.execute<{ id: string }>(sql`select id from "organization" order by id asc`)
    ).rows.map((row) => row.id);

    expect(organizations).toEqual(["org-a", "org-b"]);

    const seenChatsByOrg = new Map<string, Set<string>>();

    for (const organizationId of organizations) {
      const { client, email, calls } = fakeChannels();
      const { logger } = capturingLogger();

      const result = await materializeDailyReminders({
        db,
        client,
        logger,
        correlationId: `corr-fanout-${organizationId}`,
        organizationId,
        date,
        email,
      });

      const chats = new Set(
        calls.map((c) => c.chatId).filter((chatId): chatId is string => Boolean(chatId)),
      );
      seenChatsByOrg.set(organizationId, chats);

      expect(result.failed).toBe(0);
    }

    const orgAChats = seenChatsByOrg.get("org-a") ?? new Set();
    const orgBChats = seenChatsByOrg.get("org-b") ?? new Set();
    expect(orgAChats.has("chat-a")).toBe(true);
    expect(orgAChats.has("chat-b")).toBe(false);
    expect(orgBChats.has("chat-b")).toBe(true);
    expect(orgBChats.has("chat-a")).toBe(false);
  });
});
