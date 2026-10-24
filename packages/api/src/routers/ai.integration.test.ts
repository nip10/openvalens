import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";

/**
 * `ai.*` over HTTP (oRPC `RPCHandler`) against a disposable PostgreSQL: the
 * `chat_message.user_id` backfill, the owner-only workspace AI switch, chat
 * history kept on the server (one turn persisted per call), and chats private
 * to their author inside a shared workspace. The provider is faked; all data
 * is synthetic.
 */

const url = process.env.AI_CHAT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/ai_chat_test")
    throw new Error("Empty disposable loopback ai_chat_test database required.");
}

const CHAT_USER_MIGRATION = "20261024040000_chat_message_user";

// Fake provider: echo how many messages the model was given.
const actualAi = await import("@openvalens/ai");
const streamChat = mock(async (input: { messages: unknown[] }) => ({
  totalChunks: 1,
  text: `reply to ${input.messages.length} messages`,
  usage: { inputTokens: 1, outputTokens: 1 },
  model: "synthetic-model",
}));
mock.module("@openvalens/ai", () => ({ ...actualAi, streamChat }));
const { appRouter } = await import("./index");

async function migrate(db: Database, filter: (directory: string) => boolean): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory) || !filter(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/** A owns org-a and shares it with collaborator A2; B owns org-b. */
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-a2": { org: "org-a", role: "collaborator" },
  "user-b": { org: "org-b", role: "owner" },
};

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]!.role,
    }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

type Thread = { conversationId: string; messageCount: number; lastMessagePreview: string };
type Message = { role: string; content: string };

describe.skipIf(!url)("ai over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ai_chat_test" });
  const rpc = new RPCHandler(appRouter);
  const aiConfig = actualAi.parseAiConfig({ AI_PROVIDER: "anthropic", AI_API_KEY: "sk-test" });

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: {
        user: { id },
        session: {
          id: `s-${id}`,
          activeOrganizationId: MEMBERS[id]!.org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
      db,
      correlationId: `corr-${crypto.randomUUID()}`,
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: true, resend: false, mobilePairing: true },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig,
      aiRateLimiter: new actualAi.InMemoryRateLimiter({ limitPerMinute: 1000 }),
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    procedure: string,
    input: unknown,
    user = "user-a",
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/ai/${procedure}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const chat = (message: string, conversationId: string, user = "user-a") =>
    call<{ status: string }>("chat", { message, conversationId }, user);
  const threads = (user = "user-a") => call<Thread[]>("listThreads", {}, user);
  const messages = (conversationId: string, user = "user-a") =>
    call<Message[]>("listMessages", { conversationId }, user);
  const setWorkspace = (enabled: boolean, user = "user-a") =>
    call<{ enabled: boolean; canManage: boolean }>("workspaceConsent/set", { enabled }, user);

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db, (directory) => directory < CHAT_USER_MIGRATION);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-a', 'a@example.test'), ('user-a2', 'a2@example.test'), ('user-b', 'b@example.test'),
        ('user-c', 'c@example.test');
      insert into organization (id, name, slug, metadata) values
        ('org-a', 'Record A', 'record-a', '{"personal": true}'),
        ('org-b', 'Record B', 'record-b', '{"personal": true}'),
        ('org-c', 'Record C', 'record-c', null),
        ('org-empty', 'Record empty', 'record-empty', null);
      insert into member (id, organization_id, user_id, role, created_at) values
        ('m-user-a2', 'org-a', 'user-a2', 'collaborator', '2026-01-01'),
        ('m-user-a', 'org-a', 'user-a', 'owner', '2026-02-01'),
        ('m-user-b', 'org-b', 'user-b', 'owner', '2026-01-01'),
        ('m-user-c', 'org-c', 'user-c', 'collaborator', '2026-01-01');
      insert into chat_message (organization_id, conversation_id, role, content, created_at) values
        ('org-a', 'legacy-a', 'user', 'legacy question', '2026-09-01T00:00:00Z'),
        ('org-a', 'legacy-a', 'assistant', 'legacy reply', '2026-09-01T00:00:01Z'),
        ('org-c', 'legacy-c', 'user', 'no owner', '2026-09-01T00:00:00Z'),
        ('org-empty', 'legacy-empty', 'user', 'no members', '2026-09-01T00:00:00Z');
    `),
    );
    await migrate(db, (directory) => directory >= CHAT_USER_MIGRATION);
    await db.execute(
      sql.raw(`
      insert into user_ai_consent (user_id, granted, granted_at, consent_version) values
        ('user-a', true, now(), '${actualAi.CURRENT_CONSENT_VERSION}'),
        ('user-a2', true, now(), '${actualAi.CURRENT_CONSENT_VERSION}');
    `),
    );
    setRegisteredAuth(fakeAuth);
  });

  afterAll(() => clearRegisteredAuth());

  test("the migration assigns existing chats to the owner, else a member, else drops them", async () => {
    const rows = (
      await db.execute(
        sql`select organization_id, user_id, count(*)::int as n from chat_message group by 1, 2 order by 1`,
      )
    ).rows;
    expect(rows).toEqual([
      { organization_id: "org-a", user_id: "user-a", n: 2 },
      { organization_id: "org-c", user_id: "user-c", n: 1 },
    ]);
    const column = (
      await db.execute(
        sql`select is_nullable from information_schema.columns where table_name = 'chat_message' and column_name = 'user_id'`,
      )
    ).rows[0] as { is_nullable: string };
    expect(column.is_nullable).toBe("NO");
  });

  test("chat is refused until the workspace owner allows AI", async () => {
    expect((await chat("hello", "conv-1")).body).toMatchObject({ code: "AI_DISABLED" });
    expect(streamChat).not.toHaveBeenCalled();
  });

  test("only the owner can allow AI; other metadata is kept and the change is audited", async () => {
    const denied = await setWorkspace(true, "user-a2");
    expect(denied.status).toBe(403);
    expect((await call("workspaceConsent/get", {}, "user-a2")).body).toEqual({
      enabled: false,
      canManage: false,
    });

    const allowed = await setWorkspace(true);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ enabled: true, canManage: true });

    const org = (await db.execute(sql`select metadata from organization where id = 'org-a'`))
      .rows[0] as { metadata: unknown };
    expect(org.metadata).toEqual({ personal: true, aiConsent: { enabled: true, scope: "full" } });
    // Other workspaces are untouched.
    const other = (await db.execute(sql`select metadata from organization where id = 'org-b'`))
      .rows[0] as { metadata: unknown };
    expect(other.metadata).toEqual({ personal: true });

    const audit = (
      await db.execute(
        sql`select actor_user_id, target_id from access_audit_log where event_type = 'AI_WORKSPACE_CONSENT_CHANGED'`,
      )
    ).rows;
    expect(audit).toEqual([{ actor_user_id: "user-a", target_id: "org-a" }]);
  });

  test("each turn persists only the new message and the reply; history comes from the server", async () => {
    for (const question of ["one", "two", "three", "four", "five", "six"]) {
      expect((await chat(question, "conv-1")).status).toBe(200);
    }

    const stored = await messages("conv-1");
    expect(stored.body).toHaveLength(12);
    expect(stored.body.map((message) => message.content)).toEqual([
      "one",
      "reply to 1 messages",
      "two",
      "reply to 3 messages",
      "three",
      "reply to 5 messages",
      "four",
      "reply to 7 messages",
      "five",
      "reply to 9 messages",
      "six",
      "reply to 11 messages",
    ]);
  });

  test("chats are private to their author inside a shared workspace", async () => {
    // The collaborator sees none of the owner's threads or messages…
    expect((await threads("user-a2")).body).toEqual([]);
    expect((await messages("conv-1", "user-a2")).body).toEqual([]);
    expect((await messages("legacy-a", "user-a2")).body).toEqual([]);

    // …and reusing the owner's conversation id starts their own, empty thread.
    streamChat.mockClear();
    expect((await chat("collaborator question", "conv-1", "user-a2")).status).toBe(200);
    expect(streamChat.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "collaborator question" },
    ]);
    expect((await messages("conv-1", "user-a2")).body.map((m) => m.content)).toEqual([
      "collaborator question",
      "reply to 1 messages",
    ]);

    // The owner's thread is unchanged and their list shows only their own.
    expect((await messages("conv-1")).body).toHaveLength(12);
    const ownerThreads = (await threads()).body;
    expect(
      ownerThreads.map((thread) => [thread.conversationId, thread.messageCount]).sort(),
    ).toEqual([
      ["conv-1", 12],
      ["legacy-a", 2],
    ]);
  });

  test("the collaborator's own consent is still required", async () => {
    await db.execute(
      sql`update user_ai_consent set granted = false, revoked_at = now() where user_id = 'user-a2'`,
    );
    expect((await chat("again", "conv-2", "user-a2")).body).toMatchObject({ code: "AI_DISABLED" });
  });

  test("the owner can turn AI off again for everyone", async () => {
    expect((await setWorkspace(false)).body).toEqual({ enabled: false, canManage: true });
    expect((await chat("after off", "conv-1")).body).toMatchObject({ code: "AI_DISABLED" });
  });
});
