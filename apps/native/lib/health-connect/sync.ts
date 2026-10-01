/**
 * Sync-session transport for the mobile ingestion layer.
 *
 * WARNING / TODO: `@openhealth/api` does NOT expose a `mobile` (or
 * `contracts`) sync-session family yet — there is no `packages/api/src/contracts`
 * tree and `appRouter` mounts no `/sync-sessions` procedure. These functions
 * therefore use PLACEHOLDER REST calls shaped after the OLD Kotlin companion
 * (`SyncApiClient` in surgeonfish@1493427):
 *
 *   POST /api/v2/mobile/sync-sessions/start
 *   POST /api/v2/mobile/sync-sessions/:id/chunks
 *   POST /api/v2/mobile/sync-sessions/:id/finalize   (complete)
 *   POST /api/v2/mobile/sync-sessions/:id/abort      (no old equivalent; placeholder)
 *
 * When the oRPC contract lands, replace the `request(...)` calls with the
 * typed `client` from `@/utils/orpc` and delete `SyncApiError`.
 */
import { authClient } from "@/lib/auth-client";
import { ENV } from "@/src/env";

import type { HealthPayload } from "./types";

/** Bumped in lockstep with the server ingest payload schema. */
export const SYNC_PAYLOAD_VERSION = "1";

/** Default lookback window for a sync batch. */
export const DEFAULT_SYNC_WINDOW_HOURS = 6;

const SYNC_SESSIONS_PATH = "/api/v2/mobile/sync-sessions";

export interface SyncWindow {
  from: Date;
  to: Date;
}

export interface SyncSessionHandle {
  sessionId: string;
  uploadUrl: string;
}

export class SyncApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "SyncApiError";
    this.status = status;
    this.code = code;
  }
}

function serverUrl(): string {
  return ENV.EXPO_PUBLIC_SERVER_URL.replace(/\/+$/, "");
}

export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Small deterministic hash (djb2) for chunk dedupe keys. */
function hashPayload(payload: HealthPayload): string {
  const input = JSON.stringify(payload);
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return `djb2_${(hash >>> 0).toString(16)}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.Cookie = cookies;
    }
  } catch (error) {
    console.warn("[health-connect] unable to read auth cookie", error);
  }
  return headers;
}

type JsonRequestInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

async function request<T>(path: string, init: JsonRequestInit): Promise<T> {
  const { fetch } = await import("expo/fetch");
  const response = await fetch(`${serverUrl()}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...init.headers },
  });

  const bodyText = await response.text();

  if (!response.ok) {
    let code: string | null = null;
    let message = `Sync request failed with status ${response.status}.`;
    try {
      const parsed = JSON.parse(bodyText) as { error?: string; code?: string };
      code = parsed.code ?? null;
      message = parsed.error ?? message;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new SyncApiError(message, response.status, code);
  }

  if (!bodyText) {
    return undefined as T;
  }
  return JSON.parse(bodyText) as T;
}

/**
 * Opens a sync session on the server and returns its id plus the URL chunks
 * should be POSTed to.
 */
export async function startSyncSession(
  deviceId: string,
  window?: SyncWindow,
): Promise<SyncSessionHandle> {
  const to = window?.to ?? new Date();
  const from = window?.from ?? new Date(to.getTime() - DEFAULT_SYNC_WINDOW_HOURS * 3_600_000);

  const result = await request<{ sessionId: string; uploadUrl?: string }>(
    `${SYNC_SESSIONS_PATH}/start`,
    {
      method: "POST",
      body: JSON.stringify({
        payloadVersion: SYNC_PAYLOAD_VERSION,
        deviceId,
        timezone: getDeviceTimezone(),
        windowStart: from.toISOString(),
        windowEnd: to.toISOString(),
      }),
    },
  );

  return {
    sessionId: result.sessionId,
    uploadUrl:
      result.uploadUrl ??
      `${serverUrl()}${SYNC_SESSIONS_PATH}/${encodeURIComponent(result.sessionId)}/chunks`,
  };
}

/** Uploads one batch of records for an open session. */
export async function uploadPayload(sessionId: string, payload: HealthPayload): Promise<void> {
  await request<{ accepted: boolean }>(
    `${SYNC_SESSIONS_PATH}/${encodeURIComponent(sessionId)}/chunks`,
    {
      method: "POST",
      body: JSON.stringify({
        chunkIndex: 0,
        chunkCount: 1,
        chunkHash: hashPayload(payload),
        payloadJson: payload,
      }),
    },
  );
}

/** Finalizes a session once every chunk has been accepted. */
export async function completeSyncSession(sessionId: string): Promise<void> {
  await request<{ status: string }>(
    `${SYNC_SESSIONS_PATH}/${encodeURIComponent(sessionId)}/finalize`,
    {
      method: "POST",
      body: JSON.stringify({ finalChunkCount: 1 }),
    },
  );
}

/** Aborts an in-flight session. Placeholder endpoint — see file header. */
export async function abortSyncSession(sessionId: string, reason: string): Promise<void> {
  await request<{ status: string }>(
    `${SYNC_SESSIONS_PATH}/${encodeURIComponent(sessionId)}/abort`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}
