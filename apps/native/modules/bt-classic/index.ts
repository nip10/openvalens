/**
 * Bluetooth Classic (RFCOMM) client and server sockets, Android only (decided 2026-11-13;
 * iOS cannot open RFCOMM to these watches). Mirrors `pebble-bond`: the native
 * module loads lazily, so pure tests inject a fake and never touch Expo.
 */

export type BtClassicDevice = Readonly<{
  address: string;
  name: string | null;
  type: "classic" | "le" | "dual" | "unknown";
  bonded: boolean;
}>;

/** One open RFCOMM socket as a byte stream (no frame alignment). */
export type RfcommLink = Readonly<{
  socketId: string;
  subscribe(onBytes: (bytes: Uint8Array) => void, onClosed: (reason: string) => void): () => void;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}>;

export type BtClassicAdapter = Readonly<{
  /** False on iOS or when the native module is absent (an older build). */
  isSupported(): boolean;
  listBonded(): Promise<readonly BtClassicDevice[]>;
  /** Classic inquiry; resolves when it finishes, times out or is aborted. */
  discover(options: {
    timeoutMs: number;
    onDevice(device: BtClassicDevice): void;
    signal?: AbortSignal;
  }): Promise<void>;
  openRfcomm(options: {
    address: string;
    uuid: string;
    secure?: boolean;
    timeoutMs: number;
  }): Promise<RfcommLink>;
  /**
   * SDP query (`fetchUuidsWithSdp`): resolves with the reported service UUIDs,
   * or the cached ones after `timeoutMs`. Garmin Edge connects back to a
   * listening phone within seconds of such a query.
   */
  fetchUuids(address: string, timeoutMs: number): Promise<readonly string[]>;
  /**
   * Server socket: publishes an SDP record for `uuid`, calls `onListening`
   * once it exists, and resolves with the first accepted link and its remote
   * address. The server is closed after that accept, on timeout
   * (`BT_CLASSIC_ACCEPT_TIMEOUT`) and on abort (`BT_CLASSIC_CANCELLED`).
   */
  listen(options: {
    name: string;
    uuid: string;
    secure?: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
    onListening?: () => void;
  }): Promise<{ link: RfcommLink; address: string | null }>;
}>;

type Subscription = { remove(): void };

export type NativeBtClassicModule = Readonly<{
  isAvailable(): boolean;
  listBonded(): Promise<unknown[]>;
  startDiscovery(timeoutMs: number): Promise<void>;
  cancelDiscovery(): Promise<void>;
  connect(address: string, uuid: string, secure: boolean, timeoutMs: number): Promise<string>;
  startReading(socketId: string, bufferSize: number): Promise<void>;
  write(socketId: string, bytes: Uint8Array): Promise<void>;
  close(socketId: string): Promise<void>;
  fetchUuids(address: string, timeoutMs: number): Promise<unknown[]>;
  listen(name: string, uuid: string, secure: boolean): Promise<string>;
  accept(
    serverId: string,
    timeoutMs: number,
  ): Promise<{ socketId?: unknown; address?: unknown } | null>;
  stopListening(serverId: string): Promise<void>;
  addListener(event: string, listener: (payload: Record<string, unknown>) => void): Subscription;
}>;

type NativeLoader = () => NativeBtClassicModule | null;

function loadNativeModule(): NativeBtClassicModule | null {
  const expo = require("expo") as {
    requireOptionalNativeModule(name: string): NativeBtClassicModule | null;
  };
  return expo.requireOptionalNativeModule("BtClassic");
}

const READ_BUFFER_BYTES = 4096;

export function createBtClassicAdapter(
  loadNative: NativeLoader = loadNativeModule,
  isAndroid: () => boolean = () =>
    (require("react-native") as { Platform: { OS: string } }).Platform.OS === "android",
): BtClassicAdapter {
  let resolved = false;
  let nativeModule: NativeBtClassicModule | null = null;
  const native = (): NativeBtClassicModule => {
    if (!resolved) {
      nativeModule = isAndroid() ? loadNative() : null;
      resolved = true;
    }
    if (!nativeModule) throw new Error("BT_CLASSIC_UNSUPPORTED");
    return nativeModule;
  };

  return {
    isSupported() {
      try {
        return native().isAvailable();
      } catch {
        return false;
      }
    },
    async listBonded() {
      const devices = await native().listBonded().catch(rethrowCoded);
      return devices.map(toDevice).filter((device): device is BtClassicDevice => device !== null);
    },
    async discover({ timeoutMs, onDevice, signal }) {
      const module = native();
      await new Promise<void>((resolve, reject) => {
        const subscriptions: Subscription[] = [];
        const finish = () => {
          for (const subscription of subscriptions) subscription.remove();
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          void module.cancelDiscovery().catch(() => undefined);
          finish();
        };
        subscriptions.push(
          module.addListener("onDiscovered", (payload) => {
            const device = toDevice(payload);
            if (device) onDevice(device);
          }),
          module.addListener("onDiscoveryFinished", finish),
        );
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
        module.startDiscovery(timeoutMs).catch((error: unknown) => {
          for (const subscription of subscriptions) subscription.remove();
          signal?.removeEventListener("abort", onAbort);
          try {
            rethrowCoded(error);
          } catch (coded) {
            reject(coded);
          }
        });
      });
    },
    async openRfcomm({ address, uuid, secure = true, timeoutMs }) {
      const module = native();
      const socketId = await module.connect(address, uuid, secure, timeoutMs).catch(rethrowCoded);
      return socketLink(module, socketId);
    },
    async fetchUuids(address, timeoutMs) {
      const uuids = await native().fetchUuids(address, timeoutMs).catch(rethrowCoded);
      return uuids.filter((uuid): uuid is string => typeof uuid === "string");
    },
    async listen({ name, uuid, secure = true, timeoutMs, signal, onListening }) {
      const module = native();
      if (signal?.aborted) throw new Error("BT_CLASSIC_CANCELLED");
      const serverId = await module.listen(name, uuid, secure).catch(rethrowCoded);
      // Closing the server aborts a pending native accept (BT_CLASSIC_CANCELLED).
      const stop = () => void module.stopListening(serverId).catch(() => undefined);
      signal?.addEventListener("abort", stop, { once: true });
      try {
        if (signal?.aborted) throw new Error("BT_CLASSIC_CANCELLED");
        onListening?.();
        const accepted = await module.accept(serverId, timeoutMs).catch((error: unknown) => {
          // An abort can close the server before the native accept starts.
          if (signal?.aborted) throw new Error("BT_CLASSIC_CANCELLED", { cause: error });
          return rethrowCoded(error);
        });
        const socketId = accepted?.socketId;
        if (typeof socketId !== "string") throw new Error("BT_CLASSIC_ACCEPT_FAILED");
        const link = socketLink(module, socketId);
        if (signal?.aborted) {
          await link.close();
          throw new Error("BT_CLASSIC_CANCELLED");
        }
        return {
          link,
          address: typeof accepted?.address === "string" ? accepted.address : null,
        };
      } finally {
        signal?.removeEventListener("abort", stop);
        // Native closes the server after one accept; this covers every other exit.
        stop();
      }
    },
  };
}

/** One native socket id as a byte stream; the reader starts on first subscribe. */
function socketLink(module: NativeBtClassicModule, socketId: string): RfcommLink {
  let readerStarted = false;
  let queue: Promise<void> = Promise.resolve();
  return {
    socketId,
    subscribe(onBytes, onClosed) {
      const data = module.addListener("onData", (payload) => {
        if (payload.socketId !== socketId) return;
        const bytes = toBytes(payload.base64 ?? payload.bytes);
        if (bytes) onBytes(bytes);
      });
      const closed = module.addListener("onClosed", (payload) => {
        if (payload.socketId !== socketId) return;
        onClosed(typeof payload.reason === "string" ? payload.reason : "error");
      });
      if (!readerStarted) {
        readerStarted = true;
        void module.startReading(socketId, READ_BUFFER_BYTES).catch(() => onClosed("error"));
      }
      return () => {
        data.remove();
        closed.remove();
      };
    },
    write(bytes) {
      // Strictly ordered, like the native writer.
      const next = queue.then(() => module.write(socketId, bytes).catch(rethrowCoded));
      queue = next.catch(() => undefined);
      return next;
    },
    async close() {
      await module.close(socketId).catch(() => undefined);
    },
  };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decodes standard base64 (the native module's `onData` payload). */
export function decodeBase64(value: string): Uint8Array | null {
  const clean = value.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let buffer = 0;
  let at = 0;
  for (const char of clean) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) return null;
    buffer = ((buffer << 6) | digit) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}

/** Bytes from the native event: base64 (current module), or a byte array. */
function toBytes(value: unknown): Uint8Array | null {
  if (typeof value === "string") return decodeBase64(value);
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte)))
    return Uint8Array.from(value as number[], (byte) => byte & 0xff);
  return null;
}

function toDevice(value: unknown): BtClassicDevice | null {
  const record = value as Record<string, unknown> | null;
  if (!record || typeof record.address !== "string") return null;
  const type = record.type;
  return {
    address: record.address,
    name: typeof record.name === "string" ? record.name : null,
    type: type === "classic" || type === "le" || type === "dual" ? type : "unknown",
    bonded: record.bonded === true,
  };
}

/** Expo rejects with `{ code, message }`; surface the stable code as the message. */
function rethrowCoded(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^BT_CLASSIC_[A-Z_]+$/.test(code))
    throw new Error(code, { cause: error });
  throw error;
}

export const btClassicAdapter = createBtClassicAdapter();
