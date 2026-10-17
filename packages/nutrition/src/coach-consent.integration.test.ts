import { readdir } from "node:fs/promises";

import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql, type Database } from "@openvalens/db";

import {
  createNutritionCoachConsent,
  NUTRITION_COACH_CONSENT_VERSION,
  NutritionCoachConsentError,
  readNutritionCoachConsent,
} from "./coach-consent";
import type { NutritionScope } from "./repository";

// Set NUTRITION_COACH_CONSENT_TEST_DATABASE_URL to an EMPTY disposable
// loopback `nutrition_coach_consent_test` database (scripts/test-integration.sh
// does this). All data is synthetic.

const url = process.env.NUTRITION_COACH_CONSENT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_coach_consent_test"
  )
    throw new Error("Empty disposable loopback nutrition_coach_consent_test database required.");
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

const A: NutritionScope = { organizationId: "org-cch-a", userId: "user-cch-a" };
/** A collaborator in A's organization with their own consent row. */
const A2: NutritionScope = { organizationId: "org-cch-a", userId: "user-cch-a2" };
/** A different workspace entirely. */
const B: NutritionScope = { organizationId: "org-cch-b", userId: "user-cch-b" };

async function requireCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof NutritionCoachConsentError) return error.code;
    return "OTHER";
  }
  return "NONE";
}

describe.skipIf(!url)("nutrition coach consent against disposable PostgreSQL", () => {
  const db = createDb({
    DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_coach_consent_test",
  });
  const consent = createNutritionCoachConsent(db);

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-cch-a', 'cch-a@example.test'), ('user-cch-a2', 'cch-a2@example.test'),
        ('user-cch-b', 'cch-b@example.test');
      insert into organization (id, name, slug) values
        ('org-cch-a', 'Consent A', 'consent-a'), ('org-cch-b', 'Consent B', 'consent-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-cch-a', 'org-cch-a', 'user-cch-a', 'owner'),
        ('m-cch-a2', 'org-cch-a', 'user-cch-a2', 'collaborator'),
        ('m-cch-b', 'org-cch-b', 'user-cch-b', 'owner');
    `),
    );
  });

  test("there is no consent until the member grants one", async () => {
    expect(await consent.get(A)).toBeNull();
    expect(await readNutritionCoachConsent(db, A)).toBeNull();
    expect(await requireCode(() => consent.require(A))).toBe("CONSENT_REQUIRED");
  });

  test("grant records the current version and the member's numbers choice", async () => {
    const state = await consent.grant(A, { includeNumbers: false });
    expect(state).toMatchObject({
      granted: true,
      includeNumbers: false,
      revokedAt: null,
      consentVersion: NUTRITION_COACH_CONSENT_VERSION,
    });
    expect(typeof state.grantedAt).toBe("string");

    await expect(consent.require(A)).resolves.toMatchObject({ granted: true });
  });

  test("re-granting updates the numbers choice in place", async () => {
    const state = await consent.grant(A, { includeNumbers: true });
    expect(state.includeNumbers).toBe(true);
    const rows = await db.execute(
      sql`select count(*)::int as n from nutrition_coach_consent where organization_id = ${A.organizationId} and user_id = ${A.userId}`,
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  test("revoking stops usage immediately and clears the numbers choice", async () => {
    const state = await consent.revoke(A);
    expect(state.granted).toBe(false);
    expect(state.includeNumbers).toBe(false);
    expect(state.revokedAt).not.toBeNull();
    expect(await requireCode(() => consent.require(A))).toBe("CONSENT_REQUIRED");
  });

  test("a grant at an outdated disclosure version fails closed", async () => {
    await db.execute(
      sql`update nutrition_coach_consent set granted = true, revoked_at = null, consent_version = 'v0'
          where organization_id = ${A.organizationId} and user_id = ${A.userId}`,
    );
    expect(await requireCode(() => consent.require(A))).toBe("CONSENT_REQUIRED");
    // Re-granting at the current version repairs it.
    await consent.grant(A, { includeNumbers: false });
    await expect(consent.require(A)).resolves.toMatchObject({
      consentVersion: NUTRITION_COACH_CONSENT_VERSION,
    });
  });

  test("consent never leaks across members or workspaces", async () => {
    await consent.grant(A, { includeNumbers: true });
    // Another member of the same workspace is untouched...
    expect(await consent.get(A2)).toBeNull();
    expect(await requireCode(() => consent.require(A2))).toBe("CONSENT_REQUIRED");
    // ...and so is another workspace.
    expect(await consent.get(B)).toBeNull();
  });
});
