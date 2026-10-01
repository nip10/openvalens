import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CursorState, CursorStore } from "./drain";

/**
 * Cursors hold Health Connect change tokens and timestamps only, no health
 * data, so AsyncStorage is enough. The encrypted SQLite store arrives with
 * the offline read cache (#43), which does hold PHI.
 */
const KEY_PREFIX = "openhealth.health-sync.cursor.";

export const asyncStorageCursorStore: CursorStore = {
  async get(type) {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + type);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CursorState;
    } catch {
      return null;
    }
  },
  async set(type, state) {
    await AsyncStorage.setItem(KEY_PREFIX + type, JSON.stringify(state));
  },
};

/** Sign-out and device revocation start the next sync from scratch. */
export async function clearCursors(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(KEY_PREFIX));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
