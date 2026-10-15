import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import type { CustomFood, CustomFoodContent } from "../contracts/nutrition-custom-foods";
import type { DiaryEntry, FoodChoice } from "../contracts/nutrition-diary";
import { appRouter } from "./index";

/**
 * `nutritionCustomFoods.*` over HTTP (oRPC `RPCHandler`) against a
 * disposable PostgreSQL (Issue #81): private ownership across members and
 * workspaces, owner override attempts, null/zero/unit preservation,
 * retry-safe create/edit/archive, and logged meals that never change when
 * their food is edited or archived. All data is synthetic.
 */

const url = process.env.NUTRITION_CUSTOM_FOODS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_custom_foods_test"
  )
    throw new Error("Empty disposable loopback nutrition_custom_foods_test database required.");
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

/** A and A2 share workspace org-a (V is a viewer there); B owns org-b. */
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-a2": { org: "org-a", role: "collaborator" },
  "user-b": { org: "org-b", role: "owner" },
  "user-v": { org: "org-a", role: "viewer" },
};

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
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
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]!.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const role = MEMBERS[actorOf(headers)]!.role;
      const actions = Object.values(body.permissions).flat();
      return { success: role !== "viewer" || actions.every((action) => action === "read") };
    },
  },
} as unknown as Auth;

const DAY = "2026-10-12";
const BARCODE = "4006381333931";

/** Synthetic bread: per 100 g, one slice = 40 g; zero sugar recorded, fibre unknown. */
const bread: CustomFoodContent = {
  name: "Synthetic rye bread",
  brand: "Test bakery",
  barcode: BARCODE,
  nutrientBasisAmount: 100,
  nutrientBasisUnit: "g",
  servingSizeAmount: 40,
  servingSizeUnit: "g",
  servingLabel: "1 slice",
  nutrients: { energyKcal: 250, proteinG: 8, addedSugarsG: 0 },
};

type Outcome =
  | { outcome: "applied" | "unchanged"; food: CustomFood; targetId: string }
  | { outcome: "conflict"; server: CustomFood; targetId: string };

describe.skipIf(!url)("nutritionCustomFoods over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_custom_foods_test" });
  const rpc = new RPCHandler(appRouter);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } },
      db,
      correlationId: "corr-81",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    path: string,
    input: unknown,
    user = "user-a",
  ): Promise<{ status: number; body: T }> {
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
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const foods = (path: string, input: unknown, user = "user-a") =>
    call(`nutritionCustomFoods/${path}`, input, user);

  const create = async (clientMutationId: string, food = bread, user = "user-a") =>
    (await call<{ food: CustomFood; created: boolean }>(
      "nutritionCustomFoods/create",
      { clientMutationId, food },
      user,
    )) as { status: number; body: { food: CustomFood; created: boolean } };

  const list = async (user = "user-a", includeArchived = false) =>
    (await call<{ foods: CustomFood[] }>("nutritionCustomFoods/list", { includeArchived }, user))
      .body.foods;

  const logCustom = (foodId: number, clientMutationId: string, user = "user-a") =>
    call<{ entry: DiaryEntry }>(
      "nutritionDiary/logEntry",
      {
        clientMutationId,
        localDate: DAY,
        timeZone: "Europe/Lisbon",
        slot: "breakfast",
        food: { kind: "custom", foodId },
        amount: 2,
        unit: "serving",
        method: "manual",
      },
      user,
    );

  const day = async (user = "user-a") =>
    (await call<{ entries: DiaryEntry[] }>("nutritionDiary/getDay", { localDate: DAY }, user)).body
      .entries;

  const count = async (table: string) =>
    Number(
      (
        (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0] as {
          n: number;
        }
      ).n,
    );

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-a', 'a@example.test'), ('user-a2', 'a2@example.test'),
        ('user-b', 'b@example.test'), ('user-v', 'v@example.test');
      insert into organization (id, name, slug) values
        ('org-a', 'Record A', 'record-a'), ('org-b', 'Record B', 'record-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-user-a', 'org-a', 'user-a', 'owner'), ('m-user-a2', 'org-a', 'user-a2', 'collaborator'),
        ('m-user-b', 'org-b', 'user-b', 'owner'), ('m-user-v', 'org-a', 'user-v', 'viewer');
    `),
    );
    setRegisteredAuth(fakeAuth);
  });

  afterAll(() => clearRegisteredAuth());

  let breadId = 0;

  test("create keeps nulls, zeros, units and provenance distinct", async () => {
    const { status, body } = await create("food-1");
    expect(status).toBe(200);
    expect(body.created).toBe(true);
    breadId = body.food.id;
    expect(body.food).toMatchObject({
      sourceQualifiedId: `custom:${breadId}`,
      provenance: "user_entered",
      name: "Synthetic rye bread",
      brand: "Test bakery",
      barcode: BARCODE,
      revision: 1,
      archived: false,
      basis: {
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g",
        servingSizeAmount: 40,
        servingSizeUnit: "g",
        servingLabel: "1 slice",
      },
    });
    expect(body.food.nutrientsPerBasis.energyKcal).toBe(250);
    expect(body.food.nutrientsPerBasis.addedSugarsG).toBe(0);
    expect(body.food.nutrientsPerBasis.fiberG).toBeNull();
    expect(body.food.nutrientsPerBasis.saltG).toBeNull();
  });

  test("a retried create returns the same food instead of a duplicate", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = await create("food-1");
      expect(replay.body.created).toBe(false);
      expect(replay.body.food.id).toBe(breadId);
    }
    expect(await count("nutrition_food")).toBe(1);
  });

  test("the owner comes from the session; payloads naming an owner are rejected", async () => {
    for (const extra of [{ organizationId: "org-b" }, { userId: "user-b" }]) {
      // Another workspace id is blocked (and audited) as a tenant violation; any other owner key is invalid.
      const top = await foods("create", { clientMutationId: "evil-1", food: bread, ...extra });
      expect(top.status).toBe("organizationId" in extra ? 403 : 400);
      const nested = await foods("create", {
        clientMutationId: "evil-2",
        food: { ...bread, ...extra },
      });
      expect(nested.status).toBe(400);
      const edit = await foods("update", {
        foodId: breadId,
        expectedRevision: 1,
        food: bread,
        ...extra,
      });
      expect([400, 403]).toContain(edit.status);
    }
    expect(await count("nutrition_food")).toBe(1);
  });

  test("unit and value validation rejects bad input without echoing it", async () => {
    const cases: unknown[] = [
      { ...bread, nutrientBasisUnit: "oz" },
      { ...bread, nutrientBasisAmount: 0 },
      { ...bread, servingSizeUnit: "serving" },
      { ...bread, nutrients: { proteinG: -1 } },
      { ...bread, nutrients: { vitaminQ: 1 } },
      { ...bread, name: "  " },
    ];
    for (const food of cases) {
      const result = await foods("create", { clientMutationId: "bad", food });
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).not.toContain('vitaminQ":1');
    }
    const halfServing = await foods("create", {
      clientMutationId: "bad-serving",
      food: { ...bread, servingSizeUnit: null },
    });
    expect(halfServing.status).toBe(400);
    const badBarcode = await foods("create", {
      clientMutationId: "bad-barcode",
      food: { ...bread, barcode: "12ab" },
    });
    expect(badBarcode.status).toBe(400);
    expect(await count("nutrition_food")).toBe(1);
  });

  test("other members and workspaces can neither read nor change the food", async () => {
    for (const user of ["user-a2", "user-b", "user-v"]) {
      expect(await list(user)).toEqual([]);
      expect((await foods("get", { foodId: breadId }, user)).status).toBe(404);
      const logged = await logCustom(breadId, `steal-${user}`, user);
      expect([403, 404]).toContain(logged.status);
      const search = await call<{ results: { id: string }[] }>(
        "nutritionFoods/search",
        { query: "rye", sources: ["custom"] },
        user,
      );
      expect(search.body.results).toEqual([]);
      const byId = await call("nutritionFoods/get", { id: `custom:${breadId}` }, user);
      expect(byId.status).toBe(404);
      const barcode = await call<{ matches: unknown[] }>(
        "nutritionFoods/lookupBarcode",
        { barcode: BARCODE },
        user,
      );
      expect(barcode.body.matches).toEqual([]);
    }
    for (const user of ["user-a2", "user-b"]) {
      const edit = await foods(
        "update",
        { foodId: breadId, expectedRevision: 1, food: { ...bread, name: "Hijacked" } },
        user,
      );
      expect(edit.status).toBe(404);
      expect((await foods("archive", { foodId: breadId }, user)).status).toBe(404);
      expect((await foods("restore", { foodId: breadId }, user)).status).toBe(404);
    }
    // Viewers cannot write at all.
    expect((await foods("archive", { foodId: breadId }, "user-v")).status).toBe(403);
    expect((await create("viewer-1", bread, "user-v")).status).toBe(403);
    const mine = (await foods("get", { foodId: breadId })).body as CustomFood;
    expect(mine).toMatchObject({ name: "Synthetic rye bread", revision: 1, archived: false });
  });

  test("custom foods never leak into the shared catalogs", async () => {
    const catalogOnly = await call<{ results: { id: string }[] }>("nutritionFoods/search", {
      query: "rye",
      sources: ["fdc", "off"],
    });
    expect(catalogOnly.body.results).toEqual([]);
    const own = await call<{ results: { id: string; origin: string; source: string }[] }>(
      "nutritionFoods/search",
      { query: "rye" },
    );
    expect(own.body.results).toEqual([
      expect.objectContaining({ id: `custom:${breadId}`, origin: "private", source: "custom" }),
    ]);
    for (const table of [
      "nutrition_catalog_fdc_food",
      "nutrition_catalog_off_product",
      "nutrition_catalog_off_overlay",
    ])
      expect(await count(table)).toBe(0);
  });

  test("edits and archiving never rewrite logged meals", async () => {
    const before = await logCustom(breadId, "log-v1");
    expect(before.status).toBe(200);
    const v1 = before.body.entry;
    expect(v1.food).toMatchObject({
      source: "custom",
      sourceQualifiedId: `custom:${breadId}`,
      sourceVersion: "1",
      name: "Synthetic rye bread",
    });
    // Two 40 g slices of a 250 kcal / 100 g food.
    expect(v1.nutrients.energyKcal).toBeCloseTo(200);
    expect(v1.nutrients.fiberG).toBeNull();
    expect(v1.nutrients.addedSugarsG).toBe(0);

    const edit = await call<Outcome>("nutritionCustomFoods/update", {
      foodId: breadId,
      expectedRevision: 1,
      food: { ...bread, name: "Synthetic rye bread (new recipe)", nutrients: { energyKcal: 300 } },
    });
    expect(edit.body.outcome).toBe("applied");
    if (edit.body.outcome !== "applied") throw new Error("expected applied");
    expect(edit.body.food.revision).toBe(2);
    // A full replace: protein was not re-entered, so it is unknown now, not kept or zeroed.
    expect(edit.body.food.nutrientsPerBasis.proteinG).toBeNull();

    const after = await logCustom(breadId, "log-v2");
    expect(after.body.entry.food).toMatchObject({
      sourceVersion: "2",
      name: "Synthetic rye bread (new recipe)",
    });
    expect(after.body.entry.nutrients.energyKcal).toBeCloseTo(240);

    expect((await foods("archive", { foodId: breadId })).status).toBe(200);
    const entries = await day();
    const old = entries.find((entry) => entry.id === v1.id)!;
    expect(old.food).toEqual(v1.food);
    expect(old.nutrients).toEqual(v1.nutrients);
    expect(entries).toHaveLength(2);
  });

  test("archived foods leave search, lookup and logging, and can be restored", async () => {
    expect(await list()).toEqual([]);
    expect((await list("user-a", true)).map((food) => food.archived)).toEqual([true]);
    const listed = await call<{ customFoods: FoodChoice[] }>("nutritionDiary/listFoods", {});
    expect(listed.body.customFoods).toEqual([]);
    const search = await call<{ results: unknown[] }>("nutritionFoods/search", {
      query: "rye",
      sources: ["custom"],
    });
    expect(search.body.results).toEqual([]);
    const barcode = await call<{ matches: unknown[] }>("nutritionFoods/lookupBarcode", {
      barcode: BARCODE,
    });
    expect(barcode.body.matches).toEqual([]);
    expect((await logCustom(breadId, "log-archived")).status).toBe(404);

    // Archive is idempotent; editing an archived food asks to restore first.
    const again = await call<{ food: CustomFood }>("nutritionCustomFoods/archive", {
      foodId: breadId,
    });
    expect(again.body.food.archived).toBe(true);
    const blocked = await call<Outcome>("nutritionCustomFoods/update", {
      foodId: breadId,
      expectedRevision: 2,
      food: { ...bread, name: "Edited while archived" },
    });
    expect(blocked.body.outcome).toBe("conflict");

    const restored = await call<{ food: CustomFood }>("nutritionCustomFoods/restore", {
      foodId: breadId,
    });
    expect(restored.body.food).toMatchObject({ archived: false, revision: 2 });
    expect((await list()).map((food) => food.id)).toEqual([breadId]);
    expect((await logCustom(breadId, "log-restored")).status).toBe(200);
  });

  test("stale edits conflict; a retried edit is unchanged, never applied twice", async () => {
    const renamed = { ...bread, name: "Synthetic rye bread (v3)" };
    const first = await call<Outcome>("nutritionCustomFoods/update", {
      foodId: breadId,
      expectedRevision: 2,
      food: renamed,
    });
    expect(first.body.outcome).toBe("applied");
    // The response was lost and the client resends the same edit.
    const retry = await call<Outcome>("nutritionCustomFoods/update", {
      foodId: breadId,
      expectedRevision: 2,
      food: renamed,
    });
    expect(retry.body.outcome).toBe("unchanged");
    if (retry.body.outcome !== "unchanged") throw new Error("expected unchanged");
    expect(retry.body.food.revision).toBe(3);

    // Another device edited from revision 2: conflict with the server's state, nothing written.
    const stale = await call<Outcome>("nutritionCustomFoods/update", {
      foodId: breadId,
      expectedRevision: 2,
      food: { ...bread, name: "Other device" },
    });
    expect(stale.body.outcome).toBe("conflict");
    if (stale.body.outcome !== "conflict") throw new Error("expected conflict");
    expect(stale.body.server).toMatchObject({ name: "Synthetic rye bread (v3)", revision: 3 });

    // Choosing "keep mine" resends against the server revision.
    const keep = await call<Outcome>("nutritionCustomFoods/update", {
      foodId: breadId,
      expectedRevision: 3,
      food: { ...bread, name: "Other device" },
    });
    expect(keep.body.outcome).toBe("applied");
  });

  test("the diary quick-add save is retry-safe too", async () => {
    const quick = {
      name: "Synthetic hummus",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      nutrients: { energyKcal: 170 },
      clientMutationId: "quick-save-1",
    };
    const first = await call<{ ref: { foodId: number } }>("nutritionDiary/createFood", quick);
    const retry = await call<{ ref: { foodId: number } }>("nutritionDiary/createFood", quick);
    expect(first.status).toBe(200);
    expect(retry.body.ref.foodId).toBe(first.body.ref.foodId);
    expect((await list()).map((food) => food.name)).toContain("Synthetic hummus");
  });

  test("mutation ids are scoped per member: the same id from another member is a new food", async () => {
    const other = await create("food-1", { ...bread, name: "Another member's bread" }, "user-a2");
    expect(other.body.created).toBe(true);
    expect(other.body.food.id).not.toBe(breadId);
    expect((await list("user-a2")).map((food) => food.name)).toEqual(["Another member's bread"]);
    expect((await list()).map((food) => food.name)).not.toContain("Another member's bread");
  });

  test("audit rows carry ids only, never food names or values", async () => {
    const rows = (
      await db.execute(
        sql`select event_type, target_id, before_json, after_json from access_audit_log where target_type = 'nutrition_food'`,
      )
    ).rows as { event_type: string; target_id: string }[];
    const events = new Set(rows.map((row) => row.event_type));
    for (const event of ["RECORD_CREATED", "RECORD_UPDATED", "RECORD_DELETED"])
      expect(events).toContain(event);
    for (const row of rows.filter((row) => row.event_type.startsWith("RECORD_")))
      expect(row.target_id).toMatch(/^\d+$/);
    expect(JSON.stringify(rows)).not.toMatch(/Synthetic|bakery|hummus/);
  });
});
