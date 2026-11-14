import { isPermanentSyncError, type MetricSamplePayload } from "@openvalens/api/presenters/offline";
import type { QuickLogWrite } from "@openvalens/api/presenters/quick-log";
import type { AppRouterClient } from "@openvalens/api/routers/index";

/**
 * What the native metric outbox (lib/offline) can hold: an `ingestMetricSample`
 * input, or (#440) a supplement intake the log picker could not send. Pure, so
 * `bun test` checks it; the SQLite store and the drain loop live beside it.
 */

/** The `supplementIntake.create` input, sent unchanged (its client mutation id makes a replay safe). */
export type SupplementIntakePayload = Extract<QuickLogWrite, { type: "supplement" }>["input"];

/** A supplement intake waiting on the device. Metric rows carry no `type`, so older rows still read as metrics. */
export type QueuedSupplementIntake = { type: "supplement_intake"; input: SupplementIntakePayload };

export type QueuedWrite = MetricSamplePayload | QueuedSupplementIntake;

/** The procedures a queued write is sent through; the real oRPC client in the app. */
export type QueuedWriteApi = {
  healthRecord: Pick<AppRouterClient["healthRecord"], "ingestMetricSample">;
  supplementIntake: Pick<AppRouterClient["supplementIntake"], "create">;
};

export function isQueuedSupplementIntake(payload: QueuedWrite): payload is QueuedSupplementIntake {
  return (payload as { type?: unknown }).type === "supplement_intake";
}

/** The outbox key of a queued intake: one row per client mutation id. */
export function supplementIntakeQueueKey(clientMutationId: string): string {
  return `supplement-intake:${clientMutationId}`;
}

/** Sends one queued write through its own procedure. */
export async function sendQueuedWrite(payload: QueuedWrite, api: QueuedWriteApi): Promise<void> {
  if (isQueuedSupplementIntake(payload)) {
    await api.supplementIntake.create(payload.input);
    return;
  }
  await api.healthRecord.ingestMetricSample(payload);
}

/**
 * Whether the server will never take this write, so the drain drops it rather
 * than retrying forever and holding up the rows behind it. A refused value
 * always counts. For an intake, so does a supplement that is gone (NOT_FOUND)
 * or a mutation id already used for another intake (CONFLICT).
 */
export function isDroppedQueuedWriteError(payload: QueuedWrite, error: unknown): boolean {
  if (isPermanentSyncError(error)) return true;
  if (!isQueuedSupplementIntake(payload)) return false;
  const code = (error as { code?: unknown } | null)?.code;
  return code === "NOT_FOUND" || code === "CONFLICT";
}

/** The supplement intakes among queued payloads, oldest first. */
export function queuedSupplementIntakes(
  payloads: readonly QueuedWrite[],
): SupplementIntakePayload[] {
  return payloads.filter(isQueuedSupplementIntake).map((payload) => payload.input);
}
