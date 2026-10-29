import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openvalens/db";
import { createStructuredLogger } from "@openvalens/observability";

import type { TelegramClient } from "./client";
import {
  createConnectToken,
  disconnectTelegramChat,
  hashConnectToken,
  readTelegramConnection,
} from "./connect";
import { handleWebhookUpdate } from "./webhook";

const url = process.env.TELEGRAM_CONNECT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/telegram_connect_test"
  )
    throw new Error("Empty disposable loopback telegram_connect_test database required.");
}

describe.skipIf(!url)("Telegram /start connect flow (Issue #14)", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/telegram_connect_test" });
  const migrationsRoot = new URL("../../../db/src/migrations/", import.meta.url);
  const replies: { chatId: string; text: string }[] = [];
  const client = {
    sendMessage: mock(async (chatId: string, text: string) => {
      replies.push({ chatId, text });
      return { ok: true, result: { message_id: replies.length } };
    }),
  } as unknown as TelegramClient;
  const logger = createStructuredLogger({ level: "error", sink: () => {} });
  let updateId = 1000;

  const start = (
    chatId: number,
    text: string,
    languageCode = "en",
    canWriteWorkspace?: (input: { userId: string; organizationId: string }) => Promise<boolean>,
  ) =>
    handleWebhookUpdate({
      db,
      client,
      logger,
      correlationId: "corr-connect",
      canWriteWorkspace,
      rawUpdate: {
        update_id: ++updateId,
        message: {
          message_id: updateId,
          text,
          chat: { id: chatId, type: "private" },
          from: { id: chatId, language_code: languageCode },
        },
      },
    });

  const accounts = async (userId: string) =>
    (
      await db.execute(
        sql`select telegram_chat_id, status from telegram_account where user_id = ${userId} order by id`,
      )
    ).rows;

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
        ('user-a', 'a@example.test', false),
        ('user-p', 'p@example.test', false);
      insert into "organization" (id, name, slug) values ('org-a', 'A', 'a');
      insert into "member" (id, organization_id, user_id, role) values
        ('m-a', 'org-a', 'user-a', 'owner'),
        ('m-p', 'org-a', 'user-p', 'member');
      insert into "user_preference" (user_id, locale) values ('user-p', 'pt-PT');
    `),
    );
  }, 120000);

  afterAll(async () => {
    await db.$client.end();
  });

  test("a deep-link /start binds the chat, consumes the token and confirms", async () => {
    const { token } = await createConnectToken(db, {
      userId: "user-a",
      organizationId: "org-a",
      ttlSeconds: 600,
    });
    expect(await start(111, `/start ${token}`)).toEqual({ status: "processed" });
    expect(await accounts("user-a")).toEqual([{ telegram_chat_id: "111", status: "active" }]);
    expect(replies.at(-1)).toEqual({
      chatId: "111",
      text: expect.stringContaining("Connected"),
    });

    const audit = await db.execute(
      sql`select count(*)::int as n from access_audit_log where event_type = 'TELEGRAM_BIND_COMPLETED'`,
    );
    expect(audit.rows[0]).toEqual({ n: 1 });

    // The token is single-use.
    expect(await start(222, `/start ${token}`)).toEqual({ status: "unknown" });
    expect(await accounts("user-a")).toEqual([{ telegram_chat_id: "111", status: "active" }]);
    expect(replies.at(-1)?.text).toContain("invalid or has expired");
  });

  test("read-only Cloud access refuses /start without consuming token or binding chat", async () => {
    await db.execute(
      sql`insert into "user" (id, email, banned) values ('user-access-gate', 'access-gate@example.test', false) on conflict (id) do nothing`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-access-gate', 'org-a', 'user-access-gate', 'member') on conflict (id) do nothing`,
    );
    const { token } = await createConnectToken(db, {
      userId: "user-access-gate",
      organizationId: "org-a",
      ttlSeconds: 600,
    });
    const denied = await start(888, `/start ${token}`, "en", async ({ userId, organizationId }) => {
      expect({ userId, organizationId }).toEqual({
        userId: "user-access-gate",
        organizationId: "org-a",
      });
      return false;
    });
    expect(denied).toEqual({ status: "unknown" });
    expect((await accounts("user-access-gate")).map((row) => row.telegram_chat_id)).not.toContain(
      "888",
    );
    expect(
      (
        await db.execute<{ used_at: string | null }>(
          sql`select used_at from telegram_connect_token where token_hash = ${hashConnectToken(token)}`,
        )
      ).rows[0]?.used_at,
    ).toBeNull();
    expect(replies.at(-1)?.text).toBe(
      "Your OpenValens Cloud access has ended; your records are still there.",
    );

    // The refusal only records Telegram update/audit bookkeeping. Once access
    // returns, the original token can still be used to bind the chat.
    expect(await start(888, `/start ${token}`, "en", async () => true)).toEqual({
      status: "processed",
    });
    expect((await accounts("user-access-gate")).map((row) => row.telegram_chat_id)).toContain(
      "888",
    );
  });

  test("connecting a new chat revokes the previous one", async () => {
    const { token } = await createConnectToken(db, {
      userId: "user-a",
      organizationId: "org-a",
      ttlSeconds: 600,
    });
    expect(await start(333, `/start ${token}`)).toEqual({ status: "processed" });
    expect(await accounts("user-a")).toEqual([
      { telegram_chat_id: "111", status: "revoked" },
      { telegram_chat_id: "333", status: "active" },
    ]);
    // Status reports the active chat, not the oldest row.
    expect(await readTelegramConnection(db, "user-a", "org-a")).toMatchObject({
      connected: true,
      chatId: "333",
    });

    // Re-linking the first chat reactivates its row.
    const again = await createConnectToken(db, {
      userId: "user-a",
      organizationId: "org-a",
      ttlSeconds: 600,
    });
    expect(await start(111, `/start ${again.token}`)).toEqual({ status: "processed" });
    expect(await readTelegramConnection(db, "user-a", "org-a")).toMatchObject({
      connected: true,
      chatId: "111",
    });
  });

  test("disconnect stops delivery and discards the unused token", async () => {
    const { token } = await createConnectToken(db, {
      userId: "user-a",
      organizationId: "org-a",
      ttlSeconds: 600,
    });
    await disconnectTelegramChat(db, "user-a", "org-a");
    expect(await readTelegramConnection(db, "user-a", "org-a")).toMatchObject({
      connected: false,
      status: "revoked",
    });
    expect(await start(777, `/start ${token}`)).toEqual({ status: "unknown" });
  });

  test("a new token replaces the unused one; expired and unknown tokens are refused", async () => {
    const first = await createConnectToken(db, {
      userId: "user-a",
      organizationId: "org-a",
      ttlSeconds: 600,
    });
    await createConnectToken(db, { userId: "user-a", organizationId: "org-a", ttlSeconds: 600 });
    expect(await start(444, `/start ${first.token}`)).toEqual({ status: "unknown" });

    const expired = await createConnectToken(db, {
      userId: "user-a",
      organizationId: "org-a",
      ttlSeconds: 600,
      now: new Date(Date.now() - 3_600_000),
    });
    expect(await start(444, `/start ${expired.token}`)).toEqual({ status: "unknown" });
    expect(await start(444, "/start not-a-real-token")).toEqual({ status: "unknown" });
    expect((await accounts("user-a")).map((row) => row.telegram_chat_id)).not.toContain("444");
  });

  test("replies in the member's language, or the sender's when the link is bad", async () => {
    const { token } = await createConnectToken(db, {
      userId: "user-p",
      organizationId: "org-a",
      ttlSeconds: 600,
    });
    expect(await start(555, `/start ${token}`)).toEqual({ status: "processed" });
    expect(replies.at(-1)?.text).toContain("Ligado");

    expect(await start(666, "/start", "pt-BR")).toEqual({ status: "unknown" });
    expect(replies.at(-1)?.chatId).toBe("666");
    expect(replies.at(-1)?.text).toContain("Definições");
  });
});
