/**
 * Persisted sync status + device identity for the ingestion layer.
 *
 * Backed by AsyncStorage because the sync task runs headless (background
 * fetch) and must survive app restarts. `getSyncStatus` is async by nature of
 * AsyncStorage; `getCachedSyncStatus` exposes the in-memory snapshot for
 * synchronous render paths.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const SYNC_STATUS_KEY = "openhealth.health-connect.sync-status";
const DEVICE_ID_KEY = "openhealth.health-connect.device-id";

export interface SyncStatus {
  lastSyncAt: Date | null;
  pending: number;
  lastError: string | null;
}

interface PersistedSyncStatus {
  lastSyncAt: string | null;
  pending: number;
  lastError: string | null;
}

function emptyStatus(): SyncStatus {
  return { lastSyncAt: null, pending: 0, lastError: null };
}

let cachedStatus: SyncStatus = emptyStatus();

/** Reads the persisted status. Falls back to the in-memory snapshot. */
export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_STATUS_KEY);
    if (!raw) {
      return { ...cachedStatus };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedSyncStatus>;
    cachedStatus = {
      lastSyncAt: parsed.lastSyncAt ? new Date(parsed.lastSyncAt) : null,
      pending: typeof parsed.pending === "number" ? parsed.pending : 0,
      lastError: parsed.lastError ?? null,
    };
    return { ...cachedStatus };
  } catch (error) {
    console.warn("[health-connect] unable to read sync status", error);
    return { ...cachedStatus };
  }
}

/** Synchronous snapshot for render paths that cannot await. */
export function getCachedSyncStatus(): SyncStatus {
  return { ...cachedStatus };
}

/** Merges `patch` into the persisted status and returns the result. */
export async function updateSyncStatus(patch: Partial<SyncStatus>): Promise<SyncStatus> {
  const current = await getSyncStatus();
  const next: SyncStatus = {
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : current.lastSyncAt,
    pending: patch.pending !== undefined ? patch.pending : current.pending,
    lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
  };
  cachedStatus = next;

  const persisted: PersistedSyncStatus = {
    lastSyncAt: next.lastSyncAt ? next.lastSyncAt.toISOString() : null,
    pending: next.pending,
    lastError: next.lastError,
  };

  try {
    await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(persisted));
  } catch (error) {
    console.warn("[health-connect] unable to persist sync status", error);
  }

  return next;
}

export async function clearSyncStatus(): Promise<void> {
  cachedStatus = emptyStatus();
  try {
    await AsyncStorage.removeItem(SYNC_STATUS_KEY);
  } catch (error) {
    console.warn("[health-connect] unable to clear sync status", error);
  }
}

function generateDeviceId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoObject?.randomUUID === "function") {
    return `rnmobile_${cryptoObject.randomUUID()}`;
  }
  return `rnmobile_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-install device id, generated and persisted on first use. */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      return existing;
    }
    const created = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch (error) {
    console.warn("[health-connect] unable to persist device id", error);
    return generateDeviceId();
  }
}
