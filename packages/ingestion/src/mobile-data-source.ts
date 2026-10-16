import type { Database } from "@openvalens/db";
import { dataSource } from "@openvalens/db/schema/health-record";
import { buildDataSourceIdentity } from "@openvalens/health-record";
import { and, eq } from "drizzle-orm";

import type { MobileProvider } from "./mobile-batch";
import type { MobileHealthRecord } from "./mobile-records";

/**
 * One `data_source` per (provider, source app, device) for `mobile.ingestBatch`,
 * so source priority can tell a scale from a watch.
 */
export type SourceIdentity = ReturnType<typeof sourceIdentity>;

export function sourceIdentity(provider: MobileProvider, record: MobileHealthRecord) {
  const identity = buildDataSourceIdentity({
    provider,
    importChannel: "mobile_ingest",
    deviceType: record.sourceDevice?.type ?? null,
    deviceModel: record.sourceDevice?.model ?? null,
    sourceAppId: record.sourceApp,
  });
  return {
    ...identity,
    sourceType: record.sourceDevice?.type?.toLowerCase() || "unknown",
    deviceType: record.sourceDevice?.type ?? null,
    deviceModel: record.sourceDevice?.model ?? null,
    sourceAppId: record.sourceApp,
  };
}

export async function resolveDataSource(
  tx: Pick<Database, "select" | "insert">,
  organizationId: string,
  providerConnectionId: number,
  identity: SourceIdentity,
) {
  await tx
    .insert(dataSource)
    .values({
      organizationId,
      providerConnectionId,
      sourceType: identity.sourceType,
      sourceKey: identity.sourceKey,
      importChannel: "mobile_ingest",
      deviceType: identity.deviceType,
      deviceModel: identity.deviceModel,
      sourceAppId: identity.sourceAppId,
      displayName: identity.sourceAppId,
    })
    .onConflictDoNothing({ target: [dataSource.organizationId, dataSource.sourceKey] });
  const [row] = await tx
    .select({ id: dataSource.id })
    .from(dataSource)
    .where(
      and(
        eq(dataSource.organizationId, organizationId),
        eq(dataSource.sourceKey, identity.sourceKey),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Data source was not resolvable.");
  return row.id;
}
