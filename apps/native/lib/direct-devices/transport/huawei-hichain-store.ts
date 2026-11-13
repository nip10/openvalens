/**
 * Durable HiChain identity for Huawei/Honor watches: our per-watch id and the
 * bind's auth token, in the OS keystore (`expo-secure-store`). Without it every
 * app restart would need a new bind, i.e. a new confirmation on the watch.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { huaweiHexUpper, huaweiUnhex } from "../protocol/huawei-hichain";
import type { HuaweiHiChainStore } from "./huawei";

/** The synchronous subset of `expo-secure-store` used here (injectable for tests). */
export type SecureKeyValue = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  deleteItemAsync(key: string): Promise<void>;
}>;

/** SecureStore keys allow `[A-Za-z0-9._-]`. */
const keyFor = (deviceId: string, field: "androidId" | "authToken") =>
  `huawei.hichain.${deviceId.replace(/[^A-Za-z0-9._-]/g, "_")}.${field}`;

export function createSecureHuaweiHiChainStore(
  load: () => SecureKeyValue = () =>
    require("expo-secure-store") as typeof import("expo-secure-store"),
): HuaweiHiChainStore {
  let store: SecureKeyValue | null = null;
  const secure = () => (store ??= load());
  // A delete is async; the cache makes it visible to this process at once.
  const cache = new Map<string, string | null>();
  const read = (key: string) => {
    if (cache.has(key)) return cache.get(key)!;
    const value = secure().getItem(key);
    cache.set(key, value);
    return value;
  };
  const write = (key: string, value: string) => {
    secure().setItem(key, value);
    cache.set(key, value);
  };
  return {
    getAndroidId: (deviceId) => {
      const value = read(keyFor(deviceId, "androidId"));
      return value && /^[0-9A-F]{32}$/.test(value) ? value : null;
    },
    setAndroidId: (deviceId, androidId) => write(keyFor(deviceId, "androidId"), androidId),
    getAuthToken: (deviceId) => {
      const value = read(keyFor(deviceId, "authToken"));
      if (!value) return null;
      try {
        return huaweiUnhex(value);
      } catch {
        return null;
      }
    },
    setAuthToken: (deviceId, token) => write(keyFor(deviceId, "authToken"), huaweiHexUpper(token)),
    clearAuthToken: (deviceId) => {
      const key = keyFor(deviceId, "authToken");
      cache.set(key, null);
      void secure()
        .deleteItemAsync(key)
        .catch(() => undefined);
    },
  };
}
