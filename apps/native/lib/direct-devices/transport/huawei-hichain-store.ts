/**
 * Durable HiChain identity for Huawei/Honor watches: our per-watch id, the
 * bind's auth token and, for Honor PAKE watches, our Ed25519 seed and the
 * watch's identity, in the OS keystore (`expo-secure-store`). Without it every
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
const safeId = (deviceId: string) => deviceId.replace(/[^A-Za-z0-9._-]/g, "_");
/** Every field the store writes per watch (the purge deletes each). */
const FIELDS = ["androidId", "authToken", "pakeSeed", "pakePeerId", "pakePeerPk"] as const;
const keyFor = (deviceId: string, field: (typeof FIELDS)[number]) =>
  `huawei.hichain.${safeId(deviceId)}.${field}`;
/** The keystore cannot list keys, so the store keeps the ids it wrote, for purging. */
const INDEX_KEY = "huawei.hichain.index";

const loadSecureStore = (): SecureKeyValue =>
  require("expo-secure-store") as typeof import("expo-secure-store");

function readIndex(secure: SecureKeyValue): string[] {
  try {
    const parsed: unknown = JSON.parse(secure.getItem(INDEX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Deletes every HiChain id and token this phone holds (sign-out, server
 * switch): they identify the phone to the user's watches.
 */
export async function purgeSecureHuaweiHiChainStore(
  load: () => SecureKeyValue = loadSecureStore,
): Promise<void> {
  const secure = load();
  const ids = readIndex(secure);
  await Promise.all(
    ids.flatMap((id) =>
      FIELDS.map((field) => `huawei.hichain.${id}.${field}`).map((key) =>
        secure.deleteItemAsync(key).catch(() => undefined),
      ),
    ),
  );
  await secure.deleteItemAsync(INDEX_KEY).catch(() => undefined);
}

export function createSecureHuaweiHiChainStore(
  load: () => SecureKeyValue = loadSecureStore,
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
  const indexed = new Set<string>();
  const write = (deviceId: string, key: string, value: string) => {
    const id = safeId(deviceId);
    if (!indexed.has(id)) {
      const ids = readIndex(secure());
      if (!ids.includes(id)) secure().setItem(INDEX_KEY, JSON.stringify([...ids, id]));
      indexed.add(id);
    }
    secure().setItem(key, value);
    cache.set(key, value);
  };
  const readBytes = (key: string) => {
    const value = read(key);
    if (!value) return null;
    try {
      return huaweiUnhex(value);
    } catch {
      return null;
    }
  };
  const remove = (key: string) => {
    cache.set(key, null);
    void secure()
      .deleteItemAsync(key)
      .catch(() => undefined);
  };
  return {
    getPakeSeed: (deviceId) => {
      const seed = readBytes(keyFor(deviceId, "pakeSeed"));
      return seed?.length === 32 ? seed : null;
    },
    setPakeSeed: (deviceId, seed) =>
      write(deviceId, keyFor(deviceId, "pakeSeed"), huaweiHexUpper(seed)),
    getPakePeer: (deviceId) => {
      const authId = readBytes(keyFor(deviceId, "pakePeerId"));
      const authPk = readBytes(keyFor(deviceId, "pakePeerPk"));
      return authId && authPk?.length === 32 ? { authId, authPk } : null;
    },
    setPakePeer: (deviceId, peer) => {
      write(deviceId, keyFor(deviceId, "pakePeerId"), huaweiHexUpper(peer.authId));
      write(deviceId, keyFor(deviceId, "pakePeerPk"), huaweiHexUpper(peer.authPk));
    },
    clearPakePeer: (deviceId) => {
      remove(keyFor(deviceId, "pakePeerId"));
      remove(keyFor(deviceId, "pakePeerPk"));
    },
    getAndroidId: (deviceId) => {
      const value = read(keyFor(deviceId, "androidId"));
      return value && /^[0-9A-F]{32}$/.test(value) ? value : null;
    },
    setAndroidId: (deviceId, androidId) =>
      write(deviceId, keyFor(deviceId, "androidId"), androidId),
    getAuthToken: (deviceId) => {
      const value = read(keyFor(deviceId, "authToken"));
      if (!value) return null;
      try {
        return huaweiUnhex(value);
      } catch {
        return null;
      }
    },
    setAuthToken: (deviceId, token) =>
      write(deviceId, keyFor(deviceId, "authToken"), huaweiHexUpper(token)),
    clearAuthToken: (deviceId) => {
      const key = keyFor(deviceId, "authToken");
      cache.set(key, null);
      void secure()
        .deleteItemAsync(key)
        .catch(() => undefined);
    },
  };
}
