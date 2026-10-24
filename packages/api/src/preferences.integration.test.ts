import { msg } from "@lingui/core/macro";
import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { readLocaleForEmail, readUserLocale, serverI18n } from "./locale";
import { appRouter } from "./routers/index";

/**
 * `preferences.*` over HTTP against a disposable PostgreSQL (Issue #231): the
 * member's own interface language, read back by the server helpers that pick
 * the language of email and push.
 */

const url = process.env.PREFERENCES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/preferences_test"
  )
    throw new Error("Empty disposable loopback preferences_test database required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-a", role: "owner" },
  "user-d": { org: "org-b", role: "owner" },
};
const noWeightAccess = new Set<string>();
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          impersonatedBy: headers.get("x-test-impersonated") ?? null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      const member = MEMBERS[id];
      return member
        ? { id: `m-${id}`, userId: id, organizationId: member.org, role: member.role }
        : null;
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actor(headers)]?.role,
    }),
    hasPermission: async ({ headers }: { headers: Headers }) => ({
      success: !noWeightAccess.has(actor(headers)),
    }),
  },
} as unknown as Auth;

describe.skipIf(!url)("preferences over RPC and PostgreSQL", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/preferences_test" });
  const rpc = new RPCHandler(appRouter);

  async function migrate() {
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const folder of (await readdir(root)).sort()) {
      if (!/^\d/.test(folder)) continue;
      const contents = await Bun.file(new URL(`${folder}/migration.sql`, root)).text();
      for (const statement of contents.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }

  function contextFor(headers: Headers): Context {
    const id = actor(headers);
    return {
      session: MEMBERS[id]
        ? {
            user: { id },
            session: {
              id: `s-${id}`,
              userId: id,
              activeOrganizationId: MEMBERS[id]!.org,
              impersonatedBy: headers.get("x-test-impersonated") ?? null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-preferences",
      cronSecret: "synthetic-cron-secret-long-enough",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call(
    path: string,
    input: unknown,
    user = "user-a",
    extra: Record<string, string> = {},
  ) {
    const headers = new Headers({
      "content-type": "application/json",
      "x-test-user": user,
      ...extra,
    });
    const request = new Request(`http://test.local/rpc/preferences/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched preferences RPC path");
    const body = (await response.json()) as { json: unknown };
    return { status: response.status, body: body.json };
  }

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
  });

  beforeEach(async () => {
    noWeightAccess.clear();
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(sql`insert into "user" (id, email) values
      ('user-a', 'user-a@example.test'), ('user-b', 'user-b@example.test'),
      ('user-c', 'user-c@example.test'), ('user-d', 'user-d@example.test')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-a', 'Synthetic A', 'synthetic-a'), ('org-b', 'Synthetic B', 'synthetic-b')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', 'org-a', 'user-a', 'owner'), ('m-b', 'org-a', 'user-b', 'collaborator'),
      ('m-c', 'org-a', 'user-c', 'owner'), ('m-d', 'org-b', 'user-d', 'owner')`);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("defaults to English, stores a shipped locale and reads it back", async () => {
    expect(await call("get", {})).toMatchObject({ status: 200, body: { locale: "en" } });
    expect(await readUserLocale(db, "user-a")).toBe("en");

    expect(await call("setLocale", { locale: "pt-PT" })).toMatchObject({
      status: 200,
      body: { locale: "pt-PT" },
    });
    expect(await call("get", {})).toMatchObject({ body: { locale: "pt-PT" } });
    expect(await readUserLocale(db, "user-a")).toBe("pt-PT");
    // Mail addressed by email finds the same member, case-insensitively.
    expect(await readLocaleForEmail(db, "USER-A@example.test")).toBe("pt-PT");
    expect(await readLocaleForEmail(db, "nobody@example.test")).toBe("en");
    // Another member is unaffected.
    expect(await readUserLocale(db, "user-b")).toBe("en");

    expect(await call("setLocale", { locale: "en" })).toMatchObject({ body: { locale: "en" } });
    expect(await readUserLocale(db, "user-a")).toBe("en");
  });

  test("renders server text through the shipped catalogs", () => {
    const settings = msg`Settings`;
    expect(serverI18n("pt-PT")._(settings)).toBe("Definições");
    expect(serverI18n("en")._(settings)).toBe("Settings");
  });

  test("rejects unsupported locales, other users, impersonation and signed-out callers", async () => {
    expect((await call("setLocale", { locale: "pt-BR" })).status).toBe(400);
    expect((await call("setLocale", { locale: "pt-PT", userId: "user-b" })).status).toBe(400);
    expect(
      (await call("setLocale", { locale: "pt-PT" }, "user-a", { "x-test-impersonated": "admin" }))
        .status,
    ).toBe(403);
    expect((await call("get", {}, "nobody")).status).toBe(401);
    expect(await readUserLocale(db, "user-a")).toBe("en");
  });
});
