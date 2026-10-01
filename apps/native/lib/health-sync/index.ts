/**
 * Health data sync: Health Connect → `mobile.ingestBatch`
 * (docs/architecture/mobile-sync-decision.md).
 *
 *   permissions — read access, background and history checks
 *   run-sync    — one sync run (foreground or background)
 *   scheduler   — periodic background task
 *   status      — last-run summary for the UI
 *   drain       — the cursor algorithm (pure, unit-tested)
 */
export { getHealthAccess, requestHealthAccess, type HealthAccess } from "./permissions";
export { runHealthSync, type HealthSyncResult } from "./run-sync";
export { HEALTH_SYNC_TASK, registerHealthSyncTask, unregisterHealthSyncTask } from "./scheduler";
export { getHealthSyncStatus, type HealthSyncStatus } from "./status";
export { clearCursors } from "./cursor-store";
