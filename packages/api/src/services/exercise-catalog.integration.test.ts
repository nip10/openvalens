import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { eq } from "drizzle-orm";
import { exercise, exerciseTranslation } from "@openvalens/db/schema/exercises";
import { workout, workoutExercise } from "@openvalens/db/schema/plans";
import { RPCHandler } from "@orpc/server/fetch";
import type { Context } from "../context";
import { appRouter } from "../routers/index";

const url = process.env.EXERCISE_CATALOG_API_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/exercise_catalog_api_test"
  )
    throw new Error("Empty disposable loopback exercise_catalog_api_test database required.");
}

const members = {
  "catalog-a": { org: "catalog-org-a", role: "owner" },
  "catalog-b": { org: "catalog-org-b", role: "owner" },
} as const;
const actorOf = (headers: Headers) => headers.get("x-test-user") ?? "catalog-a";
const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: members[id as keyof typeof members].org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: members[id as keyof typeof members].org,
        role: members[id as keyof typeof members].role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: members[actorOf(headers) as keyof typeof members].role,
    }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

async function migrate(db: Database) {
  const existing = await db.execute(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (existing.rows.length)
    throw new Error("Exercise catalog API integration database must be empty.");
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

describe.skipIf(!url)("exercise catalog localized RPC against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/exercise_catalog_api_test" });
  const rpc = new RPCHandler(appRouter);
  let exerciseId = 0;
  let workoutId = 0;

  const contextFor = (headers: Headers): Context => {
    const id = actorOf(headers);
    return {
      session: {
        user: { id },
        session: { activeOrganizationId: members[id as keyof typeof members].org },
      },
      db,
      correlationId: "exercise-catalog-locale-test",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  };

  async function call<T>(path: string, input: unknown, user = "catalog-a") {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error(`Unmatched exercise catalog RPC ${path}`);
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  beforeAll(async () => {
    await migrate(db);
    setRegisteredAuth(fakeAuth);
    for (const [id, member] of Object.entries(members)) {
      await db.execute(sql`insert into "user" (id, email) values (${id}, ${`${id}@example.test`})`);
      await db.execute(
        sql`insert into organization (id, name, slug) values (${member.org}, ${member.org}, ${member.org})`,
      );
      await db.execute(
        sql`insert into member (id, organization_id, user_id, role) values (${`m-${id}`}, ${member.org}, ${id}, ${member.role})`,
      );
    }
    const [global] = await db
      .insert(exercise)
      .values({
        source: "wger",
        externalId: "locale-fixture",
        name: "Fixture row",
        licenseCode: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceRecordUrl: "https://example.test/record",
        snapshotVersion: "locale-fixture-v1",
        snapshotAt: new Date("2026-10-22T00:00:00.000Z"),
      })
      .returning({ id: exercise.id });
    exerciseId = global!.id;
    await db.insert(exerciseTranslation).values([
      {
        exerciseId,
        languageCode: "en",
        name: "Fixture English",
        instructions: "English instructions",
        licenseCode: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceUrl: "https://example.test/en",
      },
      {
        exerciseId,
        languageCode: "fr",
        name: "Fixture FR",
        instructions: "French instructions",
        licenseCode: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceUrl: "https://example.test/fr",
      },
      {
        exerciseId,
        languageCode: "fr-CA",
        name: "Canadian-only translation",
        instructions: "Canadian instructions",
        licenseCode: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceUrl: "https://example.test/fr-ca",
      },
    ]);
    const [otherOrgRow] = await db
      .insert(exercise)
      .values({
        organizationId: members["catalog-b"].org,
        source: "user",
        name: "Other organization base",
      })
      .returning({ id: exercise.id });
    await db.insert(exerciseTranslation).values({
      exerciseId: otherOrgRow!.id,
      languageCode: "fr-CA",
      name: "Other organization translation",
      instructions: "other",
    });
    const [privateWorkout] = await db
      .insert(workout)
      .values({
        organizationId: members["catalog-a"].org,
        date: "2026-10-22",
        type: "weights",
      })
      .returning({ id: workout.id });
    workoutId = privateWorkout!.id;
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("search uses exactly the displayed eligible translation and persists that name on add", async () => {
    const french = await call<Array<{ id: number; name: string; language: string | null }>>(
      "exerciseCatalog/search",
      {
        query: "Fixture FR",
        language: "fr-FR",
      },
    );
    expect(french.status).toBe(200);
    expect(french.body.map(({ id, name, language }) => ({ id, name, language }))).toEqual([
      { id: exerciseId, name: "Fixture FR", language: "fr" },
    ]);
    expect(
      (await call("exerciseCatalog/search", { query: "Fixture row", language: "fr-FR" })).body,
    ).toEqual([]);

    const exactFrench = await call<Array<{ id: number; name: string; language: string | null }>>(
      "exerciseCatalog/search",
      { query: "Canadian-only translation", language: "fr-CA" },
    );
    expect(exactFrench.body.map(({ id, name, language }) => ({ id, name, language }))).toEqual([
      { id: exerciseId, name: "Canadian-only translation", language: "fr-CA" },
    ]);
    expect(
      (await call("exerciseCatalog/search", { query: "Fixture FR", language: "fr-CA" })).body,
    ).toEqual([]);
    const englishFallback = await call<
      Array<{ id: number; name: string; language: string | null }>
    >("exerciseCatalog/search", { query: "Fixture English", language: "es-MX" });
    expect(englishFallback.body.map(({ id, name, language }) => ({ id, name, language }))).toEqual([
      { id: exerciseId, name: "Fixture English", language: "en" },
    ]);

    const request = {
      clientMutationId: "8ab1e3f3-13a4-4e62-91d8-998a11fe0011",
      workoutId,
      exerciseId,
      language: "fr-FR",
    };
    const added = await call<{ id: number; name: string; sortOrder: number }>(
      "exerciseCatalog/addFromLibrary",
      request,
    );
    expect(added.status).toBe(200);
    expect(added.body.name).toBe("Fixture FR");
    const persisted = await db
      .select({
        id: workoutExercise.id,
        exerciseId: workoutExercise.exerciseId,
        name: workoutExercise.name,
      })
      .from(workoutExercise)
      .where(eq(workoutExercise.id, added.body.id));
    expect(persisted).toEqual([{ id: added.body.id, exerciseId, name: "Fixture FR" }]);
    const replay = await call<{ id: number; name: string }>(
      "exerciseCatalog/addFromLibrary",
      request,
    );
    expect(replay.body).toMatchObject({ id: added.body.id, name: "Fixture FR" });
    const conflictingReplay = await call("exerciseCatalog/addFromLibrary", {
      ...request,
      language: "fr-CA",
    });
    expect(conflictingReplay.status).toBe(409);

    await db.execute(
      sql`update exercise_translation set license_code = null where exercise_id = ${exerciseId} and language_code = 'fr-CA'`,
    );
    await db.execute(
      sql`update exercise_translation set license_code = 'CC-BY-SA-4.0', author = null where exercise_id = ${exerciseId} and language_code = 'fr'`,
    );
    const fallbackEnglish = await call<
      Array<{ id: number; name: string; language: string | null }>
    >("exerciseCatalog/search", { query: "Fixture English", language: "fr-FR" });
    expect(fallbackEnglish.body.map(({ id, name, language }) => ({ id, name, language }))).toEqual([
      { id: exerciseId, name: "Fixture English", language: "en" },
    ]);
    expect(
      (await call("exerciseCatalog/search", { query: "Fixture FR", language: "fr-FR" })).body,
    ).toEqual([]);

    const custom = await call<{ id: number; name: string }>("exerciseCatalog/createCustom", {
      clientMutationId: "8ab1e3f3-13a4-4e62-91d8-998a11fe0012",
      name: "Private custom translation",
      language: "fr-CA",
      instructions: "custom",
    });
    expect(custom.status).toBe(200);
    const privateMatches = await call<Array<{ id: number; name: string; language: string | null }>>(
      "exerciseCatalog/search",
      { query: "Private custom translation", language: "fr-CA" },
    );
    expect(privateMatches.body.some((row) => row.name === "Private custom translation")).toBe(true);
    expect(
      (
        await call(
          "exerciseCatalog/search",
          { query: "Private custom translation", language: "fr-CA" },
          "catalog-b",
        )
      ).body,
    ).toEqual([]);
    expect(
      (
        await call("exerciseCatalog/search", {
          query: "Other organization translation",
          language: "fr-CA",
        })
      ).body,
    ).toEqual([]);
  });
});
