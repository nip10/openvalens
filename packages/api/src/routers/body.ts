import {
  createDailyWeightService,
  listCanonicalDailyWeights,
  listLegacyCheckins,
} from "@openhealth/body";
import { z } from "zod";

import { permissionedProcedure, tenantScopedProcedure, validateInput } from "../index";

const boundedLimit = z.number().int().min(1).max(10);
const readInput = z.object({ limit: boundedLimit.optional() });
const dailyInput = z.object({ limit: z.number().int().min(1).max(90).optional() });

// The legacy endpoint accepts finite numeric values or non-empty numeric strings.
const measurement = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().finite());
const writeInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: measurement.pipe(z.number().min(20).max(400)),
  bodyFatPct: measurement.pipe(z.number().min(2).max(70)).nullish(),
  notes: z.string().nullish(),
  useAsDailyWeight: z.boolean().optional(),
});

const checkin = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  weightKg: z.number(),
  bodyFatPct: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
const canonical = z.object({
  id: z.number(),
  date: z.string(),
  weightKg: z.number(),
  source: z.string(),
  resolvedFromEventId: z.number().nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Organization and actor are exclusively derived from the RBAC guard; inputs cannot select a tenant. */
export const bodyRouter = {
  listCheckins: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(readInput))
    .input(readInput)
    .output(z.array(checkin))
    .handler(async ({ input, context }) =>
      listLegacyCheckins(context.db, context.authz.activeOrganizationId, input.limit ?? 5),
    ),

  dailyWeights: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(dailyInput))
    .input(dailyInput)
    .output(z.array(canonical))
    .handler(async ({ input, context }) =>
      listCanonicalDailyWeights(
        context.db,
        context.authz.activeOrganizationId,
        context.authz.user.id,
        input.limit ?? 90,
      ),
    ),

  writeManualWeight: tenantScopedProcedure({
    resource: "weight",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "weight_checkin",
  })
    .use(validateInput(writeInput))
    .input(writeInput)
    .output(checkin.extend({ targetId: z.string() }))
    .handler(async ({ input, context }) => {
      const entry = await createDailyWeightService(context.db).writeManualWeight({
        organizationId: context.authz.activeOrganizationId,
        userId: context.authz.user.id,
        date: input.date,
        weightKg: input.weightKg,
        bodyFatPct: input.bodyFatPct ?? null,
        notes: input.notes?.trim() || null,
        useAsDailyWeight: input.useAsDailyWeight === true,
      });
      return { ...entry, targetId: String(entry.id) };
    }),
};
