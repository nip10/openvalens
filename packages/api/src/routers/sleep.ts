import { writeAuditLog, type AuditEventType } from "@openvalens/audit-security";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import {
  buildSleepCoachContext,
  deleteManualSleepSession,
  getSleepSummary,
  insertManualSleepSession,
  listManualSleepSessions,
  listSleepDailySummaries,
  overlapsDeviceSleep,
  type SleepCoachContext,
  type SleepDailySummary,
  type SleepWindowSummary,
} from "@openvalens/sleep";
import { z } from "zod";

import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";
import {
  checkManualSleepWindow,
  manualSleepDedupeHash,
  SLEEP_QUALITY_MAX,
  SLEEP_QUALITY_MIN,
} from "../presenters/manual-sleep";

/**
 * Sleep analytics oRPC surface (Issue #18).
 *
 * Three procedures:
 *
 * - `sleep.summary`           — read; `permissionedProcedure` on the
 *   `records` resource with `read` action. Defaults to a 30-day window,
 *   clamped to `[7, 365]`. Mirrors anchovy `GET /api/v2/sleep/summary`.
 * - `sleep.listDailySummaries`— read; same permission. Returns the full
 *   per-day list (no windowing). Used by AI coach (#13) and future UI.
 * - `sleep.recordFromHealthConnect` — write; composed on `protectedProcedure`
 *   with `validateInput` + a `requirePermission` call. We deliberately do
 *   **not** use `tenantScopedProcedure` here: that middleware reads
 *   `organizationId` off the raw input before `validateInput` runs, so a
 *   foreign-tenant attempt would surface as `TENANT_VIOLATION` (not
 *   `INVALID_INPUT`). Following the body `#21` `ingestAutoWeightEvent`
 *   pattern (Issue #21 second-half) the schema is `strictObject` so any
 *   attempt to override `organizationId` or `userId` via input is rejected
 *   with `INVALID_INPUT` at the boundary, before authz runs. Audit is
 *   written explicitly once on success.
 *
 * No PHI is logged. Org/user are taken exclusively from authz.
 */

const summaryInput = z.strictObject({
  days: z.number().int().min(7).max(365).optional(),
});

const listDailyInput = z.strictObject({
  days: z.number().int().min(7).max(365).optional(),
});

// Sleep stage payload mirrors the OpenValens `payloadJson` envelope used by
// the anchovy Health Connect sync. `endAt` is the session end (required for
// derivation); `sourceApp`, `sourceDevice` and `sleepStageIntervals` are all
// optional but strongly recommended for accurate scoring.
const sleepStageIntervalSchema = z.object({
  stage: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
});

const recordFromHealthConnectInput = z.strictObject({
  eventAt: z.string().min(1),
  title: z.string().nullish(),
  payloadJson: z
    .object({
      endAt: z.string().min(1),
      sourceApp: z.string().nullish(),
      sourceDevice: z.string().nullish(),
      sleepStageIntervals: z.array(sleepStageIntervalSchema).nullish(),
    })
    .passthrough(),
  sourceEventId: z.string().nullish(),
  dedupeHash: z.string().min(1).max(200),
});

const sleepStatusSchema = z.enum([
  "optimal",
  "acceptable",
  "mild_sleep_debt",
  "high_sleep_debt",
  "fragmented_sleep",
  "irregular_schedule",
  "low_confidence",
]);

const sleepConfidenceSchema = z.enum(["high", "medium", "low"]);

const dailySummaryShape: z.ZodType<SleepDailySummary> = z.object({
  date: z.string(),
  mainSleepStart: z.string().nullable(),
  mainSleepEnd: z.string().nullable(),
  mainSleepAsleepMinutes: z.number().nullable(),
  asleepMinutes: z.number(),
  timeInBedMinutes: z.number().nullable(),
  awakeMinutes: z.number(),
  sleepEfficiencyPct: z.number().nullable(),
  deepMinutes: z.number(),
  remMinutes: z.number(),
  lightMinutes: z.number(),
  unknownStageMinutes: z.number(),
  interruptionsCount: z.number(),
  sleepMidpoint: z.string().nullable(),
  targetMinutes: z.number(),
  sleepDebtMinutes: z.number(),
  qualityScore: z.number(),
  confidence: sleepConfidenceSchema,
  status: sleepStatusSchema,
  sourceSummary: z.string().nullable(),
  sessionIds: z.array(z.string()),
});

const windowSummaryShape: z.ZodType<SleepWindowSummary> = z.object({
  days: z.array(dailySummaryShape),
  lastNight: dailySummaryShape.nullable(),
  sevenDayAverageMinutes: z.number().nullable(),
  averageSleepDebtMinutes: z.number().nullable(),
  status: sleepStatusSchema,
  confidence: sleepConfidenceSchema,
});

const coachContextShape: z.ZodType<SleepCoachContext> = z.object({
  lastNightMinutes: z.number().nullable(),
  sevenDayAverageMinutes: z.number().nullable(),
  sleepDebtMinutesPerDay: z.number().nullable(),
  status: sleepStatusSchema,
  confidence: sleepConfidenceSchema,
  recommendedConstraint: z.enum(["prioritize_recovery", "avoid_max_effort_training"]).nullable(),
});

const MANUAL_SESSIONS_MAX_DAYS = 365;

const logManualSessionInput = z.strictObject({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  quality: z.number().int().min(SLEEP_QUALITY_MIN).max(SLEEP_QUALITY_MAX).nullish(),
});

const manualSessionsInput = z.strictObject({
  days: z.number().int().min(1).max(MANUAL_SESSIONS_MAX_DAYS).optional(),
});

const deleteManualSessionInput = z.strictObject({
  id: z.number().int().positive(),
});

const manualSessionShape = z.object({
  id: z.number(),
  startAt: z.string(),
  endAt: z.string(),
  quality: z.number().nullable(),
  possibleDuplicate: z.boolean(),
});

const manualSessionWriteOutput = z.object({
  id: z.number(),
  created: z.boolean(),
  possibleDuplicate: z.boolean(),
  targetId: z.string(),
});

const recordFromHealthConnectOutput = z.object({
  eventId: z.number(),
  window: windowSummaryShape,
  coachContext: coachContextShape,
  targetId: z.string(),
});

export const sleepRouter = {
  /**
   * Rolling sleep window summary. Defaults to the last 30 days when `days` is
   * omitted; clamps at `[7, 365]` at the schema boundary.
   */
  summary: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(summaryInput))
    .input(summaryInput)
    .output(windowSummaryShape)
    .handler(async ({ input, context }) =>
      getSleepSummary(context.db, context.authz.activeOrganizationId, input.days ?? 30),
    ),

  /**
   * Full per-day list (no date-window filtering). Used by the AI coach
   * (#13) and any future chart consumers.
   */
  listDailySummaries: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(listDailyInput))
    .input(listDailyInput)
    .output(z.array(dailySummaryShape))
    .handler(async ({ input, context }) =>
      listSleepDailySummaries(context.db, context.authz.activeOrganizationId, input.days ?? 90),
    ),

  /**
   * Ingest a `health_event` sleep-session row from Health Connect (or any
   * compatible ingestion source). The handler writes the row, then derives
   * the updated sleep window so callers get an authoritative response
   * without a follow-up round trip.
   *
   * Org/user are taken from authz only — the schema is `strictObject` and
   * any payload attempt to override `organizationId` / `userId` is rejected
   * with `INVALID_INPUT` before authz runs. The audit row is written
   * exactly once on success.
   */
  recordFromHealthConnect: protectedProcedure
    .use(validateInput(recordFromHealthConnectInput))
    .input(recordFromHealthConnectInput)
    .output(recordFromHealthConnectOutput)
    .handler(async ({ input, context }) => {
      let authz;
      try {
        authz = await requirePermission(context.honoContext, {
          resource: "records",
          action: "write",
        });
      } catch (error) {
        if (error instanceof AuthzHttpError) {
          throw raiseApiError(error.code, error.message);
        }
        throw raiseApiError("INTERNAL", "Authorization failed.");
      }

      const { healthEvent } = await import("@openvalens/db/schema/health-record");
      const db = context.db;
      const organizationId = authz.activeOrganizationId;

      const [row] = await db
        .insert(healthEvent)
        .values({
          organizationId,
          eventType: "sleep_session",
          eventAt: new Date(input.eventAt),
          title: input.title ?? null,
          payloadJson: input.payloadJson,
          sourceEventId: input.sourceEventId ?? null,
          dedupeHash: input.dedupeHash,
        })
        .returning({ id: healthEvent.id });
      if (!row) throw new Error("Sleep event insert did not return a row");

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_CREATED" satisfies AuditEventType,
        targetType: "health_event",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: { source: "health_connect", eventType: "sleep_session" },
      });

      // Re-derive the window so the caller sees the post-ingest state. The
      // window is bounded to the last 30 days (matches `sleep.summary`'s
      // default) — long windows are not a useful shape here.
      const window = await getSleepSummary(db, organizationId, 30);

      return {
        eventId: row.id,
        window,
        coachContext: buildSleepCoachContext(window),
        targetId: String(row.id),
      };
    }),

  /**
   * Log a night by hand (#440): bedtime, wake time and an optional quality
   * from 1 to 5. Stored as its own `sleep_session` event marked manual — it
   * never overwrites or merges into device sleep. An overlap with a device
   * night comes back as `possibleDuplicate`, and the device night counts in
   * the totals. Retrying the same night is a no-op (`created: false`).
   */
  logManualSession: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(logManualSessionInput))
    .input(logManualSessionInput)
    .output(manualSessionWriteOutput)
    .handler(async ({ input, context }) => {
      const checked = checkManualSleepWindow(input.startAt, input.endAt);
      if (!checked.ok) throw raiseApiError("INVALID_INPUT", `Sleep window: ${checked.error}.`);
      const organizationId = context.authz.activeOrganizationId;
      const userId = context.authz.user.id;
      const { id, created } = await insertManualSleepSession(context.db, {
        organizationId,
        userId,
        startAt: checked.window.startAt,
        endAt: checked.window.endAt,
        quality: input.quality ?? null,
        dedupeHash: manualSleepDedupeHash(checked.window),
      });
      if (created)
        await writeAuditLog({
          db: context.db,
          organizationId,
          actorUserId: userId,
          eventType: "RECORD_CREATED" satisfies AuditEventType,
          targetType: "health_event",
          targetId: String(id),
          correlationId: context.correlationId,
          metadata: { source: "manual", eventType: "sleep_session" },
        });
      const possibleDuplicate = await overlapsDeviceSleep(context.db, {
        organizationId,
        startAt: checked.window.startAt,
        endAt: checked.window.endAt,
      });
      return { id, created, possibleDuplicate, targetId: String(id) };
    }),

  /** The member's own manual nights, newest first, with possible duplicates flagged. */
  manualSessions: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(manualSessionsInput))
    .input(manualSessionsInput)
    .output(z.array(manualSessionShape))
    .handler(async ({ input, context }) =>
      listManualSleepSessions(context.db, {
        organizationId: context.authz.activeOrganizationId,
        userId: context.authz.user.id,
        days: input.days ?? 30,
      }),
    ),

  /** Remove one of the member's own manual nights. Device sleep can't be removed here. */
  deleteManualSession: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(deleteManualSessionInput))
    .input(deleteManualSessionInput)
    .output(z.object({ deleted: z.boolean(), targetId: z.string() }))
    .handler(async ({ input, context }) => {
      const organizationId = context.authz.activeOrganizationId;
      const userId = context.authz.user.id;
      const deleted = await deleteManualSleepSession(context.db, {
        organizationId,
        userId,
        id: input.id,
      });
      if (!deleted) throw raiseApiError("NOT_FOUND", "Manual sleep session not found.");
      await writeAuditLog({
        db: context.db,
        organizationId,
        actorUserId: userId,
        eventType: "RECORD_DELETED" satisfies AuditEventType,
        targetType: "health_event",
        targetId: String(input.id),
        correlationId: context.correlationId,
        metadata: { source: "manual", eventType: "sleep_session" },
      });
      return { deleted, targetId: String(input.id) };
    }),
};
