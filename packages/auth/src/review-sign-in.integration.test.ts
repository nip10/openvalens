import { beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { createDb, sql, type Database } from "@openvalens/db";
import type { EmailService } from "@openvalens/email";

import { createAuth } from "./index";
import {
  REVIEW_SIGN_IN_ERROR_CODE,
  REVIEW_SIGN_IN_PATH,
  REVIEW_SIGN_IN_RATE_LIMIT,
  type ReviewSignInConfig,
} from "./review-sign-in";

/**
 * App store review sign-in over the real Better Auth handler and a disposable
 * PostgreSQL: the right code signs the one review account in with a normal
 * session; a wrong code, another email, a missing account and the feature
 * being off all get the same refusal; attempts are rate limited; every attempt
 * while the feature is on is audited in the review account's own workspace.
 *
 * Guarded by `REVIEW_SIGN_IN_TEST_DATABASE_URL`, an *empty* loopback database
 * named `review_sign_in_test` (`scripts/test-integration.sh`).
 */

const url = process.env.REVIEW_SIGN_IN_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/review_sign_in_test"
  ) {
    throw new Error("Empty disposable loopback review_sign_in_test database required.");
  }
}

const BASE = "http://localhost:3000";
const WEB = "http://localhost:3001";
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: WEB,
  NODE_ENV: "test",
};
// Synthetic test values only.
const REVIEW: ReviewSignInConfig = {
  email: "reviewer@example.test",
  code: "synthetic-review-code-0001",
};

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

describe.skipIf(!url)("review sign-in against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/review_sign_in_test" });
  const email: EmailService = {
    organizationName: "OpenValens",
    sendEmail: async () => ({ id: "msg-1", dryRun: false }),
  };
  const on = createAuth(ENV, db, { email, reviewSignIn: REVIEW, rateLimitEnabled: false });
  const off = createAuth(ENV, db, { email, rateLimitEnabled: false });
  const limited = createAuth(ENV, db, { email, reviewSignIn: REVIEW, rateLimitEnabled: true });
  const missingAccount = createAuth(ENV, db, {
    email,
    reviewSignIn: { email: "nobody@example.test", code: REVIEW.code },
    rateLimitEnabled: false,
  });

  let ip = 0;
  async function attempt(
    auth: ReturnType<typeof createAuth>,
    body: { email: string; code: string },
    forwardedFor = `198.51.100.${(ip += 1)}`,
  ) {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth${REVIEW_SIGN_IN_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: WEB,
          "x-forwarded-for": forwardedFor,
        },
        body: JSON.stringify(body),
      }),
    );
    const sessionCookie = (response.headers.getSetCookie?.() ?? []).find((cookie) =>
      cookie.includes("session_token="),
    );
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
      cookie: sessionCookie ? sessionCookie.split(";")[0]! : null,
    };
  }

  async function sessionFor(cookie: string) {
    const response = await on.handler(
      new Request(`${BASE}/api/auth/get-session`, { headers: { cookie } }),
    );
    return (await response.json()) as {
      user: { id: string; email: string };
      session: { activeOrganizationId: string | null };
    } | null;
  }

  async function auditRows() {
    return (
      await db.execute<{
        organization_id: string;
        actor_user_id: string | null;
        event_type: string;
        target_id: string | null;
        after_json: { metadata?: Record<string, unknown> } | null;
      }>(
        sql`select "organization_id", "actor_user_id", "event_type", "target_id", "after_json"
            from "access_audit_log" where "event_type" like 'REVIEW_SIGN_IN_%' order by "id"`,
      )
    ).rows;
  }

  async function sessionCount(userId: string) {
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from "session" where "user_id" = ${userId}`,
    );
    return Number(rows.rows[0]!.n);
  }

  const refusal = { code: REVIEW_SIGN_IN_ERROR_CODE };

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(sql`insert into "user" (id, email, email_verified, role, banned) values
      ('reviewer', 'Reviewer@Example.test', true, 'user', false),
      ('someone', 'someone@example.test', true, 'user', false)`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-reviewer', 'Reviewer', 'reviewer'), ('org-someone', 'Someone', 'someone')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-reviewer', 'org-reviewer', 'reviewer', 'owner'),
      ('m-someone', 'org-someone', 'someone', 'owner')`);
  });

  test("settings off: the code is refused and nothing is written", async () => {
    const outcome = await attempt(off, REVIEW);
    expect(outcome.status).toBe(401);
    expect(outcome.body).toMatchObject(refusal);
    expect(outcome.cookie).toBeNull();
    expect(await sessionCount("reviewer")).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  test("right code: a normal session for the review account, in its workspace, audited", async () => {
    const outcome = await attempt(on, { email: "  REVIEWER@example.test ", code: REVIEW.code });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ status: true });
    expect(outcome.cookie).not.toBeNull();

    const session = await sessionFor(outcome.cookie!);
    expect(session?.user.id).toBe("reviewer");
    expect(session?.session.activeOrganizationId).toBe("org-reviewer");

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: "org-reviewer",
      actor_user_id: "reviewer",
      event_type: "REVIEW_SIGN_IN_SUCCEEDED",
      target_id: "reviewer",
    });
    expect(rows[0]!.after_json?.metadata).toEqual({ method: "review_code" });
  });

  test("wrong code and other emails get the same refusal, and each is audited", async () => {
    const before = (await auditRows()).length;
    const wrongCode = await attempt(on, { email: REVIEW.email, code: "synthetic-wrong-code-01" });
    const otherAccount = await attempt(on, { email: "someone@example.test", code: REVIEW.code });
    const unknown = await attempt(on, { email: "unknown@example.test", code: REVIEW.code });
    const emptyCode = await attempt(on, { email: REVIEW.email, code: "" });

    for (const outcome of [wrongCode, otherAccount, unknown, emptyCode]) {
      expect(outcome.status).toBe(401);
      expect(outcome.cookie).toBeNull();
    }
    // Byte-for-byte the same body: nothing tells the review email apart.
    expect(otherAccount.body).toEqual(wrongCode.body);
    expect(unknown.body).toEqual(wrongCode.body);
    expect(emptyCode.body).toEqual(wrongCode.body);
    expect(wrongCode.body).toMatchObject(refusal);

    // No other account can use a code.
    expect(await sessionCount("someone")).toBe(0);

    const rows = (await auditRows()).slice(before);
    expect(rows.map((row) => [row.event_type, row.after_json?.metadata?.reason])).toEqual([
      ["REVIEW_SIGN_IN_FAILED", "wrong_code"],
      ["REVIEW_SIGN_IN_FAILED", "other_email"],
      ["REVIEW_SIGN_IN_FAILED", "other_email"],
      ["REVIEW_SIGN_IN_FAILED", "wrong_code"],
    ]);
    for (const row of rows) {
      expect(row.organization_id).toBe("org-reviewer");
      expect(row.actor_user_id).toBeNull();
      // Never the submitted email or code.
      expect(JSON.stringify(row)).not.toContain("someone@");
      expect(JSON.stringify(row)).not.toContain("unknown@");
      expect(JSON.stringify(row)).not.toContain("synthetic-");
    }
  });

  test("the review account must already exist; this path never creates one", async () => {
    const users = async () =>
      Number(
        (await db.execute<{ n: number }>(sql`select count(*)::int as n from "user"`)).rows[0]!.n,
      );
    const before = await users();
    const outcome = await attempt(missingAccount, {
      email: "nobody@example.test",
      code: REVIEW.code,
    });
    expect(outcome.status).toBe(401);
    expect(outcome.body).toMatchObject(refusal);
    expect(outcome.cookie).toBeNull();
    expect(await users()).toBe(before);
  });

  test("a banned review account is refused and the refusal is audited", async () => {
    await db.execute(sql`update "user" set banned = true where id = 'reviewer'`);
    try {
      const outcome = await attempt(on, REVIEW);
      expect(outcome.status).toBe(401);
      expect(outcome.body).toMatchObject(refusal);
      const last = (await auditRows()).at(-1);
      expect(last?.after_json?.metadata?.reason).toBe("session_refused");
    } finally {
      await db.execute(sql`update "user" set banned = false where id = 'reviewer'`);
    }
  });

  test(`attempts are rate limited per IP (${REVIEW_SIGN_IN_RATE_LIMIT.max} a minute)`, async () => {
    const from = "203.0.113.7";
    for (let i = 0; i < REVIEW_SIGN_IN_RATE_LIMIT.max; i += 1) {
      const outcome = await attempt(limited, { email: REVIEW.email, code: `wrong-${i}` }, from);
      expect(outcome.status).toBe(401);
    }
    // Even the right code is turned away until the window passes.
    const blocked = await attempt(limited, REVIEW, from);
    expect(blocked.status).toBe(429);
    expect(blocked.cookie).toBeNull();
    // Another address is not affected.
    expect((await attempt(limited, REVIEW, "203.0.113.8")).status).toBe(200);
  });
});
