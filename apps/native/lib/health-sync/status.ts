import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DrainSummary } from "./drain";

/** Last-run summary for the UI. Stable codes only, never error messages. */
export type HealthSyncStatus = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  types: DrainSummary["types"];
};

const STATUS_KEY = "openhealth.health-sync.status";
const EMPTY: HealthSyncStatus = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastErrorCode: null,
  types: {},
};

export async function getHealthSyncStatus(): Promise<HealthSyncStatus> {
  try {
    const raw = await AsyncStorage.getItem(STATUS_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as HealthSyncStatus) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function recordHealthSyncRun(
  at: Date,
  summary: DrainSummary | null,
  errorCode: string | null,
) {
  const previous = await getHealthSyncStatus();
  const typeError =
    summary && Object.values(summary.types).find((type) => type?.status === "error");
  const code = errorCode ?? summary?.fatalErrorCode ?? typeError?.errorCode ?? null;
  await AsyncStorage.setItem(
    STATUS_KEY,
    JSON.stringify({
      lastRunAt: at.toISOString(),
      lastSuccessAt: code ? previous.lastSuccessAt : at.toISOString(),
      lastErrorCode: code,
      types: summary?.types ?? previous.types,
    } satisfies HealthSyncStatus),
  );
}
