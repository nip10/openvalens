import { sql } from "drizzle-orm";
import {
  DirectDeviceContextMismatchError,
  DirectDeviceOwnershipError,
  DirectDeviceIdentityError,
  ingestDirectDeviceBatch,
  DirectDeviceRecordTypeUnavailableError,
  DirectDeviceMinuteConflictError,
  MobileDeviceNotRegisteredError,
  MobileDeviceRevokedError,
  registerDirectDevice,
} from "@openvalens/ingestion";

import {
  ingestDirectDeviceBatchInput,
  ingestDirectDeviceBatchOutput,
  registerDirectDeviceInput,
  registerDirectDeviceOutput,
  listDirectDevicesInput,
  listDirectDevicesOutput,
  type DirectDeviceRefusalReason,
  type IngestDirectDeviceBatchInput,
} from "../contracts/direct-device";
import { raiseApiError, tenantScopedProcedure, validateInput } from "../index";
import {
  findDirectDeviceModel,
  type DirectDeviceFamily,
} from "@openvalens/health-record/direct-device-models";

function toApiError(error: unknown, fallback: string) {
  if (error instanceof DirectDeviceMinuteConflictError)
    return raiseApiError(
      "INVALID_INPUT",
      "A different step count already exists for this device minute.",
      { reason: "MINUTE_CONFLICT" },
    );
  if (error instanceof DirectDeviceIdentityError)
    return raiseApiError(
      "INVALID_INPUT",
      "The direct-device identity cannot be used for this request.",
      { reason: error.reason },
    );
  if (error instanceof DirectDeviceRecordTypeUnavailableError)
    return raiseApiError(
      "INVALID_INPUT",
      "This direct-device record type is not available for this device.",
    );
  if (
    error instanceof DirectDeviceContextMismatchError ||
    error instanceof DirectDeviceOwnershipError ||
    error instanceof MobileDeviceNotRegisteredError ||
    error instanceof MobileDeviceRevokedError
  ) {
    const reason: DirectDeviceRefusalReason =
      error instanceof MobileDeviceRevokedError ? "REVOKED" : "UNAVAILABLE";
    return raiseApiError(
      "PERMISSION_DENIED",
      "This direct device is not available to the active account.",
      { reason },
    );
  }
  return raiseApiError("INTERNAL", fallback);
}

export const directDeviceRouter = {
  listDirectDevices: tenantScopedProcedure({
    resource: "records",
    action: "read",
    auditAction: "RECORD_UPDATED",
    targetType: "provider_connection",
  })
    .use(validateInput(listDirectDevicesInput))
    .input(listDirectDevicesInput)
    .output(listDirectDevicesOutput)
    .handler(async ({ input, context }) => {
      const authenticated = {
        userId: context.authz.user.id,
        organizationId: context.authz.activeOrganizationId,
      };
      if (
        input.expectedContext.userId !== authenticated.userId ||
        input.expectedContext.organizationId !== authenticated.organizationId
      )
        throw raiseApiError(
          "PERMISSION_DENIED",
          "Direct devices are unavailable to the active account.",
          { reason: "UNAVAILABLE" },
        );
      const result = await context.db.execute(sql`
        select pc.external_user_id as device_id, pc.id as provider_connection_id,
          pc.direct_device_family, pc.direct_device_model_id,
          pc.connected_at, pc.last_synced_at,
          count(ms.id) filter (where md.id is not null and ms.superseded_at is null)::int as record_count,
          count(ms.id) filter (where md.id is not null and ms.superseded_at is not null and exists (
            select 1 from provenance_link l where l.organization_id=ms.organization_id
              and l.target_table='metric_sample' and l.target_id=ms.id
              and l.relation='shadowed_by_direct_steps_policy'))::int as shadowed_count
        from provider_connection pc
        left join data_source ds on ds.organization_id=pc.organization_id
          and ds.provider_connection_id=pc.id and ds.import_channel='direct_device'
        left join metric_sample ms on ms.organization_id=pc.organization_id and ms.data_source_id=ds.id
        left join metric_definition md on md.id=ms.metric_definition_id and md.organization_id=ms.organization_id and md.code='steps'
        where pc.organization_id=${authenticated.organizationId} and pc.user_id=${authenticated.userId}
          and pc.provider='direct_device' and pc.status='active'
        group by pc.id order by pc.id`);
      return {
        devices: result.rows.map((row: any) => {
          const model =
            row.direct_device_family && row.direct_device_model_id
              ? findDirectDeviceModel({
                  family: row.direct_device_family as DirectDeviceFamily,
                  modelId: row.direct_device_model_id,
                })
              : undefined;
          return {
            deviceId: row.device_id,
            providerConnectionId: Number(row.provider_connection_id),
            family: model?.family ?? null,
            modelId: model?.modelId ?? null,
            displayName: model?.displayName ?? null,
            connectedAt: new Date(row.connected_at).toISOString(),
            lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
            publication: {
              policy: "phone_cloud_first_utc_day",
              publishedRecords: Number(row.record_count),
              shadowedRecords: Number(row.shadowed_count),
            },
          };
        }),
      };
    }),

  registerDirectDevice: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "provider_connection",
  })
    .use(validateInput(registerDirectDeviceInput))
    .input(registerDirectDeviceInput)
    .output(registerDirectDeviceOutput)
    .handler(async ({ input, context }) => {
      try {
        const result = await registerDirectDevice(context.db, {
          ...input,
          authenticatedContext: {
            userId: context.authz.user.id,
            organizationId: context.authz.activeOrganizationId,
          },
        });
        return { ...result, targetId: String(result.providerConnectionId) };
      } catch (error) {
        throw toApiError(error, "Unable to register direct device.");
      }
    }),

  ingestDirectDeviceBatch: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "ingestion_raw_artifact",
  })
    .use(validateInput(ingestDirectDeviceBatchInput))
    .input(ingestDirectDeviceBatchInput)
    .output(ingestDirectDeviceBatchOutput)
    .handler(async ({ input, context }) => {
      const _contractMatchesDomain: IngestDirectDeviceBatchInput = input;
      void _contractMatchesDomain;
      try {
        const result = await ingestDirectDeviceBatch(context.db, {
          ...input,
          authenticatedContext: {
            userId: context.authz.user.id,
            organizationId: context.authz.activeOrganizationId,
          },
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
        throw toApiError(error, "Unable to ingest direct-device batch.");
      }
    }),
};
