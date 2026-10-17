import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import {
  buildNutritionCoachContext,
  createNutritionCoachConsent,
  NUTRITION_COACH_DEFAULT_WINDOW_DAYS,
  NUTRITION_COACH_NUTRIENTS,
  NUTRIENT_COVERAGE,
  type NutritionCoachContext as NutritionCoachContextPayload,
} from "@openvalens/nutrition";
import { tool } from "ai";
import { z } from "zod";

import { AiConsentError, requireAiConsent } from "../consent";
import { logToolExecuted, type AiHealthToolContext } from "./access";
import { datePart, daysBefore, unavailableReason } from "./format";
import { createDomainHealthToolSources, type AiHealthToolSources } from "./sources";

/**
 * `nutritionContext` tool (Issue #86).
 *
 * Sends a minimal, sanitized nutrition summary into the Coach conversation,
 * and only when the member has explicitly, currently opted in. Three gates are
 * re-checked at execution time — never when the tool list is built — so a
 * revocation or a downgraded role takes effect on the very next call:
 *
 * 1. `records:read` permission,
 * 2. the org + per-user AI consent (#13/#123), and
 * 3. the member's Coach nutrition-context consent (#86),
 *    `@openvalens/nutrition`'s `createNutritionCoachConsent`.
 *
 * Privacy: the tool returns only aggregates over the member's own logged days
 * (`buildNutritionCoachContext`), never foods, brands, ids, dates or per-day
 * arrays. When the member opted out of numbers it returns coverage only, so no
 * numeric value reaches the provider. Logs carry statuses, counts and booleans
 * only — never a measured value.
 *
 * The summary is not clinical: it describes recorded estimates and their
 * uncertainty and cannot change a target, log or reminder.
 */

export const nutritionContextInput = z.strictObject({
  windowDays: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(NUTRITION_COACH_DEFAULT_WINDOW_DAYS)
    .describe(
      `How many of the user's most recent days to summarise (1-30, default ${NUTRITION_COACH_DEFAULT_WINDOW_DAYS}).`,
    ),
});

const contextShape: z.ZodType<NutritionCoachContextPayload> = z.object({
  windowDays: z.number(),
  loggedDays: z.number(),
  completeDays: z.number(),
  coverage: z.enum(NUTRIENT_COVERAGE),
  numbersHidden: z.boolean(),
  averages: z.record(z.enum(NUTRITION_COACH_NUTRIENTS), z.number().nullable()).nullable(),
  notes: z.array(z.string()),
});

export const nutritionContextOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    context: contextShape,
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    context: contextShape,
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type NutritionContextInput = z.input<typeof nutritionContextInput>;
export type NutritionContextOutput = z.infer<typeof nutritionContextOutput>;

type ResolvedNutritionAccess =
  | {
      allowed: true;
      includeNumbers: boolean;
      sources: AiHealthToolSources;
      now: Date;
      logger: StructuredLogger;
    }
  | {
      allowed: false;
      reason: "permission_denied" | "consent_required";
      now: Date;
      logger: StructuredLogger;
    };

/**
 * Fresh permission + consent check performed at tool execution time. Fails
 * closed on any unexpected error and logs only a status, never a value.
 */
export async function resolveNutritionToolAccess(
  context: AiHealthToolContext,
  toolName: string,
): Promise<ResolvedNutritionAccess> {
  const now = context.now?.() ?? new Date();
  const logger = context.logger ?? createStructuredLogger({ level: "info" });

  let permitted = false;
  try {
    permitted = await context.canReadRecords();
  } catch {
    permitted = false;
  }
  if (!permitted) {
    logger.warn("ai.tool.blocked", {
      correlationId: context.correlationId,
      organizationId: context.organizationId,
      tool: toolName,
      reason: "permission_denied",
    });
    return { allowed: false, reason: "permission_denied", now, logger };
  }

  // Org + per-user AI consent (#13/#123); a revoked grant fails here.
  try {
    await requireAiConsent(context.db, context.organizationId, "chat", context.userId);
  } catch (error) {
    logger.warn("ai.tool.blocked", {
      correlationId: context.correlationId,
      organizationId: context.organizationId,
      tool: toolName,
      reason: "consent_required",
      ...(error instanceof AiConsentError ? {} : { error }),
    });
    return { allowed: false, reason: "consent_required", now, logger };
  }

  // Nutrition-context consent (#86); revocation fails here on the next call.
  let includeNumbers = false;
  try {
    const consent = await createNutritionCoachConsent(context.db).require({
      organizationId: context.organizationId,
      userId: context.userId,
    });
    includeNumbers = consent.includeNumbers;
  } catch (error) {
    logger.warn("ai.tool.blocked", {
      correlationId: context.correlationId,
      organizationId: context.organizationId,
      tool: toolName,
      reason: "consent_required",
      ...(error instanceof Error && error.name === "NutritionCoachConsentError" ? {} : { error }),
    });
    return { allowed: false, reason: "consent_required", now, logger };
  }

  return {
    allowed: true,
    includeNumbers,
    sources: context.sources ?? createDomainHealthToolSources(context.db),
    now,
    logger,
  };
}

/** Freshly reads the member's own daily totals and builds the sanitized context. */
export async function executeNutritionContext(
  context: AiHealthToolContext,
  input: NutritionContextInput,
): Promise<NutritionContextOutput> {
  const access = await resolveNutritionToolAccess(context, "nutritionContext");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const windowDays = input.windowDays ?? NUTRITION_COACH_DEFAULT_WINDOW_DAYS;
  const to = datePart(access.now.toISOString());
  const from = daysBefore(access.now, windowDays - 1);

  const days = await access.sources.listNutritionDailyTotals(
    { organizationId: context.organizationId, userId: context.userId },
    { from, to },
  );
  const built = buildNutritionCoachContext(days, { includeNumbers: access.includeNumbers });
  const status = built.loggedDays === 0 ? "no_data" : "ok";

  logToolExecuted(context, access.logger, "nutritionContext", status, {
    windowDays,
    loggedDays: built.loggedDays,
    completeDays: built.completeDays,
    coverage: built.coverage,
    numbersHidden: built.numbersHidden,
  });

  return { status, context: built, generatedAt: access.now.toISOString() };
}

export function createNutritionContextTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Summarise the user's own logged nutrition over their last N days (1-30, default 7), " +
      "only when they have explicitly opted in to sharing it with the Coach. Returns per logged " +
      "day averages for energy, protein, carbohydrate, fat and fibre, plus how complete the log is. " +
      "It never returns foods, brands, entry ids or dates, and returns coverage only when the user " +
      "withheld numbers. This is a description of recorded estimates with their uncertainty, not " +
      "medical advice: never diagnose, infer metabolism, prescribe restriction, or change a target, " +
      "food log or reminder.",
    inputSchema: nutritionContextInput,
    execute: async (input) => executeNutritionContext(context, input),
  });
}
