import { expect, test } from "bun:test";
import { createDb, sql } from "@openhealth/db";

import { createDailyWeightService } from "./daily-weight-service";

// Set BODY_TEST_DATABASE_URL to a fresh disposable local bodytest database.
// Setup creates only the five tables used by this service; never run on a shared DB.
const databaseUrl = process.env.BODY_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration(
  "Postgres commits all manual rows and rolls back on a later constraint failure",
  async () => {
    if (!databaseUrl) throw new Error("BODY_TEST_DATABASE_URL required");
    const url = new URL(databaseUrl);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/bodytest") {
      throw new Error("Integration test requires disposable 127.0.0.1/bodytest database");
    }
    const db = createDb({ DATABASE_URL: databaseUrl });
    // Only isolated disposable databases are allowed by the runner; this test does
    // not execute migrations or touch shared application databases.
    await db.execute(
      sql`CREATE TABLE weight_checkin (id serial PRIMARY KEY, organization_id text NOT NULL, date text NOT NULL, weight_kg real NOT NULL, body_fat_pct real, notes text, created_at text NOT NULL DEFAULT 'now')`,
    );
    await db.execute(
      sql`CREATE TABLE calendar_event (id serial PRIMARY KEY, organization_id text NOT NULL, date text NOT NULL, type text NOT NULL, category text, title text NOT NULL CHECK (title NOT LIKE '%999%'), reference_table text, reference_id integer)`,
    );
    await db.execute(
      sql`CREATE TABLE weight_event (id serial PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL, source text NOT NULL, measured_at text NOT NULL, date text NOT NULL, weight_kg real NOT NULL, confidence real, metadata_json jsonb, created_at text NOT NULL DEFAULT 'now')`,
    );
    await db.execute(
      sql`CREATE TABLE daily_weight_override (id serial PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL, date text NOT NULL, weight_kg real NOT NULL, reason text, created_by_user_id text, created_at text NOT NULL DEFAULT 'now', revoked_at text)`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX active_override ON daily_weight_override (organization_id, user_id, date) WHERE revoked_at IS NULL`,
    );
    await db.execute(
      sql`CREATE TABLE daily_weight (id serial PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL, date text NOT NULL, weight_kg real NOT NULL, source text NOT NULL, resolved_from_event_id integer, created_at text NOT NULL DEFAULT 'now', updated_at text NOT NULL DEFAULT 'now', UNIQUE (organization_id, user_id, date))`,
    );

    const service = createDailyWeightService(db);
    const input = {
      organizationId: "test-org",
      userId: "test-user",
      date: "2026-03-07",
      weightKg: 84,
      bodyFatPct: null,
      notes: null,
      useAsDailyWeight: true,
    };
    await expect(service.writeManualWeight({ ...input, weightKg: 999 })).rejects.toThrow();
    const failed = await db.execute(sql`SELECT count(*)::int AS count FROM weight_checkin`);
    expect(failed.rows[0]).toMatchObject({ count: 0 });
    const created = await service.writeManualWeight(input);
    expect(created.organizationId).toBe("test-org");
    const counts = await db.execute(
      sql`SELECT (SELECT count(*) FROM weight_checkin)::int AS checkins, (SELECT count(*) FROM calendar_event)::int AS calendar, (SELECT count(*) FROM weight_event)::int AS events, (SELECT count(*) FROM daily_weight_override)::int AS overrides, (SELECT count(*) FROM daily_weight)::int AS daily`,
    );
    expect(counts.rows[0]).toMatchObject({
      checkins: 1,
      calendar: 1,
      events: 1,
      overrides: 1,
      daily: 1,
    });
    await service.writeManualWeight({ ...input, weightKg: 83 });
    const current = await db.execute(sql`SELECT weight_kg AS weight, source FROM daily_weight`);
    expect(current.rows[0]).toMatchObject({ weight: 83, source: "override" });
    const override = await db.execute(sql`SELECT weight_kg AS weight FROM daily_weight_override`);
    expect(override.rows).toEqual([{ weight: 83 }]);
  },
);
