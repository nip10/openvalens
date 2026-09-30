import { writeAuditLog } from "@openhealth/audit-security";
import { AuthzHttpError, requirePermission } from "@openhealth/auth/authz/guard";
import {
  createCockpitRepository,
  deriveCockpitState,
  generateWeeklyReport,
  type CockpitInputs,
  type CockpitReviewRow,
  type CockpitSleepInput,
  type CockpitState,
  type WeeklyReport,
  type WeeklySlices,
} from "@openhealth/cockpit";
import { z } from "zod";

import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Cockpit oRPC surface (Issue #16).
 *
 * Four procedures:
 *
 * - `cockpit.today`         — read; `permissionedProcedure` on the
 *   `records` resource. Returns the deterministic
 *   `CockpitState` (readiness / blockers / confidence / rationale)
 *   plus the sanitized inputs the engine consumed.
 * - `cockpit.weekly`        — read; same permission. Returns the
 *   sanitized weekly slice summary (counts, adherence, status).
 * - `cockpit.weeklyReport`  — read; same permission. Returns the
 *   markdown draft + structured sections + meta (which sections fell
 *   back). Pure — caller owns the slices.
 * - `cockpit.logReview`     — write; composed on `protectedProcedure` +
 *   `validateInput(strictObject)` + manual `requirePermission` +
 *   `writeAuditLog`. Mirrors the body #21 / sleep #18 / plans #22
 *   pattern.
 *
 * Cross-domain reads are bound through the {@link createCockpitFacades}
 * factory: each facade receives its own domain read function, never
 * reaches into another package's tables directly. The facades can
 * be swapped out at test time so each procedure is fully
 * deterministic and never touches real DBs.
 *
 * No PHI is logged. Review notes round-trip as opaque strings the
 * caller owns. Logs contain only counts, IDs, and the correlation id.
 */

const todayInputSchema = z.strictObject({
  nowIso: z.string().min(1).optional(),
  latestBloodPanelIso: z.string().nullish(),
  latestWorkoutIso: z.string().nullish(),
  outOfRangeMarkers: z.number().int().min(0).max(200).optional(),
  sleep: z
    .object({
      status: z.string().min(1).max(80),
      confidence: z.enum(["low", "medium", "high"]),
      lastNightMinutes: z.number().int().min(0).max(1440).nullable(),
      sevenDayAverageMinutes: z.number().int().min(0).max(1440).nullable(),
      averageSleepDebtMinutes: z.number().int().min(0).max(1440).nullable(),
    })
    .nullish(),
  activeGoalsCount: z.number().int().min(0).max(200).optional(),
  recentInsightsCount: z.number().int().min(0).max(500).optional(),
  blockerFlags: z.record(z.string().min(1).max(80), z.boolean()).optional(),
});

const weeklyInputSchema = z.strictObject({
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  weightStartKg: z.number().finite().min(20).max(400).nullish(),
  weightEndKg: z.number().finite().min(20).max(400).nullish(),
  weightSampleCount: z.number().int().min(0).max(366).optional(),
  activeGoalsCount: z.number().int().min(0).max(200).optional(),
  latestCheckinDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  latestCheckinSnippet: z.string().trim().max(2000).nullish(),
  adherence: z.number().int().min(1).max(10).nullish(),
  energy: z.number().int().min(1).max(10).nullish(),
  sleep: z.number().int().min(1).max(10).nullish(),
  adherenceNotes: z.string().trim().max(2000).nullish(),
  sleepAverageMinutes: z.number().int().min(0).max(1440).nullish(),
  sleepDebtMinutes: z.number().int().min(0).max(1440).nullish(),
  sleepStatus: z.string().min(1).max(80).nullish(),
  sleepConfidence: z.enum(["low", "medium", "high"]).nullish(),
  upcomingEvents: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        frequency: z.string().trim().min(1).max(80),
      }),
    )
    .max(20)
    .optional(),
  otherRelevant: z.string().trim().max(2000).nullish(),
});

const logReviewSchema = z.strictObject({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adherence: z.number().int().min(1).max(10).nullish(),
  energy: z.number().int().min(1).max(10).nullish(),
  sleep: z.number().int().min(1).max(10).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const sleepShape = z.object({
  status: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  lastNightMinutes: z.number().nullable(),
  sevenDayAverageMinutes: z.number().nullable(),
  averageSleepDebtMinutes: z.number().nullable(),
});

const cockpitStateShape = z.object({
  readiness: z.enum(["train", "partial", "hold"]),
  blockers: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  rationale: z.object({
    freshness: z.object({
      blood: z.object({
        status: z.enum(["fresh", "aging", "stale", "missing"]),
        ageDays: z.number().nullable(),
      }),
      workout: z.object({
        status: z.enum(["fresh", "aging", "stale", "missing"]),
        ageDays: z.number().nullable(),
      }),
    }),
    sleep: sleepShape.optional(),
    scores: z.object({ readiness: z.number(), confidence: z.number() }),
    reasons: z.array(
      z.enum([
        "active_blockers_present",
        "blood_data_stale",
        "workout_data_stale",
        "sleep_debt",
        "sleep_data_low_confidence",
      ]),
    ),
  }),
});

const cockpitInputsShape: z.ZodType<CockpitInputs> = z.object({
  nowIso: z.string(),
  lastBloodPanelIso: z.string().nullable(),
  lastWorkoutIso: z.string().nullable(),
  outOfRangeMarkers: z.number(),
  sleep: sleepShape.nullable(),
  activeGoalsCount: z.number(),
  recentInsightsCount: z.number(),
  blockerFlags: z.record(z.string(), z.boolean()).optional(),
});

const todayOutputSchema = z.object({
  state: cockpitStateShape,
  inputs: cockpitInputsShape,
});

const weeklyReportShape = z.object({
  weekRange: z.object({ start: z.string(), end: z.string() }),
  generatedAt: z.string(),
  sections: z.object({
    weightProgress: z.string(),
    goalsProgression: z.string(),
    adherence: z.string(),
    sleepRecovery: z.string(),
    upcomingEvents: z.string(),
    otherRelevant: z.string(),
  }),
  meta: z.object({
    hasPartialData: z.boolean(),
    fallbackSections: z.array(z.string()),
  }),
  messageDraft: z.string(),
});

const logReviewOutputSchema = z.object({
  id: z.number(),
  weekStart: z.string(),
  targetId: z.string(),
});

async function requireCockpitAuthz(
  context: { honoContext: { req: { raw: { headers: Headers } } }; db: unknown },
  resource: "records",
  action: "read" | "write",
) {
  try {
    return await requirePermission(context.honoContext as never, { resource, action });
  } catch (error) {
    if (error instanceof AuthzHttpError) {
      throw raiseApiError(error.code, error.message);
    }
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

/**
 * Build the deterministic cockpit state from a sanitized `CockpitInputs`.
 * Exposed so tests can exercise the engine end-to-end without standing
 * up a router.
 */
export function buildCockpitToday(inputs: CockpitInputs): CockpitState {
  return deriveCockpitState({
    nowIso: inputs.nowIso,
    lastBloodPanelIso: inputs.lastBloodPanelIso,
    lastWorkoutIso: inputs.lastWorkoutIso,
    blockerFlags: inputs.blockerFlags ?? {},
    sleep: inputs.sleep ?? undefined,
  });
}

/**
 * Compose a weekly report from caller-supplied slices. Pure — the
 * caller owns the slices and is responsible for scoping them to the
 * active org. Exposed so tests can exercise the report without the
 * router.
 */
export function buildWeeklyReportPayload(
  now: Date,
  weekStart: string | undefined,
  slices: WeeklySlices,
): WeeklyReport {
  return generateWeeklyReport({ now, weekStart, slices });
}

export const cockpitRouter = {
  /**
   * Render the deterministic "today" cockpit state for the active org.
   * Inputs are passed through `validateInput(strictObject)` so a
   * foreign-tenant attempt (or a payload attempt to override
   * `organizationId` / `userId`) is rejected with `INVALID_INPUT` at
   * the boundary before authz runs.
   *
   * Cross-domain reads are bound through typed contracts — this
   * router never reaches into another package's tables. The caller
   * composes the sanitized inputs (weight trend, latest blood panel,
   * sleep coach context, recent insights count, etc.) and hands the
   * resulting shape to the engine.
   */
  today: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(todayInputSchema))
    .input(todayInputSchema)
    .output(todayOutputSchema)
    .handler(async ({ input, context }) => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      const inputs: CockpitInputs = {
        nowIso,
        lastBloodPanelIso: input.latestBloodPanelIso ?? null,
        lastWorkoutIso: input.latestWorkoutIso ?? null,
        outOfRangeMarkers: input.outOfRangeMarkers ?? 0,
        sleep: (input.sleep ?? null) as CockpitSleepInput | null,
        activeGoalsCount: input.activeGoalsCount ?? 0,
        recentInsightsCount: input.recentInsightsCount ?? 0,
        blockerFlags: input.blockerFlags,
      };
      const state = buildCockpitToday(inputs);
      // The active org comes from authz; we don't echo it back, but the
      // authz context is what gates this read in the first place.
      void context.authz;
      return { state, inputs };
    }),

  /**
   * Render the weekly slice summary for the active org. Pure — the
   * caller passes the slices in. Mirrors the anchor `weekly-report`
   * helper shape.
   */
  weekly: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(weeklyInputSchema))
    .input(weeklyInputSchema)
    .output(weeklyReportShape)
    .handler(async ({ input, context }) => {
      const now = new Date();
      const slices: WeeklySlices = {
        weightProgress:
          input.weightStartKg != null && input.weightEndKg != null
            ? {
                startKg: input.weightStartKg,
                endKg: input.weightEndKg,
                deltaKg: input.weightEndKg - input.weightStartKg,
                sampleCount: input.weightSampleCount ?? 1,
              }
            : null,
        goalsProgression: {
          activeGoalsCount: input.activeGoalsCount ?? 0,
          latestCheckinDate: input.latestCheckinDate ?? null,
          latestCheckinSnippet: input.latestCheckinSnippet ?? null,
        },
        adherence: {
          adherence: input.adherence ?? null,
          energy: input.energy ?? null,
          sleep: input.sleep ?? null,
          notesSnippet: input.adherenceNotes ?? null,
        },
        sleepRecovery: {
          sevenDayAverageMinutes: input.sleepAverageMinutes ?? null,
          averageSleepDebtMinutes: input.sleepDebtMinutes ?? null,
          status: input.sleepStatus ?? null,
          confidence: input.sleepConfidence ?? null,
        },
        upcomingEvents: { items: input.upcomingEvents ?? [] },
        otherRelevant: input.otherRelevant ?? null,
      };
      void context.authz;
      return buildWeeklyReportPayload(now, input.weekStart, slices);
    }),

  /**
   * Render the markdown draft for the active org's weekly report.
   * Same shape as `cockpit.weekly` — split into a separate procedure
   * so clients that only need the markdown don't pay for the
   * structured sections.
   */
  weeklyReport: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(weeklyInputSchema))
    .input(weeklyInputSchema)
    .output(
      z.object({
        messageDraft: z.string(),
        meta: z.object({ hasPartialData: z.boolean(), fallbackSections: z.array(z.string()) }),
      }),
    )
    .handler(async ({ input, context }) => {
      const now = new Date();
      const slices: WeeklySlices = {
        weightProgress:
          input.weightStartKg != null && input.weightEndKg != null
            ? {
                startKg: input.weightStartKg,
                endKg: input.weightEndKg,
                deltaKg: input.weightEndKg - input.weightStartKg,
                sampleCount: input.weightSampleCount ?? 1,
              }
            : null,
        goalsProgression: {
          activeGoalsCount: input.activeGoalsCount ?? 0,
          latestCheckinDate: input.latestCheckinDate ?? null,
          latestCheckinSnippet: input.latestCheckinSnippet ?? null,
        },
        adherence: {
          adherence: input.adherence ?? null,
          energy: input.energy ?? null,
          sleep: input.sleep ?? null,
          notesSnippet: input.adherenceNotes ?? null,
        },
        sleepRecovery: {
          sevenDayAverageMinutes: input.sleepAverageMinutes ?? null,
          averageSleepDebtMinutes: input.sleepDebtMinutes ?? null,
          status: input.sleepStatus ?? null,
          confidence: input.sleepConfidence ?? null,
        },
        upcomingEvents: { items: input.upcomingEvents ?? [] },
        otherRelevant: input.otherRelevant ?? null,
      };
      void context.authz;
      const report = buildWeeklyReportPayload(now, input.weekStart, slices);
      return {
        messageDraft: report.messageDraft,
        meta: report.meta,
      };
    }),

  /**
   * Persist the active org's weekly review row. Mirrors the
   * `weeklyReview` schema and writes one `RECORD_CREATED` audit row.
   * The procedure is org-scoped via authz; orgId/userId is never
   * taken from input.
   */
  logReview: protectedProcedure
    .use(validateInput(logReviewSchema))
    .input(logReviewSchema)
    .output(logReviewOutputSchema)
    .handler(async ({ input, context }) => {
      const authz = await requireCockpitAuthz(context, "records", "write");
      const row: CockpitReviewRow = await createCockpitRepository(context.db).logReview(
        authz.activeOrganizationId,
        {
          weekStart: input.weekStart,
          adherence: input.adherence ?? null,
          energy: input.energy ?? null,
          sleep: input.sleep ?? null,
          notes: input.notes ?? null,
        },
      );

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "cockpit_review",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: { resource: "records", action: "write", weekStart: row.weekStart },
      });

      return {
        id: row.id,
        weekStart: row.weekStart,
        targetId: String(row.id),
      };
    }),
};
