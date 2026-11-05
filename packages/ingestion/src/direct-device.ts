import type { Database } from "@openvalens/db";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { and, eq } from "drizzle-orm";

import { ingestMobileBatch, MobileDeviceNotRegisteredError, MobileDeviceRevokedError } from "./mobile-batch";

const DIRECT_DEVICE_PROVIDER = "direct_device";
const DIRECT_DEVICE_FAMILY = "amazfit_helio_strap";
type DirectDeviceContext = { userId: string; organizationId: string };
type DirectDeviceRecord =
  | { type: "steps"; externalRecordId: string; sourceApp: null; startTime: string; endTime: string; count: number }
  | { type: "heart_rate"; externalRecordId: string; sourceApp: null; startTime: string; endTime: string; samples: { time: string; bpm: number }[] };
type DirectDeviceBatch = { schemaVersion: 1; deviceId: string; provider: "direct_device"; recordType: "steps" | "heart_rate"; mode: "backfill"; window?: { from: string; to: string }; upserts: DirectDeviceRecord[]; deletions: []; clientTimezone: string };
type RegisterDirectDeviceInput = { deviceId: string; family: typeof DIRECT_DEVICE_FAMILY; expectedContext: DirectDeviceContext };

export class DirectDeviceContextMismatchError extends Error {
  constructor() { super("Direct-device expected context does not match the authenticated context."); this.name = "DirectDeviceContextMismatchError"; }
}
export class DirectDeviceOwnershipError extends Error {
  constructor() { super("Direct device is not owned by the active user."); this.name = "DirectDeviceOwnershipError"; }
}

export async function registerDirectDevice(
  db: Database,
  input: RegisterDirectDeviceInput & { authenticatedContext: DirectDeviceContext; now?: Date },
): Promise<{ providerConnectionId: number }> {
  assertExpectedContext(input.expectedContext, input.authenticatedContext);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.insert(providerConnection).values({
      organizationId: input.authenticatedContext.organizationId,
      provider: DIRECT_DEVICE_PROVIDER,
      externalUserId: input.deviceId,
      userId: input.authenticatedContext.userId,
      status: "active",
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({ target: [providerConnection.organizationId, providerConnection.provider, providerConnection.externalUserId] });
    const [connection] = await tx.select({ id: providerConnection.id, userId: providerConnection.userId, status: providerConnection.status })
      .from(providerConnection)
      .where(and(eq(providerConnection.organizationId, input.authenticatedContext.organizationId), eq(providerConnection.provider, DIRECT_DEVICE_PROVIDER), eq(providerConnection.externalUserId, input.deviceId)))
      .limit(1).for("update");
    if (!connection) throw new MobileDeviceNotRegisteredError();
    if (connection.userId !== input.authenticatedContext.userId) throw new DirectDeviceOwnershipError();
    if (connection.status !== "active") throw new MobileDeviceRevokedError();
    return { providerConnectionId: connection.id };
  });
}

export async function ingestDirectDeviceBatch(
  db: Database,
  input: { expectedContext: DirectDeviceContext; authenticatedContext: DirectDeviceContext; batch: DirectDeviceBatch; traceId: string; now?: Date },
) {
  assertExpectedContext(input.expectedContext, input.authenticatedContext);
  const { batch } = input;
  const normalized = {
    ...batch,
    upserts: batch.upserts.map((record) => ({
      ...record,
      externalRecordId: `dd:v1:${batch.deviceId}:${record.type}:${record.externalRecordId}`,
      startTime: new Date(record.startTime).toISOString(),
      endTime: new Date(record.endTime).toISOString(),
      ...(record.type === "heart_rate" ? { samples: record.samples.map((sample) => ({ ...sample, time: new Date(sample.time).toISOString() })) } : {}),
      sourceApp: null as null,
      sourceDevice: { type: "wearable", model: "Amazfit Helio Strap" },
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

export function assertExpectedContext(expected: DirectDeviceContext, authenticated: DirectDeviceContext) {
  if (expected.userId !== authenticated.userId || expected.organizationId !== authenticated.organizationId)
    throw new DirectDeviceContextMismatchError();
}

export { DIRECT_DEVICE_FAMILY };
