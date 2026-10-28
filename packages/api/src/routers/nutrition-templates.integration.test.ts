import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import type { NutritionTemplate } from "../contracts/nutrition-templates";
import { appRouter } from "./index";

/** HTTP contract/ownership/replay checks against a disposable PostgreSQL database. */
const url = process.env.NUTRITION_TEMPLATES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_templates_test"
  )
    throw new Error("Empty disposable loopback nutrition_templates_test database required.");
}

async function migrate(db: Database) {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const contents = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of contents.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const members: Record<string, { organizationId: string; role: string }> = {
  "template-user-a": { organizationId: "template-org-a", role: "owner" },
  "template-user-a2": { organizationId: "template-org-a", role: "collaborator" },
  "template-user-b": { organizationId: "template-org-b", role: "owner" },
};
const actor = (headers: Headers) => headers.get("x-test-user") ?? "template-user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `session-${id}`,
          userId: id,
          activeOrganizationId: members[id]!.organizationId,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      return {
        id: `member-${id}`,
        userId: id,
        organizationId: members[id]!.organizationId,
        role: members[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: members[actor(headers)]!.role,
    }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

describe.skipIf(!url)("nutritionTemplates over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_templates_test" });
  const rpc = new RPCHandler(appRouter);
  function contextFor(headers: Headers): Context {
    const id = actor(headers);
    return {
      session: { user: { id }, session: { activeOrganizationId: members[id]!.organizationId } },
      db,
      correlationId: "nutrition-template-http",
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }
  async function call<T>(procedure: string, input: unknown, user = "template-user-a") {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const path = procedure.includes("/") ? procedure : `nutritionTemplates/${procedure}`;
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("Unmatched nutritionTemplates RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }
  const content = (name: string) => ({
    kind: "meal" as const,
    name,
    ingredients: [
      {
        food: {
          kind: "manual" as const,
          food: {
            name: "Synthetic food",
            nutrientBasisAmount: 1,
            nutrientBasisUnit: "serving" as const,
            nutrients: { energyKcal: 0, proteinG: null },
          },
        },
        amount: 1,
        unit: "serving" as const,
      },
    ],
  });

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('template-user-a', 'template-a@example.test'), ('template-user-a2', 'template-a2@example.test'), ('template-user-b', 'template-b@example.test');
      insert into organization (id, name, slug) values
        ('template-org-a', 'Templates A', 'templates-a'), ('template-org-b', 'Templates B', 'templates-b');
      insert into member (id, organization_id, user_id, role) values
        ('template-member-a', 'template-org-a', 'template-user-a', 'owner'),
        ('template-member-a2', 'template-org-a', 'template-user-a2', 'collaborator'),
        ('template-member-b', 'template-org-b', 'template-user-b', 'owner');
    `),
    );
    setRegisteredAuth(auth);
  });
  afterAll(() => clearRegisteredAuth());

  test("HTTP create/list/update/archive are private and replay-safe with revision conflicts", async () => {
    const create = await call<{ outcome: string; template: NutritionTemplate; targetId: string }>(
      "create",
      { clientMutationId: "http-template-create", content: content("Synthetic template") },
    );
    expect(create.status).toBe(200);
    expect(create.body).toMatchObject({
      outcome: "applied",
      template: { id: expect.any(Number), kind: "meal", revision: 1, name: "Synthetic template" },
    });
    const id = Number(create.body.targetId);
    const own = await call<{ templates: NutritionTemplate[] }>("list", {}, "template-user-a");
    const sameOrgOtherUser = await call<{ templates: NutritionTemplate[] }>(
      "list",
      {},
      "template-user-a2",
    );
    const otherOrg = await call<{ templates: NutritionTemplate[] }>("list", {}, "template-user-b");
    expect(own.body.templates.map((item) => item.id)).toContain(id);
    expect(sameOrgOtherUser.body.templates.map((item) => item.id)).not.toContain(id);
    expect(otherOrg.body.templates.map((item) => item.id)).not.toContain(id);

    const updateInput = {
      clientMutationId: "http-template-update",
      templateId: id,
      expectedRevision: 1,
      content: content("Renamed template"),
    };
    expect(await call("update", updateInput)).toMatchObject({
      status: 200,
      body: { outcome: "applied", template: { revision: 2, name: "Renamed template" } },
    });
    expect(await call("update", updateInput)).toMatchObject({
      status: 200,
      body: { outcome: "replayed", template: { revision: 2 } },
    });
    expect(
      await call("update", { ...updateInput, content: content("Mutation id reuse") }),
    ).toMatchObject({ status: 400 });
    expect(
      await call("update", { ...updateInput, clientMutationId: "http-template-stale" }),
    ).toMatchObject({ status: 200, body: { outcome: "conflict", server: { revision: 2 } } });
    expect(
      await call("archive", {
        clientMutationId: "http-template-archive",
        templateId: id,
        expectedRevision: 2,
      }),
    ).toMatchObject({ status: 200, body: { outcome: "applied", template: { archived: true } } });
    expect(await call("list", {})).toMatchObject({ status: 200, body: { templates: [] } });

    expect(
      await call("nutritionDiary/logEntry", {
        clientMutationId: "http-template-last-used",
        localDate: "2026-10-12",
        timeZone: "UTC",
        slot: "breakfast",
        food: {
          kind: "manual",
          food: {
            name: "Synthetic quick food",
            nutrientBasisAmount: 1,
            nutrientBasisUnit: "serving",
            nutrients: { energyKcal: 0 },
          },
        },
        amount: 2,
        unit: "serving",
        method: "manual",
      }),
    ).toMatchObject({ status: 200 });
    const foodChoices = await call<{
      recents: { lastAmount: number | null; lastUnit: string | null; lastSlot: string | null }[];
    }>("nutritionDiary/listFoods", {});
    expect(foodChoices.body.recents[0]).toMatchObject({
      lastAmount: 2,
      lastUnit: "serving",
      lastSlot: "breakfast",
    });
  });
});
