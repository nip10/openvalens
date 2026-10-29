import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { createDb, sql, type Database } from "@openvalens/db";
import type { EmailService, SendEmailInput, SendEmailOptions } from "@openvalens/email";

import { createPublicSignUpService, type DeliverSignUp } from "./admission";
import type { DeploymentConfig } from "./deployment";
import { createAuth } from "./index";
import { PUBLIC_SIGN_UP_VERIFY_PATH } from "./public-sign-up-plugin";

/**
 * Issue #294 — Cloud public sign-up end to end over a disposable PostgreSQL:
 * the admission core (`createPublicSignUpService`) plus the real Better Auth
 * handler with the sign-up link endpoint mounted.
 *
 * Guarded by `PUBLIC_SIGN_UP_TEST_DATABASE_URL`, an *empty* loopback database
 * named `public_sign_up_test`; the full migration set is applied first.
 */

const url = process.env.PUBLIC_SIGN_UP_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/public_sign_up_test"
  ) {
    throw new Error("Empty disposable loopback public_sign_up_test database required.");
  }
}

const BASE = "http://localhost:3000";
const WEB = "http://localhost:3001";
const HEALTH_CONSENT_VERSION = "health-consent-2026-11";
const acceptedConsent = (email: string) => ({
  email,
  acceptedLegal: true,
  acceptedHealthDataConsent: true,
  healthDataConsentVersion: HEALTH_CONSENT_VERSION,
});
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: WEB,
  NODE_ENV: "test",
};
const CLOUD: DeploymentConfig = {
  mode: "cloud",
  legal: {
    terms: { url: "https://legal.test/terms", version: "terms-2026-11" },
    privacy: { url: "https://legal.test/privacy", version: "privacy-2026-11" },
    healthDataConsent: { url: "https://legal.test/privacy", version: "health-consent-2026-11" },
  },
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

type Delivered = Parameters<DeliverSignUp>[0];

describe.skipIf(!url)("public sign-up against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/public_sign_up_test" });
  const sentAuthEmail: SendEmailInput[] = [];
  const email: EmailService = {
    organizationName: "OpenValens",
    sendEmail: async (input: SendEmailInput, _options?: SendEmailOptions) => {
      sentAuthEmail.push(input);
      return { id: "msg-1", dryRun: false };
    },
  };

  let delivered: Delivered[] = [];
  let createdHook: { userId: string; organizationId: string }[] = [];
  let failHook = false;

  const verifyUrl = (token: string) =>
    `${BASE}/api/auth${PUBLIC_SIGN_UP_VERIFY_PATH}?token=${encodeURIComponent(token)}`;

  const cloud = createPublicSignUpService({
    db,
    deployment: CLOUD,
    verifyUrl,
    deliver: async (input) => {
      delivered.push(input);
    },
    onAccountCreated: async ({ tx, userId, organizationId }) => {
      // The hook runs inside the creating transaction (#297 starts the trial here).
      const seen = await tx.execute(sql`select 1 from "user" where "id" = ${userId}`);
      expect(seen.rows).toHaveLength(1);
      if (failHook) throw new Error("trial could not start");
      createdHook.push({ userId, organizationId });
    },
  });
  const selfHosted = createPublicSignUpService({
    db,
    deployment: { mode: "self-hosted" },
    verifyUrl,
    deliver: async (input) => {
      delivered.push(input);
    },
  });

  const cloudAuth = createAuth(ENV, db, { email, publicSignUp: cloud });
  const selfHostedAuth = createAuth(ENV, db, { email });

  const count = async (table: string) =>
    Number(
      (
        (await db.execute(sql.raw(`select count(*)::int as n from "${table}"`))).rows[0] as {
          n: number;
        }
      ).n,
    );

  const lastLinkFor = (address: string): string => {
    const entry = [...delivered].reverse().find((d) => d.email === address && d.kind === "new");
    if (!entry || entry.kind !== "new") throw new Error("no sign-up link delivered");
    return entry.url;
  };

  async function useLink(link: string) {
    const response = await cloudAuth.handler(new Request(link));
    const cookies = response.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((cookie) => cookie.includes("session_token"));
    return {
      status: response.status,
      location: response.headers.get("location"),
      cookie: sessionCookie ? sessionCookie.split(";")[0]! : null,
    };
  }

  async function signUp(address: string) {
    await cloud.signUpPublic(acceptedConsent(address));
    return useLink(lastLinkFor(address));
  }

  async function userByEmail(address: string) {
    const result = await db.execute<{ id: string; role: string; email_verified: boolean }>(
      sql`select "id", "role", "email_verified" from "user" where "email" = ${address}`,
    );
    return result.rows[0] ?? null;
  }

  async function membershipsOf(userId: string) {
    const result = await db.execute<{ organization_id: string; role: string }>(
      sql`select "organization_id", "role" from "member" where "user_id" = ${userId}`,
    );
    return result.rows;
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
  });

  beforeEach(() => {
    delivered = [];
    createdHook = [];
    failHook = false;
  });

  test("self-hosted: sign-up refuses, the link endpoint does not exist, nothing is written", async () => {
    const usersBefore = await count("user");
    await expect(
      selfHosted.signUpPublic(acceptedConsent("self@example.test")),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(await selfHosted.completePublicSignUp("anything")).toEqual({ status: "invalid" });
    const response = await selfHostedAuth.handler(
      new Request(`${BASE}/api/auth${PUBLIC_SIGN_UP_VERIFY_PATH}?token=anything`),
    );
    expect(response.status).toBe(404);
    expect(delivered).toEqual([]);
    expect(await count("sign_up_request")).toBe(0);
    expect(await count("user")).toBe(usersBefore);
  });

  test("requesting sign-up creates no user; only a token digest is stored", async () => {
    const usersBefore = await count("user");
    const membersBefore = await count("member");
    const result = await cloud.signUpPublic({
      email: "Pending@Example.test",
      acceptedLegal: true,
      acceptedHealthDataConsent: true,
      healthDataConsentVersion: HEALTH_CONSENT_VERSION,
      locale: "pt-PT",
    });
    expect(result).toEqual({ accepted: true });
    expect(await count("user")).toBe(usersBefore);
    expect(await count("member")).toBe(membersBefore);
    expect(await userByEmail("pending@example.test")).toBeNull();

    const link = lastLinkFor("pending@example.test");
    const token = new URL(link).searchParams.get("token")!;
    const rows = await db.execute<{
      token_hash: string;
      canonical_email: string;
      locale: string;
      health_data_consent_version: string;
      health_data_consent_accepted_at: unknown;
    }>(
      sql`select "token_hash", "canonical_email", "locale", "health_data_consent_version", "health_data_consent_accepted_at" from "sign_up_request"`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.canonical_email).toBe("pending@example.test");
    expect(rows.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0]!.token_hash).not.toContain(token);
    expect(rows.rows[0]!.locale).toBe("pt-PT");
    expect(rows.rows[0]!.health_data_consent_version).toBe(HEALTH_CONSENT_VERSION);
    expect(rows.rows[0]!.health_data_consent_accepted_at).not.toBeNull();
  });

  test("missing, refused, or stale health consent writes no request", async () => {
    const before = await count("sign_up_request");
    await expect(
      cloud.signUpPublic({ email: "missing-consent@example.test", acceptedLegal: true } as never),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      cloud.signUpPublic({
        ...acceptedConsent("false-consent@example.test"),
        acceptedHealthDataConsent: false,
      }),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      cloud.signUpPublic({
        ...acceptedConsent("stale-consent@example.test"),
        healthDataConsentVersion: "stale-version",
      }),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(await count("sign_up_request")).toBe(before);
    expect(delivered).toEqual([]);
  });

  test("using the link creates the user, their own workspace as owner, legal records, and a session in onboarding", async () => {
    const outcome = await signUp("alice@example.test");
    expect(outcome.status).toBe(302);
    expect(outcome.location).toBe(`${WEB}/welcome`);
    expect(outcome.cookie).not.toBeNull();

    const alice = await userByEmail("alice@example.test");
    expect(alice).not.toBeNull();
    // A customer is never an instance administrator.
    expect(alice!.role).toBe("user");
    expect(alice!.email_verified).toBe(true);

    const memberships = await membershipsOf(alice!.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe("owner");
    const organizationId = memberships[0]!.organization_id;

    const onboarding = await db.execute<{ current_step: string }>(
      sql`select "current_step" from "onboarding_state" where "organization_id" = ${organizationId}`,
    );
    expect(onboarding.rows[0]?.current_step).toBe("pending");

    const legal = await db.execute<{ document: string; version: string; accepted_at: unknown }>(
      sql`select "document", "version", "accepted_at" from "legal_acceptance" where "user_id" = ${alice!.id} order by "document"`,
    );
    expect(legal.rows.map((row) => [row.document, row.version])).toEqual([
      ["health_data_consent", HEALTH_CONSENT_VERSION],
      ["privacy", "privacy-2026-11"],
      ["terms", "terms-2026-11"],
    ]);
    expect(legal.rows.every((row) => row.accepted_at !== null)).toBe(true);

    const event = await db.execute<{ event_type: string }>(
      sql`select "event_type" from "global_security_event" where "target_user_id" = ${alice!.id}`,
    );
    expect(event.rows.map((row) => row.event_type)).toEqual(["public_sign_up_completed"]);
    expect(createdHook).toEqual([{ userId: alice!.id, organizationId }]);

    // The session starts in the new workspace.
    const session = await db.execute<{ active_organization_id: string | null }>(
      sql`select "active_organization_id" from "session" where "user_id" = ${alice!.id}`,
    );
    expect(session.rows[0]?.active_organization_id).toBe(organizationId);
    const me = await cloudAuth.handler(
      new Request(`${BASE}/api/auth/get-session`, { headers: { cookie: outcome.cookie! } }),
    );
    expect(((await me.json()) as { user?: { email?: string } }).user?.email).toBe(
      "alice@example.test",
    );

    // ...and cannot reach the instance-admin endpoints.
    const admin = await cloudAuth.handler(
      new Request(`${BASE}/api/auth/admin/list-users`, { headers: { cookie: outcome.cookie! } }),
    );
    expect(admin.status).toBe(403);
  });

  test("a reused link is refused and creates nothing more", async () => {
    await cloud.signUpPublic(acceptedConsent("reuse@example.test"));
    const link = lastLinkFor("reuse@example.test");
    expect((await useLink(link)).location).toBe(`${WEB}/welcome`);
    const users = await count("user");
    const again = await useLink(link);
    expect(again.location).toBe(`${WEB}/signup?error=used`);
    expect(again.cookie).toBeNull();
    expect(await count("user")).toBe(users);
  });

  test("an expired link is refused and creates no user", async () => {
    await cloud.signUpPublic(acceptedConsent("late@example.test"));
    await db.execute(
      sql`update "sign_up_request" set "expires_at" = clock_timestamp() - interval '1 second' where "canonical_email" = 'late@example.test'`,
    );
    const outcome = await useLink(lastLinkFor("late@example.test"));
    expect(outcome.location).toBe(`${WEB}/signup?error=expired`);
    expect(outcome.cookie).toBeNull();
    expect(await userByEmail("late@example.test")).toBeNull();
  });

  test("old pending tokens without current health consent fail before account creation", async () => {
    await cloud.signUpPublic(acceptedConsent("legacy-token@example.test"));
    const tokenUrl = lastLinkFor("legacy-token@example.test");
    await db.execute(sql`
      update "sign_up_request" set "health_data_consent_version" = null,
        "health_data_consent_accepted_at" = null
      where "canonical_email" = 'legacy-token@example.test'
    `);
    const outcome = await useLink(tokenUrl);
    expect(outcome.location).toBe(`${WEB}/signup?error=invalid`);
    expect(await userByEmail("legacy-token@example.test")).toBeNull();
  });

  test("a pending token bound to an obsolete consent version cannot provision", async () => {
    await cloud.signUpPublic(acceptedConsent("rotated-token@example.test"));
    const tokenUrl = lastLinkFor("rotated-token@example.test");
    await db.execute(sql`
      update "sign_up_request" set "health_data_consent_version" = 'old-version'
      where "canonical_email" = 'rotated-token@example.test'
    `);
    expect((await useLink(tokenUrl)).location).toBe(`${WEB}/signup?error=invalid`);
    expect(await userByEmail("rotated-token@example.test")).toBeNull();
  });

  test("an unknown or missing token is refused", async () => {
    expect(
      (await useLink(`${BASE}/api/auth${PUBLIC_SIGN_UP_VERIFY_PATH}?token=nope`)).location,
    ).toBe(`${WEB}/signup?error=invalid`);
    expect((await useLink(`${BASE}/api/auth${PUBLIC_SIGN_UP_VERIFY_PATH}`)).location).toBe(
      `${WEB}/signup?error=invalid`,
    );
  });

  test("an existing account gets the same answer, a sign-in pointer and no new request", async () => {
    await signUp("existing@example.test");
    const requestsBefore = await count("sign_up_request");
    delivered = [];
    const result = await cloud.signUpPublic({
      email: "EXISTING@example.test",
      acceptedLegal: true,
      acceptedHealthDataConsent: true,
      healthDataConsentVersion: HEALTH_CONSENT_VERSION,
    });
    expect(result).toEqual({ accepted: true });
    expect(delivered).toEqual([{ kind: "existing", email: "existing@example.test" }]);
    expect(await count("sign_up_request")).toBe(requestsBefore);
  });

  test("two links for one email: the first used wins, the second can never create a duplicate", async () => {
    await cloud.signUpPublic(acceptedConsent("twice@example.test"));
    const first = lastLinkFor("twice@example.test");
    await cloud.signUpPublic(acceptedConsent("twice@example.test"));
    const second = lastLinkFor("twice@example.test");
    expect(second).not.toBe(first);

    expect((await useLink(second)).location).toBe(`${WEB}/welcome`);
    expect((await useLink(first)).location).toBe(`${WEB}/signup?error=used`);
    const users = await db.execute(sql`select 1 from "user" where "email" = 'twice@example.test'`);
    expect(users.rows).toHaveLength(1);
  });

  test("a failing account-created hook (the #297 trial) rolls the whole sign-up back", async () => {
    await cloud.signUpPublic(acceptedConsent("rollback@example.test"));
    failHook = true;
    const outcome = await useLink(lastLinkFor("rollback@example.test"));
    expect(outcome.location).toBe(`${WEB}/signup?error=invalid`);
    expect(await userByEmail("rollback@example.test")).toBeNull();
    // The link is still pending, so it works once the hook recovers.
    failHook = false;
    expect((await useLink(lastLinkFor("rollback@example.test"))).location).toBe(`${WEB}/welcome`);
  });

  test("tenant isolation: two sign-ups get separate workspaces and see only their own", async () => {
    const one = await signUp("tenant-one@example.test");
    const two = await signUp("tenant-two@example.test");
    const userOne = (await userByEmail("tenant-one@example.test"))!;
    const userTwo = (await userByEmail("tenant-two@example.test"))!;

    const orgsOne = (await membershipsOf(userOne.id)).map((row) => row.organization_id);
    const orgsTwo = (await membershipsOf(userTwo.id)).map((row) => row.organization_id);
    expect(orgsOne).toHaveLength(1);
    expect(orgsTwo).toHaveLength(1);
    expect(orgsOne[0]).not.toBe(orgsTwo[0]);

    // Each workspace has exactly one member: its owner.
    for (const organizationId of [orgsOne[0]!, orgsTwo[0]!]) {
      const members = await db.execute(
        sql`select "user_id" from "member" where "organization_id" = ${organizationId}`,
      );
      expect(members.rows).toHaveLength(1);
    }

    const listFor = async (cookie: string) => {
      const response = await cloudAuth.handler(
        new Request(`${BASE}/api/auth/organization/list`, { headers: { cookie } }),
      );
      return ((await response.json()) as { id: string }[]).map((org) => org.id);
    };
    expect(await listFor(one.cookie!)).toEqual(orgsOne);
    expect(await listFor(two.cookie!)).toEqual(orgsTwo);

    // Switching into the other tenant's workspace is refused.
    const hijack = await cloudAuth.handler(
      new Request(`${BASE}/api/auth/organization/set-active`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: one.cookie!, origin: WEB },
        body: JSON.stringify({ organizationId: orgsTwo[0] }),
      }),
    );
    expect(hijack.status).toBeGreaterThanOrEqual(400);

    // Legal acceptance (terms, privacy, health-data consent) is per account.
    const legalOne = await db.execute(
      sql`select "document" from "legal_acceptance" where "user_id" = ${userOne.id} order by "document"`,
    );
    expect(legalOne.rows.map((row) => (row as { document: string }).document)).toEqual([
      "health_data_consent",
      "privacy",
      "terms",
    ]);
  });

  test("Better Auth's own create paths stay closed in cloud mode", async () => {
    const before = await count("user");
    const signUpEmail = await cloudAuth.handler(
      new Request(`${BASE}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "sdk@example.test", password: "hunter2hunter2", name: "x" }),
      }),
    );
    expect(signUpEmail.status).toBeGreaterThanOrEqual(400);

    await cloudAuth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "sdk-magic@example.test" }),
      }),
    );
    const message = [...sentAuthEmail].reverse().find((m) => m.to === "sdk-magic@example.test");
    const token = message?.html?.match(/magic-link\/verify\?token=([^"'&]+)/)?.[1];
    expect(token).toBeDefined();
    await cloudAuth.handler(new Request(`${BASE}/api/auth/magic-link/verify?token=${token}`));
    expect(await count("user")).toBe(before);
  });
});
