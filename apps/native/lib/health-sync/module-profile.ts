import type { PersonModule } from "@openvalens/api/presenters/modules";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ModuleProfile } from "./modules";

import { client } from "@/utils/orpc";

/**
 * The module choice the sync path uses (onboarding stage 1). Read from the
 * server each run; the last answer is kept on the phone (module ids only, no
 * health data) so a background run without the profile still skips hidden
 * modules. Nothing known yet = not chosen = every module on.
 */
const KEY = "openvalens.health-sync.enabled-modules";

export async function rememberSyncModules(enabledModules: readonly PersonModule[] | null) {
  await AsyncStorage.setItem(KEY, JSON.stringify(enabledModules)).catch(() => undefined);
}

export async function loadSyncModuleProfile(): Promise<ModuleProfile> {
  try {
    const profile = await client.profile.get({});
    await rememberSyncModules(profile.enabledModules);
    return { enabledModules: profile.enabledModules };
  } catch {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? { enabledModules: parsed as PersonModule[] } : null;
    } catch {
      return null;
    }
  }
}

export async function clearSyncModules(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}
