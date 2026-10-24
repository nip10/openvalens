import * as Notifications from "expo-notifications";
import { router, useRootNavigationState } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { pushTapTarget, type PushTapResponse } from "@/lib/push-tap";

const nativePush = Platform.OS === "ios" || Platform.OS === "android";

/**
 * Foreground presentation (#243). Without a handler a push that arrives while
 * the app is open is dropped. Show it in the banner and the list, quietly: no
 * sound and no badge, matching the quiet channel the server sends on.
 * Call once at module scope of the root layout.
 */
export function installForegroundNotificationHandler(): void {
  if (!nativePush) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function open(response: PushTapResponse | null): void {
  const path = pushTapTarget(response, Notifications.DEFAULT_ACTION_IDENTIFIER);
  if (!path) return;
  router.push(path);
}

/**
 * Opens the screen a tapped notification points at (#243): `data.path`, only
 * when it is one of the allowlisted in-app routes (`lib/push-tap.ts`). Covers
 * a tap that launched the app (cold start) and taps while it is running. Waits
 * for the root navigator, so a cold-start tap does not navigate too early.
 */
export function PushNotificationLifecycle() {
  const navigationReady = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (!nativePush || !navigationReady) return;
    const initial = Notifications.getLastNotificationResponse();
    if (initial) {
      Notifications.clearLastNotificationResponse();
      open(initial);
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      Notifications.clearLastNotificationResponse();
      open(response);
    });
    return () => subscription.remove();
  }, [navigationReady]);

  return null;
}
