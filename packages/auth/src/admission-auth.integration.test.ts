import { beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { createDb, sql, type Database } from "@openvalens/db";
import type { EmailService, SendEmailInput, SendEmailOptions } from "@openvalens/email";

import { createAuth } from "./index";

/**
 * Real Better Auth HTTP boundary for admission (Issue #63): the actual
 * `auth.handler` over a disposable PostgreSQL. Proves that SDK account
 * creation is closed, that a returning account can still sign in by magic
 * link, and that the `/admin/*` guard requires a fresh global administrator.
 */

const url = process.env.ADMISSION_AUTH_TEST_DATABASE_URL;

function assertDisposable(candidate: string | undefined, database: string): void {
  if (!candidate) return;
  const parsed = new URL(candidate);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}
assertDisposable(url, "admission_auth_test");

const BASE = "http://localhost:3000";
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: BASE,
  NODE_ENV: "test",
};

/**
 * Builds a Cookie header from `Set-Cookie` values with last-wins semantics
 * (a later set for the same name overrides an earlier one), matching how a
 * browser resolves the impersonate response's session-token swap.
 */
function lastWinsCookieHeader(cookies: readonly string[]): string {
  const byName = new Map<string, string>();
  for (const cookie of cookies) {
    const name = cookie.slice(0, cookie.indexOf("="));
    byName.set(name, cookie);
  }
  return [...byName.values()].join("; ");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

describe.skipIf(!url)("admission auth HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/admission_auth_test" });
  const sent: SendEmailInput[] = [];
  const email: EmailService = {
    organizationName: "OpenValens",
    sendEmail: async (input: SendEmailInput, _options?: SendEmailOptions) => {
      sent.push(input);
      return { id: "msg-1", dryRun: false };
    },
  };
  const auth = createAuth(ENV, db, { email });

  const magicLinkTokenFor = (emailAddress: string): string | null => {
    const message = [...sent].reverse().find((entry) => entry.to === emailAddress);
    const match = message?.html?.match(/magic-link\/verify\?token=([^"'&]+)/);
    return match ? decodeURIComponent(match[1]!) : null;
  };

  const countUsers = async () =>
    Number(
      ((await db.execute(sql`select count(*)::int as n from "user"`)).rows[0] as { n: number }).n,
    );

  async function signIn(emailAddress: string): Promise<string> {
    const request = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailAddress }),
      }),
    );
    expect(request.status).toBeLessThan(400);
    const token = magicLinkTokenFor(emailAddress);
    if (!token) throw new Error("no magic link token captured");
    const verify = await auth.handler(
      new Request(`${BASE}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`),
    );
    const cookies = verify.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((cookie) => cookie.includes("session_token"));
    if (!sessionCookie) throw new Error("no session cookie issued");
    return sessionCookie.split(";")[0]!;
  }

  async function setActiveOrg(userId: string, organizationId: string): Promise<void> {
    await db.execute(
      sql`update session set active_organization_id = ${organizationId} where user_id = ${userId}`,
    );
  }

  async function invite(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/organization/invite-member`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
  });

  test("email/password sign-up is closed", async () => {
    const before = await countUsers();
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "new@example.test",
          password: "hunter2hunter2",
          name: "New",
        }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await countUsers()).toBe(before);
  });

  test("magic-link sign-in for an unknown email never provisions an account", async () => {
    const before = await countUsers();
    await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "unknown@example.test" }),
      }),
    );
    const token = magicLinkTokenFor("unknown@example.test");
    expect(token).not.toBeNull();
    const verify = await auth.handler(
      new Request(`${BASE}/api/auth/magic-link/verify?token=${encodeURIComponent(token!)}`),
    );
    // A redirect to an error is expected (new_user_signup_disabled); no session.
    expect(verify.headers.getSetCookie?.() ?? []).toEqual([]);
    expect(await countUsers()).toBe(before);
  });

  test("a returning account can still sign in; /admin/* is closed to anonymous and non-admins", async () => {
    await db.execute(
      sql`insert into "user" (id, email, email_verified, role, banned) values
        ('admin-1', 'admin@example.test', true, 'admin', false),
        ('user-1', 'user@example.test', true, 'user', false)`,
    );

    const anon = await auth.handler(new Request(`${BASE}/api/auth/admin/list-users`));
    expect(anon.status).toBeGreaterThanOrEqual(401);

    const adminCookie = await signIn("admin@example.test");
    const allowed = await auth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie: adminCookie } }),
    );
    expect(allowed.status).toBe(200);

    const userCookie = await signIn("user@example.test");
    const denied = await auth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie: userCookie } }),
    );
    expect(denied.status).toBe(403);
  });

  test("sign-in sets a session for the returning account", async () => {
    const cookie = await signIn("admin@example.test");
    const session = await auth.handler(
      new Request(`${BASE}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { email?: string } } | null;
    expect(body?.user?.email).toBe("admin@example.test");
  });

  test("an authenticated global admin still cannot create users via /admin/create-user", async () => {
    const cookie = await signIn("admin@example.test");
    const before = await countUsers();
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/admin/create-user`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          email: "admin-made@example.test",
          password: "hunter2hunter2",
          name: "Made",
        }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await countUsers()).toBe(before);
    const created = await db.execute(
      sql`select 1 from "user" where email = 'admin-made@example.test'`,
    );
    expect(created.rows).toHaveLength(0);
  });

  test("a fresh demotion or ban denies admin access even with a previously valid cookie", async () => {
    const cookie = await signIn("admin@example.test");
    const allowed = await auth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie } }),
    );
    expect(allowed.status).toBe(200);

    await db.execute(sql`update "user" set role = 'user' where id = 'admin-1'`);
    const demoted = await auth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie } }),
    );
    expect(demoted.status).toBe(403);

    await db.execute(sql`update "user" set role = 'admin', banned = true where id = 'admin-1'`);
    const banned = await auth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie } }),
    );
    expect(banned.status).toBe(403);

    await db.execute(sql`update "user" set banned = false where id = 'admin-1'`);
  });

  test("impersonation: privileged ops rejected, exact exit endpoint reachable", async () => {
    await db.execute(
      sql`insert into "user" (id, email, email_verified, role, banned) values
        ('admin-2', 'admin2@example.test', true, 'admin', false)
        on conflict (id) do nothing`,
    );
    await db.execute(sql`update "user" set role = 'admin', banned = false where id = 'admin-1'`);
    const adminCookie = await signIn("admin@example.test");

    const impersonated = await auth.handler(
      new Request(`${BASE}/api/auth/admin/impersonate-user`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ userId: "user-1" }),
      }),
    );
    expect(impersonated.status).toBe(200);
    const impCookies = (impersonated.headers.getSetCookie?.() ?? [])
      .filter((cookie) => /^better-auth\.[a-z_]+=.+/.test(cookie))
      .map((cookie) => cookie.split(";")[0]!);
    const impCookieHeader = lastWinsCookieHeader(impCookies);
    expect(impCookieHeader).toContain("session_token");

    // An impersonated context cannot perform admin ops.
    const denied = await auth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie: impCookieHeader } }),
    );
    expect(denied.status).toBe(403);

    // The exact impersonation-exit endpoint stays reachable (with the
    // admin_session cookie the SDK issued) so the user can leave the context.
    const exit = await auth.handler(
      new Request(`${BASE}/api/auth/admin/stop-impersonating`, {
        method: "POST",
        headers: { cookie: impCookieHeader },
      }),
    );
    expect(exit.status).toBeLessThan(400);

    // Even if the impersonated session resolves to an administrator account,
    // the guard still denies privileged ops (it checks impersonation before the
    // role, and before any admin action).
    const second = await auth.handler(
      new Request(`${BASE}/api/auth/admin/impersonate-user`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ userId: "user-1" }),
      }),
    );
    expect(second.status).toBe(200);
    const secondCookie = (second.headers.getSetCookie?.() ?? [])
      .filter((cookie) => /^better-auth\.session_token=.+/.test(cookie))
      .at(-1)
      ?.split(";")[0];
    await db.execute(
      sql`update session set user_id = 'admin-2'
        where user_id = 'user-1' and impersonated_by is not null`,
    );
    const stillDenied = await auth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie: secondCookie! } }),
    );
    expect(stillDenied.status).toBe(403);
  });

  test("organization invites: unknown target denied before any row or email change", async () => {
    await db.execute(
      sql`insert into organization (id, name, slug) values ('org-1', 'Acme', 'acme')
        on conflict (id) do nothing`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-1', 'org-1', 'admin-1', 'owner')
        on conflict (id) do nothing`,
    );
    const cookie = await signIn("admin@example.test");
    await setActiveOrg("admin-1", "org-1");

    const sentBefore = sent.length;
    const unknown = await invite(cookie, {
      email: "stranger@example.test",
      role: "member",
      organizationId: "org-1",
    });
    expect(unknown.status).toBe(403);
    expect(unknown.body).not.toHaveProperty("email");
    expect(sent.length).toBe(sentBefore);

    const rows = await db.execute(
      sql`select 1 from invitation where organization_id = 'org-1' and email = 'stranger@example.test'`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  test("organization invites: existing recipient succeeds with a two-day expiry", async () => {
    const cookie = await signIn("admin@example.test");
    await setActiveOrg("admin-1", "org-1");

    const created = await invite(cookie, {
      email: "user@example.test",
      role: "member",
      organizationId: "org-1",
    });
    expect(created.status).toBe(200);
    const expiresAt = new Date(String(created.body.expiresAt));
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(1.8);
    expect(days).toBeLessThan(2.2);
  });

  test("resending an unknown legacy invitation is denied: no resend, no delivery, no provisioning", async () => {
    const fixedExpiry = new Date(Date.now() + 5 * 86_400_000);
    await db.execute(
      sql`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at)
        values ('legacy-inv', 'org-1', 'legacy@example.test', 'member', 'pending', ${fixedExpiry.toISOString()}, 'admin-1', now())
        on conflict (id) do nothing`,
    );
    const cookie = await signIn("admin@example.test");
    await setActiveOrg("admin-1", "org-1");

    const usersBefore = await countUsers();
    const sentBefore = sent.length;
    const resend = await invite(cookie, {
      email: "legacy@example.test",
      role: "member",
      organizationId: "org-1",
      resend: true,
    });
    expect(resend.status).toBe(403);
    expect(sent.length).toBe(sentBefore);

    const row = (await db.execute(sql`select expires_at from invitation where id = 'legacy-inv'`))
      .rows[0] as { expires_at: Date };
    expect(new Date(row.expires_at).getTime()).toBe(fixedExpiry.getTime());
    // No account is provisioned for the unknown target.
    expect(await countUsers()).toBe(usersBefore);
    expect(
      (await db.execute(sql`select 1 from "user" where email = 'legacy@example.test'`)).rows,
    ).toHaveLength(0);
  });

  test("resending an existing user's invitation via the SDK resend branch refreshes expiry to two days", async () => {
    await db.execute(
      sql`insert into "user" (id, email, email_verified, role, banned) values
        ('resend-1', 'resend-user@example.test', true, 'user', false)
        on conflict (id) do nothing`,
    );
    const oldExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await db.execute(
      sql`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at)
        values ('seed-resend', 'org-1', 'resend-user@example.test', 'member', 'pending', ${oldExpiry.toISOString()}, 'admin-1', now())
        on conflict (id) do nothing`,
    );
    const cookie = await signIn("admin@example.test");
    await setActiveOrg("admin-1", "org-1");

    const sentBefore = sent.length;
    const resend = await invite(cookie, {
      email: "resend-user@example.test",
      role: "member",
      organizationId: "org-1",
      resend: true,
    });
    expect(resend.status).toBe(200);
    // Same invitation identity/org/role; only the expiry is refreshed.
    expect(resend.body.id).toBe("seed-resend");
    expect(resend.body.organizationId).toBe("org-1");
    expect(resend.body.role).toBe("member");
    const expiresAt = new Date(String(resend.body.expiresAt));
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(1.8);
    expect(days).toBeLessThan(2.2);
    expect(sent.length).toBeGreaterThan(sentBefore);

    const row = (
      await db.execute(
        sql`select expires_at, role, organization_id from invitation where id = 'seed-resend'`,
      )
    ).rows[0] as { expires_at: Date; role: string; organization_id: string };
    expect(new Date(row.expires_at).getTime()).toBe(expiresAt.getTime());
    expect(row.role).toBe("member");
    expect(row.organization_id).toBe("org-1");
  });

  test("production-like SDK origin enforcement runs in an isolated child process", async () => {
    const fixture = new URL("./testing/admission-origin-fixture.ts", import.meta.url).pathname;
    const child = Bun.spawn(["bun", "--no-env-file", fixture], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "production",
        DATABASE_URL: url!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    const lastLine = stdout.trim().split("\n").at(-1) ?? "";
    const result = JSON.parse(lastLine) as {
      configured: number;
      foreign: number;
      missing: number;
    };
    expect(result.configured).toBeLessThan(400);
    expect(result.foreign).toBe(403);
  });
});
