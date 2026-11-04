import assert from "node:assert/strict";
import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildSleepSummaryFromEventRows,
  getSleepSummary,
  getSleepSummaryForRange,
  getPersonalSleepDailyEvidence,
  listSleepDailySummaries,
} from "./queries";
import type { SleepWindowSummary } from "./types";

test("buildSleepSummaryFromEventRows filters summaries to the requested range", () => {
  const summary = buildSleepSummaryFromEventRows(
    [
      {
        id: 1,
        eventAt: new Date("2026-03-01T23:30:00.000Z"),
        title: "sleep_session",
        payloadJson: { endAt: "2026-03-02T07:00:00.000Z" },
      },
      {
        id: 2,
        eventAt: new Date("2026-03-02T23:30:00.000Z"),
        title: "sleep_session",
        payloadJson: { endAt: "2026-03-03T07:00:00.000Z" },
      },
    ],
    { startDate: "2026-03-02", endDate: "2026-03-08" },
  );

  assert.equal(summary.lastNight?.date, "2026-03-03");
  assert.equal(
    summary.days.every((day) => day.date >= "2026-03-02" && day.date <= "2026-03-08"),
    true,
  );
});

type CapturedSelect = { table: unknown; sql: string; params: unknown[] };

function fakeDb(rows: unknown[]): { db: Database; selects: CapturedSelect[] } {
  const selects: CapturedSelect[] = [];
  const dialect = new PgDialect();
  const select = () => {
    let table: unknown;
    const chain: {
      from: (value: unknown) => typeof chain;
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => typeof chain;
      orderBy: (...args: unknown[]) => typeof chain;
      limit: (n?: number) => Promise<unknown[]>;
      then: <TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ) => Promise<TResult1 | TResult2>;
    } = {
      from(value: unknown) {
        table = value;
        return chain;
      },
      where(condition) {
        const query = dialect.sqlToQuery(condition);
        selects.push({ table, sql: query.sql, params: query.params });
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return Promise.resolve(rows);
      },
      // oxlint-disable-next-line unicorn/no-thenable
      then<TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return chain;
  };

  return { db: { select } as unknown as Database, selects };
}

describe("getSleepSummary Drizzle query", () => {
  test("scopes by organizationId and filters eventType='sleep_session'", async () => {
    const fake = fakeDb([]);
    const summary: SleepWindowSummary = await getSleepSummary(fake.db, "org-1", 30);
    expect(summary.days).toEqual([]);
    expect(fake.selects).toHaveLength(1);
    const select = fake.selects[0]!;
    expect(select.table).toBe(healthEvent);
    expect(select.params).toContain("org-1");
    expect(select.params).toContain("sleep_session");
    expect(select.sql).toContain("organization_id");
    expect(select.sql).toContain("event_type");
  });

  test("returns low-confidence summary when no sleep rows exist", async () => {
    const fake = fakeDb([]);
    const summary = await getSleepSummary(fake.db, "org-1", 30);
    expect(summary.lastNight).toBeNull();
    expect(summary.status).toBe("low_confidence");
    expect(summary.confidence).toBe("low");
  });

  test("projects a SleepWindowSummary from sleep_session rows", async () => {
    const fake = fakeDb([
      {
        id: 1,
        eventAt: new Date("2026-03-07T23:30:00.000Z"),
        title: "sleep_session",
        payloadJson: {
          endAt: "2026-03-08T07:00:00.000Z",
          sourceApp: "Oura",
          sourceDevice: "Ring Gen3",
        },
      },
    ]);
    const summary = await getSleepSummary(fake.db, "org-1", 30);
    expect(summary.days).toHaveLength(1);
    expect(summary.days[0]?.date).toBe("2026-03-08");
    expect(summary.lastNight?.mainSleepStart).toBe("2026-03-07T23:30:00.000Z");
    expect(summary.lastNight?.sourceSummary).toBe("Oura / Ring Gen3");
  });
});

describe("listSleepDailySummaries Drizzle query", () => {
  test("scopes by organizationId and orders by eventAt desc", async () => {
    const fake = fakeDb([]);
    const rows = await listSleepDailySummaries(fake.db, "org-1", 30);
    expect(rows).toEqual([]);
    expect(fake.selects[0]?.table).toBe(healthEvent);
    expect(fake.selects[0]?.params).toContain("org-1");
    expect(fake.selects[0]?.params).toContain("sleep_session");
  });
});

describe("personal sleep goal evidence", () => {
  test("is owner scoped and uses the local wake-up date without double-counting overlaps", async () => {
    const fake = fakeDb([
      {
        id: 1,
        eventAt: new Date("2026-03-07T23:00:00.000Z"),
        title: "sleep_session",
        payloadJson: {
          endAt: "2026-03-08T07:00:00.000Z",
          sleepStageIntervals: [
            { stage: "awake", start: "2026-03-08T01:00:00.000Z", end: "2026-03-08T03:00:00.000Z" },
          ],
        },
      },
      {
        id: 2,
        eventAt: new Date("2026-03-08T00:00:00.000Z"),
        title: "sleep_session",
        payloadJson: {
          endAt: "2026-03-08T07:00:00.000Z",
          sleepStageIntervals: [
            { stage: "awake", start: "2026-03-08T01:00:00.000Z", end: "2026-03-08T03:00:00.000Z" },
          ],
        },
      },
    ]);
    const evidence = await getPersonalSleepDailyEvidence(fake.db, {
      organizationId: "org-1",
      userId: "user-1",
      startDate: "2026-03-08",
      endDate: "2026-03-08",
      // At 07:00Z on the spring-forward date it is already March 8 in New York.
      timeZone: "America/New_York",
    });
    expect(fake.selects[0]?.params).toContain("user-1");
    expect(fake.selects[0]?.sql).toContain('"user_id"');
    expect(evidence).toEqual([
      {
        date: "2026-03-08",
        minutes: 360,
        wakeAt: "2026-03-08T07:00:00.000Z",
        sessionIds: ["1", "2"],
        source: "automatic_sleep",
      },
    ]);
  });

  test("unions deduplicated asleep time and assigns the actual local wake date across DST", async () => {
    const fake = fakeDb([
      {
        id: 10,
        eventAt: new Date("2026-03-08T06:00:00.000Z"),
        title: "sleep_session",
        payloadJson: {
          endAt: "2026-03-08T14:00:00.000Z",
          sleepStageIntervals: [
            { stage: "awake", start: "2026-03-08T09:00:00.000Z", end: "2026-03-08T11:00:00.000Z" },
          ],
        },
      },
      {
        id: 11,
        eventAt: new Date("2026-03-08T07:00:00.000Z"),
        title: "sleep_session",
        payloadJson: {
          endAt: "2026-03-08T14:00:00.000Z",
          sleepStageIntervals: [
            { stage: "awake", start: "2026-03-08T09:00:00.000Z", end: "2026-03-08T11:00:00.000Z" },
          ],
        },
      },
    ]);
    const evidence = await getPersonalSleepDailyEvidence(fake.db, {
      organizationId: "org-1",
      userId: "owner",
      startDate: "2026-03-08",
      endDate: "2026-03-08",
      timeZone: "America/Los_Angeles",
    });
    expect(evidence).toEqual([
      {
        date: "2026-03-08",
        minutes: 360,
        wakeAt: "2026-03-08T14:00:00.000Z",
        sessionIds: ["10", "11"],
        source: "automatic_sleep",
      },
    ]);
    expect(fake.selects[0]?.params).toContain("owner");
  });
});

test("every sleep read skips superseded sessions (#44)", async () => {
  const fake = fakeDb([]);
  await getSleepSummary(fake.db, "org-1", 30);
  await getSleepSummaryForRange(fake.db, "org-1", "2026-03-01", "2026-03-08");
  await listSleepDailySummaries(fake.db, "org-1", 30);
  expect(fake.selects).toHaveLength(3);
  for (const select of fake.selects) expect(select.sql).toContain('"superseded_at" is null');
});
