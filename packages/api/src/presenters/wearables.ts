/**
 * Cloud wearable connections, presented for web and mobile (Issue #60).
 * Pure TypeScript — safe for the app bundle: only a type is imported from
 * `@openvalens/wearables`. Labels are message descriptors the apps render with
 * Lingui; vendor names are brand names and stay as the server sends them.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { WearableConnectionStatus, WearableProviderId } from "@openvalens/wearables";

export type { WearableConnectionStatus, WearableProviderId };

/** The shape `wearables.list` returns per configured vendor. */
export type WearableConnectionLike = {
  provider: WearableProviderId;
  displayName: string;
  status: WearableConnectionStatus;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  quarantinedRecordCount: number;
  termsUrl: string;
};

const SENDS: Record<WearableProviderId, MessageDescriptor> = {
  oura: msg`Readiness score, overnight HRV, resting heart rate, sleep sessions and daily steps.`,
  whoop: msg`Recovery score, overnight HRV, resting heart rate and sleep sessions.`,
  polar: msg`Nightly Recharge status, overnight HRV and sleep sessions.`,
  withings: msg`Weight, body fat and sleep sessions.`,
  google_health: msg`Daily steps, weight, resting heart rate, daily HRV and sleep sessions.`,
};

/** What this vendor adds beyond the phone, translated. */
export function wearableSendsLabel(provider: WearableProviderId): MessageDescriptor {
  return SENDS[provider];
}

const STATUS: Record<WearableConnectionStatus, MessageDescriptor> = {
  not_connected: msg({ message: "Not connected", context: "wearable" }),
  active: msg({ message: "Connected", context: "wearable" }),
  reconnect_needed: msg`Reconnect needed`,
  quarantined: msg`Access revoked`,
};

export function wearableStatusLabel(status: WearableConnectionStatus): MessageDescriptor {
  return STATUS[status];
}

/**
 * Value-free explanation of `lastErrorCode`, or null when there is none.
 * Retryable failures say so; the grant-is-gone codes ask for a reconnect.
 */
export function wearableErrorLabel(code: string | null): MessageDescriptor | null {
  switch (code) {
    case null:
      return null;
    case "reauthorization_required":
    case "auth":
      return msg`The vendor no longer accepts this connection. Connect again to resume syncing.`;
    case "deauthorized":
      return msg`Access was revoked from the vendor's side.`;
    case "network":
    case "timeout":
    case "rate_limited":
    case "provider_unavailable":
      return msg`The vendor could not be reached on the last sync. It will retry automatically.`;
    default:
      return msg`The last sync failed. It will retry automatically.`;
  }
}

export type WearableCallbackNotice = {
  tone: "success" | "error";
  message: MessageDescriptor;
};

/**
 * Reads the `?provider=&status=` the OAuth callback appends when it returns
 * the browser to `/settings/devices`. Unknown statuses yield null.
 */
export function wearableCallbackNotice(
  status: string | undefined | null,
  displayName: string,
): WearableCallbackNotice | null {
  switch (status) {
    case "connected":
      return {
        tone: "success",
        message: msg`${displayName} is connected. The first sync runs shortly.`,
      };
    case "denied":
      return {
        tone: "error",
        message: msg`${displayName} was not connected: access was not granted.`,
      };
    case "unauthenticated":
      return {
        tone: "error",
        message: msg`${displayName} was not connected because this browser is not signed in. Sign in here and connect again.`,
      };
    case "failed":
      return {
        tone: "error",
        message: msg`${displayName} could not be connected. Try again, or ask your server operator if it keeps failing.`,
      };
    default:
      return null;
  }
}

/**
 * Which actions a row offers, from its status alone. Connecting again is
 * offered after a revocation too: reconnecting the same vendor account
 * restores the held-back rows instead of asking keep-or-delete.
 */
export function wearableActions(status: WearableConnectionStatus): {
  connect: boolean;
  syncNow: boolean;
  disconnect: boolean;
  resolveQuarantine: boolean;
} {
  return {
    connect: status !== "active",
    syncNow: status === "active",
    disconnect: status === "active" || status === "reconnect_needed",
    resolveQuarantine: status === "quarantined",
  };
}
