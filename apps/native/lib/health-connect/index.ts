/**
 * Health Connect ingestion layer — data-source side of the mobile app.
 *
 * Android (Health Connect) is implemented; iOS (HealthKit) is stubbed with
 * clear TODOs. This barrel is the single entry point UI screens import from.
 *
 *   permissions — permission flows + read/write scope constants
 *   sources     — per-source record readers (steps, heart rate, sleep, …)
 *   sync        — sync-session transport (start / upload / complete / abort)
 *   scheduler   — background fetch task registration (every 6h)
 *   status      — persisted sync status + device id (AsyncStorage)
 *   types       — wire-format record + payload types
 */
export * from "./permissions";
export * from "./scheduler";
export * from "./sources";
export * from "./status";
export * from "./sync";
export * from "./types";
