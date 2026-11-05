import {
  DirectDeviceContextMismatchError,
  DirectDeviceOwnershipError,
  ingestDirectDeviceBatch,
  MobileDeviceNotRegisteredError,
  MobileDeviceRevokedError,
  registerDirectDevice,
} from "@openvalens/ingestion";

import {
  ingestDirectDeviceBatchInput,
  ingestDirectDeviceBatchOutput,
  registerDirectDeviceInput,
  registerDirectDeviceOutput,
  type DirectDeviceRefusalReason,
  type IngestDirectDeviceBatchInput,
} from "../contracts/direct-device";
import { raiseApiError, tenantScopedProcedure, validateInput } from "../index";

function toApiError(error: unknown, fallback: string) {
  if (error instanceof DirectDeviceContextMismatchError || error instanceof DirectDeviceOwnershipError ||
      error instanceof MobileDeviceNotRegisteredError || error instanceof MobileDeviceRevokedError) {
    const reason: DirectDeviceRefusalReason = error instanceof MobileDeviceRevokedError ? "REVOKED" : "UNAVAILABLE";
    return raiseApiError("PERMISSION_DENIED", "This direct device is not available to the active account.", { reason });
  }
  return raiseApiError("INTERNAL", fallback);
}

export const directDeviceRouter = {
  registerDirectDevice: tenantScopedProcedure({ resource: "records", action: "write", auditAction: "RECORD_CREATED", targetType: "provider_connection" })
    .use(validateInput(registerDirectDeviceInput))
    .input(registerDirectDeviceInput)
    .output(registerDirectDeviceOutput)
    .handler(async ({ input, context }) => {
      try {
        const result = await registerDirectDevice(context.db, {
          ...input,
          authenticatedContext: { userId: context.authz.user.id, organizationId: context.authz.activeOrganizationId },
        });
        return { ...result, targetId: String(result.providerConnectionId) };
      } catch (error) { throw toApiError(error, "Unable to register direct device."); }
    }),

  ingestDirectDeviceBatch: tenantScopedProcedure({ resource: "records", action: "write", auditAction: "RECORD_CREATED", targetType: "ingestion_raw_artifact" })
    .use(validateInput(ingestDirectDeviceBatchInput))
    .input(ingestDirectDeviceBatchInput)
    .output(ingestDirectDeviceBatchOutput)
    .handler(async ({ input, context }) => {
      const _contractMatchesDomain: IngestDirectDeviceBatchInput = input;
      void _contractMatchesDomain;
      try {
        const result = await ingestDirectDeviceBatch(context.db, {
          ...input,
          authenticatedContext: { userId: context.authz.user.id, organizationId: context.authz.activeOrganizationId },
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
      } catch (error) { throw toApiError(error, "Unable to ingest direct-device batch."); }
    }),
};
