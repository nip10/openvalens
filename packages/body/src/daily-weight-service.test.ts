import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";
import {
  dailyWeight,
  dailyWeightOverride,
  weightCheckin,
  weightEvent,
} from "@openhealth/db/schema/body";
import { calendarEvent } from "@openhealth/db/schema/plans";

import { createDailyWeightService } from "./daily-weight-service";

const input = {
  organizationId: "org-1",
  userId: "user-1",
  date: "2026-03-07",
  weightKg: 84.2,
  bodyFatPct: 23.1,
  notes: "private note",
  useAsDailyWeight: false,
};
type Write = { table: unknown; values: Record<string, unknown>; conflict?: unknown };

// Transactional fake: staged writes only become visible on commit, and a failed
// calendar/event/override/daily insert discards the whole staged batch.
function fakeDb(failTable?: unknown) {
  const committed: Write[] = [];
  let calls = 0;
  const db = {
    async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      calls++;
      const staged: Write[] = [];
      const tx = {
        insert(table: unknown) {
          return {
            values(values: Record<string, unknown>) {
              const write: Write = { table, values };
              const execute = async () => {
                if (table === failTable) throw new Error("injected DB failure");
                staged.push(write);
                return table === weightCheckin
                  ? [{ id: 501, ...values, createdAt: "2026-03-07T10:00:00Z" }]
                  : [{ id: 901 }];
              };
              return {
                // oxlint-disable-next-line unicorn/no-thenable
                then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
                  execute().then(resolve, reject),
                returning: execute,
                onConflictDoUpdate(conflict: unknown) {
                  write.conflict = conflict;
                  return execute();
                },
              };
            },
          };
        },
      };
      const result = await callback(tx);
      committed.push(...staged);
      return result;
    },
  } as unknown as Database;
  return {
    db,
    committed,
    get calls() {
      return calls;
    },
  };
}

describe("manual weight transaction", () => {
  test("writes check-in, calendar event and manual event without changing canonical weight by default", async () => {
    const state = fakeDb();
    const result = await createDailyWeightService(state.db).writeManualWeight(input);
    expect(state.calls).toBe(1);
    expect(result.id).toBe(501);
    expect(state.committed.map((write) => write.table)).toEqual([
      weightCheckin,
      calendarEvent,
      weightEvent,
    ]);
    expect(state.committed[1]?.values).toMatchObject({
      organizationId: "org-1",
      referenceTable: "weight_checkin",
      referenceId: 501,
    });
    expect(state.committed[2]?.values).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      source: "manual",
      confidence: 0.5,
      measuredAt: "2026-03-07T12:00:00.000Z",
      metadataJson: { weightCheckinId: 501 },
    });
  });

  test("daily flag upserts numeric override and materialized row with org/user/date conflict keys", async () => {
    const state = fakeDb();
    await createDailyWeightService(state.db).writeManualWeight({
      ...input,
      useAsDailyWeight: true,
    });
    expect(state.committed.map((write) => write.table)).toEqual([
      weightCheckin,
      calendarEvent,
      weightEvent,
      dailyWeightOverride,
      dailyWeight,
    ]);
    expect(state.committed[3]?.values).toMatchObject({
      weightKg: 84.2,
      userId: "user-1",
      organizationId: "org-1",
    });
    expect(state.committed[3]?.values).not.toHaveProperty("eventId");
    expect(state.committed[3]?.conflict).toMatchObject({
      target: [
        dailyWeightOverride.organizationId,
        dailyWeightOverride.userId,
        dailyWeightOverride.date,
      ],
    });
    expect(state.committed[4]?.values).toMatchObject({
      source: "override",
      resolvedFromEventId: 901,
    });
    expect(state.committed[4]?.conflict).toMatchObject({
      target: [dailyWeight.organizationId, dailyWeight.userId, dailyWeight.date],
    });
  });

  for (const table of [calendarEvent, weightEvent, dailyWeightOverride, dailyWeight]) {
    test(`rolls back staged writes when ${table === calendarEvent ? "calendar" : table === weightEvent ? "event" : table === dailyWeightOverride ? "override" : "daily"} insert fails`, async () => {
      const state = fakeDb(table);
      await expect(
        createDailyWeightService(state.db).writeManualWeight({ ...input, useAsDailyWeight: true }),
      ).rejects.toThrow("injected DB failure");
      expect(state.committed).toEqual([]);
    });
  }
});
