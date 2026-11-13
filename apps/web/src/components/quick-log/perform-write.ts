import type { QuickLogWrite } from "@openvalens/api/presenters/quick-log";
import type { MetricSamplePayload } from "@openvalens/api/presenters/offline";
import { newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import type { AppRouterClient } from "@openvalens/api/routers/index";

/** The procedures a quick log write calls; the real oRPC client in the app. */
export type QuickLogApi = {
  healthRecord: Pick<AppRouterClient["healthRecord"], "ingestMetricSample">;
  sleep: Pick<AppRouterClient["sleep"], "logManualSession" | "deleteManualSession">;
  plainWater: Pick<AppRouterClient["plainWater"], "add" | "delete">;
  supplementIntake: Pick<AppRouterClient["supplementIntake"], "create" | "delete">;
};

export type QuickLogResult = {
  /** Deletes the entry just made; absent when the domain has no member delete. */
  undo?: () => Promise<void>;
  /** Some metric samples failed and wait in the offline outbox. */
  queued: boolean;
};

/**
 * Runs one quick log write through the kind's own procedure. A failed metric
 * sample goes into the existing offline outbox (`enqueue`), like the Vitals
 * and Body forms; other kinds surface the error to the caller.
 */
export async function performQuickLogWrite(
  write: QuickLogWrite,
  api: QuickLogApi,
  enqueue: (sample: MetricSamplePayload, error: unknown) => void,
): Promise<QuickLogResult> {
  switch (write.type) {
    case "metric": {
      const results = await Promise.allSettled(
        write.samples.map((sample) => api.healthRecord.ingestMetricSample(sample)),
      );
      let queued = false;
      results.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        enqueue(write.samples[index]!, result.reason);
        queued = true;
      });
      return { queued };
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
      const saved = await api.plainWater.add(write.input);
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
  }
}
