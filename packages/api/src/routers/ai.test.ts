import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openhealth/db";

import type { Context } from "../context";

const ORG_ID = "org-1";
const USER_ID = "user-1";
const CORRELATION_ID = "corr-ai-1";

const requireOrgMembership = mock(async () => ({
  user: { id: USER_ID, email: "user@example.com", name: null },
  session: {
    id: "session-1",
    userId: USER_ID,
    activeOrganizationId: ORG_ID,
    expiresAt: null,
  },
  activeOrganizationId: ORG_ID,
  member: { id: "member-1", userId: USER_ID, organizationId: ORG_ID, role: "owner" },
  role: "owner",
}));

// Stub the authz guard so the procedure runs without a live Better Auth
// instance. `mock.module` must run before `./index` is loaded.
mock.module("@openhealth/auth/authz/guard", () => ({
  AuthzHttpError: class AuthzHttpError extends Error {
    readonly status = 403;
    readonly code = "NO_MEMBERSHIP";
  },
  requirePermission: mock(),
  requireSession: mock(),
  requireOrgMembership,
}));

// Replace only `streamChat`; keep the real consent/config/limiter exports so the
// gate behaviour under test is genuine.
const actualAi = await import("@openhealth/ai");
const streamChat = mock(async () => ({
  totalChunks: 2,
  text: "ASSISTANT_SECRET_REPLY",
  usage: { inputTokens: 11, outputTokens: 4 },
  model: "claude-sonnet-5-5",
}));
mock.module("@openhealth/ai", () => ({ ...actualAi, streamChat }));

const { appRouter } = await import("./index");
const { chatMessage } = await import("@openhealth/db/schema/coach");
const { accessAuditLog } = await import("@openhealth/db/schema/auth");

type CapturedInsert = { table: unknown; payload: unknown };

function createMockDb(metadata: unknown): { db: Database; inserts: CapturedInsert[] } {
  const inserts: CapturedInsert[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ metadata }],
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (payload: unknown) => {
        inserts.push({ table, payload });
        // A promise augmented with `.returning()` so both `await values(...)`
        // (chatMessage) and `values(...).returning(...)` (audit) work.
        const result = Promise.resolve(payload) as Promise<unknown> & {
          returning: () => Promise<Array<{ id: number }>>;
        };
        result.returning = async () => [{ id: inserts.length }];
        return result;
      },
    }),
  } as unknown as Database;
  return { db, inserts };
}

function createContext(
  db: Database,
  options: { limitPerMinute?: number; apiKey?: string | null } = {},
): Context {
  const limitPerMinute = options.limitPerMinute ?? 20;
  const apiKey = options.apiKey === undefined ? "sk-ant-test" : options.apiKey;
  return {
    session: { user: { id: USER_ID } },
    db,
    correlationId: CORRELATION_ID,
    cronSecret: "test-cron-secret",
    betterAuthSecretConfigured: true,
    capabilities: {
      telegram: false,
      anthropic: apiKey !== null,
      resend: false,
      mobilePairing: true,
    },
    telegram: { webhookSecret: "test-webhook-secret-1234", connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      ANTHROPIC_API_KEY: apiKey,
      AI_MODEL: "claude-sonnet-5-5",
      AI_RATE_LIMIT_PER_MINUTE: limitPerMinute,
    },
    aiRateLimiter: new actualAi.InMemoryRateLimiter({ limitPerMinute }),
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

function callChat(context: Context, content = "hello") {
  return appRouter.ai.chat.callable({ context })({
    messages: [{ role: "user", content }],
  });
}

function parseLogLines(raw: string[]): Array<Record<string, unknown>> {
  const parsed: Array<Record<string, unknown>> = [];
  for (const chunk of raw) {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        parsed.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // ignore non-JSON output
      }
    }
  }
  return parsed;
}

/**
 * Captures the structured logger's stdout/stderr lines for the duration of
 * `fn`. The logger's sink reads `process.stdout`/`process.stderr` at emit time,
 * so patching the stream writers is enough — no module mocking required.
 */
async function captureLogs(fn: () => Promise<unknown>): Promise<Array<Record<string, unknown>>> {
  const raw: string[] = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = ((chunk: unknown) => {
    raw.push(String(chunk));
    return true;
  }) as unknown as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    raw.push(String(chunk));
    return true;
  }) as unknown as typeof process.stderr.write;

  try {
    await fn();
  } catch {
    // assertions on the error happen outside; we only care about the logs here
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }

  return parseLogLines(raw);
}

beforeEach(() => {
  streamChat.mockClear();
  requireOrgMembership.mockClear();
});

describe("ai.chat consent gate", () => {
  test("rejects with AI_DISABLED when the org has no consent", async () => {
    const { db, inserts } = createMockDb({});

    await expect(callChat(createContext(db))).rejects.toMatchObject({
      code: "AI_DISABLED",
      status: 403,
    });

    expect(inserts).toHaveLength(0);
    expect(streamChat).not.toHaveBeenCalled();
  });

  test("rejects with AI_DISABLED when consent is explicitly false", async () => {
    const { db } = createMockDb({ aiConsent: false });
    await expect(callChat(createContext(db))).rejects.toMatchObject({ code: "AI_DISABLED" });
  });
});

describe("ai.chat rate limit", () => {
  test("rejects with RATE_LIMITED after the per-key budget is spent", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    const context = createContext(db, { limitPerMinute: 1 });

    await expect(callChat(context)).resolves.toMatchObject({ status: "ok" });
    await expect(callChat(context)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });

    // The second call must not reach the provider.
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
});

describe("ai.chat success", () => {
  test("returns the aggregate shape without any message content", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    const result = await callChat(createContext(db), "MY_SECRET_QUESTION");

    expect(result).toEqual({
      status: "ok",
      conversationId: CORRELATION_ID,
      chunks: 2,
      usage: { inputTokens: 11, outputTokens: 4 },
      model: "claude-sonnet-5-5",
      correlationId: CORRELATION_ID,
    });
    expect("text" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("ASSISTANT_SECRET_REPLY");
    expect(JSON.stringify(result)).not.toContain("MY_SECRET_QUESTION");
  });

  test("persists the user + assistant turns to chatMessage (org-scoped)", async () => {
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    await callChat(createContext(db), "MY_SECRET_QUESTION");

    const messageInserts = inserts.filter((insert) => insert.table === chatMessage);
    expect(messageInserts).toHaveLength(1);

    const rows = messageInserts[0]?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      organizationId: ORG_ID,
      conversationId: CORRELATION_ID,
      role: "user",
      content: "MY_SECRET_QUESTION",
    });
    expect(rows[1]).toMatchObject({
      organizationId: ORG_ID,
      conversationId: CORRELATION_ID,
      role: "assistant",
      content: "ASSISTANT_SECRET_REPLY",
    });
  });

  test("writes AI_CHAT_REQUESTED + AI_CHAT_COMPLETED audit entries", async () => {
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    await callChat(createContext(db));

    const auditRows = inserts.filter((insert) => insert.table === accessAuditLog);
    const eventTypes = auditRows.map(
      (insert) => (insert.payload as Record<string, unknown>).eventType,
    );
    expect(eventTypes).toEqual(["AI_CHAT_REQUESTED", "AI_CHAT_COMPLETED"]);

    for (const row of auditRows) {
      const payload = row.payload as Record<string, unknown>;
      expect(payload.organizationId).toBe(ORG_ID);
      expect(payload.actorUserId).toBe(USER_ID);
      expect(payload.targetType).toBe("ai_chat");
    }
  });
});

describe("ai.chat failure", () => {
  test("writes AI_CHAT_FAILED and returns a generic internal error", async () => {
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    streamChat.mockImplementationOnce(async () => {
      throw new Error("PROVIDER_SECRET_ERROR");
    });

    await expect(callChat(createContext(db))).rejects.toMatchObject({
      code: "INTERNAL",
      status: 500,
    });

    const auditRows = inserts.filter((insert) => insert.table === accessAuditLog);
    const eventTypes = auditRows.map(
      (insert) => (insert.payload as Record<string, unknown>).eventType,
    );
    expect(eventTypes).toEqual(["AI_CHAT_REQUESTED", "AI_CHAT_FAILED"]);

    // No chatMessage rows on failure.
    expect(inserts.filter((insert) => insert.table === chatMessage)).toHaveLength(0);
  });

  test("fails closed with a generic error when no API key is configured", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    streamChat.mockImplementationOnce(async () => {
      throw new actualAi.AiConfigError("ANTHROPIC_API_KEY is not configured.");
    });

    await expect(callChat(createContext(db, { apiKey: null }))).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});

describe("ai.chat PHI safety", () => {
  test("never logs message content or model responses", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    const lines = await captureLogs(() => callChat(createContext(db), "MY_SECRET_QUESTION"));

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("MY_SECRET_QUESTION");
    expect(serialized).not.toContain("ASSISTANT_SECRET_REPLY");

    const events = lines.map((line) => line.event);
    expect(events).toContain("ai.chat.requested");
    expect(events).toContain("ai.chat.completed");
    for (const line of lines) {
      expect(line.correlationId).toBe(CORRELATION_ID);
    }
  });

  test("logs the consent block without any prompt text", async () => {
    const { db } = createMockDb({});

    const lines = await captureLogs(() => callChat(createContext(db), "MY_SECRET_QUESTION"));

    const serialized = JSON.stringify(lines);
    expect(serialized).toContain("ai.chat.consent_blocked");
    expect(serialized).not.toContain("MY_SECRET_QUESTION");
  });
});
