import { Platform } from "react-native";

import { asyncStorageCursorStore, clearCursors } from "./cursor-store";
import { ensureDeviceRegistered, getDeviceId } from "./device";
import { drainHealthChanges, type DrainOptions, type DrainSummary } from "./drain";
import { healthConnectSource } from "./health-connect-source";
import { healthKitSource } from "./healthkit-source";
import { loadSyncModuleProfile } from "./module-profile";
import { sourceForModules } from "./modules";
import { getHealthAccess } from "./permissions";
import { recordHealthSyncRun } from "./status";

import { readCloudAccess, writesPaused } from "@/lib/cloud-access";
import { client } from "@/utils/orpc";

export type HealthSyncResult =
  | {
      status: "skipped";
      reason: "unsupported_platform" | "unavailable" | "no_permissions" | "access_ended";
    }
  | { status: "done"; summary: DrainSummary }
  | { status: "failed"; errorCode: string };

let inFlight: Promise<HealthSyncResult> | null = null;

/**
 * One sync run. Foreground and background callers share a single in-flight
 * run so two runs never move the same cursor concurrently.
 */
export function runHealthSync(options: DrainOptions): Promise<HealthSyncResult> {
  inFlight ??= run(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(options: DrainOptions): Promise<HealthSyncResult> {
  const startedAt = new Date();
  if (Platform.OS !== "android" && Platform.OS !== "ios")
    return { status: "skipped", reason: "unsupported_platform" };
  const ios = Platform.OS === "ios";
  const access = await getHealthAccess();
  if (!access.available) return { status: "skipped", reason: "unavailable" };
  if (access.grantedTypes.length === 0) return { status: "skipped", reason: "no_permissions" };

  // #298 — an OpenValens Cloud workspace whose access ended takes no new
  // records: skip without reading the health store or moving any cursor, so
  // the next run after access is back resumes exactly where this one stopped.
  // If the state cannot be read the run goes ahead; a refusal then stops it.
  if (writesPaused(await readCloudAccess())) {
    await recordHealthSyncRun(startedAt, null, "ACCESS_READ_ONLY");
    return { status: "skipped", reason: "access_ended" };
  }

  try {
    // Onboarding stage 1: hidden modules' data types are not read or sent.
    const modules = await loadSyncModuleProfile();
    const deviceId = await getDeviceId();
    await ensureDeviceRegistered(deviceId);
    const summary = await drainHealthChanges(
      {
        deviceId,
        provider: ios ? "apple_health" : "health_connect",
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        now: () => new Date(),
        source: sourceForModules(ios ? healthKitSource : healthConnectSource, modules),
        cursors: asyncStorageCursorStore,
        send: async (batch) => {
          await client.mobile.ingestBatch(batch);
        },
      },
      options,
    );
    // A revoked device starts from scratch if it is ever re-registered.
    if (summary.fatalErrorCode === "PERMISSION_DENIED") await clearCursors();
    await recordHealthSyncRun(startedAt, summary, null);
    return { status: "done", summary };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const errorCode = typeof code === "string" ? code : "SYNC_FAILED";
    await recordHealthSyncRun(startedAt, null, errorCode);
    return { status: "failed", errorCode };
  }
}
