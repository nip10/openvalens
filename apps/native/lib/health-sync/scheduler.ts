import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";

import { runHealthSync } from "./run-sync";

/**
 * Periodic background sync. Still on the deprecated `expo-background-fetch`;
 * moving to `expo-background-task` with a per-run time budget is #28.
 */
export const HEALTH_SYNC_TASK = "openhealth-health-sync";
const INTERVAL_SECONDS = 6 * 60 * 60;
/** Background runs are short-lived: bounded work, the cursor resumes next time. */
const BACKGROUND_BUDGET = { maxBatches: 10, windowMs: 20_000 };

// Defined at module scope so a cold background launch can find the task.
if (!TaskManager.isTaskDefined(HEALTH_SYNC_TASK)) {
  TaskManager.defineTask(HEALTH_SYNC_TASK, async () => {
    const result = await runHealthSync({
      maxBatches: BACKGROUND_BUDGET.maxBatches,
      deadline: Date.now() + BACKGROUND_BUDGET.windowMs,
    });
    if (result.status === "failed") return BackgroundFetch.BackgroundFetchResult.Failed;
    if (result.status === "done" && Object.values(result.summary.types).some((t) => t?.batchesSent))
      return BackgroundFetch.BackgroundFetchResult.NewData;
    return BackgroundFetch.BackgroundFetchResult.NoData;
  });
}

export async function registerHealthSyncTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Denied ||
    status === BackgroundFetch.BackgroundFetchStatus.Restricted
  )
    throw new Error("Background refresh is disabled for this app.");
  await BackgroundFetch.registerTaskAsync(HEALTH_SYNC_TASK, {
    minimumInterval: INTERVAL_SECONDS,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterHealthSyncTask(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(HEALTH_SYNC_TASK))
    await BackgroundFetch.unregisterTaskAsync(HEALTH_SYNC_TASK);
}
