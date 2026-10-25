import { sql, type Database } from "@openvalens/db";
import { z } from "zod";

/**
 * Issue #64 — backup status for the readiness probe and the admin panel.
 *
 * The self-host backup service (deploy/backup) writes `backup_run` and
 * `backup_schedule`; the server only reads them. Everything here is
 * value-free: backup ids are UTC timestamps plus a trigger, `detail` is a
 * step name such as `pg_dump` or `checksum`.
 *
 * State:
 * - `off`: no backup service has ever reported (development, or an install
 *   that runs no scheduler). Not a readiness problem.
 * - `failing`: the newest backup or the newest verify failed.
 * - `stale`: the scheduler reported, but the newest good backup is older
 *   than {@link STALE_AFTER_MS}, or the planned run is overdue (the scheduler
 *   is not running).
 * - `ok`: otherwise.
 * - `unknown`: the status could not be read (readiness already reports the
 *   database).
 *
 * The optional off-site copy has its own state (`offsite.state`): `off` when no
 * upload was ever recorded, `failing` when the newest upload failed, `ok`
 * otherwise. It degrades readiness on its own and never makes the local
 * backups `failing`: the backup itself exists and verified.
 */

/** Two missed daily runs. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
/** A planned run this late means the scheduler is not running. */
export const OVERDUE_AFTER_MS = 2 * 60 * 60 * 1000;
/**
 * A schedule row nobody has refreshed for this long is ignored: the scheduler
 * is gone for good (the database moved off the self-host stack, or backups were
 * switched to the operator's own). It refreshes the row at least daily.
 */
export const SCHEDULE_ABANDONED_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export const backupStateSchema = z.enum(["ok", "failing", "stale", "off", "unknown"]);
export type BackupState = z.infer<typeof backupStateSchema>;

export const offsiteStateSchema = z.enum(["ok", "failing", "off", "unknown"]);
export type OffsiteState = z.infer<typeof offsiteStateSchema>;

export const backupStatusSchema = z.object({
  state: backupStateSchema,
  lastBackup: z
    .object({
      id: z.string().nullable(),
      trigger: z.string(),
      sizeBytes: z.number().nullable(),
      at: z.string(),
    })
    .nullable(),
  lastVerify: z
    .object({
      id: z.string().nullable(),
      outcome: z.enum(["ok", "failed"]),
      at: z.string(),
    })
    .nullable(),
  lastFailure: z
    .object({
      operation: z.string(),
      trigger: z.string(),
      step: z.string().nullable(),
      at: z.string(),
    })
    .nullable(),
  schedule: z
    .object({
      nextRunAt: z.string().nullable(),
      hourUtc: z.number(),
      dailyRetain: z.number(),
    })
    .nullable(),
  offsite: z.object({
    state: offsiteStateSchema,
    lastUpload: z.object({ id: z.string().nullable(), at: z.string() }).nullable(),
    lastFailure: z
      .object({ id: z.string().nullable(), step: z.string().nullable(), at: z.string() })
      .nullable(),
  }),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

const EMPTY: Omit<BackupStatus, "state"> = {
  lastBackup: null,
  lastVerify: null,
  lastFailure: null,
  schedule: null,
  offsite: { state: "off", lastUpload: null, lastFailure: null },
};

const UNKNOWN: BackupStatus = {
  state: "unknown",
  ...EMPTY,
  offsite: { state: "unknown", lastUpload: null, lastFailure: null },
};

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function json(value: unknown): Row | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return JSON.parse(value) as Row;
  return value as Row;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pure state rule; exported for tests. */
export function backupState(
  status: Pick<BackupStatus, "lastBackup" | "lastVerify" | "lastFailure" | "schedule">,
  latestBackupFailed: boolean,
  now: Date,
): BackupState {
  const reported =
    status.lastBackup !== null ||
    status.lastVerify !== null ||
    status.lastFailure !== null ||
    status.schedule !== null;
  if (!reported) return "off";
  if (latestBackupFailed || status.lastVerify?.outcome === "failed") return "failing";
  if (status.schedule) {
    const last = status.lastBackup ? Date.parse(status.lastBackup.at) : Number.NaN;
    if (!Number.isFinite(last) || now.getTime() - last > STALE_AFTER_MS) return "stale";
    const next = status.schedule.nextRunAt ? Date.parse(status.schedule.nextRunAt) : Number.NaN;
    if (Number.isFinite(next) && now.getTime() - next > OVERDUE_AFTER_MS) return "stale";
  }
  return "ok";
}

/** Reads the backup status. Never throws: any failure is `unknown`. */
export async function readBackupStatus(
  db: Pick<Database, "execute">,
  now: Date = new Date(),
): Promise<BackupStatus> {
  try {
    const ready = rowsOf(
      await db.execute(sql`select to_regclass('public.backup_run') is not null
        and to_regclass('public.backup_schedule') is not null as ready`),
    )[0];
    if (!ready) return UNKNOWN;
    if (ready.ready !== true) return { state: "off", ...EMPTY };

    const row = rowsOf(
      await db.execute(sql`select
        (select row_to_json(b) from (select backup_id, trigger, size_bytes, finished_at
          from backup_run where operation = 'backup' and outcome = 'ok'
          order by finished_at desc, id desc limit 1) b) as last_backup,
        (select row_to_json(v) from (select backup_id, outcome, finished_at
          from backup_run where operation = 'verify'
          order by finished_at desc, id desc limit 1) v) as last_verify,
        (select row_to_json(f) from (select operation, trigger, detail, finished_at
          from backup_run where outcome = 'failed' and operation <> 'offsite'
          order by finished_at desc, id desc limit 1) f) as last_failure,
        (select row_to_json(o) from (select backup_id, finished_at
          from backup_run where operation = 'offsite' and outcome = 'ok'
          order by finished_at desc, id desc limit 1) o) as last_offsite,
        (select row_to_json(x) from (select backup_id, detail, finished_at
          from backup_run where operation = 'offsite' and outcome = 'failed'
          order by finished_at desc, id desc limit 1) x) as last_offsite_failure,
        (select outcome from backup_run where operation = 'offsite'
          order by finished_at desc, id desc limit 1) as latest_offsite_outcome,
        (select outcome from backup_run where operation = 'backup'
          order by finished_at desc, id desc limit 1) as latest_backup_outcome,
        (select row_to_json(s) from (select next_run_at, hour_utc, daily_retain, updated_at
          from backup_schedule where id = 'instance') s) as schedule`),
    )[0];
    if (!row) return UNKNOWN;

    const backup = json(row.last_backup);
    const verify = json(row.last_verify);
    const failure = json(row.last_failure);
    const scheduleRow = json(row.schedule);
    const scheduleUpdated = scheduleRow
      ? Date.parse(String(iso(scheduleRow.updated_at)))
      : Number.NaN;
    const schedule =
      scheduleRow &&
      !(
        Number.isFinite(scheduleUpdated) &&
        now.getTime() - scheduleUpdated > SCHEDULE_ABANDONED_AFTER_MS
      )
        ? scheduleRow
        : null;
    const upload = json(row.last_offsite);
    const uploadFailure = json(row.last_offsite_failure);
    const status: Omit<BackupStatus, "state"> = {
      lastBackup:
        backup && iso(backup.finished_at)
          ? {
              id: backup.backup_id === null ? null : String(backup.backup_id),
              trigger: String(backup.trigger),
              sizeBytes: num(backup.size_bytes),
              at: iso(backup.finished_at)!,
            }
          : null,
      lastVerify:
        verify && iso(verify.finished_at)
          ? {
              id: verify.backup_id === null ? null : String(verify.backup_id),
              outcome: verify.outcome === "ok" ? "ok" : "failed",
              at: iso(verify.finished_at)!,
            }
          : null,
      lastFailure:
        failure && iso(failure.finished_at)
          ? {
              operation: String(failure.operation),
              trigger: String(failure.trigger),
              step: failure.detail === null ? null : String(failure.detail),
              at: iso(failure.finished_at)!,
            }
          : null,
      schedule: schedule
        ? {
            nextRunAt: iso(schedule.next_run_at),
            hourUtc: num(schedule.hour_utc) ?? 0,
            dailyRetain: num(schedule.daily_retain) ?? 0,
          }
        : null,
      offsite: {
        state:
          row.latest_offsite_outcome === "failed"
            ? "failing"
            : row.latest_offsite_outcome === "ok"
              ? "ok"
              : "off",
        lastUpload:
          upload && iso(upload.finished_at)
            ? {
                id: upload.backup_id === null ? null : String(upload.backup_id),
                at: iso(upload.finished_at)!,
              }
            : null,
        lastFailure:
          uploadFailure && iso(uploadFailure.finished_at)
            ? {
                id: uploadFailure.backup_id === null ? null : String(uploadFailure.backup_id),
                step: uploadFailure.detail === null ? null : String(uploadFailure.detail),
                at: iso(uploadFailure.finished_at)!,
              }
            : null,
      },
    };
    return {
      state: backupState(status, row.latest_backup_outcome === "failed", now),
      ...status,
    };
  } catch {
    return UNKNOWN;
  }
}
