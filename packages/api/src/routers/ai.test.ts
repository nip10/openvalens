import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";

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

class FakeAuthzHttpError extends Error {
  readonly status = 403;
  readonly code: string;

  constructor(code = "NO_MEMBERSHIP") {
    super(code);
    this.code = code;
  }
}

// `records:read` check used by the chat health tools (Issue #124). Resolves
// (granted) by default; individual tests make it reject.
const requirePermission = mock(
  async (_context: unknown, _input: unknown): Promise<unknown> => ({}),
);

// Stub the authz guard so the procedure runs without a live Better Auth
// instance. `mock.module` must run before `./index` is loaded.
mock.module("@openvalens/auth/authz/guard", () => ({
  AuthzHttpError: FakeAuthzHttpError,
  requirePermission,
  requireSession: mock(),
  requireOrgMembership,
}));

// Replace only `streamChat` (the fake provider) and the domain read ports of the
// health tools; keep the real consent/config/limiter/tool exports so the gate
// behaviour under test is genuine.
const actualAi = await import("@openvalens/ai");
const {
  bloodPanel,
  createFakeSources,
  dexaScanRow,
  goalEntry,
  marker,
  supplementEntry,
  timelineEntry,
} = await import("@openvalens/ai/tools/test-fixtures");
const streamChat = mock(
  async (_input: { tools?: Record<string, unknown> }): Promise<StreamChatResultShape> => ({
    totalChunks: 2,
    text: "ASSISTANT_SECRET_REPLY",
    usage: { inputTokens: 11, outputTokens: 4 },
    model: "claude-sonnet-5-5",
  }),
);

type StreamChatResultShape = {
  totalChunks: number;
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

const OTHER_ORG_ID = "org-2";
let fakeSources = createFakeSources({});
// Capture the real factory first: `mock.module` rebinds the live namespace, so
// calling `actualAi.createAiCoachTools` later would recurse into the mock.
const realCreateAiCoachTools = actualAi.createAiCoachTools;
const createAiCoachTools = mock((context: Parameters<typeof realCreateAiCoachTools>[0]) =>
  realCreateAiCoachTools({ ...context, sources: fakeSources.sources }),
);
mock.module("@openvalens/ai", () => ({ ...actualAi, streamChat, createAiCoachTools }));

const { appRouter } = await import("./index");
const { CHAT_HISTORY_LIMIT } = await import("./ai");
const { chatMessage } = await import("@openvalens/db/schema/coach");
const { accessAuditLog, userAiConsent } = await import("@openvalens/db/schema/auth");

type CapturedInsert = { table: unknown; payload: unknown };

type UserConsentRow = {
  userId: string;
  granted: boolean;
  grantedAt: Date;
  revokedAt: Date | null;
  consentVersion: string;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const CONSENT_EPOCH = new Date("2026-01-01T00:00:00.000Z");

function grantedConsentRow(userId = USER_ID): UserConsentRow {
  return {
    userId,
    granted: true,
    grantedAt: CONSENT_EPOCH,
    revokedAt: null,
    consentVersion: "v1",
    source: "settings",
    createdAt: CONSENT_EPOCH,
    updatedAt: CONSENT_EPOCH,
  };
}

function revokedConsentRow(userId = USER_ID): UserConsentRow {
  return {
    userId,
    granted: false,
    grantedAt: CONSENT_EPOCH,
    revokedAt: new Date("2026-01-02T00:00:00.000Z"),
    consentVersion: "v1",
    source: "api",
    createdAt: CONSENT_EPOCH,
    updatedAt: CONSENT_EPOCH,
  };
}

function buildConsentRow(payload: Record<string, unknown>): UserConsentRow {
  const now = new Date();
  return {
    userId: payload.userId as string,
    granted: Boolean(payload.granted),
    grantedAt: (payload.grantedAt as Date) ?? now,
    revokedAt: (payload.revokedAt as Date | null) ?? null,
    consentVersion: (payload.consentVersion as string) ?? "v1",
    source: (payload.source as string | null) ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

type WriteResult = Promise<unknown> & {
  returning: () => Promise<Array<{ id: number }>>;
  onConflictDoUpdate: (config: { target?: unknown; set?: Record<string, unknown> }) => WriteResult;
};

type ChatHistoryRow = { role: string; content: string };

/**
 * Stateful Drizzle-shaped fake. Organization reads yield `[{ metadata }]`;
 * `user_ai_consent` reads yield the current in-memory row (or none). Inserts on
 * `user_ai_consent` upsert into that row so grant/revoke round-trips are
 * observable. `initialConsent` defaults to a granted row so the pre-#123 chat
 * tests keep exercising the org gate; pass `null` for missing-consent cases.
 * `chatHistory` is what a `chat_message` read returns (newest first, as the
 * query orders it). `transaction` locks-and-updates the organization metadata
 * so workspace consent writes are observable via `currentMetadata()`.
 */
function createMockDb(
  metadata: unknown,
  initialConsent: UserConsentRow | null = grantedConsentRow(),
  chatHistory: ChatHistoryRow[] = [],
): {
  db: Database;
  inserts: CapturedInsert[];
  historyLimits: number[];
  currentMetadata: () => unknown;
} {
  const inserts: CapturedInsert[] = [];
  const historyLimits: number[] = [];
  let consent: UserConsentRow | null = initialConsent;
  let orgMetadata = metadata;

  const rowsFor = (table: unknown): unknown[] => {
    if (table === userAiConsent) return consent === null ? [] : [consent];
    if (table === chatMessage) return chatHistory;
    return [{ metadata: orgMetadata }];
  };

  const select = () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => rowsFor(table),
        for: async () => rowsFor(table),
        orderBy: () => ({
          limit: async (limit: number) => {
            if (table === chatMessage) historyLimits.push(limit);
            return rowsFor(table).slice(0, limit);
          },
        }),
      }),
    }),
  });

  const db = {
    select,
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        select,
        update: () => ({
          set: (values: { metadata?: unknown }) => ({
            where: async () => {
              orgMetadata = values.metadata;
            },
          }),
        }),
      }),
    insert: (table: unknown) => ({
      values: (payload: unknown) => {
        inserts.push({ table, payload });
        // A promise augmented with `.returning()` (audit) and
        // `.onConflictDoUpdate()` (consent upsert) so both chains work.
        const result = Promise.resolve(payload) as WriteResult;
        result.returning = async () => [{ id: inserts.length }];
        result.onConflictDoUpdate = (config) => {
          if (table === userAiConsent) {
            const set = config.set ?? {};
            consent =
              consent === null
                ? buildConsentRow(payload as Record<string, unknown>)
                : ({ ...consent, ...set } as UserConsentRow);
          }
          return result;
        };
        return result;
      },
    }),
  } as unknown as Database;
  return { db, inserts, historyLimits, currentMetadata: () => orgMetadata };
}

function createContext(
  db: Database,
  options: {
    /** Replaces the default (trusted, not impersonated) session. */
    session?: unknown;
    limitPerMinute?: number;
    apiKey?: string | null;
    /** Issue #59 — raw AI env overriding the default Anthropic selection. */
    aiEnv?: Parameters<typeof actualAi.parseAiConfig>[0];
    /** Issue #299 — monthly usage meter. */
    aiUsage?: import("@openvalens/ai").AiUsageMeter;
  } = {},
): Context {
  const limitPerMinute = options.limitPerMinute ?? 20;
  const apiKey = options.apiKey === undefined ? "sk-ant-test" : options.apiKey;
  const aiConfig = actualAi.parseAiConfig({
    ...(options.aiEnv ?? { AI_PROVIDER: "anthropic", AI_API_KEY: apiKey }),
    AI_RATE_LIMIT_PER_MINUTE: limitPerMinute,
  });
  return {
    session: options.session ?? {
      user: { id: USER_ID },
      session: { id: "session-1", expiresAt: new Date(Date.now() + 3_600_000) },
    },
    db,
    correlationId: CORRELATION_ID,
    cronSecret: "test-cron-secret",
    betterAuthSecretConfigured: true,
    capabilities: {
      telegram: false,
      anthropic: actualAi.describeAiIntegration(aiConfig).provider === "anthropic",
      resend: false,
      mobilePairing: true,
    },
    telegram: { connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig,
    aiRateLimiter: new actualAi.InMemoryRateLimiter({ limitPerMinute }),
    ...(options.aiUsage ? { aiUsage: options.aiUsage } : {}),
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

type MeterLog = {
  begins: Array<{ userId: string; promptChars: number }>;
  added: Array<{ inputTokens: number; outputTokens: number; cachedInputTokens: number }>;
  finished: number;
};

/** Issue #299 — a fake meter that records every call, or refuses when capped. */
function fakeMeter(options: { cappedUntil?: string } = {}) {
  const log: MeterLog = { begins: [], added: [], finished: 0 };
  const meter: import("@openvalens/ai").AiUsageMeter = {
    config: { monthlyLimitMicros: 1_500_000, prices: null, currency: "EUR" },
    async begin(input) {
      log.begins.push(input);
      if (options.cappedUntil) throw new actualAi.AiUsageLimitError(options.cappedUntil);
      return {
        add: (usage) => log.added.push(usage),
        finish: async () => {
          log.finished += 1;
        },
      };
    },
    summary: async () => {
      throw new Error("not used");
    },
  };
  return { meter, log };
}

function callChat(context: Context, content = "hello", conversationId?: string) {
  return appRouter.ai.chat.callable({ context })({
    message: content,
    ...(conversationId === undefined ? {} : { conversationId }),
  });
}

function callWorkspaceGet(context: Context) {
  return appRouter.ai.workspaceConsent.get.callable({ context })({});
}

function callWorkspaceSet(context: Context, enabled: boolean) {
  return appRouter.ai.workspaceConsent.set.callable({ context })({ enabled });
}

function asMember(role: string) {
  requireOrgMembership.mockImplementationOnce(async () => ({
    user: { id: USER_ID, email: "user@example.com", name: null },
    session: { id: "session-1", userId: USER_ID, activeOrganizationId: ORG_ID, expiresAt: null },
    activeOrganizationId: ORG_ID,
    member: { id: "member-1", userId: USER_ID, organizationId: ORG_ID, role },
    role,
  }));
}

function callConsentGet(context: Context) {
  return appRouter.ai.consent.get.callable({ context })({});
}

function callConsentGrant(context: Context) {
  return appRouter.ai.consent.grant.callable({ context })({});
}

function callConsentRevoke(context: Context) {
  return appRouter.ai.consent.revoke.callable({ context })({});
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
  requirePermission.mockClear();
  createAiCoachTools.mockClear();
  fakeSources = createFakeSources({});
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

  // Issue #59 — the gate sits in front of provider selection, so an
  // OpenAI-compatible endpoint (even a local, keyless one) is blocked too.
  test("rejects with AI_DISABLED on an OpenAI-compatible provider", async () => {
    const { db, inserts } = createMockDb({});
    const context = createContext(db, {
      aiEnv: {
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://127.0.0.1:11434/v1",
        AI_MODEL: "synthetic-local-model",
      },
    });

    await expect(callChat(context)).rejects.toMatchObject({ code: "AI_DISABLED", status: 403 });
    expect(inserts).toHaveLength(0);
    expect(streamChat).not.toHaveBeenCalled();
  });

  test("rejects with AI_DISABLED on an OpenAI-compatible provider without user consent", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } }, null);
    const context = createContext(db, {
      aiEnv: {
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://127.0.0.1:11434/v1",
        AI_MODEL: "synthetic-local-model",
      },
    });

    await expect(callChat(context)).rejects.toMatchObject({ code: "AI_DISABLED", status: 403 });
    expect(streamChat).not.toHaveBeenCalled();
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

describe("ai.chat monthly usage cap (Issue #299)", () => {
  test("refuses with AI_USAGE_LIMIT_REACHED and the reset date, without calling the provider", async () => {
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    const { meter, log } = fakeMeter({ cappedUntil: "2026-11-01" });

    await expect(callChat(createContext(db, { aiUsage: meter }))).rejects.toMatchObject({
      code: "AI_USAGE_LIMIT_REACHED",
      status: 429,
      data: { resetsOn: "2026-11-01" },
    });

    expect(streamChat).not.toHaveBeenCalled();
    expect(log.begins).toEqual([{ userId: USER_ID, promptChars: "hello".length }]);
    expect(inserts.filter((insert) => insert.table === chatMessage)).toHaveLength(0);
  });

  test("records every model step the provider reported, then settles once", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    const { meter, log } = fakeMeter();
    streamChat.mockImplementationOnce(async (input) => {
      const onUsage = (input as { onUsage?: (usage: MeterLog["added"][number]) => void }).onUsage;
      onUsage?.({ inputTokens: 900, outputTokens: 40, cachedInputTokens: 0 });
      onUsage?.({ inputTokens: 1_100, outputTokens: 120, cachedInputTokens: 800 });
      return {
        totalChunks: 1,
        text: "ok",
        usage: { inputTokens: 2_000, outputTokens: 160 },
        model: "m",
      };
    });

    await expect(callChat(createContext(db, { aiUsage: meter }))).resolves.toMatchObject({
      status: "ok",
    });
    expect(log.added).toHaveLength(2);
    expect(log.finished).toBe(1);
  });

  test("records usage of a failed turn that still billed", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    const { meter, log } = fakeMeter();
    streamChat.mockImplementationOnce(async (input) => {
      const onUsage = (input as { onUsage?: (usage: MeterLog["added"][number]) => void }).onUsage;
      onUsage?.({ inputTokens: 700, outputTokens: 30, cachedInputTokens: 0 });
      throw new Error("PROVIDER_SECRET_ERROR");
    });

    await expect(callChat(createContext(db, { aiUsage: meter }))).rejects.toMatchObject({
      code: "INTERNAL",
    });
    expect(log.added).toEqual([{ inputTokens: 700, outputTokens: 30, cachedInputTokens: 0 }]);
    expect(log.finished).toBe(1);
  });

  test("extract and generateInsight are under the same cap", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "full" } });
    const { meter } = fakeMeter({ cappedUntil: "2026-11-01" });
    const context = createContext(db, { aiUsage: meter });

    await expect(
      appRouter.ai.extract.callable({ context })({
        text: "synthetic text",
        promptHint: "extract",
        jsonShape: "{}",
      }),
    ).rejects.toMatchObject({ code: "AI_USAGE_LIMIT_REACHED" });
    await expect(
      appRouter.ai.generateInsight.callable({ context })({ topic: "sleep", snapshot: {} }),
    ).rejects.toMatchObject({ code: "AI_USAGE_LIMIT_REACHED" });
  });

  test("the cap message is logged without any prompt text", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    const { meter } = fakeMeter({ cappedUntil: "2026-11-01" });

    const lines = await captureLogs(() =>
      callChat(createContext(db, { aiUsage: meter }), "MY_SECRET_QUESTION"),
    );
    expect(JSON.stringify(lines)).not.toContain("MY_SECRET_QUESTION");
    expect(lines.map((line) => line.event)).toContain("ai.usage.limit_reached");
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

  test("persists the user + assistant turns to chatMessage (org- and user-scoped)", async () => {
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    await callChat(createContext(db), "MY_SECRET_QUESTION");

    const messageInserts = inserts.filter((insert) => insert.table === chatMessage);
    expect(messageInserts).toHaveLength(1);

    const rows = messageInserts[0]?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      organizationId: ORG_ID,
      userId: USER_ID,
      conversationId: CORRELATION_ID,
      role: "user",
      content: "MY_SECRET_QUESTION",
    });
    expect(rows[1]).toMatchObject({
      organizationId: ORG_ID,
      userId: USER_ID,
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

describe("ai.chat history", () => {
  test("sends stored history plus the new message, but persists only the new turn", async () => {
    // Newest first, as the bounded history query returns it.
    const { db, inserts, historyLimits } = createMockDb(
      { aiConsent: { enabled: true, scope: "chat" } },
      grantedConsentRow(),
      [
        { role: "assistant", content: "second reply" },
        { role: "user", content: "second question" },
        { role: "assistant", content: "first reply" },
        { role: "user", content: "first question" },
      ],
    );

    await callChat(createContext(db), "third question", "conv-1");

    const sent = (streamChat.mock.calls[0]![0] as unknown as { messages: ChatHistoryRow[] })
      .messages;
    expect(sent).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "second question" },
      { role: "assistant", content: "second reply" },
      { role: "user", content: "third question" },
    ]);
    expect(historyLimits).toEqual([CHAT_HISTORY_LIMIT]);

    const rows = inserts.find((insert) => insert.table === chatMessage)?.payload as Array<
      Record<string, unknown>
    >;
    expect(rows.map((row) => [row.role, row.content, row.conversationId])).toEqual([
      ["user", "third question", "conv-1"],
      ["assistant", "ASSISTANT_SECRET_REPLY", "conv-1"],
    ]);
  });

  test("rejects the old client-supplied message array", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    const call = appRouter.ai.chat.callable({ context: createContext(db) }) as unknown as (
      input: unknown,
    ) => Promise<unknown>;

    await expect(call({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(streamChat).not.toHaveBeenCalled();
  });

  test("rejects a blank message", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });
    await expect(callChat(createContext(db), "   ")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("ai.workspaceConsent", () => {
  test("get reports the workspace state and that the owner can manage it", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "full" } });
    await expect(callWorkspaceGet(createContext(db))).resolves.toEqual({
      enabled: true,
      canManage: true,
    });
  });

  test("get is readable by other members, who cannot manage it", async () => {
    const { db } = createMockDb({ personal: true });
    asMember("collaborator");
    await expect(callWorkspaceGet(createContext(db))).resolves.toEqual({
      enabled: false,
      canManage: false,
    });
  });

  test("the owner turns AI on in a shape the consent gate accepts, keeping other metadata", async () => {
    const { db, inserts, currentMetadata } = createMockDb({ personal: true });

    await expect(callWorkspaceSet(createContext(db), true)).resolves.toEqual({
      enabled: true,
      canManage: true,
    });

    expect(currentMetadata()).toEqual({
      personal: true,
      aiConsent: { enabled: true, scope: "full" },
    });
    expect(actualAi.parseAiConsent(currentMetadata())).toEqual({ enabled: true, scope: "full" });

    const audit = inserts.find((insert) => insert.table === accessAuditLog)?.payload as Record<
      string,
      unknown
    >;
    expect(audit).toMatchObject({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      eventType: "AI_WORKSPACE_CONSENT_CHANGED",
      targetType: "organization",
      targetId: ORG_ID,
      beforeJson: { enabled: false },
    });
    expect(JSON.stringify(audit.afterJson)).toContain('"enabled":true');
  });

  test("turning it on makes chat pass the org gate", async () => {
    const { db } = createMockDb({ personal: true });
    const context = createContext(db);

    await expect(callChat(context)).rejects.toMatchObject({ code: "AI_DISABLED" });
    await callWorkspaceSet(context, true);
    await expect(callChat(context)).resolves.toMatchObject({ status: "ok" });
  });

  test("the owner turns AI off again", async () => {
    const { db, currentMetadata } = createMockDb({
      personal: true,
      aiConsent: { enabled: true, scope: "full" },
    });

    await expect(callWorkspaceSet(createContext(db), false)).resolves.toEqual({
      enabled: false,
      canManage: true,
    });
    expect(currentMetadata()).toEqual({ personal: true, aiConsent: { enabled: false } });
  });

  test("decodes JSON-string metadata instead of discarding its keys", async () => {
    const { db, currentMetadata } = createMockDb(JSON.stringify({ personal: true }));
    await callWorkspaceSet(createContext(db), true);
    expect(currentMetadata()).toEqual({
      personal: true,
      aiConsent: { enabled: true, scope: "full" },
    });
  });

  for (const role of ["admin", "collaborator", "viewer"]) {
    test(`a ${role} cannot change it`, async () => {
      const { db, inserts, currentMetadata } = createMockDb({ personal: true });
      asMember(role);

      await expect(callWorkspaceSet(createContext(db), true)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        status: 403,
      });
      expect(currentMetadata()).toEqual({ personal: true });
      expect(inserts).toHaveLength(0);
    });
  }

  test("an impersonated owner session cannot change it", async () => {
    const { db, currentMetadata } = createMockDb({ personal: true });
    const context = createContext(db, {
      session: {
        user: { id: USER_ID },
        session: {
          id: "session-1",
          impersonatedBy: "admin-1",
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
    });

    await expect(callWorkspaceGet(context)).resolves.toMatchObject({ canManage: false });
    await expect(callWorkspaceSet(context, true)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(currentMetadata()).toEqual({ personal: true });
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

describe("ai.chat per-user consent gate (Issue #123)", () => {
  test("succeeds when the org and the user have both consented, without echoing consent state", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    const result = await callChat(createContext(db), "MY_SECRET_QUESTION");

    expect(result).toMatchObject({ status: "ok" });
    expect(JSON.stringify(result)).not.toContain("granted");
    expect(JSON.stringify(result)).not.toContain("consentVersion");
  });

  test("rejects with AI_DISABLED when the user has no consent row", async () => {
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } }, null);

    await expect(callChat(createContext(db))).rejects.toMatchObject({
      code: "AI_DISABLED",
      status: 403,
    });

    expect(streamChat).not.toHaveBeenCalled();
    expect(inserts.filter((insert) => insert.table === chatMessage)).toHaveLength(0);
  });

  test("rejects with AI_DISABLED when the user has revoked consent", async () => {
    const { db } = createMockDb(
      { aiConsent: { enabled: true, scope: "chat" } },
      revokedConsentRow(),
    );

    await expect(callChat(createContext(db))).rejects.toMatchObject({
      code: "AI_DISABLED",
      status: 403,
    });
    expect(streamChat).not.toHaveBeenCalled();
  });

  test("blocks an org owner who has not granted consent (independent of role)", async () => {
    const { db } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } }, null);

    await expect(callChat(createContext(db))).rejects.toMatchObject({
      code: "AI_DISABLED",
      status: 403,
    });

    const authz = await (requireOrgMembership.mock.results[0]?.value as Promise<{
      role: string;
    }>);
    expect(authz.role).toBe("owner");
  });
});

describe("ai.consent procedures", () => {
  test("get returns null before any grant", async () => {
    const { db } = createMockDb({}, null);
    await expect(callConsentGet(createContext(db))).resolves.toBeNull();
  });

  test("grant then get round-trips a granted state", async () => {
    const { db } = createMockDb({}, null);
    const context = createContext(db);

    const granted = await callConsentGrant(context);
    expect(granted).toMatchObject({
      granted: true,
      revokedAt: null,
      consentVersion: "v1",
    });
    expect(typeof granted.grantedAt).toBe("string");

    await expect(callConsentGet(context)).resolves.toMatchObject({ granted: true });
  });

  test("revoke then get round-trips a revoked state", async () => {
    const { db } = createMockDb({}, grantedConsentRow());
    const context = createContext(db);

    const revoked = await callConsentRevoke(context);
    expect(revoked.granted).toBe(false);
    expect(revoked.revokedAt).not.toBeNull();

    await expect(callConsentGet(context)).resolves.toMatchObject({ granted: false });
  });

  test("revoke inserts a row when none exists", async () => {
    const { db } = createMockDb({}, null);

    const revoked = await callConsentRevoke(createContext(db));
    expect(revoked).toMatchObject({ granted: false, consentVersion: "v1" });
    expect(revoked.revokedAt).not.toBeNull();
  });
});

describe("ai.consent PHI safety", () => {
  test("consent procedure logs never contain message content or prompts", async () => {
    const { db } = createMockDb({}, null);
    const context = createContext(db);

    const lines = await captureLogs(async () => {
      await callConsentGrant(context);
      await callConsentGet(context);
      await callConsentRevoke(context);
    });

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("MY_SECRET_QUESTION");
    expect(serialized).not.toContain("ASSISTANT_SECRET_REPLY");
    expect(serialized).not.toContain("prompt");

    const events = lines.map((line) => line.event);
    expect(events).toContain("ai.consent.granted");
    expect(events).toContain("ai.consent.revoked");
    for (const line of lines) {
      expect(line.correlationId).toBe(CORRELATION_ID);
    }
  });
});

type ExecutableTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };

/**
 * Fake provider: instead of a model, call the offered tools the way the AI SDK
 * would and fold their JSON results into the reply text.
 */
function streamChatCallingTools(calls: Array<{ name: string; input: unknown }>) {
  return async (input: { tools?: Record<string, unknown> }): Promise<StreamChatResultShape> => {
    const results: unknown[] = [];
    for (const call of calls) {
      const offered = input.tools?.[call.name] as ExecutableTool | undefined;
      if (!offered) throw new Error(`tool ${call.name} not offered`);
      results.push(await offered.execute(call.input, { toolCallId: "t-1", messages: [] }));
    }
    return {
      totalChunks: 1,
      text: JSON.stringify(results),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "claude-sonnet-5-5",
    };
  };
}

function assistantText(inserts: CapturedInsert[]): unknown[] {
  const rows = inserts.find((insert) => insert.table === chatMessage)?.payload as Array<{
    role: string;
    content: string;
  }>;
  const assistant = rows.find((row) => row.role === "assistant");
  return JSON.parse(assistant?.content ?? "[]") as unknown[];
}

const INSIGHTS_CONSENT = { aiConsent: { enabled: true, scope: "insights" } };

describe("ai.chat health tools (Issue #124)", () => {
  test("offers the planned health tools bound to the session org and user", async () => {
    const { db } = createMockDb(INSIGHTS_CONSENT);

    await callChat(createContext(db));

    const tools = streamChat.mock.calls[0]?.[0].tools ?? {};
    expect(Object.keys(tools).sort()).toEqual(
      [
        "bodyComp",
        "goals",
        "healthSnapshot",
        "labs",
        "markerTrend",
        "nutritionContext",
        "outOfRange",
        "panelCompare",
        "supplements",
        "timelineSummary",
        "weightTrend",
      ].sort(),
    );
    expect(createAiCoachTools).toHaveBeenCalledTimes(1);
    expect(createAiCoachTools.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG_ID,
      userId: USER_ID,
      correlationId: CORRELATION_ID,
    });
  });

  test("tool calls read real data for the active org only", async () => {
    fakeSources = createFakeSources({
      [ORG_ID]: {
        labs: [marker("blood_marker_ferritin", "Ferritin", "ng/mL", [40, 52])],
        latestWeight: { date: "2026-03-08", weightKg: 72 },
      },
      [OTHER_ORG_ID]: {
        labs: [marker("blood_marker_ferritin", "Ferritin", "ng/mL", [900, 999])],
        latestWeight: { date: "2026-03-08", weightKg: 123.4 },
      },
    });
    streamChat.mockImplementationOnce(
      streamChatCallingTools([
        { name: "healthSnapshot", input: {} },
        { name: "markerTrend", input: { markerKey: "ferritin" } },
      ]),
    );
    const { db, inserts } = createMockDb(INSIGHTS_CONSENT);

    await callChat(createContext(db));

    const [snapshot, trend] = assistantText(inserts) as Array<Record<string, unknown>>;
    expect(snapshot).toMatchObject({
      status: "ok",
      body: { latestWeightKg: 72 },
      labs: { markersWithReadings: 1 },
    });
    expect(trend).toMatchObject({ status: "ok", trend: "up", latest: { value: 52 } });
    expect(fakeSources.calls.length).toBeGreaterThan(0);
    expect(fakeSources.calls.every((call) => call.organizationId === ORG_ID)).toBe(true);
    expect(JSON.stringify([snapshot, trend])).not.toContain("999");
    expect(JSON.stringify([snapshot, trend])).not.toContain("123.4");
  });

  test("re-checks records:read on every tool call and returns unavailable when denied", async () => {
    fakeSources = createFakeSources({
      [ORG_ID]: { latestWeight: { date: "2026-03-08", weightKg: 72 } },
    });
    requirePermission.mockImplementation(async () => {
      throw new FakeAuthzHttpError("PERMISSION_DENIED");
    });
    streamChat.mockImplementationOnce(
      streamChatCallingTools([
        { name: "healthSnapshot", input: {} },
        { name: "markerTrend", input: { markerKey: "ferritin" } },
      ]),
    );
    const { db, inserts } = createMockDb(INSIGHTS_CONSENT);

    try {
      await callChat(createContext(db));
    } finally {
      requirePermission.mockImplementation(async () => ({}));
    }

    expect(requirePermission).toHaveBeenCalledTimes(2);
    expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
    expect(assistantText(inserts)).toEqual([
      expect.objectContaining({ status: "unavailable", reason: "permission_denied" }),
      expect.objectContaining({ status: "unavailable", reason: "permission_denied" }),
    ]);
    expect(fakeSources.calls).toHaveLength(0);
  });

  test("a chat-only org grant lets chat run but keeps health data out of tools", async () => {
    fakeSources = createFakeSources({
      [ORG_ID]: { latestWeight: { date: "2026-03-08", weightKg: 72 } },
    });
    streamChat.mockImplementationOnce(
      streamChatCallingTools([{ name: "healthSnapshot", input: {} }]),
    );
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    await expect(callChat(createContext(db))).resolves.toMatchObject({ status: "ok" });

    expect(assistantText(inserts)).toEqual([
      expect.objectContaining({ status: "unavailable", reason: "consent_required" }),
    ]);
    expect(fakeSources.calls).toHaveLength(0);
  });

  test("never builds tools when the user has not consented", async () => {
    const { db } = createMockDb(INSIGHTS_CONSENT, null);

    await expect(callChat(createContext(db))).rejects.toMatchObject({ code: "AI_DISABLED" });

    expect(createAiCoachTools).not.toHaveBeenCalled();
    expect(fakeSources.calls).toHaveLength(0);
  });

  test("returns honest empty results when the org has no records", async () => {
    streamChat.mockImplementationOnce(
      streamChatCallingTools([
        { name: "healthSnapshot", input: {} },
        { name: "markerTrend", input: { markerKey: "ferritin" } },
      ]),
    );
    const { db, inserts } = createMockDb(INSIGHTS_CONSENT);

    await callChat(createContext(db));

    expect(assistantText(inserts)).toEqual([
      expect.objectContaining({ status: "no_data" }),
      expect.objectContaining({ status: "not_found", availableMarkers: [] }),
    ]);
  });

  test("tool execution logs carry no health values", async () => {
    fakeSources = createFakeSources({
      [ORG_ID]: {
        labs: [marker("blood_marker_ferritin", "Ferritin", "ng/mL", [40, 52])],
        latestWeight: { date: "2026-03-08", weightKg: 72.25 },
      },
    });
    streamChat.mockImplementationOnce(
      streamChatCallingTools([
        { name: "healthSnapshot", input: {} },
        { name: "markerTrend", input: { markerKey: "ferritin" } },
      ]),
    );
    const { db } = createMockDb(INSIGHTS_CONSENT);

    const lines = await captureLogs(() => callChat(createContext(db)));

    const toolLines = lines.filter((line) => line.event === "ai.tool.executed");
    expect(toolLines).toHaveLength(2);
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("72.25");
    expect(serialized).not.toContain("Ferritin");
    expect(serialized).not.toContain("ferritin");
  });
});

const REMAINING_TOOL_CALLS = [
  { name: "labs", input: {} },
  { name: "panelCompare", input: {} },
  { name: "outOfRange", input: {} },
  { name: "bodyComp", input: {} },
  { name: "weightTrend", input: { days: 365 } },
  { name: "supplements", input: { includeInactive: false } },
  { name: "goals", input: {} },
  { name: "timelineSummary", input: { days: 90 } },
];

/** Sentinel values that only the other organization holds. */
const OTHER_ORG_VALUE = 876.54;

function remainingToolData(organizationId: string, value: number) {
  return {
    bloodPanels: [
      bloodPanel(1, "2026-01-05", [{ testKey: "ferritin", value: value - 1 }], organizationId),
      bloodPanel(2, "2026-03-01", [{ testKey: "ferritin", value, flag: "HIGH" }], organizationId),
    ],
    dexaScans: [dexaScanRow(3, "2026-02-15", { bodyFatPct: value })],
    bodyComp: {
      canonicalDailyPoints: [
        {
          date: new Date().toISOString().slice(0, 10),
          weightKg: value,
          source: "s",
          confidence: 1,
        },
      ],
      compositionMarkers: [],
    },
    supplements: [supplementEntry(4, `Supplement ${value}`, ["active"])],
    goals: [goalEntry(5, `Goal ${value}`, "in_progress", { current: String(value), target: "1" })],
    timeline: [timelineEntry("health_event:6", new Date(Date.now() - 60_000).toISOString())],
  };
}

describe("ai.chat remaining health tools (Issue #130)", () => {
  test("each tool reads real data for the active org only", async () => {
    fakeSources = createFakeSources({
      [ORG_ID]: remainingToolData(ORG_ID, 52.5),
      [OTHER_ORG_ID]: remainingToolData(OTHER_ORG_ID, OTHER_ORG_VALUE),
    });
    streamChat.mockImplementationOnce(streamChatCallingTools(REMAINING_TOOL_CALLS));
    const { db, inserts } = createMockDb(INSIGHTS_CONSENT);

    await callChat(createContext(db));

    const results = assistantText(inserts) as Array<Record<string, unknown>>;
    expect(results.map((result) => result.status)).toEqual(Array(8).fill("ok"));
    expect(results[0]).toMatchObject({ panelDate: "2026-03-01", markerCount: 1 });
    expect(results[1]).toMatchObject({ rows: [expect.objectContaining({ toValue: 52.5 })] });
    expect(results[2]).toMatchObject({ flaggedCount: 1 });
    expect(results[4]).toMatchObject({ latest: expect.objectContaining({ weightKg: 52.5 }) });
    expect(fakeSources.calls.every((call) => call.organizationId === ORG_ID)).toBe(true);
    expect(JSON.stringify(results)).not.toContain(String(OTHER_ORG_VALUE));
    expect(JSON.stringify(results)).not.toContain(ORG_ID);
  });

  test("re-checks records:read on every call and reads nothing when denied", async () => {
    fakeSources = createFakeSources({ [ORG_ID]: remainingToolData(ORG_ID, 52.5) });
    requirePermission.mockImplementation(async () => {
      throw new FakeAuthzHttpError("PERMISSION_DENIED");
    });
    streamChat.mockImplementationOnce(streamChatCallingTools(REMAINING_TOOL_CALLS));
    const { db, inserts } = createMockDb(INSIGHTS_CONSENT);

    try {
      await callChat(createContext(db));
    } finally {
      requirePermission.mockImplementation(async () => ({}));
    }

    expect(requirePermission).toHaveBeenCalledTimes(REMAINING_TOOL_CALLS.length);
    expect(assistantText(inserts)).toEqual(
      Array(REMAINING_TOOL_CALLS.length).fill(
        expect.objectContaining({ status: "unavailable", reason: "permission_denied" }),
      ),
    );
    expect(fakeSources.calls).toHaveLength(0);
  });

  test("a chat-only org grant keeps every tool's health data out", async () => {
    fakeSources = createFakeSources({ [ORG_ID]: remainingToolData(ORG_ID, 52.5) });
    streamChat.mockImplementationOnce(streamChatCallingTools(REMAINING_TOOL_CALLS));
    const { db, inserts } = createMockDb({ aiConsent: { enabled: true, scope: "chat" } });

    await callChat(createContext(db));

    expect(assistantText(inserts)).toEqual(
      Array(REMAINING_TOOL_CALLS.length).fill(
        expect.objectContaining({ status: "unavailable", reason: "consent_required" }),
      ),
    );
    expect(fakeSources.calls).toHaveLength(0);
  });

  test("returns honest empty results when the org has no records", async () => {
    streamChat.mockImplementationOnce(streamChatCallingTools(REMAINING_TOOL_CALLS));
    const { db, inserts } = createMockDb(INSIGHTS_CONSENT);

    await callChat(createContext(db));

    expect(
      (assistantText(inserts) as Array<{ status: string }>).map((result) => result.status),
    ).toEqual([
      "no_data",
      "insufficient_data",
      "no_data",
      "no_data",
      "no_data",
      "no_data",
      "no_data",
      "no_data",
    ]);
  });

  test("tool execution logs carry no health values", async () => {
    fakeSources = createFakeSources({ [ORG_ID]: remainingToolData(ORG_ID, 52.5) });
    streamChat.mockImplementationOnce(streamChatCallingTools(REMAINING_TOOL_CALLS));
    const { db } = createMockDb(INSIGHTS_CONSENT);

    const lines = await captureLogs(() => callChat(createContext(db)));

    expect(lines.filter((line) => line.event === "ai.tool.executed")).toHaveLength(
      REMAINING_TOOL_CALLS.length,
    );
    const serialized = JSON.stringify(lines);
    for (const forbidden of ["52.5", "ferritin", "Supplement", "Goal 52", "2026-03-01"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
