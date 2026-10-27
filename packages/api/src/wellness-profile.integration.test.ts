import { readdir } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Session } from "@openvalens/auth";
import { deleteSubjectData } from "@openvalens/data-rights/delete";
import { exportSubjectData } from "@openvalens/data-rights/export";
import { createDb, sql } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";
import { createWellnessProfileService } from "./wellness-profile";

/**
 * Issue #98 — wellness profile over the real RPC boundary against a
 * disposable PostgreSQL.
 *
 * Guarded by `WELLNESS_PROFILE_TEST_DATABASE_URL`, which must point at an
 * *empty* loopback database named `wellness_profile_test`. Registered in
 * `scripts/test-integration.sh`. All data is synthetic.
 */
const url = process.env.WELLNESS_PROFILE_TEST_DATABASE_URL;

if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/wellness_profile_test"
  ) {
    throw new Error("Empty disposable loopback wellness_profile_test database required.");
  }
}

const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/wellness_profile_test" });

if (url) {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) throw new Error("Integration database must be empty.");
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }
}

function sessionFor(userId: string, overrides: { impersonatedBy?: string | null } = {}): Session {
  return {
    user: { id: userId, email: `${userId}@example.test`, name: null },
    session: {
      id: `sess-${userId}`,
      userId,
      activeOrganizationId: `org-${userId}`,
      impersonatedBy: overrides.impersonatedBy ?? null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  } as unknown as Session;
}

const rpc = new RPCHandler(appRouter);

function contextFor(headers: Headers, session: unknown): Context {
  return {
    session,
    db,
    correlationId: "corr-profile",
    cronSecret: "cron-secret-long-enough-value",
    betterAuthSecretConfigured: true,
    capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
    telegram: { connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      AI_PROVIDER: null,
      AI_API_KEY: null,
      AI_BASE_URL: null,
      AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
      AI_MODEL: "test-model",
      AI_RATE_LIMIT_PER_MINUTE: 20,
    },
    aiRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
    honoContext: { req: { raw: { headers } } },
  } as unknown as Context;
}

type RpcResult = { status: number; json: Record<string, unknown> };

async function call(path: "get" | "update", body: unknown, session: unknown): Promise<RpcResult> {
  const headers = new Headers({ "content-type": "application/json" });
  const request = new Request(`http://test.local/rpc/profile/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ json: body }),
  });
  const { matched, response } = await rpc.handle(request, {
    prefix: "/rpc",
    context: contextFor(headers, session),
  });
  if (!matched || !response) throw new Error("unmatched RPC path");
  const parsed = (await response.json()) as { json: Record<string, unknown> };
  return { status: response.status, json: parsed.json };
}

async function seedPerson(who: string): Promise<void> {
  await db.execute(
    sql.raw(`
    insert into "user" (id, email) values ('${who}', '${who}@example.test');
    insert into organization (id, name, slug) values ('org-${who}', 'Record ${who}', 'record-${who}');
    insert into member (id, organization_id, user_id, role) values ('m-${who}', 'org-${who}', '${who}', 'owner');
  `),
  );
}

async function reset(): Promise<void> {
  await db.execute(sql`delete from "wellness_profile_consent"`);
  await db.execute(sql`delete from "wellness_profile"`);
  await db.execute(sql`delete from "member"`);
  await db.execute(sql`delete from "organization"`);
  await db.execute(sql`delete from "user"`);
}

const ADULT_WITH_AGE = {
  eligibility: { state: "recorded", value: "adult" },
  consents: { age_band: "grant", sex: "grant" },
  birthYear: { state: "recorded", value: 1983 },
  sex: { state: "recorded", value: "female" },
};

describe.skipIf(!url)("wellness profile over RPC (PostgreSQL)", () => {
  let logged: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  beforeAll(() => {
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
  });

  beforeEach(async () => {
    logged = [];
    await reset();
    await seedPerson("user-a");
    await seedPerson("user-b");
  });

  afterEach(() => {
    logged = [];
  });

  test("anonymous calls are rejected", async () => {
    expect((await call("get", {}, null)).status).toBe(401);
    expect((await call("update", { expectedRevision: 0 }, null)).status).toBe(401);
  });

  test("impersonated sessions are denied", async () => {
    const impersonated = sessionFor("user-a", { impersonatedBy: "admin-x" });
    expect((await call("get", {}, impersonated)).status).toBe(403);
    const update = await call(
      "update",
      { expectedRevision: 0, setupStatus: "skipped" },
      impersonated,
    );
    expect(update.status).toBe(403);
    const rows = await db.execute(sql`select count(*)::int as n from wellness_profile`);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  test("a new person reads an empty profile; skip reaches the app without any answer", async () => {
    const empty = await call("get", {}, sessionFor("user-a"));
    expect(empty.status).toBe(200);
    expect(empty.json).toMatchObject({
      revision: 0,
      setupStatus: null,
      eligibility: { state: "unknown" },
      sex: { state: "unknown" },
      consents: { age_band: null, sex: null },
    });

    const skipped = await call(
      "update",
      { expectedRevision: 0, setupStatus: "skipped" },
      sessionFor("user-a"),
    );
    expect(skipped.status).toBe(200);
    expect(skipped.json).toMatchObject({
      revision: 1,
      setupStatus: "skipped",
      eligibility: { state: "unknown" },
    });
  });

  test("enabled modules: null until chosen, stored in order, kept by other updates", async () => {
    const a = sessionFor("user-a");
    const fresh = await call("get", {}, a);
    expect(fresh.json.enabledModules).toBeNull();

    const chosen = await call(
      "update",
      { expectedRevision: 0, enabledModules: ["food", "sleep", "care"] },
      a,
    );
    expect(chosen.status).toBe(200);
    expect(chosen.json).toMatchObject({ revision: 1, enabledModules: ["sleep", "food", "care"] });

    const other = await call(
      "update",
      { expectedRevision: 1, region: { state: "recorded", value: "pt" } },
      a,
    );
    expect(other.json).toMatchObject({ revision: 2, enabledModules: ["sleep", "food", "care"] });

    // The same set again is not a change (no revision bump).
    const same = await call(
      "update",
      { expectedRevision: 2, enabledModules: ["care", "food", "sleep"] },
      a,
    );
    expect(same.json).toMatchObject({ revision: 2 });

    const none = await call("update", { expectedRevision: 2, enabledModules: [] }, a);
    expect(none.json).toMatchObject({ revision: 3, enabledModules: [] });
    expect((await call("get", {}, sessionFor("user-b"))).json.enabledModules).toBeNull();

    const bad = await call("update", { expectedRevision: 3, enabledModules: ["weight"] }, a);
    expect(bad.status).toBe(400);
    expect(logged.join("")).not.toContain('"sleep"');
  });

  test("the database refuses unknown module ids", async () => {
    await db.execute(sql`insert into wellness_profile (user_id) values ('user-a')`);
    // db.execute returns a lazy query; await it inside an async function so the
    // rejection is what the assertion sees.
    await expect(
      (async () =>
        await db.execute(
          sql`update wellness_profile set enabled_modules = array['weight']::text[] where user_id = 'user-a'`,
        ))(),
    ).rejects.toThrow();
  });

  test("partial updates keep omitted fields; explicit unknown clears", async () => {
    const a = sessionFor("user-a");
    await call(
      "update",
      {
        expectedRevision: 0,
        focus: { state: "recorded", value: ["sleep_recovery", "nutrition"] },
        region: { state: "recorded", value: "uk" },
      },
      a,
    );
    const partial = await call(
      "update",
      { expectedRevision: 1, inputMethod: { state: "recorded", value: "manual" } },
      a,
    );
    expect(partial.json).toMatchObject({
      revision: 2,
      focus: { state: "recorded", value: ["sleep_recovery", "nutrition"] },
      region: { state: "recorded", value: "uk" },
      inputMethod: { state: "recorded", value: "manual" },
    });

    const cleared = await call("update", { expectedRevision: 2, region: { state: "unknown" } }, a);
    expect(cleared.json).toMatchObject({
      revision: 3,
      region: { state: "unknown" },
      focus: { state: "recorded", value: ["sleep_recovery", "nutrition"] },
      inputMethod: { state: "recorded", value: "manual" },
    });
  });

  test("stale revision conflicts without writing; an identical retry succeeds idempotently", async () => {
    const a = sessionFor("user-a");
    const first = await call(
      "update",
      { expectedRevision: 0, region: { state: "recorded", value: "pt" } },
      a,
    );
    expect(first.json.revision).toBe(1);

    // The client retries the same request after a lost response.
    const retry = await call(
      "update",
      { expectedRevision: 0, region: { state: "recorded", value: "pt" } },
      a,
    );
    expect(retry.status).toBe(200);
    expect(retry.json.revision).toBe(1);

    // A different change on the stale revision conflicts and writes nothing.
    const stale = await call(
      "update",
      { expectedRevision: 0, region: { state: "recorded", value: "us" } },
      a,
    );
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: "CONFLICT" });
    const after = await call("get", {}, a);
    expect(after.json).toMatchObject({ revision: 1, region: { state: "recorded", value: "pt" } });
  });

  test("server validation: strict input, adult policy, consent and birth year", async () => {
    const a = sessionFor("user-a");
    for (const body of [
      { expectedRevision: 0, userId: "user-b", region: { state: "recorded", value: "us" } },
      { expectedRevision: 0, region: { state: "recorded", value: "fr" } },
      { expectedRevision: 0, birthYear: { state: "recorded", value: -1980 } },
      { expectedRevision: 0, focus: { state: "recorded", value: [] } },
    ]) {
      const result = await call("update", body, a);
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ code: "INVALID_INPUT" });
    }

    const noAdult = await call(
      "update",
      {
        expectedRevision: 0,
        consents: { age_band: "grant" },
        birthYear: { state: "recorded", value: 1980 },
      },
      a,
    );
    expect(noAdult.status).toBe(400);
    expect(noAdult.json).toMatchObject({
      data: { reason: "ADULT_CONFIRMATION_REQUIRED", field: "birthYear" },
    });

    const noConsent = await call(
      "update",
      {
        expectedRevision: 0,
        eligibility: { state: "recorded", value: "adult" },
        sex: { state: "recorded", value: "male" },
      },
      a,
    );
    expect(noConsent.json).toMatchObject({ data: { reason: "CONSENT_REQUIRED", field: "sex" } });

    const minor = await call(
      "update",
      {
        expectedRevision: 0,
        eligibility: { state: "recorded", value: "adult" },
        consents: { age_band: "grant" },
        birthYear: { state: "recorded", value: 2012 },
      },
      a,
    );
    expect(minor.json).toMatchObject({ data: { reason: "BIRTH_YEAR_UNDER_18" } });
    // The error envelope never echoes the submitted value.
    expect(JSON.stringify(minor.json)).not.toContain("2012");

    // Rejected requests write nothing — not even the consent they carried.
    const consentRows = await db.execute(
      sql`select count(*)::int as n from wellness_profile_consent`,
    );
    expect((consentRows.rows[0] as { n: number }).n).toBe(0);
    const profile = await call("get", {}, a);
    expect(profile.json).toMatchObject({ revision: 0, eligibility: { state: "unknown" } });
  });

  test("consent is versioned per purpose; withdrawal clears only its value", async () => {
    const a = sessionFor("user-a");
    const saved = await call("update", { expectedRevision: 0, ...ADULT_WITH_AGE }, a);
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      birthYear: { state: "recorded", value: 1983 },
      sex: { state: "recorded", value: "female" },
      consents: {
        age_band: { active: true, version: "2026-10-15", withdrawnAt: null },
        sex: { active: true, version: "2026-10-15", withdrawnAt: null },
      },
    });

    const withdrawn = await call(
      "update",
      { expectedRevision: 1, consents: { age_band: "withdraw" } },
      a,
    );
    expect(withdrawn.json).toMatchObject({
      revision: 2,
      birthYear: { state: "unknown" },
      sex: { state: "recorded", value: "female" },
      consents: { age_band: { active: false }, sex: { active: true } },
    });

    // Re-granting appends a new record; history is kept.
    await call("update", { expectedRevision: 2, consents: { age_band: "grant" } }, a);
    const history = await db.execute(
      sql`select purpose, withdrawn_at is null as active from wellness_profile_consent where user_id = 'user-a' order by granted_at, purpose`,
    );
    expect(history.rows.filter((r) => (r as { purpose: string }).purpose === "age_band")).toEqual([
      { purpose: "age_band", active: false },
      { purpose: "age_band", active: true },
    ]);
  });

  test("changing the adult answer to under 18 clears adult-only values", async () => {
    const a = sessionFor("user-a");
    await call("update", { expectedRevision: 0, ...ADULT_WITH_AGE }, a);
    const minor = await call(
      "update",
      { expectedRevision: 1, eligibility: { state: "recorded", value: "under_18" } },
      a,
    );
    expect(minor.json).toMatchObject({
      eligibility: { state: "recorded", value: "under_18" },
      birthYear: { state: "unknown" },
      sex: { state: "unknown" },
    });
  });

  test("ownership: each person only ever reads and writes their own profile", async () => {
    await call("update", { expectedRevision: 0, ...ADULT_WITH_AGE }, sessionFor("user-a"));

    // B is a collaborator in A's workspace and has A's org active.
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-b-in-a', 'org-user-a', 'user-b', 'collaborator')`,
    );
    const bInA = {
      ...sessionFor("user-b"),
      session: { ...sessionFor("user-b").session, activeOrganizationId: "org-user-a" },
    };
    const bRead = await call("get", {}, bInA);
    expect(bRead.json).toMatchObject({ revision: 0, birthYear: { state: "unknown" } });

    await call("update", { expectedRevision: 0, region: { state: "recorded", value: "us" } }, bInA);
    const aAfter = await call("get", {}, sessionFor("user-a"));
    expect(aAfter.json).toMatchObject({
      revision: 1,
      region: { state: "unknown" },
      birthYear: { state: "recorded", value: 1983 },
    });
  });

  test("logs carry field names, never values", async () => {
    await call("update", { expectedRevision: 0, ...ADULT_WITH_AGE }, sessionFor("user-a"));
    const lines = logged.filter((line) => line.includes("profile.updated"));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("birthYear");
    expect(lines[0]).not.toContain("1983");
    expect(lines[0]).not.toContain("female");
    expect(lines[0]).not.toContain("user-a@example.test");
  });

  test("the database refuses contradictory state pairs", async () => {
    await db.execute(sql`insert into wellness_profile (user_id) values ('user-a')`);
    for (const statement of [
      sql`update wellness_profile set sex_state = 'declined', sex = 'male' where user_id = 'user-a'`,
      sql`update wellness_profile set sex_state = 'recorded' where user_id = 'user-a'`,
      sql`update wellness_profile set focus_state = 'recorded', focus_areas = array['cut']::text[] where user_id = 'user-a'`,
      sql`update wellness_profile set birth_year_state = 'recorded', birth_year = -1990 where user_id = 'user-a'`,
    ]) {
      let failed = false;
      try {
        await db.execute(statement);
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    }
  });

  test("data rights: export includes only the subject's profile; delete erases it", async () => {
    await call("update", { expectedRevision: 0, ...ADULT_WITH_AGE }, sessionFor("user-a"));
    await call(
      "update",
      { expectedRevision: 0, region: { state: "recorded", value: "us" } },
      sessionFor("user-b"),
    );

    const exported = await exportSubjectData(db, {
      userId: "user-a",
      organizationIds: ["org-user-a"],
    });
    const file = (table: string) =>
      JSON.parse(exported.files.find((f) => f.path === `entities/${table}.json`)!.content) as {
        user_id: string;
      }[];
    expect(file("wellness_profile").map((r) => r.user_id)).toEqual(["user-a"]);
    expect(file("wellness_profile_consent").map((r) => r.user_id)).toEqual(["user-a", "user-a"]);

    await deleteSubjectData(db, { userId: "user-a", organizationIds: ["org-user-a"] });
    const remaining = await db.execute(
      sql`select user_id from wellness_profile union all select user_id from wellness_profile_consent`,
    );
    expect(remaining.rows).toEqual([{ user_id: "user-b" }]);
  });

  test("concurrent writes on one revision: one wins, the other conflicts", async () => {
    const service = createWellnessProfileService({ db });
    const results = await Promise.allSettled([
      service.update("user-a", { expectedRevision: 0, region: { state: "recorded", value: "us" } }),
      service.update("user-a", { expectedRevision: 0, region: { state: "recorded", value: "uk" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { code: string }).code).toBe("CONFLICT");
  });
});
