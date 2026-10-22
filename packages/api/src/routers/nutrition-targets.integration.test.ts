import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import type { TargetsOverview, UpdateSettingsOutput } from "../contracts/nutrition-targets";
import { findBannedCopy } from "@openvalens/nutrition/nutrition-safety";
import type { ImportRecipeFromUrlOutput } from "../contracts/nutrition-recipe-import";
import { createRecipeImportService } from "../recipe-import/service";
import type { ParseFoodDraftOutput } from "../contracts/nutrition-food-drafts";
import { createFoodDraftService } from "../food-drafts";
import { appRouter } from "./index";

/**
 * `nutritionTargets.*` over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL (Issue #80). Covers the acceptance criteria: targets are
 * user-owned with safe defaults, hide-numbers mode is a per-member setting
 * that never touches data, exclusions and an eating-disorder declaration turn
 * off suggestions without blocking logging, and no returned copy uses a
 * shaming word or a red/green verdict. Weights are synthetic rows in the
 * canonical daily weight table (#87).
 */

const url = process.env.NUTRITION_TARGETS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_targets_test"
  )
    throw new Error("Empty disposable loopback nutrition_targets_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/**
 * A and A2 share org-a; B owns org-b; R is in org-a without weight access;
 * U (declared under 18) owns org-u.
 */
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-a2": { org: "org-a", role: "collaborator" },
  "user-b": { org: "org-b", role: "owner" },
  "user-r": { org: "org-a", role: "collaborator" },
  "user-u": { org: "org-u", role: "owner" },
};
const NO_WEIGHT_READ = new Set(["user-r"]);

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      if (!MEMBERS[id]) return null;
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]?.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const denied = NO_WEIGHT_READ.has(actorOf(headers)) && "weight" in body.permissions;
      return { success: !denied };
    },
  },
} as unknown as Auth;

/**
 * A flat, stable weight over the last 28 days (relative to the database's
 * current date) so the protein reference has a recent body weight to read.
 */
function seedWeight(org: string, userId: string): string {
  return `
    insert into daily_weight (organization_id, user_id, date, weight_kg, source, created_at, updated_at)
      select '${org}', '${userId}', to_char(current_date - i, 'YYYY-MM-DD'), 70, 'auto', now(), now()
      from generate_series(0, 27) i;
  `;
}

describe.skipIf(!url)("nutritionTargets over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_targets_test" });
  const rpc = new RPCHandler(appRouter);
  /** Recipe import (#82) with a fake fetcher: no network in this suite. */
  /** Food drafts (#73) with a fake provider: no network in this suite. */
  const providerCalls: string[] = [];
  const foodDraftService = createFoodDraftService({
    extract: (async (input: { text: string }) => {
      providerCalls.push(input.text);
      return {
        status: "ok",
        attempts: 1,
        model: "test-model",
        data: {
          items: [
            { food: "porridge", quantity: "1", unit: "bowl" },
            { food: "banana", quantity: null, unit: null },
          ],
        },
      };
    }) as never,
  });
  const recipePageFetches: string[] = [];
  const recipeImportService = createRecipeImportService({
    fetchPage: async (target) => {
      recipePageFetches.push(target);
      if (target.endsWith("/robots.txt")) return { ok: false, reason: "http_error", status: 404 };
      return {
        ok: true,
        url: target,
        status: 200,
        contentType: "text/html",
        body: `<script type="application/ld+json">${JSON.stringify({
          "@type": "Recipe",
          name: "Lentil soup",
          recipeIngredient: ["200 g red lentils"],
        })}</script>`,
      };
    },
  });

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: MEMBERS[id]
        ? {
            user: { id },
            session: {
              id: `s-${id}`,
              activeOrganizationId: MEMBERS[id]!.org,
              expiresAt: new Date(Date.now() + 3_600_000),
              impersonatedBy: headers.get("x-test-impersonated") ?? undefined,
            },
          }
        : null,
      db,
      correlationId: "corr-80",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {
        AI_PROVIDER: "anthropic",
        AI_API_KEY: "test-key",
        AI_BASE_URL: null,
        AI_MODEL: "test-model",
        AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
        AI_RATE_LIMIT_PER_MINUTE: 10,
      },
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
      recipeImportService,
      foodDraftService,
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    procedure: string,
    input: unknown,
    user = "user-a",
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({
      "content-type": "application/json",
      "x-test-user": user,
      ...extraHeaders,
    });
    const path = procedure.includes("/") ? procedure : `nutritionTargets/${procedure}`;
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const overview = (localDate: string, user = "user-a") =>
    call<TargetsOverview>("get", { localDate }, user);
  const setTarget = (input: unknown, user = "user-a", extraHeaders = {}) =>
    call("setTarget", input, user, extraHeaders);
  const clearTarget = (input: unknown, user = "user-a") => call("clearTarget", input, user);
  const updateSettings = (input: unknown, user = "user-a", extraHeaders = {}) =>
    call<UpdateSettingsOutput>("updateSettings", input, user, extraHeaders);

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    const users = Object.keys(MEMBERS);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ${users.map((id) => `('${id}', '${id}@example.test')`).join(", ")};
      insert into organization (id, name, slug) values
        ('org-a', 'Record A', 'record-a'), ('org-b', 'Record B', 'record-b'),
        ('org-u', 'Record U', 'record-u');
      insert into member (id, organization_id, user_id, role) values
        ${users.map((id) => `('m-${id}', '${MEMBERS[id]!.org}', '${id}', '${MEMBERS[id]!.role}')`).join(", ")};
      insert into wellness_profile (user_id, revision, eligibility_state, eligibility) values
        ('user-a', 1, 'recorded', 'adult'), ('user-a2', 1, 'recorded', 'adult'),
        ('user-b', 1, 'recorded', 'adult'), ('user-r', 1, 'recorded', 'adult'),
        ('user-u', 1, 'recorded', 'under_18');
      ${seedWeight("org-a", "user-a")}
      ${seedWeight("org-a", "user-a2")}
    `),
    );
    setRegisteredAuth(fakeAuth);
  });

  afterAll(() => clearRegisteredAuth());

  async function resetSettings(userId: string) {
    await db.execute(sql`delete from nutrition_target_settings where user_id = ${userId}`);
  }
  async function resetGoals(userId: string) {
    await db.execute(sql`delete from nutrition_goal where user_id = ${userId}`);
  }

  test("a new member gets safe defaults: maintain, no targets, no auto deficit", async () => {
    await resetSettings("user-a");
    await resetGoals("user-a");
    const result = await overview("2026-03-28");
    expect(result.status).toBe(200);
    const body = result.body;
    expect(body.settings).toEqual({
      revision: 0,
      hideNumbers: false,
      energyDirection: "maintain",
      activeProtein: false,
      streaksEnabled: false,
      recipeImportEnabled: false,
      voiceDraftsEnabled: false,
      heightCm: null,
      declarations: [],
    });
    expect(body.targets).toEqual([]);
    expect(body.targetsOn).toEqual({ localDate: "2026-03-28", targets: [] });
    expect(body.safety.energyTargets).toBe("available");
    expect(body.safety.energySuggestions).toBe("available");
    expect(body.safety.reductionSuggestions).toBe("available");
    expect(body.safety.streaks).toBe("available");
    expect(body.safety.softGates).toEqual([]);
    // Nothing set the target: the default direction is maintain, not a deficit.
    expect(body.notes).toEqual([]);
    // Weight is known, so a protein reference is offered as guidance, not a target.
    expect(body.proteinReference).toMatchObject({ basis: "default", minGPerKg: 0.8 });
  });

  test("targets are entered by the member, source-labelled and date-scoped", async () => {
    await resetGoals("user-a");
    const saved = await setTarget({
      nutrient: "proteinG",
      minAmount: 60,
      effectiveFrom: "2026-03-01",
    });
    expect(saved.status).toBe(200);
    expect((saved.body as { target: Record<string, unknown> }).target).toMatchObject({
      nutrient: "proteinG",
      minAmount: 60,
      maxAmount: null,
      source: "entered",
      effectiveFrom: "2026-03-01",
      effectiveTo: null,
    });

    const energy = await setTarget({
      nutrient: "energyKcal",
      minAmount: 2100,
      maxAmount: 2100,
      effectiveFrom: "2026-03-01",
    });
    expect(energy.status).toBe(200);

    const body = (await overview("2026-03-28")).body;
    const nutrients = body.targets.map((t) => t.nutrient).sort();
    expect(nutrients).toEqual(["energyKcal", "proteinG"]);
    expect(body.targets.every((t) => t.source === "entered")).toBe(true);
    expect(body.targetsOn.targets.map((t) => t.nutrient).sort()).toEqual([
      "energyKcal",
      "proteinG",
    ]);

    // Replacing a target keeps the old one for the days it applied.
    await setTarget({
      nutrient: "energyKcal",
      minAmount: 1900,
      maxAmount: 1900,
      effectiveFrom: "2026-03-15",
    });
    const past = (await overview("2026-03-10")).body;
    expect(past.targetsOn.targets.find((t) => t.nutrient === "energyKcal")).toMatchObject({
      minAmount: 2100,
      effectiveTo: "2026-03-15",
    });
    const today = (await overview("2026-03-20")).body;
    expect(today.targetsOn.targets.find((t) => t.nutrient === "energyKcal")).toMatchObject({
      minAmount: 1900,
      effectiveFrom: "2026-03-15",
    });

    // Clearing ends the active target from the given date; nothing is deleted.
    const cleared = await clearTarget({ nutrient: "energyKcal", effectiveTo: "2026-03-25" });
    expect(cleared.status).toBe(200);
    expect((cleared.body as { cleared: boolean }).cleared).toBe(true);
    const after = (await overview("2026-03-28")).body;
    expect(after.targets.some((t) => t.nutrient === "energyKcal")).toBe(false);
    expect(
      (await overview("2026-03-24")).body.targetsOn.targets.some(
        (t) => t.nutrient === "energyKcal",
      ),
    ).toBe(true);
  });

  test("target input is validated: a bound is needed, min ≤ max, no future start", async () => {
    const noBound = await setTarget({ nutrient: "fiberG", effectiveFrom: "2026-03-01" });
    expect(noBound.status).toBe(400);
    const backwards = await setTarget({
      nutrient: "fiberG",
      minAmount: 40,
      maxAmount: 10,
      effectiveFrom: "2026-03-01",
    });
    expect(backwards.status).toBe(400);
    const future = await setTarget({
      nutrient: "fiberG",
      maxAmount: 40,
      effectiveFrom: "2999-01-01",
    });
    expect(future.status).toBe(400);
  });

  test("reads and writes stay within the session's own org and member", async () => {
    await resetGoals("user-b");
    await setTarget({ nutrient: "proteinG", minAmount: 90, effectiveFrom: "2026-03-01" }, "user-b");
    // A2 shares org-a but is a different member: A2 sees none of A's targets.
    const a2 = (await overview("2026-03-28", "user-a2")).body;
    expect(a2.targets).toEqual([]);
    const other = (await overview("2026-03-28", "user-b")).body;
    expect(other.targets.map((t) => t.minAmount)).toEqual([90]);
  });

  test("writes need the member's own, non-impersonated session", async () => {
    const denied = await setTarget(
      { nutrient: "fatG", maxAmount: 70, effectiveFrom: "2026-03-01" },
      "user-a",
      { "x-test-impersonated": "user-a" },
    );
    expect(denied.status).toBe(403);
  });

  test("sensitive settings reads need the member's own, non-impersonated session", async () => {
    const denied = await call("get", { localDate: "2026-03-28" }, "user-a", {
      "x-test-impersonated": "user-a",
    });
    expect(denied.status).toBe(403);
    expect((await overview("2026-03-28", "user-a")).status).toBe(200);
    // Same-organization and other-organization reads remain scoped to caller.
    expect((await overview("2026-03-28", "user-a2")).body.targets).toEqual([]);
    expect((await overview("2026-03-28", "user-b")).body.targets).toHaveLength(1);
  });

  test("hide-numbers mode is a per-member setting that never touches targets", async () => {
    await resetSettings("user-a");
    await resetGoals("user-a");
    await setTarget({ nutrient: "proteinG", minAmount: 60, effectiveFrom: "2026-03-01" });

    const on = await updateSettings({ expectedRevision: 0, hideNumbers: true });
    expect(on.status).toBe(200);
    if (on.body.outcome !== "updated") throw new Error(`expected updated, got ${on.body.outcome}`);
    expect(on.body.settings.hideNumbers).toBe(true);
    expect(on.body.settings.revision).toBe(1);

    // A stale revision is refused and writes nothing.
    const conflict = await updateSettings({ expectedRevision: 0, hideNumbers: false });
    expect(conflict.body.outcome).toBe("conflict");
    if (conflict.body.outcome !== "conflict") throw new Error("expected conflict");
    expect(conflict.body.settings.hideNumbers).toBe(true);

    // The stored data is unchanged by the display setting.
    const body = (await overview("2026-03-28")).body;
    expect(body.settings.hideNumbers).toBe(true);
    expect(body.targets.map((t) => t.minAmount)).toEqual([60]);

    const off = await updateSettings({ expectedRevision: 1, hideNumbers: false });
    if (off.body.outcome !== "updated") throw new Error("expected updated");
    expect(off.body.settings.hideNumbers).toBe(false);
    expect(off.body.settings.revision).toBe(2);
  });

  test("height and weight give a protein reference; the active opt-in raises it", async () => {
    await resetSettings("user-a");
    await updateSettings({ expectedRevision: 0, heightCm: 175 });
    const body = (await overview("2026-03-28")).body;
    // 70 kg × 0.8 g/kg = 56 g, rounded to 5 g.
    expect(body.proteinReference).toEqual({
      minGPerKg: 0.8,
      maxGPerKg: 0.8,
      minG: 55,
      maxG: 55,
      basis: "default",
    });

    const active = await updateSettings({ expectedRevision: 1, activeProtein: true });
    if (active.body.outcome !== "updated") throw new Error("expected updated");
    const withActive = (await overview("2026-03-28")).body;
    expect(withActive.proteinReference).toMatchObject({
      basis: "active",
      minGPerKg: 1.2,
      maxGPerKg: 1.6,
      minG: 85,
      maxG: 110,
    });
  });

  test("the reference needs weight access: it is left out, not invented", async () => {
    await resetSettings("user-r");
    await updateSettings({ expectedRevision: 0, heightCm: 175 }, "user-r");
    const body = (await overview("2026-03-28", "user-r")).body;
    expect(body.proteinReference).toBeNull();
  });

  test("an exclusion turns off reductions without blocking logging", async () => {
    await resetSettings("user-a");
    const result = await updateSettings({
      expectedRevision: 0,
      declarations: ["pregnant_or_breastfeeding"],
    });
    if (result.body.outcome !== "updated") throw new Error("expected updated");
    expect(result.body.safety.energySuggestions).toBe("available");
    expect(result.body.safety.reductionSuggestions).toBe("off");
    expect(result.body.safety.streaks).toBe("hidden");
    // Logging is unaffected: the diary router still works.
    const log = await call("nutritionDiary/getDay", { localDate: "2026-03-28" }, "user-a");
    expect(log.status).toBe(200);
  });

  test("an eating-disorder declaration turns off energy targets and shows support", async () => {
    await resetSettings("user-a");
    await resetGoals("user-a");
    await setTarget({
      nutrient: "energyKcal",
      minAmount: 2000,
      maxAmount: 2000,
      effectiveFrom: "2026-03-01",
    });

    const declared = await updateSettings({
      expectedRevision: 0,
      declarations: ["eating_disorder"],
    });
    if (declared.body.outcome !== "updated") throw new Error("expected updated");
    expect(declared.body.safety.energyTargets).toBe("off");
    expect(declared.body.safety.energySuggestions).toBe("off");
    expect(declared.body.safety.streaks).toBe("hidden");
    expect(declared.body.disclosure?.helplines.length).toBeGreaterThan(0);

    const body = (await overview("2026-03-28")).body;
    // The stored energy target is hidden, not deleted.
    expect(body.targets.some((t) => t.nutrient === "energyKcal")).toBe(false);
    expect(body.support?.helplines.length).toBeGreaterThan(0);
    const stored = await db.execute(
      sql`select count(*)::int as n from nutrition_goal where user_id = 'user-a' and nutrient = 'energy_kcal'`,
    );
    expect((stored.rows[0] as { n: number }).n).toBe(1);

    const refused = await setTarget({
      nutrient: "energyKcal",
      maxAmount: 1800,
      effectiveFrom: "2026-03-01",
    });
    expect(refused.status).toBe(400);

    // Removing the declaration needs a deliberate, separate confirmation.
    const needsConfirm = await updateSettings({ expectedRevision: 1, declarations: [] });
    expect(needsConfirm.body.outcome).toBe("confirmation_required");
    const confirmed = await updateSettings({
      expectedRevision: 1,
      declarations: [],
      confirmClearEatingDisorder: true,
    });
    if (confirmed.body.outcome !== "updated") throw new Error("expected updated");
    expect(confirmed.body.safety.energyTargets).toBe("available");
  });

  test("chronic kidney disease caps the protein reference", async () => {
    await resetSettings("user-a");
    await updateSettings({ expectedRevision: 0, heightCm: 175 });
    const ckd = await updateSettings({
      expectedRevision: 1,
      declarations: ["chronic_kidney_disease"],
    });
    if (ckd.body.outcome !== "updated") throw new Error("expected updated");
    expect(ckd.body.safety.proteinCapped).toBe(true);
    const body = (await overview("2026-03-28")).body;
    expect(body.proteinReference).toMatchObject({ basis: "kidney_cap", maxGPerKg: 0.8 });
  });

  test("under-18 profiles get no suggestions and no streaks", async () => {
    await resetSettings("user-u");
    const body = (await overview("2026-03-28", "user-u")).body;
    expect(body.safety.energySuggestions).toBe("off");
    expect(body.safety.reductionSuggestions).toBe("off");
    expect(body.safety.streaks).toBe("hidden");
  });

  test("no note or support copy uses a shaming word or a verdict", async () => {
    await resetSettings("user-a");
    const ed = await updateSettings({ expectedRevision: 0, declarations: ["eating_disorder"] });
    if (ed.body.outcome !== "updated") throw new Error("expected updated");
    const body = (await overview("2026-03-28")).body;
    const strings = [
      ...body.notes,
      ...(body.support ? [body.support.text, ...body.support.helplines.map((h) => h.name)] : []),
    ];
    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) expect(findBannedCopy(text)).toEqual([]);
  });
  describe("logging streak (#90)", () => {
    const today = new Date().toISOString().slice(0, 10);
    const daysAgo = (days: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    const streak = (user = "user-b", timeZone = "UTC", extraHeaders = {}) =>
      call<Record<string, unknown>>("loggingStreak", { timeZone }, user, extraHeaders);

    /** Logs one synthetic entry and pins its creation to noon on its own day. */
    async function logDay(localDate: string, user: string, index: number) {
      const result = await call<{ entry: { id: number } }>(
        "nutritionDiary/logEntry",
        {
          clientMutationId: `streak-${user}-${index}`,
          localDate,
          timeZone: "UTC",
          slot: "breakfast",
          food: {
            kind: "manual",
            food: {
              name: "Synthetic oats",
              nutrientBasisAmount: 100,
              nutrientBasisUnit: "g",
              nutrients: { energyKcal: 380 },
            },
          },
          amount: 50,
          unit: "g",
          method: "quick_add",
        },
        user,
      );
      expect(result.status).toBe(200);
      await db.execute(
        sql`update nutrition_meal_entry set created_at = ${`${localDate}T12:00:00Z`}::timestamptz where id = ${result.body.entry.id}`,
      );
    }

    test("off until the member opts in; then derived from their own diary", async () => {
      await resetSettings("user-b");
      expect((await streak()).body).toEqual({ state: "off" });

      for (const [index, days] of [2, 1, 0].entries()) await logDay(daysAgo(days), "user-b", index);
      const enabled = await updateSettings({ expectedRevision: 0, streaksEnabled: true }, "user-b");
      expect(enabled.body.outcome).toBe("updated");
      expect(enabled.body.settings.streaksEnabled).toBe(true);

      expect((await streak()).body).toMatchObject({
        state: "on",
        current: 3,
        freezesAvailable: 2,
        repairAvailableUntil: null,
        lastLoggedDate: today,
      });

      // Another workspace's member never sees user-b's diary.
      await resetSettings("user-a");
      await updateSettings({ expectedRevision: 0, streaksEnabled: true }, "user-a");
      expect((await streak("user-a")).body).toMatchObject({
        state: "on",
        current: 0,
        lastLoggedDate: null,
      });
    });

    test("hide-numbers, any exclusion and an unconfirmed adult hide it entirely", async () => {
      await resetSettings("user-b");
      await updateSettings({ expectedRevision: 0, streaksEnabled: true }, "user-b");
      const hidden = await updateSettings({ expectedRevision: 1, hideNumbers: true }, "user-b");
      expect(hidden.body.outcome).toBe("updated");
      expect((await streak()).body).toEqual({ state: "hidden" });

      await updateSettings(
        { expectedRevision: 2, hideNumbers: false, declarations: ["bariatric_surgery"] },
        "user-b",
      );
      expect((await streak()).body).toEqual({ state: "hidden" });

      // Turning it back on later restores the derived streak: nothing was lost.
      await updateSettings({ expectedRevision: 3, declarations: [] }, "user-b");
      expect((await streak()).body).toMatchObject({ state: "on", current: 3 });

      await resetSettings("user-u");
      await updateSettings({ expectedRevision: 0, streaksEnabled: true }, "user-u");
      expect((await streak("user-u")).body).toEqual({ state: "hidden" });
    });

    test("rejects unknown time zones and impersonated sessions", async () => {
      expect((await streak("user-b", "Mars/Olympus")).status).toBe(400);
      const impersonated = await streak("user-b", "UTC", { "x-test-impersonated": "admin-1" });
      expect(impersonated.status).toBe(403);
    });
  });
  describe("recipe import (#82)", () => {
    const importRecipe = (user = "user-a", extraHeaders: Record<string, string> = {}) =>
      call<ImportRecipeFromUrlOutput>(
        "nutritionRecipeImport/fromUrl",
        { url: "https://recipes.example.test/soup" },
        user,
        extraHeaders,
      );
    const rowCount = async (table: string) =>
      Number((await db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0]!.n);

    test("is off by default, opt-in, and revocable; it never fetches while off", async () => {
      await resetSettings("user-b");
      recipePageFetches.length = 0;
      const off = await importRecipe("user-b");
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ status: "disabled", candidates: [] });
      expect(recipePageFetches).toEqual([]);

      const on = await updateSettings({ expectedRevision: 0, recipeImportEnabled: true }, "user-b");
      expect(on.body.outcome).toBe("updated");
      expect(on.body.settings.recipeImportEnabled).toBe(true);
      const imported = await importRecipe("user-b");
      expect(imported.body.status).toBe("ready");
      expect(imported.body.candidates[0]!.ingredients.map((item) => item.rawText)).toEqual([
        "200 g red lentils",
      ]);

      await updateSettings({ expectedRevision: 1, recipeImportEnabled: false }, "user-b");
      recipePageFetches.length = 0;
      expect((await importRecipe("user-b")).body.status).toBe("disabled");
      expect(recipePageFetches).toEqual([]);
    });

    test("the opt-in is per member: another member stays off", async () => {
      await resetSettings("user-a");
      await resetSettings("user-a2");
      await updateSettings({ expectedRevision: 0, recipeImportEnabled: true }, "user-a");
      expect((await importRecipe("user-a2")).body.status).toBe("disabled");
    });

    test("an import writes nothing: no recipe, meal, entry or food rows", async () => {
      await resetSettings("user-a");
      await updateSettings({ expectedRevision: 0, recipeImportEnabled: true }, "user-a");
      const before = await Promise.all(
        ["nutrition_meal", "nutrition_meal_entry", "nutrition_food"].map(rowCount),
      );
      expect((await importRecipe("user-a")).body.status).toBe("ready");
      const after = await Promise.all(
        ["nutrition_meal", "nutrition_meal_entry", "nutrition_food"].map(rowCount),
      );
      expect(after).toEqual(before);
    });

    test("rejects client-supplied tenant fields, impersonation and signed-out callers", async () => {
      const smuggled = await call(
        "nutritionRecipeImport/fromUrl",
        { url: "https://recipes.example.test/soup", organizationId: "org-b" },
        "user-a",
      );
      expect(smuggled.status).toBe(400);
      expect((await importRecipe("user-a", { "x-test-impersonated": "admin-1" })).status).toBe(403);
      expect((await importRecipe("nobody")).status).toBe(401);
    });
  });
  describe("voice food drafts (#73)", () => {
    const parse = (input: unknown, user = "user-a", extraHeaders: Record<string, string> = {}) =>
      call<ParseFoodDraftOutput>("nutritionFoodDrafts/parse", input, user, extraHeaders);
    const transcript = "Two eggs, a slice of toast and 200g greek yogurt";
    const anthropic = { provider: "anthropic", host: "api.anthropic.com" };
    const entryRows = async () =>
      Number(
        (
          (await db.execute(sql`select count(*)::int as n from nutrition_meal_entry`)).rows[0] as {
            n: number;
          }
        ).n,
      );

    test("is off by default and revocable; nothing is parsed or sent while off", async () => {
      await resetSettings("user-a");
      providerCalls.length = 0;
      expect((await parse({ transcript, mode: "local" })).body).toEqual({
        status: "disabled",
        mode: "local",
        candidates: [],
      });
      expect((await parse({ transcript, mode: "ai", sendToProvider: anthropic })).body.status).toBe(
        "disabled",
      );
      expect(providerCalls).toEqual([]);

      await updateSettings({ expectedRevision: 0, voiceDraftsEnabled: true });
      expect((await parse({ transcript, mode: "local" })).body.status).toBe("ready");
      await updateSettings({ expectedRevision: 1, voiceDraftsEnabled: false });
      expect((await parse({ transcript, mode: "local" })).body.status).toBe("disabled");
    });

    test("local mode returns flagged, unresolved candidates and writes nothing", async () => {
      await resetSettings("user-a");
      await updateSettings({ expectedRevision: 0, voiceDraftsEnabled: true });
      const before = await entryRows();
      const result = await parse({ transcript, mode: "local" });
      expect(
        result.body.candidates.map((c) => [c.foodText, c.quantity, c.unitText, c.flags]),
      ).toEqual([
        ["eggs", 2, null, ["no_unit"]],
        ["toast", 1, "slice", []],
        ["greek yogurt", 200, "g", []],
      ]);
      expect(JSON.stringify(result.body)).not.toMatch(/kcal|energy|protein/i);
      expect(await entryRows()).toBe(before);
      expect((await parse({ transcript: "   ", mode: "local" })).body.status).toBe("empty");
      expect((await parse({ transcript: "2, 3 and 4", mode: "local" })).body.status).toBe(
        "unrecognized",
      );
    });

    test("ai mode sends nothing without a matching, contemporaneous provider confirmation", async () => {
      await resetSettings("user-a");
      await updateSettings({ expectedRevision: 0, voiceDraftsEnabled: true });
      providerCalls.length = 0;
      const provider = await call("nutritionFoodDrafts/provider", {});
      expect(provider.body).toEqual({ available: true, ...anthropic });
      expect((await parse({ transcript, mode: "ai" })).body.status).toBe("consent_required");
      expect(
        (
          await parse({
            transcript,
            mode: "ai",
            sendToProvider: { provider: "anthropic", host: "proxy.example.test" },
          })
        ).body.status,
      ).toBe("consent_required");
      expect(providerCalls).toEqual([]);
    });

    test("ai mode also respects the organization and member AI consent", async () => {
      await resetSettings("user-a");
      await updateSettings({ expectedRevision: 0, voiceDraftsEnabled: true });
      providerCalls.length = 0;
      await db.execute(sql`update organization set metadata = null where id = 'org-a'`);
      expect((await parse({ transcript, mode: "ai", sendToProvider: anthropic })).status).toBe(403);
      expect(providerCalls).toEqual([]);

      await db.execute(
        sql`update organization set metadata = '{"aiConsent":"full"}'::jsonb where id = 'org-a'`,
      );
      await db.execute(sql`delete from user_ai_consent where user_id = 'user-a'`);
      await db.execute(
        sql`insert into user_ai_consent (user_id, granted, consent_version) values ('user-a', true, 'v1')`,
      );
      const result = await parse({ transcript, mode: "ai", sendToProvider: anthropic });
      expect(result.body).toMatchObject({ status: "ready", mode: "ai" });
      expect(
        result.body.candidates.map((c) => [c.foodText, c.quantity, c.unitText, c.flags]),
      ).toEqual([
        ["porridge", 1, "bowl", []],
        ["banana", null, null, ["no_quantity", "no_unit"]],
      ]);
      // Only the transcript text is sent.
      expect(providerCalls).toEqual([transcript]);
    });

    test("rejects tenant fields, impersonation and signed-out callers", async () => {
      expect((await parse({ transcript, mode: "local", organizationId: "org-b" })).status).toBe(
        400,
      );
      expect(
        (await parse({ transcript, mode: "local" }, "user-a", { "x-test-impersonated": "admin-1" }))
          .status,
      ).toBe(403);
      expect((await parse({ transcript, mode: "local" }, "nobody")).status).toBe(401);
    });
  });
});
