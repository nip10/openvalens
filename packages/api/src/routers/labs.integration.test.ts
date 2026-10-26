import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import { appRouter } from "./index";

/**
 * `labs.latest` over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL: readings written through `healthRecord.ingestMetricSample`
 * carry the lab's own reference range in their payload, and `labs.latest`
 * returns the range stored with the latest reading only, exactly as
 * recorded. No range recorded means `null`, never a looked-up one. All data
 * is synthetic.
 */

const url = process.env.LABS_ROUTER_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/labs_router_test"
  )
    throw new Error("Empty disposable loopback labs_router_test database required.");
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

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-b", role: "owner" },
};

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
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

type Marker = {
  code: string;
  unit: string | null;
  latestValue: number | null;
  referenceRange: {
    low: number | null;
    high: number | null;
    text: string | null;
    unit: string | null;
  } | null;
};

describe.skipIf(!url)("labs.latest reference ranges against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/labs_router_test" });
  const rpc = new RPCHandler(appRouter);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: MEMBERS[id]
        ? { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } }
        : null,
      db,
      correlationId: "corr-labs",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T>(path: string, input: unknown, user = "user-a") {
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

  let seq = 0;
  const ingest = (
    metricCode: string,
    observedAt: string,
    valueNumeric: number,
    payload?: Record<string, unknown>,
    user = "user-a",
  ) =>
    call(
      "healthRecord/ingestMetricSample",
      { metricCode, observedAt, valueNumeric, dedupeHash: `labs-range-${++seq}`, payload },
      user,
    );

  const latest = async (user = "user-a") => {
    const result = await call<Marker[]>("labs/latest", {}, user);
    expect(result.status).toBe(200);
    return new Map(result.body.map((marker) => [marker.code, marker]));
  };

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-a', 'a@example.test'), ('user-b', 'b@example.test');
      insert into organization (id, name, slug) values
        ('org-a', 'Record A', 'record-a'), ('org-b', 'Record B', 'record-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-user-a', 'org-a', 'user-a', 'owner'), ('m-user-b', 'org-b', 'user-b', 'owner');
      insert into metric_definition (organization_id, code, display_name, category, unit, value_type, aggregation_default) values
        ('org-a', 'blood_marker_vitamin_d', 'Vitamin D', 'labs', 'ng/mL', 'number', 'latest'),
        ('org-a', 'blood_marker_hs_crp', 'hs-CRP', 'labs', 'mg/L', 'number', 'latest'),
        ('org-a', 'blood_marker_ferritin', 'Ferritin', 'labs', 'ng/mL', 'number', 'latest'),
        ('org-a', 'blood_marker_glucose', 'Glucose', 'labs', 'mg/dL', 'number', 'latest'),
        ('org-b', 'blood_marker_vitamin_d', 'Vitamin D', 'labs', 'ng/mL', 'number', 'latest');
    `),
    );
    setRegisteredAuth(fakeAuth);

    const writes = [
      // Older reading with a different range; only the latest one counts.
      ingest("blood_marker_vitamin_d", "2026-01-14T08:15:00.000Z", 19, {
        refRangeLow: 20,
        refRangeHigh: 80,
      }),
      ingest("blood_marker_vitamin_d", "2026-10-08T08:15:00.000Z", 41, {
        refRangeLow: 30,
        refRangeHigh: 100,
        refRangeText: "30–100",
      }),
      // Text only, kept verbatim.
      ingest("blood_marker_hs_crp", "2026-10-08T08:15:00.000Z", 0.2, { refRangeText: " < 0.30 " }),
      // The latest reading has no range: none is shown, even though an older one had one.
      ingest("blood_marker_ferritin", "2026-06-03T08:15:00.000Z", 18, {
        refRangeLow: 15,
        refRangeHigh: 150,
      }),
      ingest("blood_marker_ferritin", "2026-10-08T08:15:00.000Z", 34),
      // Malformed values are dropped rather than coerced.
      ingest("blood_marker_glucose", "2026-10-08T08:15:00.000Z", 92, {
        refRangeLow: "70",
        refRangeHigh: 99,
      }),
      ingest(
        "blood_marker_vitamin_d",
        "2026-10-09T08:15:00.000Z",
        55,
        { refRangeLow: 1, refRangeHigh: 2 },
        "user-b",
      ),
    ];
    for (const write of writes) expect((await write).status).toBe(200);
  });

  afterAll(() => clearRegisteredAuth());

  test("returns the range stored with the latest reading, in the marker's unit", async () => {
    const markers = await latest();
    expect(markers.get("blood_marker_vitamin_d")).toMatchObject({
      latestValue: 41,
      referenceRange: { low: 30, high: 100, text: "30–100", unit: "ng/mL" },
    });
  });

  test("keeps text-only ranges as text, trimmed but otherwise verbatim", async () => {
    const markers = await latest();
    expect(markers.get("blood_marker_hs_crp")?.referenceRange).toEqual({
      low: null,
      high: null,
      text: "< 0.30",
      unit: "mg/L",
    });
  });

  test("no range recorded with the latest reading means null", async () => {
    const markers = await latest();
    expect(markers.get("blood_marker_ferritin")).toMatchObject({
      latestValue: 34,
      referenceRange: null,
    });
  });

  test("drops non-numeric bounds instead of coercing them", async () => {
    const markers = await latest();
    expect(markers.get("blood_marker_glucose")?.referenceRange).toEqual({
      low: null,
      high: 99,
      text: null,
      unit: "mg/dL",
    });
  });

  test("never returns another workspace's range", async () => {
    const markers = await latest();
    expect(markers.get("blood_marker_vitamin_d")?.referenceRange?.high).toBe(100);
    const other = await latest("user-b");
    expect(other.get("blood_marker_vitamin_d")?.referenceRange).toMatchObject({ low: 1, high: 2 });
  });
});
