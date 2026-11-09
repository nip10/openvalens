import type { Database } from "@openvalens/db";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { and, eq } from "drizzle-orm";
import { dataSource } from "@openvalens/db/schema/health-record";

import {
  ingestMobileBatch,
  MobileDeviceNotRegisteredError,
  MobileDeviceRevokedError,
} from "./mobile-batch";
import { lockActivityPublication } from "./direct-steps-fallback";
import {
  findDirectDeviceModel,
  type DirectDeviceIdentity,
} from "@openvalens/health-record/direct-device-models";
import { assertDirectDeviceIdentity, DirectDeviceIdentityError } from "./direct-device-identity";
import type { DirectDeviceRecordType } from "./direct-device-identity";

const DIRECT_DEVICE_PROVIDER = "direct_device";
const DIRECT_DEVICE_FAMILY = "amazfit_helio_strap";
type DirectDeviceContext = { userId: string; organizationId: string };
type DirectDeviceRecord =
  | {
      type: "steps";
      externalRecordId: string;
      sourceApp: null;
      startTime: string;
      endTime: string;
      count: number;
    }
  | {
      type: "heart_rate";
      externalRecordId: string;
      sourceApp: null;
      startTime: string;
      endTime: string;
      samples: { time: string; bpm: number }[];
    }
  | {
      type: "body_temperature";
      externalRecordId: string;
      sourceApp: null;
      startTime: string;
      endTime: string;
      celsius: number;
    }
  | {
      type: "blood_pressure";
      externalRecordId: string;
      sourceApp: null;
      startTime: string;
      endTime: string;
      systolic: number;
      diastolic: number;
      meanArterialPressure?: number;
      pulseRate?: number;
    };
type DirectDeviceBatch = {
  schemaVersion: 1;
  deviceId: string;
  deviceIdentity?: DirectDeviceIdentity;
  provider: "direct_device";
  recordType: "steps" | "heart_rate" | "body_temperature" | "blood_pressure";
  mode: "backfill";
  window?: { from: string; to: string };
  upserts: DirectDeviceRecord[];
  deletions: [];
  clientTimezone: string;
};
type RegisterDirectDeviceInput = {
  deviceId: string;
  family: string;
  modelId?: string;
  confirmLegacyIdentity?: boolean;
  expectedContext: DirectDeviceContext;
};

export class DirectDeviceContextMismatchError extends Error {
  constructor() {
    super("Direct-device expected context does not match the authenticated context.");
    this.name = "DirectDeviceContextMismatchError";
  }
}
export class DirectDeviceOwnershipError extends Error {
  constructor() {
    super("Direct device is not owned by the active user.");
    this.name = "DirectDeviceOwnershipError";
  }
}
export class DirectDeviceRecordTypeUnavailableError extends Error {
  constructor() {
    super("This direct-device record type is not available.");
    this.name = "DirectDeviceRecordTypeUnavailableError";
  }
}

const DIRECT_DEVICE_RECORD_TYPES = new Set<DirectDeviceRecordType>([
  "steps",
  "heart_rate",
  "body_temperature",
  "blood_pressure",
]);

export async function registerDirectDevice(
  db: Database,
  input: RegisterDirectDeviceInput & { authenticatedContext: DirectDeviceContext; now?: Date },
): Promise<{ providerConnectionId: number }> {
  assertExpectedContext(input.expectedContext, input.authenticatedContext);
  const requested = input.modelId
    ? { family: input.family as DirectDeviceIdentity["family"], modelId: input.modelId }
    : undefined;
  const descriptor = requested ? findDirectDeviceModel(requested) : undefined;
  if (input.modelId && !descriptor) throw new DirectDeviceIdentityError("IDENTITY_REQUIRED");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // Binding activation changes which direct source may publish an uncovered
    // day; serialize it with all canonical activity publication/reconciliation.
    await lockActivityPublication(tx, input.authenticatedContext.organizationId);
    await tx
      .insert(providerConnection)
      .values({
        organizationId: input.authenticatedContext.organizationId,
        provider: DIRECT_DEVICE_PROVIDER,
        externalUserId: input.deviceId,
        userId: input.authenticatedContext.userId,
        ...(descriptor
          ? { directDeviceFamily: requested!.family, directDeviceModelId: requested!.modelId }
          : {}),
        status: "active",
        connectedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          providerConnection.organizationId,
          providerConnection.provider,
          providerConnection.externalUserId,
        ],
      });
    const [connection] = await tx
      .select({
        id: providerConnection.id,
        userId: providerConnection.userId,
        status: providerConnection.status,
        directDeviceFamily: providerConnection.directDeviceFamily,
        directDeviceModelId: providerConnection.directDeviceModelId,
      })
      .from(providerConnection)
      .where(
        and(
          eq(providerConnection.organizationId, input.authenticatedContext.organizationId),
          eq(providerConnection.provider, DIRECT_DEVICE_PROVIDER),
          eq(providerConnection.externalUserId, input.deviceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!connection) throw new MobileDeviceNotRegisteredError();
    if (connection.userId !== input.authenticatedContext.userId)
      throw new DirectDeviceOwnershipError();
    if (connection.status !== "active") throw new MobileDeviceRevokedError();
    if (descriptor) {
      if (connection.directDeviceFamily !== null || connection.directDeviceModelId !== null) {
        if (
          connection.directDeviceFamily !== requested!.family ||
          connection.directDeviceModelId !== requested!.modelId
        )
          throw new DirectDeviceIdentityError("IDENTITY_MISMATCH");
      } else if (input.confirmLegacyIdentity) {
        await tx
          .update(providerConnection)
          .set({
            directDeviceFamily: requested!.family,
            directDeviceModelId: requested!.modelId,
            updatedAt: now,
          })
          .where(
            and(
              eq(providerConnection.id, connection.id),
              eq(providerConnection.organizationId, input.authenticatedContext.organizationId),
            ),
          );
        await tx
          .update(dataSource)
          .set({ deviceModel: descriptor.displayName })
          .where(
            and(
              eq(dataSource.organizationId, input.authenticatedContext.organizationId),
              eq(dataSource.providerConnectionId, connection.id),
              eq(dataSource.importChannel, "direct_device"),
            ),
          );
      }
    }
    return { providerConnectionId: connection.id };
  });
}

export async function ingestDirectDeviceBatch(
  db: Database,
  input: {
    expectedContext: DirectDeviceContext;
    authenticatedContext: DirectDeviceContext;
    batch: DirectDeviceBatch;
    traceId: string;
    now?: Date;
  },
) {
  assertExpectedContext(input.expectedContext, input.authenticatedContext);
  const { batch } = input;
  if (!DIRECT_DEVICE_RECORD_TYPES.has(batch.recordType))
    throw new DirectDeviceRecordTypeUnavailableError();
  const [binding] = await db
    .select({
      userId: providerConnection.userId,
      status: providerConnection.status,
      directDeviceFamily: providerConnection.directDeviceFamily,
      directDeviceModelId: providerConnection.directDeviceModelId,
    })
    .from(providerConnection)
    .where(
      and(
        eq(providerConnection.organizationId, input.authenticatedContext.organizationId),
        eq(providerConnection.provider, DIRECT_DEVICE_PROVIDER),
        eq(providerConnection.externalUserId, batch.deviceId),
      ),
    )
    .limit(1);
  if (
    !binding ||
    binding.status !== "active" ||
    binding.userId !== input.authenticatedContext.userId
  )
    throw new MobileDeviceNotRegisteredError();
  const identity = assertDirectDeviceIdentity(binding, batch.deviceIdentity, {
    recordType: batch.recordType,
  });
  const descriptor = findDirectDeviceModel(identity)!;
  const normalized = {
    ...batch,
    upserts: batch.upserts.map((record) => ({
      ...record,
      externalRecordId: `dd:v1:${batch.deviceId}:${record.type}:${record.externalRecordId}`,
      startTime: new Date(record.startTime).toISOString(),
      endTime: new Date(record.endTime).toISOString(),
      ...(record.type === "heart_rate"
        ? {
            samples: record.samples.map((sample) => ({
              ...sample,
              time: new Date(sample.time).toISOString(),
            })),
          }
        : {}),
      sourceApp: null as null,
      sourceDevice: { type: "wearable", model: descriptor.displayName },
    })),
  };
  return ingestMobileBatch(db, {
    organizationId: input.authenticatedContext.organizationId,
    batch: normalized,
    traceId: input.traceId,
    now: input.now,
    expectedOwnerId: input.authenticatedContext.userId,
  });
}

export function assertExpectedContext(
  expected: DirectDeviceContext,
  authenticated: DirectDeviceContext,
) {
  if (
    expected.userId !== authenticated.userId ||
    expected.organizationId !== authenticated.organizationId
  )
    throw new DirectDeviceContextMismatchError();
}

export { DIRECT_DEVICE_FAMILY };
