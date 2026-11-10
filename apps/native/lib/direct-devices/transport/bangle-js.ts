/**
 * Connection session for Bangle.js / Espruino smartwatches.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`service/devices/banglejs/BangleJSDeviceSupport.java`).
 *
 * On connect the session subscribes to the RX (notify) characteristic, sets the
 * watch clock, requests MTU 131, asks for activity history since the last
 * cursor, and finally enables the realtime heart-rate stream. History arrives
 * as a stream of `act` lines terminated by `actfetch state:"end"`; each stored
 * bucket becomes a `steps_interval` and/or `heart_rate` record. Realtime
 * (`rt:1`) samples are forwarded to the live heart-rate sink only.
 *
 * Cursor handling mirrors upstream: the device preference defaults to
 * now − 1 day, and a successful `end` stores now − 60 s so the next connection
 * re-reads only the tail. This codebase has no durable device-preference
 * storage (the Colmi family re-requests fixed day windows instead), so the
 * cursor lives in an in-memory store that is injectable for tests and survives
 * reconnects only for the lifetime of the process.
 *
 * One unavailable characteristic or failed write must not fail the whole
 * connection; failures are reported through `onFailure` and never thrown.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  BANGLE_JS_RX_UUID,
  BANGLE_JS_SERVICE_UUID,
  BANGLE_JS_TX_UUID,
  type BangleJsModelId,
} from "../models/bangle-js";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  BANGLE_JS_DEFAULT_CHUNK_BYTES,
  BANGLE_JS_DEFAULT_LOOKBACK_MS,
  BANGLE_JS_MTU_REQUEST,
  BANGLE_JS_SYNC_MARGIN_MS,
  BangleJsLineAssembler,
  actSampleToRecords,
  buildActFetch,
  buildRealtimeDisable,
  buildRealtimeEnable,
  buildTimeSet,
  chunk,
  parseActFetchState,
  parseActPacket,
  parseBangleJsLine,
  realtimeSampleToHeartRate,
  type BangleJsFailure,
  type BangleJsHeartRateSample,
  type BangleJsRecord,
} from "../protocol/bangle-js";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Every service a registered Bangle.js model exposes. */
export const BANGLE_JS_SERVICE_UUIDS: ReadonlySet<string> = new Set([BANGLE_JS_SERVICE_UUID]);

/** Local safety net for a silent history fetch; upstream has no explicit timeout. */
export const BANGLE_JS_HISTORY_WATCHDOG_MS = 30_000;
/** Delay before the first write, so the UART is ready after connect. */
export const BANGLE_JS_INIT_DELAY_MS = 1_000;

export type BangleJsProfile = Readonly<{
  modelId: BangleJsModelId;
  serviceUuid: string;
  /** Phone → watch write characteristic. */
  txUuid: string;
  /** Watch → phone notify characteristic. */
  rxUuid: string;
}>;

type ProfileDevice = Pick<Device, "characteristicsForService">;

async function characteristicUuidsFor(
  device: ProfileDevice,
  serviceUuid: string,
): Promise<readonly string[]> {
  const characteristics = await device.characteristicsForService(serviceUuid);
  return characteristics.map((characteristic) => normalizeServiceUuid(characteristic.uuid));
}

/**
 * Picks the Bangle.js profile from the connected device's services. The Nordic
 * UART service with both the write (TX) and notify (RX) characteristics is
 * required. Returns null when anything is missing.
 */
export async function selectBangleJsProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  modelId: BangleJsModelId,
): Promise<BangleJsProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(BANGLE_JS_SERVICE_UUID)) return null;
  const characteristics = await characteristicUuidsFor(device, BANGLE_JS_SERVICE_UUID);
  if (!characteristics.includes(BANGLE_JS_TX_UUID)) return null;
  if (!characteristics.includes(BANGLE_JS_RX_UUID)) return null;
  return {
    modelId,
    serviceUuid: BANGLE_JS_SERVICE_UUID,
    txUuid: BANGLE_JS_TX_UUID,
    rxUuid: BANGLE_JS_RX_UUID,
  };
}

/** Last-sync cursor storage. Not durable; see the module header. */
export type BangleJsSyncStateStore = Readonly<{
  getLastSync(deviceId: string): number | null;
  setLastSync(deviceId: string, millis: number): void;
}>;

/** Creates an isolated in-memory cursor store (used by tests and by default). */
export function createMemoryBangleJsSyncStateStore(): BangleJsSyncStateStore {
  const cursors = new Map<string, number>();
  return {
    getLastSync: (deviceId) => cursors.get(deviceId) ?? null,
    setLastSync: (deviceId, millis) => {
      cursors.set(deviceId, millis);
    },
  };
}

/** Process-wide fallback cursor store. */
export const defaultBangleJsSyncStateStore: BangleJsSyncStateStore =
  createMemoryBangleJsSyncStateStore();

export type BangleJsTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: BangleJsTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type MonitorDevice = Pick<Device, "monitorCharacteristicForService">;
type WriteDevice = Pick<Device, "writeCharacteristicWithResponseForService">;
type MtuDevice = Pick<Device, "requestMTU">;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output +=
      second === undefined ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return output;
}

export type BangleJsSessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice> & Partial<MtuDevice>;
  /** Stable device id used as the last-sync cursor key. */
  deviceId: string;
  profile: BangleJsProfile;
  /** Stored history records (`rt:0` samples). */
  onRecord: (record: BangleJsRecord) => void;
  /** Realtime heart-rate samples (`rt:1`). */
  onLiveHeartRate?: (sample: BangleJsHeartRateSample) => void;
  onFailure?: (failure: BangleJsFailure) => void;
  now?: () => Date;
  timers?: BangleJsTimers;
  /** Write chunk size; upstream's pre-negotiation default is 20 bytes. */
  chunkBytes?: number;
  /** Delay before the first write. */
  initDelayMs?: number;
  /** Local watchdog for the history fetch. */
  watchdogMs?: number;
  /** Enable the realtime heart-rate stream after the history fetch. */
  realtime?: boolean;
  /** Set the watch clock from the phone during init. */
  setTime?: boolean;
  syncState?: BangleJsSyncStateStore;
}>;

/**
 * One watch connection. `start()` subscribes and launches the init + history
 * chain; `close()` stops the realtime stream and tears everything down.
 */
export class BangleJsSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly assembler = new BangleJsLineAssembler();
  private readonly timers: BangleJsTimers;
  private readonly now: () => Date;
  private readonly chunkBytes: number;
  private readonly initDelayMs: number;
  private readonly watchdogMs: number;
  private readonly realtime: boolean;
  private readonly setTime: boolean;
  private readonly syncState: BangleJsSyncStateStore;
  private pending: { resolve: () => void; timer: unknown } | null = null;
  private fetching = false;
  private realtimeEnabled = false;
  private closed = false;

  constructor(private readonly options: BangleJsSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? (() => new Date());
    this.chunkBytes = options.chunkBytes ?? BANGLE_JS_DEFAULT_CHUNK_BYTES;
    this.initDelayMs = options.initDelayMs ?? BANGLE_JS_INIT_DELAY_MS;
    this.watchdogMs = options.watchdogMs ?? BANGLE_JS_HISTORY_WATCHDOG_MS;
    this.realtime = options.realtime ?? true;
    this.setTime = options.setTime ?? true;
    this.syncState = options.syncState ?? defaultBangleJsSyncStateStore;
  }

  start(): void {
    if (this.closed) return;
    this.monitor();
    void this.run();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.realtimeEnabled) {
      this.realtimeEnabled = false;
      await this.writeFrame(buildRealtimeDisable()).catch(() => undefined);
    }
    this.finish();
    this.assembler.reset();
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
  }

  /** Sends the realtime enable frame; safe to call more than once. */
  async enableRealtime(): Promise<void> {
    if (this.closed || this.realtimeEnabled) return;
    this.realtimeEnabled = true;
    try {
      await this.writeFrame(buildRealtimeEnable());
    } catch {
      this.realtimeEnabled = false;
      this.options.onFailure?.("heart_rate");
    }
  }

  // -------------------------------------------------------------------------
  // Chain
  // -------------------------------------------------------------------------

  private async run(): Promise<void> {
    if (this.initDelayMs > 0) {
      await new Promise<void>((resolve) => this.timers.setTimeout(resolve, this.initDelayMs));
    }
    if (this.closed) return;
    await this.initialize();
    if (this.closed) return;
    await this.fetchHistory();
    if (this.closed || !this.realtime) return;
    await this.enableRealtime();
  }

  /** Clock and MTU setup. Neither failure aborts the chain. */
  private async initialize(): Promise<void> {
    if (this.setTime) {
      const now = this.now();
      const unixSeconds = Math.floor(now.getTime() / 1000);
      const tzOffsetHours = -now.getTimezoneOffset() / 60;
      try {
        await this.writeFrame(buildTimeSet(unixSeconds, tzOffsetHours));
      } catch {
        this.options.onFailure?.("init");
      }
    }
    if (this.closed) return;
    try {
      await this.options.device.requestMTU?.(BANGLE_JS_MTU_REQUEST);
    } catch {
      // Best effort: iOS ignores this and Android negotiates the largest MTU.
    }
  }

  private async fetchHistory(): Promise<void> {
    if (this.closed) return;
    const lastSync = this.syncState.getLastSync(this.options.deviceId);
    const since = lastSync ?? this.now().getTime() - BANGLE_JS_DEFAULT_LOOKBACK_MS;
    this.fetching = true;
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
      const timer = this.timers.setTimeout(() => {
        if (this.pending?.resolve !== settle) return;
        this.pending = null;
        this.fetching = false;
        this.options.onFailure?.("steps_interval");
        resolve();
      }, this.watchdogMs);
      this.pending = { resolve, timer };
    });
    try {
      await this.writeFrame(buildActFetch(since));
    } catch {
      if (this.pending?.resolve === settle) {
        this.finish();
        this.options.onFailure?.("steps_interval");
      }
    }
    await done;
  }

  private finish(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.fetching = false;
    this.timers.clearTimeout(pending.timer);
    pending.resolve();
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private handleBytes(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    for (const line of this.assembler.push(bytes)) this.handleLine(line);
  }

  private handleLine(line: string): void {
    const packet = parseBangleJsLine(line);
    if (!packet) return;
    if (parseActFetchState(packet) === "end") {
      // Successful close of the history stream: store now − 60 s so the next
      // connection only re-reads the tail (upstream behaviour).
      this.syncState.setLastSync(
        this.options.deviceId,
        this.now().getTime() - BANGLE_JS_SYNC_MARGIN_MS,
      );
      this.finish();
      return;
    }
    const sample = parseActPacket(packet);
    if (!sample) return;
    if (sample.realtime) {
      const live = realtimeSampleToHeartRate(sample);
      if (live) this.options.onLiveHeartRate?.(live);
      return;
    }
    if (!this.fetching) return;
    for (const record of actSampleToRecords(sample)) this.options.onRecord(record);
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  private async writeFrame(frame: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("BANGLE_JS_WRITE_UNAVAILABLE");
    const { serviceUuid, txUuid } = this.options.profile;
    for (const part of chunk(frame, this.chunkBytes)) {
      await write.call(this.options.device, serviceUuid, txUuid, encodeBase64(part));
    }
  }

  private monitor(): void {
    if (this.closed) return;
    const { serviceUuid, rxUuid } = this.options.profile;
    try {
      const subscription = this.options.device.monitorCharacteristicForService(
        serviceUuid,
        rxUuid,
        (error, value: Characteristic | null) => {
          if (this.closed) return;
          if (error || !value?.value) {
            this.options.onFailure?.("init");
            return;
          }
          try {
            this.handleBytes(decodeBase64(value.value));
          } catch {
            this.options.onFailure?.("init");
          }
        },
      );
      this.subscriptions.add(subscription);
    } catch {
      this.options.onFailure?.("init");
    }
  }
}

/** Creates a Bangle.js session for a selected profile. */
export function createBangleJsSession(options: BangleJsSessionOptions): BangleJsSession {
  return new BangleJsSession(options);
}
