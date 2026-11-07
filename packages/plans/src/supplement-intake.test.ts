import { describe, expect, it } from "bun:test";
import type { Database } from "@openvalens/db";
import { supplementIntake } from "@openvalens/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createSupplementIntakeRepository,
  SupplementIntakeValidationError,
  validateSupplementIntakePayload,
} from "./supplement-intake";

function ownerScopedListDb(rows: Array<Record<string, unknown>>) {
  const dialect = new PgDialect();
  let filters: { sql: string; params: unknown[] } = { sql: "", params: [] };
  const chain = {
    from(table: unknown) {
      expect(table).toBe(supplementIntake);
      return chain;
    },
    where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
      const query = dialect.sqlToQuery(condition);
      filters = { sql: query.sql, params: query.params };
      return chain;
    },
    orderBy() {
      const matches = rows.filter((row) => {
        const userColumn = filters.sql.slice(filters.sql.indexOf('"user_id"'));
        const ownerParam = filters.params[1];
        return !userColumn.includes('"user_id"') || row.userId === ownerParam;
      });
      return Promise.resolve(matches);
    },
  };
  return { select: () => chain } as unknown as Database;
}

describe("supplement intake validation contract", () => {
  it("preserves distinct same-day intake events and normalizes occurrence instants", () => {
    const morning = validateSupplementIntakePayload({
      supplementId: 7,
      occurredAt: "2026-10-02T08:15:00-05:00",
      timeZone: "America/Chicago",
      dose: " 1 capsule ",
    });
    const evening = validateSupplementIntakePayload({
      supplementId: 7,
      occurredAt: "2026-10-02T20:15:00-05:00",
      timeZone: "America/Chicago",
      dose: "1 capsule",
    });

    expect(morning.occurredAt).toBe("2026-10-02T13:15:00.000Z");
    expect(evening.occurredAt).toBe("2026-10-03T01:15:00.000Z");
    expect(morning.occurredAt).not.toBe(evening.occurredAt);
    expect(morning.dose).toBe("1 capsule");
  });

  it("rejects invalid zones and future occurrences", () => {
    expect(() =>
      validateSupplementIntakePayload({
        supplementId: 2,
        occurredAt: "2026-11-01T10:00:00Z",
        timeZone: "Mars/Olympus",
        dose: "1 tablet",
      }),
    ).toThrow(SupplementIntakeValidationError);
    expect(() =>
      validateSupplementIntakePayload({
        supplementId: 2,
        occurredAt: "2999-01-01T10:00:00Z",
        timeZone: "UTC",
        dose: "1 tablet",
      }),
    ).toThrow(SupplementIntakeValidationError);
  });

  it("does not return another user’s intake within the same organization", async () => {
    const base = {
      supplementId: 7,
      occurredAt: new Date("2026-10-31T12:00:00Z"),
      timezone: "UTC",
      dose: "1 capsule",
      note: null,
      version: 1,
      correctedFromId: null,
      deletedAt: null,
      createdAt: new Date("2026-10-31T12:00:00Z"),
      updatedAt: new Date("2026-10-31T12:00:00Z"),
    };
    const db = ownerScopedListDb([
      { ...base, id: 1, organizationId: "org-a", userId: "user-a" },
      { ...base, id: 2, organizationId: "org-a", userId: "user-b" },
    ]);
    const visible = await createSupplementIntakeRepository(db, {
      organizationId: "org-a",
      userId: "user-a",
    }).list();

    expect(visible.map((row) => row.id)).toEqual([1]);
  });
});
