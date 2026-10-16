import { resolveSessionIdentity } from "@openvalens/auth/authz/trusted-session";
import { createStructuredLogger } from "@openvalens/observability";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import {
  evidenceLibraryInput,
  evidenceLibraryResultSchema,
  preventiveCareGetInput,
  preventiveCareResultSchema,
  preventiveDeclareInput,
  preventiveItemUpdateInput,
  preventiveSettingsOutput,
  preventiveSettingsUpdateInput,
} from "../preventive-care-contract";
import {
  createPreventiveCareService,
  PreventiveCareError,
  type PreventiveAccess,
  type PreventiveScope,
} from "../preventive-care";

/**
 * Issue #97 — preventive care by region.
 *
 * - `preventiveCare.get`        — the region's cited guideline items for the
 *                                 signed-in workspace owner, filtered by #98
 *                                 age range / sex and their own declarations.
 * - `preventiveCare.declare`    — answer or clear a self-declared criterion.
 * - `preventiveCare.updateItem` — done date, next date, reminder, plan.
 * - `preventiveCare.settings.update` — turn the evidence-check library on/off.
 * - `preventiveCare.library`    — the evidence-check library (empty while off).
 *
 * Organization and user come only from the trusted session/authz context.
 * Only the workspace owner sees or changes anything; other members get
 * `owner_only`. Mutations refuse impersonated sessions. Logs carry item ids,
 * criterion ids, changed field names and counts — never an answer or a date.
 */

const logger = createStructuredLogger({ level: "info" });

type Authz = { activeOrganizationId: string; user: { id: string }; role: string };

function scopeOf(authz: Authz): PreventiveScope {
  return { organizationId: authz.activeOrganizationId, userId: authz.user.id };
}

function accessOf(context: Context, authz: Authz): PreventiveAccess {
  const identity = resolveSessionIdentity(context.session);
  const isOwner = authz.role === "owner";
  return { isOwner, canEdit: isOwner && identity !== null && !identity.impersonated };
}

function mapError(error: unknown): never {
  if (error instanceof PreventiveCareError) {
    if (error.code === "DENIED")
      throw raiseApiError(
        "PERMISSION_DENIED",
        "You do not have permission to perform this action.",
      );
    throw raiseApiError("INVALID_INPUT", "Invalid input", { reason: error.reason });
  }
  if (error instanceof ORPCError) throw error;
  throw raiseApiError("INTERNAL", "Something went wrong.");
}

const okOutput = z.object({ ok: z.literal(true) });

export const preventiveCareRouter = {
  get: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(preventiveCareGetInput))
    .input(preventiveCareGetInput)
    .output(preventiveCareResultSchema)
    .handler(async ({ context }) => {
      try {
        const result = await createPreventiveCareService({ db: context.db }).get(
          scopeOf(context.authz),
          accessOf(context, context.authz),
        );
        logger.info("preventive_care.get", {
          correlationId: context.correlationId,
          status: result.status,
          packVersion: result.packVersion,
          shown: result.items.length,
          notShown: result.notShown.length,
        });
        return result;
      } catch (error) {
        mapError(error);
      }
    }),

  declare: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(preventiveDeclareInput))
    .input(preventiveDeclareInput)
    .output(okOutput)
    .handler(async ({ context, input }) => {
      try {
        await createPreventiveCareService({ db: context.db }).declare(
          scopeOf(context.authz),
          accessOf(context, context.authz),
          input.criterion,
          input.answer,
        );
        logger.info("preventive_care.declared", {
          correlationId: context.correlationId,
          criterion: input.criterion,
          cleared: input.answer === null,
        });
        return { ok: true as const };
      } catch (error) {
        mapError(error);
      }
    }),

  updateItem: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(preventiveItemUpdateInput))
    .input(preventiveItemUpdateInput)
    .output(okOutput)
    .handler(async ({ context, input }) => {
      try {
        const { changed } = await createPreventiveCareService({ db: context.db }).updateItem(
          scopeOf(context.authz),
          accessOf(context, context.authz),
          input,
        );
        logger.info("preventive_care.item_updated", {
          correlationId: context.correlationId,
          itemId: input.itemId,
          changed,
        });
        return { ok: true as const };
      } catch (error) {
        mapError(error);
      }
    }),

  settings: {
    update: permissionedProcedure({ resource: "records", action: "read" })
      .use(validateInput(preventiveSettingsUpdateInput))
      .input(preventiveSettingsUpdateInput)
      .output(preventiveSettingsOutput)
      .handler(async ({ context, input }) => {
        try {
          const result = await createPreventiveCareService({
            db: context.db,
          }).setLibraryEnabled(
            scopeOf(context.authz),
            accessOf(context, context.authz),
            input.libraryEnabled,
          );
          logger.info("preventive_care.settings_updated", {
            correlationId: context.correlationId,
            libraryEnabled: result.libraryEnabled,
          });
          return result;
        } catch (error) {
          mapError(error);
        }
      }),
  },

  library: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(evidenceLibraryInput))
    .input(evidenceLibraryInput)
    .output(evidenceLibraryResultSchema)
    .handler(async ({ context }) => {
      try {
        return await createPreventiveCareService({ db: context.db }).library(
          scopeOf(context.authz),
          accessOf(context, context.authz),
        );
      } catch (error) {
        mapError(error);
      }
    }),
};
