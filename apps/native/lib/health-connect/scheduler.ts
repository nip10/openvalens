/**
 * Background sync wiring for the ingestion layer.
 *
 * Uses `expo-background-fetch` + `expo-task-manager`. NOTE: expo-background-fetch
 * is deprecated in SDK 57; the migration target is `expo-background-task`.
 * Kept per the ingestion spec for now — see TODO below.
 */
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";

import { readAllSources } from "./sources";
import { getOrCreateDeviceId, updateSyncStatus } from "./status";
import {
  DEFAULT_SYNC_WINDOW_HOURS,
  SYNC_PAYLOAD_VERSION,
  abortSyncSession,
  completeSyncSession,
  getDeviceTimezone,
  startSyncSession,
  uploadPayload,
} from "./sync";
import { countHealthRecords, type HealthPayload } from "./types";

export const HEALTH_SYNC_TASK_NAME = "openhealth-health-connect-sync";

/** Default cadence: every 6 hours. */
export const DEFAULT_SYNC_INTERVAL_SECONDS = 6 * 60 * 60;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one full sync cycle: open a session, read every source, upload the
 * batch, finalize. On failure the session is aborted and the error recorded.
 *
 * TODO: no oRPC mobile sync contract yet — `startSyncSession`/`uploadPayload`/
 * `completeSyncSession`/`abortSyncSession` hit placeholder REST endpoints.
 */
export async function runSync(deviceId?: string): Promise<void> {
  const resolvedDeviceId = deviceId ?? (await getOrCreateDeviceId());
  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_SYNC_WINDOW_HOURS * 3_600_000);

  const session = await startSyncSession(resolvedDeviceId, { from, to });

  try {
    const records = await readAllSources(from, to);
    const payload: HealthPayload = {
      metadata: {
        payloadVersion: SYNC_PAYLOAD_VERSION,
        deviceId: resolvedDeviceId,
        timezone: getDeviceTimezone(),
        windowStart: from.toISOString(),
        windowEnd: to.toISOString(),
      },
      records,
    };

    await updateSyncStatus({ pending: countHealthRecords(records) });
    await uploadPayload(session.sessionId, payload);
    await completeSyncSession(session.sessionId);
    await updateSyncStatus({ lastSyncAt: new Date(), pending: 0, lastError: null });
  } catch (error) {
    const message = errorMessage(error);
    try {
      await abortSyncSession(session.sessionId, message);
    } catch (abortError) {
      console.warn("[health-connect] failed to abort sync session", abortError);
    }
    await updateSyncStatus({ lastError: message });
    throw error;
  }
}

// Must be defined in the global bundle scope so the headless background
// runtime can find it after a cold start.
if (!TaskManager.isTaskDefined(HEALTH_SYNC_TASK_NAME)) {
  TaskManager.defineTask(HEALTH_SYNC_TASK_NAME, async () => {
    try {
      await runSync();
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
      console.warn("[health-connect] background sync failed", error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

/**
 * Registers the periodic sync task (every 6 hours by default).
 *
 * TODO: migrate to `expo-background-task` (`registerTaskAsync`) — the
 * `expo-background-fetch` package is deprecated in SDK 57.
 */
export async function registerSyncTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Denied ||
    status === BackgroundFetch.BackgroundFetchStatus.Restricted
  ) {
    throw new Error(
      "Background fetch is unavailable. The user has disabled background refresh for this app.",
    );
  }

  await BackgroundFetch.registerTaskAsync(HEALTH_SYNC_TASK_NAME, {
    minimumInterval: DEFAULT_SYNC_INTERVAL_SECONDS,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterSyncTask(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(HEALTH_SYNC_TASK_NAME)) {
    await BackgroundFetch.unregisterTaskAsync(HEALTH_SYNC_TASK_NAME);
  }
}

export async function isSyncTaskRegistered(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(HEALTH_SYNC_TASK_NAME);
}
