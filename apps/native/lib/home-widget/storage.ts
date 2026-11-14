import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";

import { isHomeWidgetNonce, newHomeWidgetNonce } from "./link-guard";
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
 * This install's widget nonce (#505): the Android widget's links carry it, so
 * the app can tell its own widget's taps from a link another app or page
 * opened. Only the app (and so the widget it draws) can read it.
 */
const NONCE_KEY = "openvalens.home-widget.nonce";

/** The stored nonce, or `null` when there is none. */
export async function readHomeWidgetNonce(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(NONCE_KEY);
    return isHomeWidgetNonce(value) ? value : null;
  } catch {
    return null;
  }
}

/** The stored nonce, made and stored first when there is none (before drawing the widget). */
export async function ensureHomeWidgetNonce(): Promise<string> {
  const stored = await readHomeWidgetNonce();
  if (stored) return stored;
  const nonce = newHomeWidgetNonce((count) => Crypto.getRandomBytes(count));
  await AsyncStorage.setItem(NONCE_KEY, nonce);
  return nonce;
}

/** The stored nonce for a link check: `undefined` while it is read, `null` when off or none. */
export function useHomeWidgetNonce(enabled: boolean): string | null | undefined {
  const [nonce, setNonce] = useState<string | null | undefined>(enabled ? undefined : null);
  useEffect(() => {
    if (!enabled) {
      setNonce(null);
      return;
    }
    let active = true;
    void readHomeWidgetNonce().then((value) => {
      if (active) setNonce(value);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return nonce;
}

export async function readHomeWidgetSnapshot(): Promise<HomeWidgetSnapshot | null> {
  try {
    return parseHomeWidgetSnapshot(await AsyncStorage.getItem(SNAPSHOT_KEY));
  } catch {
    return null;
  }
}

export async function writeHomeWidgetSnapshot(snapshot: HomeWidgetSnapshot): Promise<void> {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
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

/** No one signed in: the widget's buttons, values and nonce go (a new nonce is made next time). */
export async function clearHomeWidgetSnapshot(): Promise<void> {
  await AsyncStorage.multiRemove([SNAPSHOT_KEY, NONCE_KEY]);
}

/** Sign-out: the widget forgets everything, the opt-in and the nonce included. */
export async function clearHomeWidgetStorage(): Promise<void> {
  await AsyncStorage.multiRemove([SNAPSHOT_KEY, VALUES_KEY, NONCE_KEY]);
  for (const listener of listeners) listener(false);
}
