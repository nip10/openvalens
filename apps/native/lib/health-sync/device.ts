import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { client } from "@/utils/orpc";

/** Random per-install id; never an account or org id. */
const DEVICE_ID_KEY = "openhealth.health-sync.device-id";
const REGISTERED_KEY = "openhealth.health-sync.device-registered";

export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

/** Registers the device with the server once per install. */
export async function ensureDeviceRegistered(deviceId: string): Promise<void> {
  if ((await AsyncStorage.getItem(REGISTERED_KEY)) === deviceId) return;
  await client.mobile.registerDevice({
    deviceId,
    platform: Platform.OS === "ios" ? "ios" : "android",
    appVersion: Constants.expoConfig?.version ?? "0.0.0",
  });
  await AsyncStorage.setItem(REGISTERED_KEY, deviceId);
}
