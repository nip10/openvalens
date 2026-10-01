import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { runHealthSync } from "./run-sync";

/**
 * Periodic background sync on `expo-background-task` (#28). The OS treats
 * the interval as a minimum and picks the actual window; iOS mostly runs
 * these overnight. Each run is bounded, and the cursors resume where the
 * last run stopped, so a short or interrupted run loses nothing.
 */
export const HEALTH_SYNC_TASK = "openhealth-health-sync";
const INTERVAL_MINUTES = 6 * 60;
const BACKGROUND_BUDGET = { maxBatches: 10, windowMs: 20_000 };

// Must run at module scope on startup so a cold background launch finds the
// task; the root layout imports this module.
if (!TaskManager.isTaskDefined(HEALTH_SYNC_TASK)) {
  TaskManager.defineTask(HEALTH_SYNC_TASK, async () => {
    const result = await runHealthSync({
      maxBatches: BACKGROUND_BUDGET.maxBatches,
      deadline: Date.now() + BACKGROUND_BUDGET.windowMs,
    });
    return result.status === "failed"
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function isBackgroundSyncAvailable(): Promise<boolean> {
  return (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available;
}

export async function isHealthSyncTaskRegistered(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(HEALTH_SYNC_TASK);
}

export async function registerHealthSyncTask(): Promise<void> {
  if (!(await isBackgroundSyncAvailable()))
    throw new Error("Background tasks are restricted for this app.");
  await BackgroundTask.registerTaskAsync(HEALTH_SYNC_TASK, { minimumInterval: INTERVAL_MINUTES });
}

export async function unregisterHealthSyncTask(): Promise<void> {
  if (await isHealthSyncTaskRegistered())
    await BackgroundTask.unregisterTaskAsync(HEALTH_SYNC_TASK);
}
