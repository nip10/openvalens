import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { client } from "@/utils/orpc";

/**
 * Issue #92 — opt-in push for insights. Nothing here runs at launch: the OS
 * permission prompt appears only after the person taps "Turn on" (the
 * in-context offer or Settings). Notifications are quiet: an Android channel
 * with low importance and no sound; the server sends iOS `passive` pushes.
 * The payload is generic ("You have a new insight"), never a value.
 */

export const INSIGHT_CHANNEL_ID = "insights";

export type PushRegistration =
  | { status: "registered"; registeredDevices: number }
  | { status: "denied" }
  | { status: "unsupported" };

async function ensureQuietChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(INSIGHT_CHANNEL_ID, {
    name: "Insights",
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/** Asks for permission (explicit tap only) and registers this phone's Expo token. */
export async function enablePushOnThisPhone(): Promise<PushRegistration> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return { status: "unsupported" };
  const id = projectId();
  if (!id) return { status: "unsupported" };
  await ensureQuietChannel();
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted
    ? current
    : await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: false, allowSound: false },
      });
  if (!granted.granted) return { status: "denied" };
  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  const result = await client.insights.pushDevices.register({
    token: token.data,
    platform: Platform.OS,
  });
  return { status: "registered", registeredDevices: result.registeredDevices };
}

/** Removes this phone's token from the account (e.g. before signing out). */
export async function disablePushOnThisPhone(): Promise<void> {
  const id = projectId();
  if (!id) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await client.insights.pushDevices.unregister({ token: token.data });
}

export function describePushRegistration(result: PushRegistration): string {
  if (result.status === "registered") return "Notifications are on for this phone.";
  if (result.status === "denied")
    return "Notifications are blocked for OpenValens in your phone settings, so none will arrive here.";
  return "Push notifications are not available in this build of the app.";
}
