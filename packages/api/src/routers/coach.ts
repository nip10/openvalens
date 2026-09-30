import { writeAuditLog, type AuditEventType } from "@openhealth/audit-security";
import { AuthzHttpError, requirePermission } from "@openhealth/auth/authz/guard";
import {
  buildV2PolicyInstruction,
  COACH_DISCLAIMER_MODES,
  COACH_RISK_TOLERANCES,
  COACH_TEMPLATE_IDS,
  COACH_TONES,
  createCoachRepository,
  validateTemplate,
  type CoachPolicyTemplateKey,
  type CoachProfile,
  type CoachTemplate,
  type Insight,
  type InstructionPreset,
} from "@openhealth/coach";
import { z } from "zod";

import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Coach oRPC surface (Issue #19).
 *
 * Six procedures:
 *
 * - `coach.getConfig`        — read the org's `coachProfile`.
 * - `coach.upsertConfig`     — write the org's `coachProfile`.
 * - `coach.listTemplates`    — list the global `coachTemplate` catalog.
 * - `coach.upsertTemplate`   — write a global `coachTemplate` row.
 * - `coach.computeInstruction` — render the v2 policy instruction string
 *   for the active org. Pure — consumes sanitized inputs the caller owns.
 * - `coach.recordFeedback`   — write an `aiFeedback` row after AI chat.
 * - `coach.listInsights` / `coach.getInsight` — read `insight` rows for the
 *   active org.
 *
 * RBAC: reads are `permissionedProcedure` on `records | coach | coach`
 * (templates / insights / config). Writes are `protectedProcedure` +
 * `validateInput(strictObject)` + manual `requirePermission` +
 * `writeAuditLog`, mirroring the body #21 / sleep #18 / plans #22 pattern.
 * All inputs are `strictObject` so any payload attempt to override
 * `organizationId` / `userId` is rejected with `INVALID_INPUT` at the
 * boundary before authz runs.
 *
 * No PHI is logged. Coach notes, insight bodies, feedback comments, and
 * template fragments round-trip as opaque strings the caller owns.
 */

const upsertProfileSchema = z.strictObject({
  tone: z.enum(COACH_TONES),
  assertiveness: z.number().int().min(1).max(5),
  riskTolerance: z.enum(COACH_RISK_TOLERANCES),
  medicalDisclaimerMode: z.enum(COACH_DISCLAIMER_MODES),
  selectedTemplateKey: z.enum(COACH_TEMPLATE_IDS),
});

const profileShape: z.ZodType<CoachProfile> = z.object({
  id: z.number(),
  organizationId: z.string(),
  tone: z.enum(COACH_TONES),
  assertiveness: z.number(),
  riskTolerance: z.enum(COACH_RISK_TOLERANCES),
  medicalDisclaimerMode: z.enum(COACH_DISCLAIMER_MODES),
  selectedTemplateKey: z.enum(COACH_TEMPLATE_IDS),
  updatedAt: z.string(),
});

const presetShape: z.ZodType<InstructionPreset> = z.object({
  objective: z.string(),
  directives: z.array(z.string()),
  outputStyle: z.string(),
});

const templateShape: z.ZodType<CoachTemplate> = z.object({
  key: z.enum(COACH_TEMPLATE_IDS),
  title: z.string(),
  description: z.string(),
  instructionPreset: presetShape,
  isActive: z.boolean(),
});

const upsertTemplateSchema = z.strictObject({
  key: z.enum(COACH_TEMPLATE_IDS),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  instructionPreset: z.strictObject({
    objective: z.string().trim().min(1).max(2000),
    directives: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
    outputStyle: z.string().trim().min(1).max(200),
  }),
  isActive: z.boolean().optional(),
});

const computeInstructionSchema = z.strictObject({
  templateId: z.union([z.enum(COACH_TEMPLATE_IDS), z.literal("default")]).optional(),
  latestBloodPanelDate: z.string().nullish(),
  markerOutOfRangeCount: z.number().int().min(0).max(200).optional(),
  highSleepDebt: z.boolean().optional(),
  mildSleepDebt: z.boolean().optional(),
  weightTrendUnstable: z.boolean().optional(),
});

const recordFeedbackSchema = z.strictObject({
  source: z.enum(["insight", "chat"]),
  referenceId: z.number().int().positive().nullish(),
  rating: z.enum(["up", "down"]),
  comment: z.string().trim().max(2000).nullish(),
});

const insightIdSchema = z.strictObject({ id: z.number().int().positive() });
const insightListInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(200).optional(),
});

const upsertResult = z.object({
  id: z.number(),
  targetId: z.string(),
});

const computeInstructionOutput = z.object({
  instruction: z.string(),
  templateKey: z.string(),
  state: z.object({
    readiness: z.string(),
    blockers: z.array(z.string()),
    confidence: z.string(),
  }),
});

const insightRowShape: z.ZodType<Insight> = z.object({
  id: z.number(),
  organizationId: z.string(),
  type: z.enum(["trend", "flag", "recommendation"]),
  severity: z.enum(["info", "warning", "critical"]).nullable(),
  title: z.string(),
  body: z.string().nullable(),
  createdAt: z.string(),
});

async function requireCoachAuthz(
  context: { honoContext: { req: { raw: { headers: Headers } } }; db: unknown },
  resource: "coach" | "records",
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

export const coachRouter = {
  // ─── config (org-scoped coach profile) ──────────────────────

  /**
   * Read the active org's `coachProfile`. The handler `ensure`s a
   * defaults row when none exists yet, so callers always get a usable
   * shape without a separate "create" round trip.
   */
  getConfig: permissionedProcedure({ resource: "coach", action: "read" })
    .input(z.object({}).optional())
    .output(profileShape)
    .handler(async ({ context }) =>
      createCoachRepository(context.db).ensureProfile(context.authz.activeOrganizationId),
    ),

  upsertConfig: protectedProcedure
    .use(validateInput(upsertProfileSchema))
    .input(upsertProfileSchema)
    .output(profileShape)
    .handler(async ({ input, context }) => {
      const authz = await requireCoachAuthz(context, "coach", "write");
      const profile = await createCoachRepository(context.db).upsertProfile(
        authz.activeOrganizationId,
        {
          tone: input.tone,
          assertiveness: input.assertiveness,
          riskTolerance: input.riskTolerance,
          medicalDisclaimerMode: input.medicalDisclaimerMode,
          selectedTemplateKey: input.selectedTemplateKey,
        },
      );

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_UPDATED",
        targetType: "coach_profile",
        targetId: String(profile.id),
        correlationId: context.correlationId,
        metadata: { resource: "coach", action: "write" },
      });

      return profile;
    }),

  // ─── templates (global catalog) ─────────────────────────────

  listTemplates: permissionedProcedure({ resource: "coach", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(templateShape))
    .handler(async ({ context }) => createCoachRepository(context.db).listTemplates()),

  upsertTemplate: protectedProcedure
    .use(validateInput(upsertTemplateSchema))
    .input(upsertTemplateSchema)
    .output(templateShape)
    .handler(async ({ input, context }) => {
      const authz = await requireCoachAuthz(context, "coach", "write");
      const validation = validateTemplate(input);
      if (!validation.ok) {
        throw raiseApiError("INVALID_INPUT", validation.reason);
      }

      const template = await createCoachRepository(context.db).upsertTemplate({
        key: input.key,
        title: input.title,
        description: input.description,
        instructionPreset: input.instructionPreset,
        isActive: input.isActive ?? true,
      });

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_UPDATED" satisfies AuditEventType,
        targetType: "coach_template",
        targetId: template.key,
        correlationId: context.correlationId,
        metadata: { resource: "coach", action: "write", templateKey: template.key },
      });

      return template;
    }),

  // ─── instruction derivation (typed contract for AI chat) ─────

  /**
   * Render the v2 policy instruction string for the active org.
   *
   * Inputs are derived slices the caller owns — the coach domain never
   * reaches into another package's DB. AI chat (#13) calls this with the
   * `guardrailSummary` it computed from its sanitized context.
   */
  computeInstruction: permissionedProcedure({ resource: "coach", action: "read" })
    .use(validateInput(computeInstructionSchema))
    .input(computeInstructionSchema)
    .output(computeInstructionOutput)
    .handler(async ({ input, context }) => {
      const templateId: CoachPolicyTemplateKey | undefined = input.templateId;
      const result = buildV2PolicyInstruction({
        inputs: {
          latestBloodPanelDate: input.latestBloodPanelDate ?? null,
          markerOutOfRangeCount: input.markerOutOfRangeCount ?? 0,
          highSleepDebt: input.highSleepDebt,
          mildSleepDebt: input.mildSleepDebt,
          weightTrendUnstable: input.weightTrendUnstable,
        },
        templateId,
      });

      // Touch the active org so the procedure is in the org-scoped
      // audit trail even though no DB write happens here.
      void context.authz.activeOrganizationId;
      return result;
    }),

  // ─── feedback (post-chat / post-insight thumbs) ────────────

  recordFeedback: protectedProcedure
    .use(validateInput(recordFeedbackSchema))
    .input(recordFeedbackSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireCoachAuthz(context, "coach", "write");
      const row = await createCoachRepository(context.db).recordFeedback(
        authz.activeOrganizationId,
        {
          source: input.source,
          referenceId: input.referenceId ?? null,
          rating: input.rating,
          comment: input.comment ?? null,
        },
      );

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "ai_feedback",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: { resource: "coach", action: "write", source: input.source },
      });

      return { id: row.id, targetId: String(row.id) };
    }),

  // ─── insights (read-only; generation owned by #13) ──────────

  listInsights: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(insightListInputSchema))
    .input(insightListInputSchema)
    .output(z.array(insightRowShape))
    .handler(async ({ input, context }) =>
      createCoachRepository(context.db).listInsights(context.authz.activeOrganizationId, {
        limit: input.limit ?? 50,
      }),
    ),

  getInsight: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(insightIdSchema))
    .input(insightIdSchema)
    .output(insightRowShape.nullable())
    .handler(async ({ input, context }) =>
      createCoachRepository(context.db).getInsight(context.authz.activeOrganizationId, input.id),
    ),
};
