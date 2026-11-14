import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import { parseHomeWidgetSnapshot, type HomeWidgetSnapshot } from "./model";

/**
 * What the Android widget draws (#449), kept in the app's own storage: the
 * widget runs inside the app (a headless task), so nothing is shared outside
 * it. Every key is removed on sign-out.
 */
const SNAPSHOT_KEY = "openvalens.home-widget.snapshot";
/** The Settings opt-in for values on the widget. Absent means off. */
const VALUES_KEY = "openvalens.home-widget.values";
/**
 * 1.2.0's per-install widget nonce (#505), which the Android widget's links
 * carried. A tap the widget's receiver records replaced it, so it is only
 * removed now.
 */
const LEGACY_NONCE_KEY = "openvalens.home-widget.nonce";

export async function readHomeWidgetSnapshot(): Promise<HomeWidgetSnapshot | null> {
  try {
    return parseHomeWidgetSnapshot(await AsyncStorage.getItem(SNAPSHOT_KEY));
  } catch {
    return null;
  }
}

export async function writeHomeWidgetSnapshot(snapshot: HomeWidgetSnapshot): Promise<void> {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  await AsyncStorage.removeItem(LEGACY_NONCE_KEY);
}

const listeners = new Set<(enabled: boolean) => void>();

export async function readHomeWidgetValuesEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(VALUES_KEY)) === "on";
  } catch {
    return false;
  }
}

export async function setHomeWidgetValuesEnabled(enabled: boolean): Promise<void> {
  if (enabled) await AsyncStorage.setItem(VALUES_KEY, "on");
  else await AsyncStorage.removeItem(VALUES_KEY);
  for (const listener of listeners) listener(enabled);
}

/** The opt-in, `null` until read. Updates when Settings changes it. */
export function useHomeWidgetValuesEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void readHomeWidgetValuesEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    listeners.add(setEnabled);
    return () => {
      active = false;
      listeners.delete(setEnabled);
    };
  }, []);
  return enabled;
}

/** No one signed in: the widget's buttons and values go. */
export async function clearHomeWidgetSnapshot(): Promise<void> {
  await AsyncStorage.multiRemove([SNAPSHOT_KEY, LEGACY_NONCE_KEY]);
}

/** Sign-out: the widget forgets everything, the opt-in included. */
export async function clearHomeWidgetStorage(): Promise<void> {
  await AsyncStorage.multiRemove([SNAPSHOT_KEY, VALUES_KEY, LEGACY_NONCE_KEY]);
  for (const listener of listeners) listener(false);
}
