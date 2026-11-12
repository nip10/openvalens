export type PebbleBondState = "none" | "bonding" | "bonded" | "unsupported";

export type PebbleBondAdapter = Readonly<{
  getState(nativeId: string): Promise<PebbleBondState>;
  ensureBonded(options: { nativeId: string; requestId: string; timeoutMs: number }): Promise<void>;
  cancelWait(requestId: string): Promise<void>;
}>;

type NativePebbleBondModule = Readonly<{
  getState(nativeId: string): Promise<unknown>;
  ensureBonded(nativeId: string, requestId: string, timeoutMs: number): Promise<void>;
  cancelWait(requestId: string): Promise<void>;
}>;

type NativeLoader = () => NativePebbleBondModule | null;
type PlatformCheck = () => boolean;

function loadNativeModule(): NativePebbleBondModule | null {
  // Delay requiring Expo until the adapter is used. This keeps pure JS tests
  // and non-Expo runtimes from attempting to load a native module at import time.
  const expo = require("expo") as {
    requireOptionalNativeModule(name: string): NativePebbleBondModule | null;
  };
  return expo.requireOptionalNativeModule("PebbleBond");
}

export function createPebbleBondAdapter(
  loadNative: NativeLoader = loadNativeModule,
  isIOS: PlatformCheck = () =>
    (require("react-native") as { Platform: { OS: string } }).Platform.OS === "ios",
): PebbleBondAdapter {
  let resolved = false;
  let nativeModule: NativePebbleBondModule | null = null;
  const getNative = (): NativePebbleBondModule | null => {
    if (!resolved) {
      nativeModule = loadNative();
      resolved = true;
    }
    return nativeModule;
  };

  return {
    async getState(nativeId) {
      if (isIOS() || !getNative()) return "unsupported";
      const state: unknown = await getNative()!.getState(nativeId).catch(rethrowCoded);
      if (!isPebbleBondState(state)) throw new Error("PEBBLE_PAIRING_INVALID_STATE");
      return state;
    },
    async ensureBonded({ nativeId, requestId, timeoutMs }) {
      if (isIOS() || !getNative()) {
        throw new Error("PEBBLE_PAIRING_UNSUPPORTED");
      }
      await getNative()!.ensureBonded(nativeId, requestId, timeoutMs).catch(rethrowCoded);
    },
    async cancelWait(requestId) {
      if (isIOS()) return;
      await getNative()?.cancelWait(requestId);
    },
  };
}

/**
 * Expo rejects with `{ code, message }`: the stable code is in `code`, the
 * message is prose. Callers map `message`, so surface the code there.
 */
function rethrowCoded(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^PEBBLE_PAIRING_[A-Z_]+$/.test(code))
    throw new Error(code, { cause: error });
  throw error;
}

function isPebbleBondState(state: unknown): state is PebbleBondState {
  return state === "none" || state === "bonding" || state === "bonded" || state === "unsupported";
}

export const pebbleBondAdapter = createPebbleBondAdapter();
