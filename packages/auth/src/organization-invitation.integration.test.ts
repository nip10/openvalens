import { beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { createDb, sql, type Database } from "@openvalens/db";
import type { EmailService, SendEmailInput, SendEmailOptions } from "@openvalens/email";

import { createAuth } from "./index";

/**
 * Issue #133 — the real Better Auth HTTP boundary for workspace invitation
 * acceptance and rejection over a disposable PostgreSQL. Proves the state
 * transitions the native client depends on through the protected organization
 * SDK: accept joins the workspace and activates it, reject declines, a wrong
 * account cannot accept, an expired invitation is refused and an unverified
 * account is denied. No account is ever created by these endpoints.
 */

const url = process.env.ORG_INVITATION_TEST_DATABASE_URL;

function assertDisposable(candidate: string | undefined, database: string): void {
  if (!candidate) return;
  const parsed = new URL(candidate);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}
assertDisposable(url, "org_invitation_test");

const BASE = "http://localhost:3000";
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: BASE,
  NODE_ENV: "test",
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

describe.skipIf(!url)("workspace invitation acceptance over HTTP", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/org_invitation_test" });
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

  async function signIn(emailAddress: string): Promise<string> {
    await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailAddress }),
      }),
    );
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

  async function post(
    cookie: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function listUserInvitations(
    cookie: string,
  ): Promise<{ status: number; body: Array<Record<string, unknown>> }> {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/organization/list-user-invitations`, {
        headers: { cookie },
      }),
    );
    return {
      status: response.status,
      body: (await response.json()) as Array<Record<string, unknown>>,
    };
  }

  async function seedInvitation(input: {
    id: string;
    organizationId: string;
    email: string;
    role?: string;
    status?: string;
    expiresAt?: Date;
  }): Promise<void> {
    const expiresAt = input.expiresAt ?? new Date(Date.now() + 2 * 86_400_000);
    await db.execute(
      sql`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at)
        values (${input.id}, ${input.organizationId}, ${input.email}, ${input.role ?? "member"},
          ${input.status ?? "pending"}, ${expiresAt.toISOString()}, 'owner-1', now())
        on conflict (id) do nothing`,
    );
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
        ('recipient-1', 'recipient@example.test', true, 'user', false),
        ('decliner-1', 'decliner@example.test', true, 'user', false),
        ('stranger-1', 'stranger@example.test', true, 'user', false),
        ('unverified-1', 'unverified@example.test', true, 'user', false)`,
    );
    await db.execute(
      sql`insert into organization (id, name, slug) values ('org-1', 'Northwind Clinic', 'northwind')`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-owner', 'org-1', 'owner-1', 'owner')`,
    );
  });

  test("a recipient accepts and joins the workspace with it activated", async () => {
    await seedInvitation({
      id: "inv-accept",
      organizationId: "org-1",
      email: "recipient@example.test",
    });
    const cookie = await signIn("recipient@example.test");

    const accepted = await post(cookie, "/organization/accept-invitation", {
      invitationId: "inv-accept",
    });
    expect(accepted.status).toBe(200);

    const invitation = (
      await db.execute(sql`select status from invitation where id = 'inv-accept'`)
    ).rows[0] as { status: string };
    expect(invitation.status).toBe("accepted");

    const members = await db.execute(
      sql`select role from member where organization_id = 'org-1' and user_id = 'recipient-1'`,
    );
    expect(members.rows).toHaveLength(1);
    expect((members.rows[0] as { role: string }).role).toBe("member");

    // Accepting activates the joined workspace on the session.
    const session = (
      await db.execute(
        sql`select active_organization_id from session where user_id = 'recipient-1'`,
      )
    ).rows[0] as { active_organization_id: string | null };
    expect(session.active_organization_id).toBe("org-1");
  });

  test("a recipient declines and does not join", async () => {
    await seedInvitation({
      id: "inv-decline",
      organizationId: "org-1",
      email: "decliner@example.test",
    });
    const cookie = await signIn("decliner@example.test");

    const declined = await post(cookie, "/organization/reject-invitation", {
      invitationId: "inv-decline",
    });
    expect(declined.status).toBe(200);

    const invitation = (
      await db.execute(sql`select status from invitation where id = 'inv-decline'`)
    ).rows[0] as { status: string };
    expect(invitation.status).toBe("rejected");
    // Signing in gave the decliner their own workspace; they did not join org-1.
    const joined = await db.execute(
      sql`select 1 from member where user_id = 'decliner-1' and organization_id = 'org-1'`,
    );
    expect(joined.rows).toHaveLength(0);
  });

  test("a different account cannot accept the invitation", async () => {
    await seedInvitation({
      id: "inv-wrong",
      organizationId: "org-1",
      email: "recipient@example.test",
    });
    const cookie = await signIn("stranger@example.test");

    const denied = await post(cookie, "/organization/accept-invitation", {
      invitationId: "inv-wrong",
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION");

    const invitation = (await db.execute(sql`select status from invitation where id = 'inv-wrong'`))
      .rows[0] as { status: string };
    expect(invitation.status).toBe("pending");
  });

  test("an expired invitation is refused", async () => {
    await seedInvitation({
      id: "inv-expired",
      organizationId: "org-1",
      email: "recipient@example.test",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const cookie = await signIn("recipient@example.test");

    const refused = await post(cookie, "/organization/accept-invitation", {
      invitationId: "inv-expired",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("INVITATION_NOT_FOUND");
  });

  test("an unverified account is denied", async () => {
    await seedInvitation({
      id: "inv-unverified",
      organizationId: "org-1",
      email: "unverified@example.test",
    });
    const cookie = await signIn("unverified@example.test");
    // Drop verification after sign-in so the live session carries it.
    await db.execute(sql`update "user" set email_verified = false where id = 'unverified-1'`);

    const denied = await post(cookie, "/organization/accept-invitation", {
      invitationId: "inv-unverified",
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe(
      "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
    );

    await db.execute(sql`update "user" set email_verified = true where id = 'unverified-1'`);
  });

  test("a recipient lists only their own pending invitations", async () => {
    await seedInvitation({
      id: "inv-list-mine",
      organizationId: "org-1",
      email: "recipient@example.test",
    });
    const cookie = await signIn("recipient@example.test");

    const listed = await listUserInvitations(cookie);
    expect(listed.status).toBe(200);
    const ids = listed.body.map((entry) => entry.id);
    expect(ids).toContain("inv-list-mine");
    expect(ids).not.toContain("inv-decline");
  });
});
