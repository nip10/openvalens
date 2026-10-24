/**
 * Where a tapped push notification may take the person (#243). The server
 * sends `data.path` (`/` for a new insight, `/preventive-care` for a care
 * reminder; see `packages/push`). The value arrives from the network, so it
 * is only ever compared against this fixed list of in-app routes: no prefix
 * match, no query string, no other scheme or host. Anything else is ignored
 * and the app simply opens where it is.
 *
 * Pure (no React Native imports) so it can be unit-tested with `bun test`.
 */

export const PUSH_TAP_PATHS = ["/", "/preventive-care"] as const;

export type PushTapPath = (typeof PUSH_TAP_PATHS)[number];

/** The allowlisted in-app path in a notification's `data`, or `null`. */
export function pushTapPath(data: unknown): PushTapPath | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  if (!Object.hasOwn(data, "path")) return null;
  const path = (data as { path?: unknown }).path;
  if (typeof path !== "string") return null;
  return (PUSH_TAP_PATHS as readonly string[]).includes(path) ? (path as PushTapPath) : null;
}

/** Minimal shape of an `expo-notifications` `NotificationResponse`. */
export type PushTapResponse = {
  actionIdentifier: string;
  notification: { request: { content: { data?: unknown } } };
};

/**
 * The path to open for a notification response: only for a plain tap on the
 * notification (`defaultActionId`, i.e. `DEFAULT_ACTION_IDENTIFIER`), never for
 * another action, and only for an allowlisted path.
 */
export function pushTapTarget(
  response: PushTapResponse | null | undefined,
  defaultActionId: string,
): PushTapPath | null {
  if (!response || response.actionIdentifier !== defaultActionId) return null;
  return pushTapPath(response.notification?.request?.content?.data);
}
