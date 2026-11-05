import * as SQLite from "expo-sqlite";

import type { DirectDeviceStore } from "./store";
import { createSqliteDirectDeviceStore } from "./store";

const DATABASE_NAME = "openvalens-direct-devices.db";
let privateStore: DirectDeviceStore | null = null;

/** Lazily opens a dedicated private DB; neither the handle nor raw queries escape. */
export function getDirectDeviceStore(): DirectDeviceStore {
  if (!privateStore) {
    const database = SQLite.openDatabaseSync(DATABASE_NAME);
    privateStore = createSqliteDirectDeviceStore(database);
  }
  return privateStore;
}
