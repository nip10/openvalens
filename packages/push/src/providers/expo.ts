import {
  PushDeliveryError,
  sanitizePushErrorName,
  type PushMessage,
  type PushProvider,
  type PushTicket,
} from "../provider";

/**
 * Expo push service adapter (Issue #92). Plain `fetch` to the documented HTTP
 * API — no SDK. Messages are sent quietly: normal priority, no sound, the
 * iOS `passive` interruption level and the Android `insights` channel (which
 * the app creates with low importance). Only the per-ticket error *name* is
 * read back; the error message (which may echo a token) is ignored.
 */

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const DEFAULT_EXPO_TIMEOUT_MS = 10_000;
/** Android notification channel the app registers with low importance. */
export const INSIGHT_ANDROID_CHANNEL_ID = "insights";

type ExpoTicket = {
  status?: unknown;
  details?: { error?: unknown } | null;
};

export function buildExpoMessages(message: PushMessage) {
  return message.to.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: { path: message.path },
    priority: "normal",
    sound: null,
    channelId: INSIGHT_ANDROID_CHANNEL_ID,
    interruptionLevel: "passive",
  }));
}

export function createExpoPushProvider(deps: {
  fetch: typeof fetch;
  timeoutMs?: number;
}): PushProvider {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_EXPO_TIMEOUT_MS;
  return {
    id: "expo",
    async send(message: PushMessage): Promise<PushTicket[]> {
      if (message.to.length === 0) return [];
      let response: Response;
      try {
        response = await deps.fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(buildExpoMessages(message)),
        });
      } catch (error) {
        throw new PushDeliveryError(0, error instanceof Error ? error.name : "network_error");
      }
      if (!response.ok) throw new PushDeliveryError(response.status, null);

      let tickets: ExpoTicket[] = [];
      try {
        const parsed = (await response.json()) as { data?: unknown };
        tickets = Array.isArray(parsed.data) ? (parsed.data as ExpoTicket[]) : [];
      } catch {
        throw new PushDeliveryError(response.status, "invalid_response");
      }
      return message.to.map((token, index): PushTicket => {
        const ticket = tickets[index];
        if (ticket?.status === "ok") return { token, status: "ok" };
        const errorName = sanitizePushErrorName(ticket?.details?.error);
        if (errorName === "DeviceNotRegistered") return { token, status: "unregistered" };
        return { token, status: "error", errorName };
      });
    },
  };
}
