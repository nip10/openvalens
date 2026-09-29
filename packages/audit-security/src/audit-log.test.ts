import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Database } from "@openhealth/db";

import { writeAuditLog } from "./audit-log";

type CapturedInsert = Record<string, unknown>;

function createMockDb(options: { fail?: boolean } = {}): {
  db: Database;
  inserts: CapturedInsert[];
} {
  const inserts: CapturedInsert[] = [];

  const db = {
    insert: () => ({
      values: (payload: CapturedInsert) => {
        inserts.push(payload);
        return {
          returning: async () => {
            if (options.fail) {
              throw new Error("insert failed");
            }
            return [{ id: 7 }];
          },
        };
      },
    }),
  } as unknown as Database;

  return { db, inserts };
}

const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

afterEach(() => {
  stderrSpy.mockClear();
});

describe("writeAuditLog", () => {
  test("builds the insert payload and returns the inserted row id", async () => {
    const { db, inserts } = createMockDb();

    const id = await writeAuditLog({
      db,
      organizationId: "org-1",
      actorUserId: "user-1",
      eventType: "RECORD_CREATED",
      targetType: "record",
      targetId: "record-1",
      before: { value: "old" },
      after: { value: "new" },
      correlationId: "corr-1",
    });

    expect(id).toBe(7);
    expect(inserts).toHaveLength(1);

    const payload = inserts[0];
    expect(payload?.organizationId).toBe("org-1");
    expect(payload?.actorUserId).toBe("user-1");
    expect(payload?.eventType).toBe("RECORD_CREATED");
    expect(payload?.targetType).toBe("record");
    expect(payload?.targetId).toBe("record-1");
    expect(payload?.beforeJson).toEqual({ value: "old" });
    expect(payload?.afterJson).toEqual({
      after: { value: "new" },
      correlationId: "corr-1",
    });
  });

  test("redacts before, after and metadata before insert", async () => {
    const { db, inserts } = createMockDb();

    await writeAuditLog({
      db,
      organizationId: "org-1",
      eventType: "RECORD_UPDATED",
      before: { email: "patient@example.com", safe: "keep" },
      after: { payload: { phi: true }, token: "t", status: "ok" },
      metadata: { authorization: "Bearer x", note: "visible" },
    });

    const payload = inserts[0];
    expect(payload?.beforeJson).toEqual({ safe: "keep" });
    expect(payload?.afterJson).toEqual({
      after: { status: "ok" },
      metadata: { note: "visible" },
    });
  });

  test("writes null beforeJson/afterJson when no payload is provided", async () => {
    const { db, inserts } = createMockDb();

    await writeAuditLog({
      db,
      organizationId: "org-1",
      eventType: "TENANT_VIOLATION_BLOCKED",
    });

    expect(inserts[0]?.beforeJson).toBeNull();
    expect(inserts[0]?.afterJson).toBeNull();
  });

  test("logs a warning and returns null when the insert fails", async () => {
    const { db } = createMockDb({ fail: true });

    const id = await writeAuditLog({
      db,
      organizationId: "org-1",
      eventType: "RECORD_CREATED",
      correlationId: "corr-fail",
    });

    expect(id).toBeNull();
    const lines = stderrSpy.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("audit_write_failed"))).toBe(true);
    expect(lines.some((line) => line.includes("corr-fail"))).toBe(true);
  });
});
