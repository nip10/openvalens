import { beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { InMemoryRateLimiter } from "@openvalens/ai";
import { createAdmissionService } from "@openvalens/auth/admission";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";

/**
 * Real HTTP boundary for the `admission` RPC namespace (Issue #63): a genuine
 * `RPCHandler` over a disposable PostgreSQL. Exercises same-origin enforcement,
 * value-free input validation, the default-deny admin gate and the full
 * setup-token bootstrap through the mounted handler.
 *
 * The oRPC RPC wire format wraps the payload as `{ json }`. Tests run in order:
 * the setup bootstrap creates the first administrator and flips the instance to
 * `invite_only`, which the later invitation tests depend on.
 */

const url = process.env.ADMISSION_AUTH_TEST_DATABASE_URL;

function assertDisposable(candidate: string | undefined, database: string): void {
  if (!candidate) return;
  const parsed = new URL(candidate);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}
assertDisposable(url, "admission_rpc_test");

const ORIGIN = "https://app.test";
const handler = new RPCHandler(appRouter);

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

describe.skipIf(!url)("admission RPC over real HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_rpc_test" });
  const delivered: { email: string; code: string }[] = [];
  const service = createAdmissionService({
    db,
    deliverVerification: async ({ email, verificationCode }) => {
      delivered.push({ email, code: verificationCode });
    },
    deliverInvitation: async () => {},
  });

  let adminUserId = "";
  const sessionFor = (userId: string) => ({
    id: "s-1",
    userId,
    activeOrganizationId: null,
    // A live session expiry — the core requires a non-expired session for
    // existing targets.
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  function contextFor(headers: Headers, sessionValue: unknown): Context {
    return {
      session: sessionValue,
      db,
      correlationId: "corr-1",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {
        AI_PROVIDER: null,
        AI_API_KEY: null,
        AI_BASE_URL: null,
        AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
        AI_MODEL: "claude-sonnet-5-5",
        AI_RATE_LIMIT_PER_MINUTE: 20,
      },
      aiRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
      admissionOrigin: ORIGIN,
      admissionService: service,
      admissionRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call(
    path: string,
    body: unknown,
    options: { origin?: string; sessionValue?: unknown } = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers = new Headers({ "content-type": "application/json" });
    if (options.origin !== undefined) headers.set("origin", options.origin);
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: body }),
    });
    const { matched, response } = await handler.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers, options.sessionValue ?? null),
    });
    if (!matched || !response) throw new Error(`unmatched RPC path ${path}`);
    const parsed = (await response.json()) as { json: Record<string, unknown> };
    return { status: response.status, json: parsed.json };
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
  });

  test("status is a public read with no origin required", async () => {
    const result = await call("admission/status", {});
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ setupAvailable: true });
  });

  test("a foreign or missing origin is rejected before input validation", async () => {
    const foreign = await call(
      "admission/begin",
      { kind: "bogus" },
      { origin: "https://evil.test" },
    );
    expect(foreign.status).toBe(403);
    expect(foreign.json).toMatchObject({ code: "PERMISSION_DENIED" });

    const missing = await call("admission/begin", { kind: "bogus" });
    expect(missing.status).toBe(403);
    expect(missing.json).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  test("a valid origin with invalid input is a value-free INVALID_INPUT", async () => {
    const result = await call(
      "admission/begin",
      { kind: "bogus", credential: "leaky-secret", email: "x" },
      { origin: ORIGIN },
    );
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(result.json)).not.toContain("leaky-secret");
  });

  test("setup bootstrap creates the first administrator end to end", async () => {
    const minted = await service.mintSetupToken();

    const begin = await call(
      "admission/begin",
      { kind: "setup", credential: minted.token, email: "first@example.test" },
      { origin: ORIGIN },
    );
    expect(begin.status).toBe(200);
    const enrollmentId = (begin.json as { enrollmentId: string }).enrollmentId;
    expect(delivered.at(-1)?.email).toBe("first@example.test");
    const code = delivered.at(-1)!.code;

    const complete = await call(
      "admission/complete",
      { enrollmentId, credential: minted.token, verificationCode: code },
      { origin: ORIGIN },
    );
    expect(complete.status).toBe(200);
    expect(complete.json).toEqual({ completed: true });

    const created = await db.execute(
      sql`select id, role, email_verified from "user" where email = 'first@example.test'`,
    );
    expect(created.rows).toHaveLength(1);
    const row = created.rows[0] as { id: string; role: string; email_verified: boolean };
    expect(row.role).toBe("admin");
    expect(row.email_verified).toBe(true);
    adminUserId = row.id;
  });

  test("admin mutations default-deny anonymous and non-admin callers", async () => {
    const anon = await call(
      "admission/issueInvitation",
      { email: "x@example.test" },
      { origin: ORIGIN },
    );
    expect(anon.status).toBe(401);
    expect(anon.json).toMatchObject({ code: "UNAUTHENTICATED" });

    await db.execute(
      sql`insert into "user" (id, email, role, banned) values ('user-1', 'user@example.test', 'user', false)`,
    );
    const nonAdmin = await call(
      "admission/issueInvitation",
      { email: "x@example.test" },
      {
        origin: ORIGIN,
        sessionValue: {
          user: { id: "user-1", email: "user@example.test", name: null },
          session: sessionFor("user-1"),
        },
      },
    );
    expect(nonAdmin.status).toBe(403);
    expect(nonAdmin.json).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  test("an admin with a foreign origin is rejected; with a valid origin issues and lists", async () => {
    const adminSession = {
      user: { id: adminUserId, email: "first@example.test", name: null },
      session: sessionFor(adminUserId),
    };

    const foreign = await call(
      "admission/issueInvitation",
      { email: "invitee@example.test" },
      { origin: "https://evil.test", sessionValue: adminSession },
    );
    expect(foreign.status).toBe(403);

    const issued = await call(
      "admission/issueInvitation",
      { email: "invitee@example.test" },
      { origin: ORIGIN, sessionValue: adminSession },
    );
    expect(issued.status).toBe(200);
    expect((issued.json as { invitationId: string }).invitationId).toBeString();

    const list = await call("admission/listInvitations", {}, { sessionValue: adminSession });
    expect(list.status).toBe(200);
    const invitations = (list.json as { invitations: { email: string }[] }).invitations;
    expect(invitations.some((entry) => entry.email === "invitee@example.test")).toBe(true);
  });

  test("an expired session cannot issue invitations", async () => {
    const expired = {
      user: { id: adminUserId, email: "first@example.test", name: null },
      session: {
        id: "s-exp",
        userId: adminUserId,
        activeOrganizationId: null,
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    };
    const result = await call(
      "admission/issueInvitation",
      { email: "invitee2@example.test" },
      { origin: ORIGIN, sessionValue: expired },
    );
    expect(result.status).toBe(403);
    expect(result.json).toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
