import { newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import {
  isAccessReadOnlySyncError,
  isAuthSyncError,
  isPermanentSyncError,
  type MetricSamplePayload,
} from "@openvalens/api/presenters/offline";
import type { QuickLogWrite } from "@openvalens/api/presenters/quick-log";
import type { AppRouterClient } from "@openvalens/api/routers/index";

/** A custom tracker entry (#441), logged now from the picker. */
export type TrackerQuickLogWrite = {
  type: "tracker";
  input: { trackerId: string; value: number; timeZone: string };
};

/** One write the mobile log picker makes. */
export type PickerWrite = QuickLogWrite | TrackerQuickLogWrite;

/** The procedures a picker write calls; the real oRPC client in the app. */
export type PickerApi = {
  healthRecord: Pick<AppRouterClient["healthRecord"], "ingestMetricSample">;
  sleep: Pick<AppRouterClient["sleep"], "logManualSession" | "deleteManualSession">;
  plainWater: Pick<AppRouterClient["plainWater"], "add" | "delete">;
  supplementIntake: Pick<AppRouterClient["supplementIntake"], "create" | "delete">;
  trackers: Pick<AppRouterClient["trackers"], "log" | "deleteEntry">;
  nutritionDiary: Pick<AppRouterClient["nutritionDiary"], "logEntry" | "deleteEntry">;
  pain: Pick<AppRouterClient["pain"], "log" | "delete">;
};

export type WaterAddInput = Extract<QuickLogWrite, { type: "water" }>["input"];

/** The device queues a write falls back to when the server cannot be reached. */
export type PickerOffline = {
  /** Queues a metric sample in the offline outbox (lib/offline). */
  enqueueMetric: (sample: MetricSamplePayload, error: unknown) => void;
  /** Queues a water add in the durable water outbox; its queue id, or null if it was not queued. */
  enqueueWater: (input: WaterAddInput) => string | null;
  /** Removes a queued water add that has not been sent yet; false once it may have been. */
  discardWater: (queueId: string) => boolean;
};

export type PickerResult = {
  /** Removes the entry just made; absent when the domain has no member delete. */
  undo?: () => Promise<void>;
  /** The entry is kept on this device and syncs later. */
  queued: boolean;
};

/**
 * Whether a failed write may wait on the device: offline, timeouts and 5xx
 * may; a refused value, an expired session or a read-only workspace may not
 * (the same rule the offline outbox uses).
 */
export function canQueueAfter(error: unknown): boolean {
  return !(
    isPermanentSyncError(error) ||
    isAuthSyncError(error) ||
    isAccessReadOnlySyncError(error)
  );
}

/**
 * Runs one picker write through the kind's own procedure (#440). A metric
 * sample or a water add the server cannot take now waits in the device's
 * existing queues, as on the Vitals, Body and water screens; undoing a water
 * add that is still queued takes it off the queue. Everything else surfaces
 * the error to the caller.
 */
export async function performPickerWrite(
  write: PickerWrite,
  api: PickerApi,
  offline: PickerOffline,
): Promise<PickerResult> {
  switch (write.type) {
    case "metric": {
      const results = await Promise.allSettled(
        write.samples.map((sample) => api.healthRecord.ingestMetricSample(sample)),
      );
      const failures = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ sample: write.samples[index]!, error: result.reason }]
          : [],
      );
      const refused = failures.find((failure) => !canQueueAfter(failure.error));
      if (refused) throw refused.error;
      for (const failure of failures) offline.enqueueMetric(failure.sample, failure.error);
      return { queued: failures.length > 0 };
    }
    case "sleep": {
      const saved = await api.sleep.logManualSession(write.input);
      // A replay of a night already saved must not be undone: it was not made now.
      return saved.created
        ? {
            queued: false,
            undo: async () => {
              await api.sleep.deleteManualSession({ id: saved.id });
            },
          }
        : { queued: false };
    }
    case "water": {
      let saved: Awaited<ReturnType<PickerApi["plainWater"]["add"]>>;
      try {
        saved = await api.plainWater.add(write.input);
      } catch (error) {
        if (!canQueueAfter(error)) throw error;
        // Same client mutation id: if the first try did reach the server, the
        // queued add replays it instead of logging twice.
        const queueId = offline.enqueueWater(write.input);
        if (queueId === null) throw error;
        return {
          queued: true,
          undo: async () => {
            if (!offline.discardWater(queueId)) throw new Error("WATER_ALREADY_SENT");
          },
        };
      }
      if (saved.outcome !== "applied") return { queued: false };
      return {
        queued: false,
        undo: async () => {
          await api.plainWater.delete({
            id: saved.entry.id,
            clientMutationId: newClientMutationId(),
            expectedRevision: saved.entry.revision,
          });
        },
      };
    }
    case "supplement": {
      const saved = await api.supplementIntake.create(write.input);
      if (!saved.created) return { queued: false };
      return {
        queued: false,
        undo: async () => {
          await api.supplementIntake.delete({
            id: saved.id,
            version: saved.version,
            clientMutationId: newClientMutationId(),
          });
        },
      };
    }
    case "tracker": {
      const entry = await api.trackers.log(write.input);
      return {
        queued: false,
        undo: async () => {
          await api.trackers.deleteEntry({ id: entry.id });
        },
      };
    }
    case "drink": {
      // A drink preset (#443) is a diary entry; a replay of one already saved is not undone.
      const saved = await api.nutritionDiary.logEntry(write.input);
      if (!saved.created) return { queued: false };
      return {
        queued: false,
        undo: async () => {
          await api.nutritionDiary.deleteEntry({
            clientMutationId: newClientMutationId(),
            entryId: saved.entry.id,
            expectedRevision: saved.entry.revision,
          });
        },
      };
    }
    case "pain": {
      // The member's own pain log (#442): one entry per region.
      const created = await api.pain.log(write.input);
      return {
        queued: false,
        undo: async () => {
          for (const entry of created) await api.pain.delete({ id: entry.id });
        },
      };
    }
  }
}
