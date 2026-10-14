import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";

import type { Context } from "../context";
import { appRouter } from "./index";

/**
 * oRPC `sharing.createInvitation` boundary (Issue #63): the real router over a
 * disposable PostgreSQL with a fake registered auth session. Proves that an
 * unknown recipient is denied before any row/audit change and that an existing
 * recipient is invited with the two-day window.
 */

const url = process.env.ADMISSION_AUTH_TEST_DATABASE_URL;

function assertDisposable(candidate: string | undefined, database: string): void {
  if (!candidate) return;
  const parsed = new URL(candidate);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}
assertDisposable(url, "admission_sharing_test");

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const OWNER = { id: "owner-1", email: "owner@example.test", name: null };
const OWNER_SESSION = {
  id: "s-1",
  userId: "owner-1",
  activeOrganizationId: "org-1",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const fakeAuth = {
  api: {
    getSession: async () => ({ user: OWNER, session: OWNER_SESSION }),
    getActiveMember: async () => ({
      id: "m-1",
      userId: "owner-1",
      organizationId: "org-1",
      role: "owner",
    }),
    getActiveMemberRole: async () => ({ role: "owner" }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

describe.skipIf(!url)("sharing.createInvitation against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_sharing_test" });

  function context(): Context {
    return {
      session: { user: OWNER, session: OWNER_SESSION },
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
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers: new Headers() } } },
    } as unknown as Context;
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql`insert into "user" (id, email, email_verified, role, banned) values
        ('owner-1', 'owner@example.test', true, 'user', false),
        ('known-1', 'known@example.test', true, 'user', false)`,
    );
    await db.execute(
      sql`insert into organization (id, name, slug) values ('org-1', 'Acme', 'acme')`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-1', 'org-1', 'owner-1', 'owner')`,
    );
    setRegisteredAuth(fakeAuth);
  });

  afterAll(() => {
    clearRegisteredAuth();
  });

  test("an unknown recipient is denied with no row or audit change", async () => {
    const result = await appRouter.sharing.createInvitation
      .callable({ context: context() })({ email: "stranger@example.test", role: "member" })
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "PERMISSION_DENIED" });

    const rows = await db.execute(
      sql`select 1 from invitation where organization_id = 'org-1' and email = 'stranger@example.test'`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  test("an existing recipient is invited with a two-day window", async () => {
    const created = await appRouter.sharing.createInvitation.callable({ context: context() })({
      email: "Known@Example.test",
      role: "member",
    });
    expect(created.email).toBe("known@example.test");
    const days = (new Date(created.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(1.8);
    expect(days).toBeLessThan(2.2);

    const rows = await db.execute(
      sql`select email, status from invitation where organization_id = 'org-1' and email = 'known@example.test'`,
    );
    expect(rows.rows).toHaveLength(1);
  });
});
