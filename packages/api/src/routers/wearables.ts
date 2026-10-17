import {
  WEARABLE_PROVIDER_IDS,
  WearableConnectError,
  WearableNotConnectedError,
  type WearablesService,
} from "@openvalens/wearables";
import { z } from "zod";

import type { Context } from "../context";
import {
  permissionedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";

/**
 * Cloud wearable connections (Issue #60). Phone-first ingestion is the main
 * path and needs none of this; these procedures only manage the optional
 * vendor links an operator enabled. Organization and user always come from
 * the session; the strict inputs accept a provider id and nothing that names
 * a workspace, person or token. Responses are status only: no token, vendor
 * user id or health value ever leaves the server.
 */

const provider = z.enum(WEARABLE_PROVIDER_IDS);

const providerInput = z.object({ provider }).strict();
const disconnectInput = z.object({ provider, deleteData: z.boolean() }).strict();
const quarantineInput = z.object({ provider, action: z.enum(["keep", "delete"]) }).strict();

const connectionOutput = z.object({
  provider,
  displayName: z.string(),
  sends: z.string(),
  termsUrl: z.string(),
  status: z.enum(["not_connected", "active", "reconnect_needed", "quarantined"]),
  lastSyncedAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  quarantinedRecordCount: z.number(),
});

export const wearablesListOutput = z.object({ providers: z.array(connectionOutput) });

function requireService(context: Context): WearablesService {
  if (!context.wearables) throw raiseApiError("NOT_FOUND", "This device service is not enabled.");
  return context.wearables;
}

function toApiError(error: unknown, fallback: string) {
  if (error instanceof WearableNotConnectedError)
    return raiseApiError("NOT_FOUND", "This device is not connected.");
  if (error instanceof WearableConnectError && error.code === "provider_unavailable")
    return raiseApiError("NOT_FOUND", "This device service is not enabled.");
  return raiseApiError("INTERNAL", fallback);
}

export const wearablesRouter = {
  /** Configured vendors with this person's connection status. Empty when none is enabled. */
  list: permissionedProcedure({ resource: "records", action: "read" })
    .input(z.object({}))
    .output(wearablesListOutput)
    .handler(async ({ context }) => ({
      providers: context.wearables
        ? await context.wearables.listConnections({
            organizationId: context.authz.activeOrganizationId,
            userId: context.authz.user.id,
          })
        : [],
    })),

  /** Starts OAuth: returns the vendor's authorization URL to open in the browser. */
  connect: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "wearable_connection",
  })
    .use(validateInput(providerInput))
    .input(providerInput)
    .output(z.object({ authorizationUrl: z.string(), targetId: z.string() }))
    .handler(async ({ input, context }) => {
      const service = requireService(context);
      try {
        const { authorizationUrl } = await service.startConnect({
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
          provider: input.provider,
        });
        return { authorizationUrl, targetId: input.provider };
      } catch (error) {
        throw toApiError(error, "Unable to start connecting this device.");
      }
    }),

  /** Revokes upstream, deletes the tokens and (optionally) every row the connection brought in. */
  disconnect: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_DELETED",
    targetType: "wearable_connection",
  })
    .use(validateInput(disconnectInput))
    .input(disconnectInput)
    .output(z.object({ revoked: z.boolean(), deletedRows: z.number(), targetId: z.string() }))
    .handler(async ({ input, context }) => {
      const service = requireService(context);
      try {
        const result = await service.disconnect({
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
          provider: input.provider,
          deleteData: input.deleteData,
        });
        return { ...result, targetId: input.provider };
      } catch (error) {
        throw toApiError(error, "Unable to disconnect this device.");
      }
    }),

  /** After the vendor revoked access: keep the held-back records, or delete them. */
  resolveQuarantine: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_UPDATED",
    targetType: "wearable_connection",
  })
    .use(validateInput(quarantineInput))
    .input(quarantineInput)
    .output(z.object({ affectedRows: z.number(), targetId: z.string() }))
    .handler(async ({ input, context }) => {
      const service = requireService(context);
      try {
        const result = await service.resolveQuarantine({
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
          provider: input.provider,
          action: input.action,
        });
        return { ...result, targetId: input.provider };
      } catch (error) {
        throw toApiError(error, "Unable to update these records.");
      }
    }),

  /** Asks for a sync on the next run (the poller or a webhook-triggered run). */
  syncNow: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_UPDATED",
    targetType: "wearable_connection",
  })
    .use(validateInput(providerInput))
    .input(providerInput)
    .output(z.object({ requested: z.literal(true), targetId: z.string() }))
    .handler(async ({ input, context }) => {
      const service = requireService(context);
      try {
        await service.requestSync({
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
          provider: input.provider,
        });
        return { requested: true as const, targetId: input.provider };
      } catch (error) {
        throw toApiError(error, "Unable to request a sync.");
      }
    }),
};
