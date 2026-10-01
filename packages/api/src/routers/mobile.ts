import {
  getMobileSyncStatus,
  ingestMobileBatch,
  MobileDeviceNotRegisteredError,
  MobileDeviceRevokedError,
  registerMobileDevice,
  type MobileIngestBatch,
} from "@openhealth/ingestion";
import { z } from "zod";

import {
  ingestBatchInput,
  ingestBatchOutput,
  registerDeviceInput,
  registerDeviceOutput,
  syncStatusOutput,
  type IngestBatchInput,
} from "../contracts/mobile-ingest";
import {
  permissionedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";

// The wire contract must stay assignable to the domain input.
const _contractMatchesDomain = (input: IngestBatchInput): MobileIngestBatch => input;
void _contractMatchesDomain;

function toApiError(error: unknown, fallback: string) {
  if (error instanceof MobileDeviceNotRegisteredError)
    return raiseApiError("PERMISSION_DENIED", "This device is not registered.");
  if (error instanceof MobileDeviceRevokedError)
    return raiseApiError("PERMISSION_DENIED", "This device's access has been revoked.");
  return raiseApiError("INTERNAL", fallback);
}

/**
 * Mobile ingestion (issue #7, docs/architecture/mobile-sync-decision.md).
 * Organization and user come only from the session; the strict contract
 * rejects overrides. Domain logic lives in `@openhealth/ingestion`.
 */
export const mobileRouter = {
  /** Upsert this device's provider connection. A revoked device stays revoked. */
  registerDevice: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "provider_connection",
  })
    .use(validateInput(registerDeviceInput))
    .input(registerDeviceInput)
    .output(registerDeviceOutput)
    .handler(async ({ input, context }) => {
      try {
        const { providerConnectionId } = await registerMobileDevice(context.db, {
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
          deviceId: input.deviceId,
          platform: input.platform,
        });
        return { providerConnectionId, targetId: String(providerConnectionId) };
      } catch (error) {
        throw toApiError(error, "Unable to register device.");
      }
    }),

  /**
   * Append-only, idempotent ingestion of one batch of one record type. Any of
   * `applied`, `queued` or `duplicate` means the device may advance its cursor.
   */
  ingestBatch: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "ingestion_raw_artifact",
  })
    .use(validateInput(ingestBatchInput))
    .input(ingestBatchInput)
    .output(ingestBatchOutput)
    .handler(async ({ input, context }) => {
      try {
        const result = await ingestMobileBatch(context.db, {
          organizationId: context.authz.activeOrganizationId,
          batch: input,
          traceId: context.correlationId,
        });
        return {
          status: result.status,
          rawArtifactId: result.rawArtifactId,
          accepted: result.accepted,
          duplicates: result.duplicates,
          rejected: result.rejected,
          superseded: result.superseded,
          targetId: String(result.rawArtifactId),
        };
      } catch (error) {
        throw toApiError(error, "Unable to ingest batch.");
      }
    }),

  /** Safe status metadata only: device ids, timestamps and job statuses. */
  syncStatus: permissionedProcedure({ resource: "records", action: "read" })
    .input(z.object({}))
    .output(syncStatusOutput)
    .handler(async ({ context }) =>
      getMobileSyncStatus(context.db, { organizationId: context.authz.activeOrganizationId }),
    ),
};
