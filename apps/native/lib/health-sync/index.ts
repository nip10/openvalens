/**
 * Health data sync: Health Connect → `mobile.ingestBatch`
 * (docs/architecture/mobile-sync-decision.md).
 *
 *   permissions — read access, background and history checks
 *   run-sync    — one sync run (foreground or background)
 *   scheduler   — periodic background task (expo-background-task)
 *   status      — last-run summary for the UI
 *   reset       — sign-out cleanup
 *   drain       — the cursor algorithm (pure, unit-tested)
 */
export { getHealthAccess, requestHealthAccess, type HealthAccess } from "./permissions";
export { runHealthSync, type HealthSyncResult } from "./run-sync";
export {
  HEALTH_SYNC_TASK,
  isBackgroundSyncAvailable,
  isHealthSyncTaskRegistered,
  registerHealthSyncTask,
  unregisterHealthSyncTask,
} from "./scheduler";
export { getHealthSyncStatus, type HealthSyncStatus } from "./status";
export { resetHealthSync } from "./reset";
export { SYNCED_TYPES } from "./record-types";
