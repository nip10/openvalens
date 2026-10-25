import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";

import { backupState, readBackupStatus } from "./backup-status";

const NOW = new Date("2026-10-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** A fake db answering the two status queries in order. */
function fakeBackupDb(row: Record<string, unknown> | null, ready = true): Database {
  let call = 0;
  return {
    execute: async () => {
      call += 1;
      if (call === 1) return { rows: [{ ready }] };
      return { rows: row ? [row] : [] };
    },
  } as unknown as Database;
}

const schedule = (nextHours: number) =>
  JSON.stringify({ next_run_at: hoursAgo(-nextHours), hour_utc: 3, daily_retain: 14 });

describe("backup status (Issue #64)", () => {
  test("off when no backup service ever reported, or before the migration", async () => {
    expect((await readBackupStatus(fakeBackupDb(null, false), NOW)).state).toBe("off");
    const empty = await readBackupStatus(
      fakeBackupDb({
        last_backup: null,
        last_verify: null,
        last_failure: null,
        latest_backup_outcome: null,
        schedule: null,
      }),
      NOW,
    );
    expect(empty).toEqual({
      state: "off",
      lastBackup: null,
      lastVerify: null,
      lastFailure: null,
      schedule: null,
    });
  });

  test("ok with a recent verified backup and the next run planned", async () => {
    const status = await readBackupStatus(
      fakeBackupDb({
        last_backup: {
          backup_id: "20261025T030000Z-daily",
          trigger: "daily",
          size_bytes: 2048,
          finished_at: hoursAgo(9),
        },
        last_verify: {
          backup_id: "20261025T030000Z-daily",
          outcome: "ok",
          finished_at: hoursAgo(9),
        },
        last_failure: null,
        latest_backup_outcome: "ok",
        schedule: schedule(15),
      }),
      NOW,
    );
    expect(status.state).toBe("ok");
    expect(status.lastBackup).toEqual({
      id: "20261025T030000Z-daily",
      trigger: "daily",
      sizeBytes: 2048,
      at: hoursAgo(9),
    });
    expect(status.schedule).toEqual({ nextRunAt: hoursAgo(-15), hourUtc: 3, dailyRetain: 14 });
  });

  test("failing when the newest backup or the newest verify failed", () => {
    const base = {
      lastBackup: { id: "x", trigger: "daily", sizeBytes: 1, at: hoursAgo(1) },
      lastVerify: { id: "x", outcome: "ok" as const, at: hoursAgo(1) },
      lastFailure: null,
      schedule: null,
    };
    expect(backupState(base, false, NOW)).toBe("ok");
    expect(backupState(base, true, NOW)).toBe("failing");
    expect(
      backupState(
        { ...base, lastVerify: { id: "x", outcome: "failed", at: hoursAgo(1) } },
        false,
        NOW,
      ),
    ).toBe("failing");
  });

  test("stale when the newest good backup is over 48 hours old or the scheduler is overdue", () => {
    const sched = { nextRunAt: hoursAgo(-10), hourUtc: 3, dailyRetain: 14 };
    const backup = (h: number) => ({ id: "x", trigger: "daily", sizeBytes: 1, at: hoursAgo(h) });
    const status = (h: number | null, next = sched) => ({
      lastBackup: h === null ? null : backup(h),
      lastVerify: null,
      lastFailure: null,
      schedule: next,
    });
    expect(backupState(status(47), false, NOW)).toBe("ok");
    expect(backupState(status(49), false, NOW)).toBe("stale");
    expect(backupState(status(null), false, NOW)).toBe("stale");
    expect(backupState(status(1, { ...sched, nextRunAt: hoursAgo(3) }), false, NOW)).toBe("stale");
  });

  test("unknown when the status cannot be read; never throws", async () => {
    const broken = {
      execute: async () => {
        throw new Error("ECONNREFUSED");
      },
    } as unknown as Database;
    expect((await readBackupStatus(broken, NOW)).state).toBe("unknown");
    const odd = { execute: async () => [] } as unknown as Database;
    expect((await readBackupStatus(odd, NOW)).state).toBe("unknown");
  });
});
