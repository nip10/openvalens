import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { createNutritionRepository } from "@openvalens/nutrition";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import type {
  DailyTotals,
  DiaryEntry,
  LogEntryInput,
  NutrientSummary,
} from "../contracts/nutrition-diary";
import { appRouter } from "./index";

/**
 * `nutritionDiary.*` over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL (Issue #77): idempotent replay, deterministic conflicts, undo,
 * day markers, copy-day, recents/favourites and member/tenant isolation,
 * plus server-computed daily totals with coverage (Issue #79). All data is
 * synthetic.
 */

const url = process.env.NUTRITION_DIARY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_diary_test"
  )
    throw new Error("Empty disposable loopback nutrition_diary_test database required.");
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

/** Members: A and A2 share workspace org-a (A2 is a viewer there too); B owns org-b. */
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
const NEXT = "2026-10-13";

const oats = {
  kind: "manual" as const,
  food: {
    name: "Synthetic oats",
    nutrientBasisAmount: 100,
    nutrientBasisUnit: "g" as const,
    nutrients: { energyKcal: 380, proteinG: 13 },
  },
};
/** A food whose source did not provide energy: totals must show it as unknown. */
const mystery = {
  kind: "manual" as const,
  food: {
    name: "Synthetic soup",
    nutrientBasisAmount: 1,
    nutrientBasisUnit: "serving" as const,
    nutrients: { proteinG: 4 },
  },
};

describe.skipIf(!url)("nutritionDiary over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_diary_test" });
  const rpc = new RPCHandler(appRouter);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } },
      db,
      correlationId: "corr-77",
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
    procedure: string,
    input: unknown,
    user = "user-a",
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/nutritionDiary/${procedure}`, {
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

  const log = (input: Partial<LogEntryInput> & { clientMutationId: string }, user = "user-a") =>
    call<{ entry: DiaryEntry; created: boolean }>(
      "logEntry",
      {
        localDate: DAY,
        timeZone: "Europe/Lisbon",
        slot: "breakfast",
        food: oats,
        amount: 50,
        unit: "g",
        method: "quick_add",
        ...input,
      },
      user,
    );

  const day = async (localDate = DAY, user = "user-a") =>
    (
      await call<{ status: string; completedAt: string | null; entries: DiaryEntry[] }>(
        "getDay",
        { localDate },
        user,
      )
    ).body;

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

  test("logging is idempotent: replaying the same client mutation id adds nothing", async () => {
    const first = await log({ clientMutationId: "log-1" });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = await log({ clientMutationId: "log-1" });
      expect(replay.body.created).toBe(false);
      expect(replay.body.entry.id).toBe(first.body.entry.id);
    }
    expect(await count("nutrition_meal_entry")).toBe(1);
    expect(first.body.entry.nutrients.energyKcal).toBeCloseTo(190);
    expect(first.body.entry.food).toMatchObject({ source: "manual", name: "Synthetic oats" });
  });

  test("missing nutrients stay unknown, never zero", async () => {
    await log({
      clientMutationId: "log-2",
      food: mystery,
      amount: 1,
      unit: "serving",
      slot: "lunch",
    });
    const entries = (await day()).entries;
    const soup = entries.find((entry) => entry.food.name === "Synthetic soup")!;
    expect(soup.nutrients.energyKcal).toBeNull();
    expect(soup.nutrients.proteinG).toBe(4);
    expect(entries.map((entry) => entry.slot)).toEqual(["breakfast", "lunch"]);
  });

  test("edits replay idempotently and stale revisions conflict deterministically", async () => {
    const [entry] = (await day()).entries;
    const applied = await call<{ outcome: string; entry: DiaryEntry }>("updateEntry", {
      clientMutationId: "edit-1",
      entryId: entry!.id,
      expectedRevision: entry!.revision,
      amount: 80,
      unit: "g",
    });
    expect(applied.body.outcome).toBe("applied");
    expect(applied.body.entry.revision).toBe(entry!.revision + 1);

    // Same queued edit sent again (retry after a lost response): no second bump, no conflict.
    const replay = await call<{ outcome: string; entry: DiaryEntry }>("updateEntry", {
      clientMutationId: "edit-1",
      entryId: entry!.id,
      expectedRevision: entry!.revision,
      amount: 80,
      unit: "g",
    });
    expect(replay.body.outcome).toBe("replayed");
    expect(replay.body.entry.revision).toBe(entry!.revision + 1);

    // An offline device still holding the old revision gets both states back.
    const stale = await call<{ outcome: string; server: DiaryEntry }>("updateEntry", {
      clientMutationId: "edit-offline",
      entryId: entry!.id,
      expectedRevision: entry!.revision,
      amount: 120,
      unit: "g",
    });
    expect(stale.body.outcome).toBe("conflict");
    expect(stale.body.server.amount).toBe(80);
    expect((await day()).entries[0]!.amount).toBe(80);

    // "Keep my change": resend against the server's revision.
    const resolved = await call<{ outcome: string; entry: DiaryEntry }>("updateEntry", {
      clientMutationId: "edit-offline-resolved",
      entryId: entry!.id,
      expectedRevision: stale.body.server.revision,
      amount: 120,
      unit: "g",
      slot: "snack",
    });
    expect(resolved.body.outcome).toBe("applied");
    expect(resolved.body.entry).toMatchObject({ amount: 120, slot: "snack", localDate: DAY });
  });

  test("delete, replay and undo; editing a deleted entry is a conflict", async () => {
    const soup = (await day()).entries.find((entry) => entry.food.name === "Synthetic soup")!;
    const removed = await call<{ outcome: string; entry: DiaryEntry }>("deleteEntry", {
      clientMutationId: "del-1",
      entryId: soup.id,
      expectedRevision: soup.revision,
    });
    expect(removed.body.outcome).toBe("applied");
    expect(removed.body.entry.deleted).toBe(true);
    const again = await call<{ outcome: string }>("deleteEntry", {
      clientMutationId: "del-1",
      entryId: soup.id,
      expectedRevision: soup.revision,
    });
    expect(again.body.outcome).toBe("replayed");
    expect((await day()).entries.some((entry) => entry.id === soup.id)).toBe(false);

    const edit = await call<{ outcome: string; server: DiaryEntry }>("updateEntry", {
      clientMutationId: "edit-deleted",
      entryId: soup.id,
      expectedRevision: removed.body.entry.revision,
      amount: 2,
      unit: "serving",
    });
    expect(edit.body.outcome).toBe("conflict");
    expect(edit.body.server.deleted).toBe(true);

    const undo = await call<{ outcome: string; entry: DiaryEntry }>("restoreEntry", {
      clientMutationId: "undo-1",
      entryId: soup.id,
      expectedRevision: removed.body.entry.revision,
    });
    expect(undo.body.outcome).toBe("applied");
    expect(undo.body.entry.deleted).toBe(false);
    expect((await day()).entries.some((entry) => entry.id === soup.id)).toBe(true);
  });

  test("a blank day, a completed empty day and a cleared marker are distinct", async () => {
    const blank = await day("2026-10-01");
    expect(blank).toMatchObject({ status: "unmarked", completedAt: null, entries: [] });
    const marked = await call<{ status: string; completedAt: string }>("setDayStatus", {
      localDate: "2026-10-02",
      complete: true,
    });
    expect(marked.body.status).toBe("complete");
    // Replaying the marker keeps the first completion time.
    const replay = await call<{ completedAt: string }>("setDayStatus", {
      localDate: "2026-10-02",
      complete: true,
    });
    expect(replay.body.completedAt).toBe(marked.body.completedAt);
    expect(await day("2026-10-02")).toMatchObject({ status: "complete", entries: [] });
    await call("setDayStatus", { localDate: "2026-10-02", complete: false });
    expect((await day("2026-10-02")).status).toBe("unmarked");
  });

  test("copy-day copies only the confirmed entries, once", async () => {
    const source = (await day()).entries;
    const chosen = source.find((entry) => entry.food.name === "Synthetic oats")!;
    const copy = await call<{ created: number; entries: DiaryEntry[] }>("copyDay", {
      clientMutationId: "copy-1",
      fromDate: DAY,
      toDate: NEXT,
      timeZone: "Europe/Lisbon",
      entryIds: [chosen.id],
    });
    expect(copy.body.created).toBe(1);
    expect(copy.body.entries[0]).toMatchObject({
      slot: chosen.slot,
      amount: chosen.amount,
      method: "copied",
    });
    const replay = await call<{ created: number }>("copyDay", {
      clientMutationId: "copy-1",
      fromDate: DAY,
      toDate: NEXT,
      timeZone: "Europe/Lisbon",
      entryIds: [chosen.id],
    });
    expect(replay.body.created).toBe(0);
    expect((await day(NEXT)).entries).toHaveLength(1);
  });

  test("recents and favourites; logging from a recent snapshot", async () => {
    const foods = await call<{ recents: { ref: { snapshotId: number }; name: string }[] }>(
      "listFoods",
      {},
    );
    const recent = foods.body.recents.find((food) => food.name === "Synthetic oats")!;
    expect(recent).toBeDefined();
    expect(
      (await call("setFavorite", { snapshotId: recent.ref.snapshotId, favorite: true })).status,
    ).toBe(200);
    expect(
      (await call("setFavorite", { snapshotId: recent.ref.snapshotId, favorite: true })).status,
    ).toBe(200);
    const after = await call<{ favorites: { name: string }[] }>("listFoods", {});
    expect(after.body.favorites.map((food) => food.name)).toEqual(["Synthetic oats"]);

    const again = await log({
      clientMutationId: "log-recent",
      food: { kind: "snapshot", snapshotId: recent.ref.snapshotId },
      localDate: "2026-10-14",
    });
    expect(again.body.entry.food.snapshotId).toBe(recent.ref.snapshotId);
  });

  test("foods logged by search id are resolved on the server", async () => {
    const created = await call<{ ref: { foodId: number } }>("createFood", {
      name: "Synthetic bread",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      nutrients: { energyKcal: 250 },
    });
    const logged = await log({
      clientMutationId: "log-search-id",
      food: { kind: "catalog", id: `custom:${created.body.ref.foodId}` },
      method: "search",
      localDate: "2026-10-15",
    });
    expect(logged.status).toBe(200);
    expect(logged.body.entry.food).toMatchObject({ source: "custom", name: "Synthetic bread" });
    expect(logged.body.entry.nutrients.energyKcal).toBeCloseTo(125);
    // Another member cannot log A's private food by id.
    const other = await log(
      {
        clientMutationId: "log-search-id",
        food: { kind: "catalog", id: `custom:${created.body.ref.foodId}` },
        method: "search",
      },
      "user-a2",
    );
    expect(other.status).toBe(404);
  });

  test("diaries are private to the member and the workspace", async () => {
    const recent = (await call<{ recents: { ref: { snapshotId: number } }[] }>("listFoods", {}))
      .body.recents[0]!;
    // Another member of the same workspace sees an empty diary and cannot reuse A's foods.
    expect((await day(DAY, "user-a2")).entries).toEqual([]);
    expect((await call("listFoods", {}, "user-a2")).body).toMatchObject({
      recents: [],
      favorites: [],
    });
    const reuse = await log(
      { clientMutationId: "steal", food: { kind: "snapshot", snapshotId: recent.ref.snapshotId } },
      "user-a2",
    );
    expect(reuse.status).toBe(404);
    // Another workspace cannot touch A's entries by id.
    const entry = (await day()).entries[0]!;
    const cross = await call("deleteEntry", { clientMutationId: "x", entryId: entry.id }, "user-b");
    expect(cross.status).toBe(404);
    expect((await day()).entries.some((row) => row.id === entry.id)).toBe(true);
    // The same client mutation id from another member is independent, not a replay.
    const own = await log({ clientMutationId: "log-1" }, "user-a2");
    expect(own.body.created).toBe(true);
  });

  test("rejects tenant overrides, viewer writes, unknown catalog foods and unit mismatches", async () => {
    const override = await call("getDay", { localDate: DAY, organizationId: "org-b" });
    expect(override.status).toBe(400);
    const viewer = await log({ clientMutationId: "viewer-1" }, "user-v");
    expect(viewer.status).toBe(403);
    const catalog = await log({
      clientMutationId: "cat-1",
      food: { kind: "catalog", id: "fdc:999999" },
    });
    expect(catalog.status).toBe(404);
    const unit = await log({ clientMutationId: "unit-1", unit: "ml" });
    expect(unit.status).toBe(400);
    expect(unit.body).toMatchObject({
      code: "INVALID_INPUT",
      data: { reason: "UNIT_INCOMPATIBLE" },
    });
  });

  test("writes are audited with ids only", async () => {
    const rows = (
      await db.execute(
        sql`select target_type, target_id, before_json, after_json from access_audit_log where organization_id = 'org-a' and event_type = 'RECORD_CREATED' and target_type = 'nutrition_meal_entry'`,
      )
    ).rows as { target_type: string; target_id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("Synthetic");
  });
  describe("daily totals (#79)", () => {
    const T0 = "2026-11-01";
    const T1 = "2026-11-02";
    const T2 = "2026-11-03";

    const totals = async (from: string, to: string, user = "user-a") =>
      call<{ days: DailyTotals[] }>("getTotals", { from, to }, user);

    const manual = (name: string, nutrients: Record<string, number>, extra = {}) => ({
      kind: "manual" as const,
      food: {
        name,
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g" as const,
        nutrients,
        ...extra,
      },
    });

    test("sums snapshot × factor over active entries with explicit per-nutrient coverage", async () => {
      // 50 g oats: 190 kcal, 6.5 g protein.
      await log({ clientMutationId: "t-oats", localDate: T1 });
      // 1 serving soup: protein only; energy unknown.
      await log({
        clientMutationId: "t-soup",
        localDate: T1,
        slot: "lunch",
        food: mystery,
        amount: 1,
        unit: "serving",
      });
      // 2 slices of 30 g at 250 kcal/100 g = 150 kcal; sodium given, salt not; added sugars a recorded 0.
      await log({
        clientMutationId: "t-bread",
        localDate: T1,
        slot: "dinner",
        food: manual(
          "Synthetic bread",
          { energyKcal: 250, sodiumMg: 500, totalSugarsG: 5, addedSugarsG: 0 },
          { servingSizeAmount: 30, servingSizeUnit: "g", servingLabel: "1 slice" },
        ),
        amount: 2,
        unit: "serving",
      });
      // A deleted entry never counts.
      const gone = await log({
        clientMutationId: "t-gone",
        localDate: T1,
        slot: "snack",
        food: manual("Synthetic bar", { energyKcal: 1000, saltG: 2 }),
        amount: 100,
      });
      await call("deleteEntry", { clientMutationId: "t-gone-del", entryId: gone.body.entry.id });

      const result = await totals(T0, T2);
      expect(result.status).toBe(200);
      expect(result.body.days.map((d) => d.localDate)).toEqual([T0, T1, T2]);
      const [empty, logged, after] = result.body.days;

      // Nothing logged: no totals, not zero totals.
      for (const d of [empty!, after!]) {
        expect(d.entryCount).toBe(0);
        expect(d.status).toBe("unmarked");
        expect(Object.values(d.totals).every((t) => t.known === null)).toBe(true);
        expect(Object.values(d.totals).every((t) => t.coverage === "no_entries")).toBe(true);
      }

      expect(logged!.entryCount).toBe(3);
      expect(logged!.totals.energyKcal).toMatchObject({
        reported: 2,
        missing: 1,
        coverage: "partial",
      });
      expect(logged!.totals.energyKcal.known).toBeCloseTo(340);
      expect(logged!.totals.proteinG.known).toBeCloseTo(10.5);
      expect(logged!.totals.proteinG.coverage).toBe("partial");
      // Sodium is never converted into salt; salt from the deleted bar is gone.
      expect(logged!.totals.sodiumMg.known).toBeCloseTo(300);
      expect(logged!.totals.saltG).toEqual({
        known: null,
        reported: 0,
        missing: 3,
        coverage: "none",
      });
      // Total sugars and added sugars stay separate; a recorded 0 is reported, unknown is not.
      expect(logged!.totals.totalSugarsG.known).toBeCloseTo(3);
      expect(logged!.totals.addedSugarsG).toEqual({
        known: 0,
        reported: 1,
        missing: 2,
        coverage: "partial",
      });
      expect(logged!.totals.freeSugarsG.coverage).toBe("none");
      expect(logged!.totals.fiberG.known).toBeNull();
      expect(logged!.sources).toEqual({ fdc: 0, off: 0, custom: 0, manual: 3 });

      // getDay carries the same server-computed summary.
      const viaDay = (await call<{ summary: NutrientSummary }>("getDay", { localDate: T1 })).body
        .summary;
      expect(viaDay).toEqual({
        entryCount: logged!.entryCount,
        totals: logged!.totals,
        sources: logged!.sources,
      });
    });

    test("an edited portion and the day marker are reflected; history keeps the snapshot", async () => {
      const oats = (await day(T1)).entries.find((e) => e.clientMutationId === "t-oats")!;
      await call("updateEntry", {
        clientMutationId: "t-oats-edit",
        entryId: oats.id,
        expectedRevision: oats.revision,
        amount: 100,
        unit: "g",
      });
      await call("setDayStatus", { localDate: T1, complete: true });

      // A custom food edited after logging does not change past totals.
      const created = await call<{ ref: { foodId: number } }>("createFood", {
        name: "Synthetic yoghurt",
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g",
        nutrients: { energyKcal: 60 },
      });
      await log({
        clientMutationId: "t-yog",
        localDate: T2,
        food: { kind: "custom", foodId: created.body.ref.foodId },
        amount: 200,
        method: "manual",
      });
      await createNutritionRepository(db).updateCustomFood(
        { organizationId: "org-a", userId: "user-a" },
        created.body.ref.foodId,
        {
          name: "Synthetic yoghurt",
          nutrientBasisAmount: 100,
          nutrientBasisUnit: "g",
          nutrients: { energyKcal: 999 },
        },
      );

      const [logged, after] = (await totals(T1, T2)).body.days;
      expect(logged!.status).toBe("complete");
      // 380 (100 g oats) + 150 (bread).
      expect(logged!.totals.energyKcal.known).toBeCloseTo(530);
      expect(after!.totals.energyKcal).toMatchObject({ known: 120, coverage: "full" });
      expect(after!.sources.custom).toBe(1);
    });

    test("days are the member's logged local dates, not UTC days", async () => {
      // Both logged at the same instant: Auckland is already on the next day.
      await log({
        clientMutationId: "t-akl",
        localDate: "2026-11-11",
        timeZone: "Pacific/Auckland",
        amount: 10,
      });
      await log({
        clientMutationId: "t-la",
        localDate: "2026-11-10",
        timeZone: "America/Los_Angeles",
        amount: 20,
      });
      const [la, akl] = (await totals("2026-11-10", "2026-11-11")).body.days;
      expect(la!.totals.energyKcal.known).toBeCloseTo(76);
      expect(akl!.totals.energyKcal.known).toBeCloseTo(38);
    });

    test("totals are private to the member and validated", async () => {
      for (const user of ["user-a2", "user-b", "user-v"]) {
        const other = await totals(T1, T1, user);
        expect(other.status).toBe(200);
        expect(other.body.days[0]!.entryCount).toBe(0);
      }
      const override = await call("getTotals", { from: T1, to: T1, organizationId: "org-b" });
      expect(override.status).toBe(400);
      const reversed = await totals(T2, T1);
      expect(reversed.status).toBe(400);
      expect(reversed.body).toMatchObject({ code: "INVALID_INPUT" });
      const tooLong = await totals("2026-01-01", "2026-12-31");
      expect(tooLong.status).toBe(400);
    });
  });
});
