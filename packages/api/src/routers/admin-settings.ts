import { z } from "zod";

import { requireAdmissionOrigin, safeAdmissionInput } from "../admission";
import { backupStatusSchema, readBackupStatus } from "../backup-status";
import {
  instanceAdminProcedure,
  o,
  protectedProcedure,
  raiseApiError,
  resolveInstanceAdminProcedure,
} from "../index";
import {
  productSettingsSnapshotSchema,
  productSettingsUpdateInput,
} from "../product-settings-contract";
import { mapProductSettingsError, requireProductSettingsService } from "../product-settings";

/**
 * Issue #58 — global, instance-administrator settings surface.
 *
 * `access` and `configuration` are the original session-only read surfaces.
 * `productSettings` is an authenticated read (any workspace, no org scope) that
 * returns the effective display settings plus a freshly resolved `canEdit`.
 * `updateProductSettings` additionally requires a fresh instance administrator
 * and an exact same-origin `Origin` header, enforced before the handler runs.
 *
 * No configuration value, user id, email or role string is ever returned.
 */

const accessOutput = z.object({
  isInstanceAdmin: z.boolean(),
});

const configurationEntryOutput = z.object({
  key: z.string(),
  configured: z.boolean(),
  sensitive: z.boolean(),
});

const configurationOutput = z.object({
  entries: z.array(configurationEntryOutput),
});

const aiUsageCountsShape = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number(),
  /** Estimated model cost in millionths of `currency`. */
  costMicros: z.number(),
  callCount: z.number(),
});

/**
 * Issue #299 — this month's AI usage. Accounts are opaque user ids only:
 * never an email, a name or anything the person wrote.
 */
export const aiUsageSummaryOutput = z.object({
  month: z.string(),
  resetsOn: z.string(),
  currency: z.string(),
  monthlyLimitMicros: z.number().nullable(),
  pricesConfigured: z.boolean(),
  totals: aiUsageCountsShape.extend({ accounts: z.number() }),
  top: z.array(aiUsageCountsShape.extend({ userId: z.string() })),
});

/**
 * Exact same-origin guard for mutations. Reuses the admission boundary guard:
 * a missing configured origin or missing context binding fails closed
 * (`INTERNAL`); a missing/null/foreign `Origin` header is a generic
 * `403 PERMISSION_DENIED`. Runs before input validation and the handler.
 */
const originGuard = o.middleware(async ({ context, next }) => {
  requireAdmissionOrigin(context);
  return next({});
});

export const adminSettingsRouter = {
  access: resolveInstanceAdminProcedure
    .input(z.object({}))
    .output(accessOutput)
    .handler(({ context }) => ({ isInstanceAdmin: context.instanceAdmin })),

  configuration: instanceAdminProcedure
    .input(z.object({}))
    .output(configurationOutput)
    .handler(({ context }) => {
      const inventory = context.adminConfigInventory;
      if (!inventory) {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }

      // Project exactly the three contract fields; any extra entry field is
      // ignored rather than forwarded.
      const entries = inventory.map((entry) => ({
        key: entry.key,
        configured: entry.configured,
        sensitive: entry.sensitive,
      }));

      return { entries };
    }),

  /**
   * Issue #64 — self-host backup status (last backup, last verify, last
   * failure step, next planned run). Value-free; instance administrators only.
   */
  backupStatus: instanceAdminProcedure
    .input(z.object({}))
    .output(backupStatusSchema)
    .handler(({ context }) => readBackupStatus(context.db)),

  /**
   * Issue #299 — AI usage this month (UTC): totals and the top accounts by
   * estimated cost, by opaque id. Instance administrators only.
   */
  aiUsage: instanceAdminProcedure
    .input(z.object({}))
    .output(aiUsageSummaryOutput)
    .handler(async ({ context }) => {
      if (!context.aiUsage) throw raiseApiError("INTERNAL", "Something went wrong.");
      try {
        const summary = await context.aiUsage.summary({ top: 10 });
        return {
          month: summary.month,
          resetsOn: summary.resetsOn,
          currency: summary.currency,
          monthlyLimitMicros: summary.monthlyLimitMicros,
          pricesConfigured: summary.pricesConfigured,
          totals: summary.totals,
          top: summary.top,
        };
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
    }),

  productSettings: protectedProcedure
    .input(z.object({}))
    .output(productSettingsSnapshotSchema)
    .handler(async ({ context }) => {
      try {
        const snapshot = await requireProductSettingsService(context).read(context.session);
        // Project exactly the four contract fields; any extra service field is
        // dropped rather than forwarded.
        return {
          units: snapshot.units,
          locale: snapshot.locale,
          revision: snapshot.revision,
          canEdit: snapshot.canEdit,
        };
      } catch (error) {
        mapProductSettingsError(error);
      }
    }),

  updateProductSettings: instanceAdminProcedure
    .use(originGuard)
    .use(safeAdmissionInput(productSettingsUpdateInput))
    .input(productSettingsUpdateInput)
    .output(productSettingsSnapshotSchema)
    .handler(async ({ context, input }) => {
      try {
        const snapshot = await requireProductSettingsService(context).update(
          input,
          context.session,
        );
        return {
          units: snapshot.units,
          locale: snapshot.locale,
          revision: snapshot.revision,
          canEdit: snapshot.canEdit,
        };
      } catch (error) {
        mapProductSettingsError(error);
      }
    }),
};
