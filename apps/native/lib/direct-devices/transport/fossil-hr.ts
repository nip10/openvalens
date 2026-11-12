/**
 * Fossil Hybrid HR BLE session (issue #429): identity, authentication with the
 * user's key, activity-file download, and the watch-side delete.
 *
 * Upstream reference: Gadgetbridge 8976702fc3d00e6008c91fe994668cb4027f7bc2;
 * see docs/research/notes/Fossil Hybrid HR protocol/fossil-hybrid-hr-protocol.md.
 *
 * Safety rules this session enforces (the caller drives the order):
 * - `downloadActivity` never deletes anything. It returns the CRC-verified
 *   plaintext; the caller must store it durably and only then call
 *   `deleteFile` with the exact handle that was fetched.
 * - One request in flight; every response waiter is registered before its
 *   write, so a fast reply cannot be missed.
 * - A fresh key verification runs before each encrypted get (upstream
 *   `queueWrite(FileEncryptedInterface)`).
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import { resolveFossilHrModel, type FossilHrModel } from "../models/fossil-hr";
import {
  FOSSIL_AUTH_UUID,
  FOSSIL_BASIC_UUID,
  FOSSIL_DEVICE_INFO_SERVICE_UUID,
  FOSSIL_FILE_CONTROL_UUID,
  FOSSIL_FILE_DATA_UUID,
  FOSSIL_FIRMWARE_REVISION_UUID,
  FOSSIL_MODEL_NUMBER_UUID,
  FOSSIL_SERVICE_UUID,
  FossilEncryptedDownload,
  FossilPlainDownload,
  answerFossilChallenge,
  encodeFossilActivityLookup,
  encodeFossilFileDelete,
  encodeFossilFileGet,
  encodeFossilVerifyStart,
  fossilFileIv,
  fossilHandleFromLookupPayload,
  fossilResponseType,
  parseFossilDeleteResult,
  parseFossilGetStart,
  parseFossilLookupStart,
  parseFossilTransferCrc,
  parseFossilVerifyResult,
  type FossilCrypto,
  type FossilHandle,
} from "../protocol/fossil-hr";
import { decodeBase64 } from "./ble-gatt-sensors";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(triple >> 18) & 63]! + BASE64[(triple >> 12) & 63]!;
    out += b === undefined ? "=" : BASE64[(triple >> 6) & 63]!;
    out += c === undefined ? "=" : BASE64[triple & 63]!;
  }
  return out;
}

export type FossilTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;
const defaultTimers: FossilTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type FossilPeer = Readonly<{
  nativeId: string;
  model: FossilHrModel;
  firmwareRevision: string;
  modelNumber: string;
}>;

export type FossilDownloadResult =
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "file"; handle: FossilHandle; data: Uint8Array; crc: number }>;

export interface FossilSession {
  /** Notifications, identity reads and MTU; no authentication, no file access. */
  prepare(signal: AbortSignal): Promise<FossilPeer>;
  /** Verifies the key, looks up and downloads the activity file. Deletes nothing. */
  downloadActivity(options: {
    key: Uint8Array;
    signal: AbortSignal;
  }): Promise<FossilDownloadResult>;
  /** Deletes exactly `handle` on the watch. Call only after durable storage. */
  deleteFile(options: { handle: FossilHandle; signal: AbortSignal }): Promise<boolean>;
  close(): Promise<void>;
}

export type FossilSessionOptions = Readonly<{
  device: Device;
  nativeId: string;
  advertisedName?: string | null;
  crypto: FossilCrypto | (() => Promise<FossilCrypto>);
  timers?: FossilTimers;
  /** Per-response wait (default 30 s). */
  responseTimeoutMs?: number;
  /** Whole download budget (default 5 min, like upstream). */
  downloadTimeoutMs?: number;
}>;

type Waiter = {
  uuid: string;
  /** Drops the waiter without settling it (its request has ended). */
  cancel: () => void;
  /** Restarts its inactivity timer (data is still arriving). */
  rearm: () => void;
  accept: (value: Uint8Array) => boolean;
  resolve: (value: Uint8Array) => void;
  reject: (error: Error) => void;
};

const NOTIFIED = [
  FOSSIL_BASIC_UUID,
  FOSSIL_FILE_CONTROL_UUID,
  FOSSIL_FILE_DATA_UUID,
  FOSSIL_AUTH_UUID,
];

export class FossilHrSession implements FossilSession {
  private readonly timers: FossilTimers;
  private readonly subscriptions: Subscription[] = [];
  private readonly waiters = new Set<Waiter>();
  private dataSink: ((packet: Uint8Array) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private writeWithResponse = new Map<string, boolean>();
  private crypto: FossilCrypto | null = null;
  private peer: FossilPeer | null = null;
  private closed = false;
  /** Failure of the current request only; reset when the next one starts. */
  private failure: Error | null = null;
  /** Link-level failure (monitor, write, close): every later request fails. */
  private fatal: Error | null = null;
  private rejectDataWait: ((error: Error) => void) | null = null;

  constructor(private readonly options: FossilSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
  }

  async prepare(signal: AbortSignal): Promise<FossilPeer> {
    return this.exclusive(signal, async () => {
      const device = this.options.device;
      const characteristics = await device.characteristicsForService(FOSSIL_SERVICE_UUID);
      const byUuid = new Map(characteristics.map((c) => [c.uuid.toLowerCase(), c] as const));
      for (const uuid of [FOSSIL_FILE_CONTROL_UUID, FOSSIL_FILE_DATA_UUID, FOSSIL_AUTH_UUID])
        if (!byUuid.has(uuid)) throw new Error("FOSSIL_SERVICE_MISSING");
      // Upstream never chooses a write type (spec §1.3); prefer with-response
      // where the characteristic offers it.
      for (const [uuid, characteristic] of byUuid)
        this.writeWithResponse.set(uuid, characteristic.isWritableWithResponse !== false);
      for (const uuid of NOTIFIED) {
        if (!byUuid.has(uuid)) continue;
        this.subscriptions.push(
          device.monitorCharacteristicForService(FOSSIL_SERVICE_UUID, uuid, (error, value) => {
            if (error) {
              this.fail(new Error("FOSSIL_MONITOR_FAILED"), true);
              return;
            }
            if (value?.value) this.route(uuid, decodeBase64(value.value));
          }),
        );
      }
      const firmwareRevision = await this.readString(FOSSIL_FIRMWARE_REVISION_UUID);
      const modelNumber = await this.readString(FOSSIL_MODEL_NUMBER_UUID);
      // Best effort, like upstream: a failed MTU change must not stall setup.
      await device.requestMTU(512).catch(() => undefined);
      const model = resolveFossilHrModel({
        firmwareRevision,
        modelNumber,
        advertisedName: this.options.advertisedName,
      });
      if (!model) throw new Error("FOSSIL_MODEL_UNSUPPORTED");
      this.peer = { nativeId: this.options.nativeId, model, firmwareRevision, modelNumber };
      return this.peer;
    });
  }

  async downloadActivity(options: {
    key: Uint8Array;
    signal: AbortSignal;
  }): Promise<FossilDownloadResult> {
    if (!this.peer) throw new Error("FOSSIL_NOT_PREPARED");
    return this.exclusive(options.signal, async () => {
      const crypto = await this.loadCrypto();
      const budget = this.deadline(this.options.downloadTimeoutMs ?? 300_000);
      try {
        await this.verify(crypto, options.key);
        const handle = await this.lookup();
        if (!handle) return { status: "empty" } as const;
        const randoms = await this.verify(crypto, options.key);
        return await this.encryptedGet(crypto, options.key, handle, randoms);
      } finally {
        budget.clear();
      }
    });
  }

  async deleteFile(options: { handle: FossilHandle; signal: AbortSignal }): Promise<boolean> {
    if (!this.peer) throw new Error("FOSSIL_NOT_PREPARED");
    return this.exclusive(options.signal, async () => {
      const reply = this.expect(
        FOSSIL_FILE_CONTROL_UUID,
        (value) => value.length === 4 && value[0] === 0x8b,
      );
      await this.write(FOSSIL_FILE_CONTROL_UUID, encodeFossilFileDelete(options.handle));
      return parseFossilDeleteResult(await reply, options.handle) === true;
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error("CANCELLED"), true);
    for (const subscription of this.subscriptions.splice(0)) subscription.remove();
    await this.options.device.cancelConnection().catch(() => undefined);
  }

  // -------------------------------------------------------------------------

  /** One request at a time; abort or close rejects everything pending. */
  private exclusive<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.closed || signal.aborted) throw new Error("CANCELLED");
      if (this.fatal) throw this.fatal;
      // A timeout or a bad download fails only its own request.
      this.failure = null;
      const abort = () => this.fail(new Error("CANCELLED"));
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await work();
      } finally {
        signal.removeEventListener("abort", abort);
        this.dataSink = null;
        this.rejectDataWait = null;
        // Waiters this request registered but never needed (e.g. the type-8
        // reply after an empty lookup) must not catch the next request's.
        for (const waiter of Array.from(this.waiters)) waiter.cancel();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private fail(error: Error, fatal = false): void {
    if (fatal) this.fatal ??= error;
    this.failure ??= error;
    this.rejectDataWait?.(this.failure);
    this.rejectDataWait = null;
    // Snapshot: rejecting a waiter may register another.
    for (const waiter of Array.from(this.waiters)) {
      this.waiters.delete(waiter);
      waiter.reject(this.failure);
    }
  }

  private route(uuid: string, value: Uint8Array): void {
    if (uuid === FOSSIL_FILE_DATA_UUID) {
      // A transfer in progress is activity: reply timeouts measure silence,
      // not total transfer time (the download budget caps that).
      for (const waiter of this.waiters) waiter.rearm();
      this.dataSink?.(value);
      return;
    }
    for (const waiter of this.waiters)
      if (waiter.uuid === uuid && waiter.accept(value)) {
        this.waiters.delete(waiter);
        waiter.resolve(value);
        return;
      }
  }

  /** Registers a waiter now; it resolves with the first matching notification. */
  private expect(uuid: string, accept: (value: Uint8Array) => boolean): Promise<Uint8Array> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<Uint8Array>((resolve, reject) => {
      const waiter: Waiter = {
        uuid,
        accept,
        cancel: () => undefined,
        rearm: () => undefined,
        resolve: () => undefined,
        reject: () => undefined,
      };
      const timeoutMs = this.options.responseTimeoutMs ?? 30_000;
      const onTimeout = () => {
        this.waiters.delete(waiter);
        reject(new Error("FOSSIL_RESPONSE_TIMEOUT"));
      };
      let timer = this.timers.setTimeout(onTimeout, timeoutMs);
      waiter.rearm = () => {
        this.timers.clearTimeout(timer);
        timer = this.timers.setTimeout(onTimeout, timeoutMs);
      };
      waiter.resolve = (value) => {
        this.timers.clearTimeout(timer);
        resolve(value);
      };
      waiter.reject = (error) => {
        this.timers.clearTimeout(timer);
        reject(error);
      };
      waiter.cancel = () => {
        this.timers.clearTimeout(timer);
        this.waiters.delete(waiter);
      };
      this.waiters.add(waiter);
    });
  }

  private deadline(ms: number): { clear(): void } {
    const handle = this.timers.setTimeout(
      () => this.fail(new Error("FOSSIL_DOWNLOAD_TIMEOUT")),
      ms,
    );
    return { clear: () => this.timers.clearTimeout(handle) };
  }

  private async write(uuid: string, bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("CANCELLED");
    if (this.fatal) throw this.fatal;
    if (this.failure) throw this.failure;
    const device = this.options.device;
    try {
      if (this.writeWithResponse.get(uuid) !== false)
        await device.writeCharacteristicWithResponseForService(
          FOSSIL_SERVICE_UUID,
          uuid,
          encodeBase64(bytes),
        );
      else
        await device.writeCharacteristicWithoutResponseForService(
          FOSSIL_SERVICE_UUID,
          uuid,
          encodeBase64(bytes),
        );
    } catch {
      const error = new Error("FOSSIL_WRITE_FAILED");
      this.fail(error, true);
      throw error;
    }
  }

  private async readString(uuid: string): Promise<string> {
    let characteristic: Characteristic;
    try {
      characteristic = await this.options.device.readCharacteristicForService(
        FOSSIL_DEVICE_INFO_SERVICE_UUID,
        uuid,
      );
    } catch {
      throw new Error("FOSSIL_DEVICE_INFO_UNAVAILABLE");
    }
    const bytes = characteristic.value ? decodeBase64(characteristic.value) : new Uint8Array();
    return new TextDecoder().decode(bytes).replace(/\0+$/, "").trim();
  }

  private async loadCrypto(): Promise<FossilCrypto> {
    if (this.crypto) return this.crypto;
    const source = this.options.crypto;
    this.crypto = typeof source === "function" ? await source() : source;
    return this.crypto;
  }

  /** VerifyPrivateKeyRequest (spec §3.2); returns the randoms for the file IV. */
  private async verify(
    crypto: FossilCrypto,
    key: Uint8Array,
  ): Promise<{ phoneRandom: Uint8Array; watchRandom: Uint8Array }> {
    const phoneRandom = crypto.randomBytes(8);
    const challenge = this.expect(FOSSIL_AUTH_UUID, (value) => value[1] === 0x01);
    await this.write(FOSSIL_AUTH_UUID, encodeFossilVerifyStart(phoneRandom));
    const { watchRandom, reply } = answerFossilChallenge(crypto, key, await challenge);
    const result = this.expect(FOSSIL_AUTH_UUID, (value) => value[1] === 0x02);
    await this.write(FOSSIL_AUTH_UUID, reply);
    if (parseFossilVerifyResult(await result) !== true) throw new Error("FOSSIL_AUTH_FAILED");
    return { phoneRandom, watchRandom };
  }

  /** Unencrypted lookup of the activity file's dynamic handle (spec §4.3). */
  private async lookup(): Promise<FossilHandle | null> {
    const download = new FossilPlainDownload();
    const data = this.dataWait();
    this.dataSink = (packet) => {
      try {
        if (download.push(packet)) data.settle();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("FOSSIL_LOOKUP_FAILED"));
      }
    };
    const start = this.expect(FOSSIL_FILE_CONTROL_UUID, (value) => fossilResponseType(value) === 2);
    const done = this.expect(FOSSIL_FILE_CONTROL_UUID, (value) => fossilResponseType(value) === 8);
    done.catch(() => undefined);
    await this.write(FOSSIL_FILE_CONTROL_UUID, encodeFossilActivityLookup());
    const header = parseFossilLookupStart(await start);
    if (!header || header.status !== 0) throw new Error("FOSSIL_LOOKUP_FAILED");
    if (header.size === 0) return null;
    const crc = parseFossilTransferCrc(await done);
    await data.promise;
    if (crc === null) throw new Error("FOSSIL_LOOKUP_FAILED");
    return fossilHandleFromLookupPayload(download.result(crc));
  }

  /** Encrypted get of the whole file (spec §4.4). */
  private async encryptedGet(
    crypto: FossilCrypto,
    key: Uint8Array,
    handle: FossilHandle,
    randoms: { phoneRandom: Uint8Array; watchRandom: Uint8Array },
  ): Promise<FossilDownloadResult> {
    // Packets can arrive right after the type-1 reply: buffer until the
    // decryptor exists, then feed it in order.
    let download: FossilEncryptedDownload | null = null;
    const early: Uint8Array[] = [];
    const data = this.dataWait();
    const feed = (packet: Uint8Array) => {
      try {
        if (download!.push(packet)) data.settle();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("FOSSIL_FILE_FAILED"));
      }
    };
    this.dataSink = (packet) => (download ? feed(packet) : early.push(packet));
    const start = this.expect(FOSSIL_FILE_CONTROL_UUID, (value) => fossilResponseType(value) === 1);
    const done = this.expect(FOSSIL_FILE_CONTROL_UUID, (value) => fossilResponseType(value) === 8);
    done.catch(() => undefined);
    await this.write(FOSSIL_FILE_CONTROL_UUID, encodeFossilFileGet(handle));
    const header = parseFossilGetStart(await start, handle);
    if (!header || header.status !== 0) throw new Error("FOSSIL_FILE_GET_FAILED");
    download = new FossilEncryptedDownload(
      crypto,
      key,
      fossilFileIv(randoms.phoneRandom, randoms.watchRandom),
      header.fileSize,
    );
    for (const packet of early.splice(0)) feed(packet);
    const complete = await done;
    // Upstream checks the handle echo on the completion reply too.
    if (complete[1] !== handle.minor || complete[2] !== handle.major)
      throw new Error("FOSSIL_FILE_HANDLE_MISMATCH");
    const crc = parseFossilTransferCrc(complete);
    await data.promise;
    if (crc === null) throw new Error("FOSSIL_FILE_GET_FAILED");
    return { status: "file", handle, data: download.result(crc), crc };
  }

  /** A promise settled by `settle()`, or rejected as soon as the session fails. */
  private dataWait(): { promise: Promise<void>; settle(): void } {
    let settle!: () => void;
    const promise = new Promise<void>((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      this.rejectDataWait = reject;
      settle = () => {
        this.rejectDataWait = null;
        resolve();
      };
    });
    promise.catch(() => undefined);
    return { promise, settle: () => settle?.() };
  }
}

export function createFossilHrSession(options: FossilSessionOptions): FossilSession {
  return new FossilHrSession(options);
}
