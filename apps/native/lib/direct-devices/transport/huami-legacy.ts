/**
 * Connection session for legacy Huami (pre-Zepp-OS Amazfit / Mi Band) devices.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/huami/HuamiSupport.java`
 * - `service/devices/huami/operations/init/InitOperation.java`
 * - `service/devices/huami/operations/fetch/AbstractFetchOperation.java`
 * - `service/devices/huami/operations/fetch/AbstractRepeatingFetchOperation.java`
 * - `service/devices/huami/operations/fetch/FetchActivityOperation.java`
 *
 * On `start(authKey)` the session subscribes to the auth, activity-control,
 * activity-data and (when present) heart-rate characteristics, runs the
 * per-model auth handshake, optionally sets the clock and reads the firmware
 * version (only to resolve a firmware-gated sample width), then walks the
 * repeating activity fetch until the device reports data at or past the
 * current time or the ten-round cap is reached. Each round's per-minute samples
 * become exact-minute `steps` records (plus `heart_rate` points), and sleep
 * sessions are derived once at the end from activity kinds 9/11.
 *
 * Auth key timing
 * ---------------
 * The key is user-entered, so the session is created on connect but only
 * started when the sync action supplies the key. This mirrors the existing
 * Zepp OS / Xiaomi flow while keeping the transfer in this family's own
 * connection session.
 *
 * One unavailable characteristic or failed write must not fail the whole
 * connection; failures are reported through `onFailure` and never thrown from
 * `start`. `whenDone()` rejects so a caller that supplied a key can surface the
 * failure.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  HUAMI_ACTIVITY_CONTROL_UUID,
  HUAMI_ACTIVITY_DATA_UUID,
  HUAMI_AUTH_UUID,
  HUAMI_CHUNKED_UUID,
  HUAMI_CURRENT_TIME_SERVICE_UUID,
  HUAMI_CURRENT_TIME_UUID,
  HUAMI_DEVICE_INFO_SERVICE_UUID,
  HUAMI_FIRMWARE_REVISION_UUID,
  HUAMI_HEART_RATE_CONTROL_UUID,
  HUAMI_HEART_RATE_MEASUREMENT_UUID,
  HUAMI_HEART_RATE_SERVICE_UUID,
  HUAMI_SERVICE_MIBAND2_UUID,
  HUAMI_SERVICE_UUID,
  type HuamiLegacyModelId,
  type HuamiSampleSizeRule,
} from "../models/huami-legacy";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  HUAMI_AUTH_FAIL,
  HUAMI_AUTH_REQUEST_RANDOM,
  HUAMI_AUTH_SEND_ENCRYPTED,
  HUAMI_AUTH_SEND_KEY,
  HUAMI_AUTH_SUCCESS,
  HUAMI_HR_START_CONTINUOUS,
  HUAMI_HR_STOP_CONTINUOUS,
  HUAMI_HR_STOP_MANUAL,
  HUAMI_RESPONSE,
  HUAMI_SUCCESS,
  buildActivityAckFrame,
  buildActivityFetchFrame,
  buildActivityStartFrame,
  buildAuthRequestRandom,
  buildAuthSendEncrypted,
  buildAuthSendKey,
  buildChunkedWrites,
  buildCurrentTimeFrame,
  encryptAuthChallenge,
  loadHuamiAuthCrypto,
  minuteSampleToRecords,
  parseActivityControlResponse,
  parseActivitySamples,
  parseAuthChallenge,
  parseAuthResponse,
  parseHeartRateMeasurement,
  parseHuamiAuthKey,
  resolveSampleSize,
  segmentSleepSessions,
  type HuamiAuthCrypto,
  type HuamiLegacyFailure,
  type HuamiLegacyRecord,
  type HuamiMinuteSample,
} from "../protocol/huami-legacy";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Every service a registered legacy Huami model may expose. */
export const HUAMI_LEGACY_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  HUAMI_SERVICE_UUID,
  HUAMI_SERVICE_MIBAND2_UUID,
  HUAMI_HEART_RATE_SERVICE_UUID,
  HUAMI_CURRENT_TIME_SERVICE_UUID,
  HUAMI_DEVICE_INFO_SERVICE_UUID,
]);

/** Upstream `AbstractRepeatingFetchOperation` caps a sync at ten rounds. */
export const HUAMI_LEGACY_MAX_ROUNDS = 10;
/** Local watchdog for each auth/fetch step; upstream has no explicit timeout. */
export const HUAMI_LEGACY_WATCHDOG_MS = 30_000;
/** Delay before the first write, so the GATT link is ready after connect. */
export const HUAMI_LEGACY_INIT_DELAY_MS = 1_000;
/**
 * Default history cursor: seven days. Upstream defaults to 100 days; this is a
 * deliberate bound so the first sync stays inside the ten-round cap.
 */
export const HUAMI_LEGACY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export type HuamiLegacyProfile = Readonly<{
  modelId: HuamiLegacyModelId;
  /** Primary service (activity control/data). */
  serviceUuid: string;
  /** Service that owns the auth characteristic (FEE0 or FEE1). */
  authServiceUuid: string;
  authUuid: string;
  activityControlUuid: string;
  activityDataUuid: string;
  chunkedUuid: string | null;
  currentTimeServiceUuid: string | null;
  currentTimeUuid: string | null;
  deviceInfoServiceUuid: string | null;
  firmwareRevisionUuid: string | null;
  heartRateServiceUuid: string | null;
  heartRateMeasurementUuid: string | null;
  heartRateControlUuid: string | null;
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
 * Picks the legacy Huami profile from the connected device's services. FEE0
 * with both activity characteristics is required; the auth characteristic may
 * live in FEE0 or FEE1. Chunked, clock, device-info and heart-rate
 * characteristics are optional. Returns null when anything required is absent.
 */
export async function selectHuamiLegacyProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  modelId: HuamiLegacyModelId,
): Promise<HuamiLegacyProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(HUAMI_SERVICE_UUID)) return null;
  const primary = await characteristicUuidsFor(device, HUAMI_SERVICE_UUID);
  if (!primary.includes(HUAMI_ACTIVITY_CONTROL_UUID)) return null;
  if (!primary.includes(HUAMI_ACTIVITY_DATA_UUID)) return null;

  let authServiceUuid = HUAMI_SERVICE_UUID;
  if (!primary.includes(HUAMI_AUTH_UUID)) {
    if (!services.has(HUAMI_SERVICE_MIBAND2_UUID)) return null;
    const secondary = await characteristicUuidsFor(device, HUAMI_SERVICE_MIBAND2_UUID);
    if (!secondary.includes(HUAMI_AUTH_UUID)) return null;
    authServiceUuid = HUAMI_SERVICE_MIBAND2_UUID;
  }

  let currentTimeServiceUuid: string | null = null;
  let currentTimeUuid: string | null = null;
  if (services.has(HUAMI_CURRENT_TIME_SERVICE_UUID)) {
    const clock = await characteristicUuidsFor(device, HUAMI_CURRENT_TIME_SERVICE_UUID);
    if (clock.includes(HUAMI_CURRENT_TIME_UUID)) {
      currentTimeServiceUuid = HUAMI_CURRENT_TIME_SERVICE_UUID;
      currentTimeUuid = HUAMI_CURRENT_TIME_UUID;
    }
  }

  let deviceInfoServiceUuid: string | null = null;
  let firmwareRevisionUuid: string | null = null;
  if (services.has(HUAMI_DEVICE_INFO_SERVICE_UUID)) {
    const info = await characteristicUuidsFor(device, HUAMI_DEVICE_INFO_SERVICE_UUID);
    if (info.includes(HUAMI_FIRMWARE_REVISION_UUID)) {
      deviceInfoServiceUuid = HUAMI_DEVICE_INFO_SERVICE_UUID;
      firmwareRevisionUuid = HUAMI_FIRMWARE_REVISION_UUID;
    }
  }

  let heartRateServiceUuid: string | null = null;
  let heartRateMeasurementUuid: string | null = null;
  let heartRateControlUuid: string | null = null;
  if (services.has(HUAMI_HEART_RATE_SERVICE_UUID)) {
    const heartRate = await characteristicUuidsFor(device, HUAMI_HEART_RATE_SERVICE_UUID);
    if (heartRate.includes(HUAMI_HEART_RATE_MEASUREMENT_UUID)) {
      heartRateServiceUuid = HUAMI_HEART_RATE_SERVICE_UUID;
      heartRateMeasurementUuid = HUAMI_HEART_RATE_MEASUREMENT_UUID;
      if (heartRate.includes(HUAMI_HEART_RATE_CONTROL_UUID))
        heartRateControlUuid = HUAMI_HEART_RATE_CONTROL_UUID;
    }
  }

  return {
    modelId,
    serviceUuid: HUAMI_SERVICE_UUID,
    authServiceUuid,
    authUuid: HUAMI_AUTH_UUID,
    activityControlUuid: HUAMI_ACTIVITY_CONTROL_UUID,
    activityDataUuid: HUAMI_ACTIVITY_DATA_UUID,
    chunkedUuid: primary.includes(HUAMI_CHUNKED_UUID) ? HUAMI_CHUNKED_UUID : null,
    currentTimeServiceUuid,
    currentTimeUuid,
    deviceInfoServiceUuid,
    firmwareRevisionUuid,
    heartRateServiceUuid,
    heartRateMeasurementUuid,
    heartRateControlUuid,
  };
}

/** Last-sync cursor storage. Not durable; see the module header. */
export type HuamiLegacySyncStateStore = Readonly<{
  getLastSync(deviceId: string): number | null;
  setLastSync(deviceId: string, millis: number): void;
}>;

/** Creates an isolated in-memory cursor store (used by tests and by default). */
export function createMemoryHuamiLegacySyncStateStore(): HuamiLegacySyncStateStore {
  const cursors = new Map<string, number>();
  return {
    getLastSync: (deviceId) => cursors.get(deviceId) ?? null,
    setLastSync: (deviceId, millis) => {
      cursors.set(deviceId, millis);
    },
  };
}

/** Process-wide fallback cursor store. */
export const defaultHuamiLegacySyncStateStore: HuamiLegacySyncStateStore =
  createMemoryHuamiLegacySyncStateStore();

export type HuamiLegacyTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: HuamiLegacyTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type MonitorDevice = Pick<Device, "monitorCharacteristicForService">;
type WriteDevice = Pick<Device, "writeCharacteristicWithResponseForService">;
type ReadDevice = Pick<Device, "readCharacteristicForService">;

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

function ascii(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}

export type HuamiLegacySessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice> & Partial<ReadDevice>;
  /** Stable device id used as the last-sync cursor key. */
  deviceId: string;
  profile: HuamiLegacyProfile;
  /** Explicit sample width; otherwise resolved from `sampleSizeRule`. */
  sampleSize?: 4 | 8;
  /** Model rule used to resolve the sample width (firmware-gated models). */
  sampleSizeRule?: HuamiSampleSizeRule;
  /** Auth bytes from the model registry. */
  authFlags?: number;
  cryptFlags?: number;
  /** Key supplied at construction, if the caller already has it. */
  authKey?: string | Uint8Array;
  /** Stored history records. */
  onRecord: (record: HuamiLegacyRecord) => void;
  /** Realtime heart-rate samples while connected. */
  onLiveHeartRate?: (record: HuamiLegacyRecord) => void;
  onFailure?: (failure: HuamiLegacyFailure) => void;
  now?: () => Date;
  timers?: HuamiLegacyTimers;
  /** AES-128-ECB provider; defaults to `react-native-quick-crypto`. */
  crypto?: HuamiAuthCrypto;
  initDelayMs?: number;
  watchdogMs?: number;
  lookbackMs?: number;
  maxRounds?: number;
  /** Enable continuous heart rate after the history fetch. */
  realtime?: boolean;
  syncState?: HuamiLegacySyncStateStore;
}>;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

type FetchRound = {
  buffer: number[];
  expected: number;
  startTime: string | null;
  lastCounter: number;
  start: Deferred<Uint8Array>;
  data: Deferred<Uint8Array>;
  ack: Deferred<Uint8Array>;
};

type AuthWaiter = {
  resolve: (value: Uint8Array) => void;
  reject: (error: unknown) => void;
  timer: unknown;
};

/**
 * One device connection. `start(key)` subscribes and launches the auth + fetch
 * chain; `whenDone()` resolves when the chain ends; `close()` tears everything
 * down.
 */
export class HuamiLegacySession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly timers: HuamiLegacyTimers;
  private readonly now: () => Date;
  private readonly initDelayMs: number;
  private readonly watchdogMs: number;
  private readonly lookbackMs: number;
  private readonly maxRounds: number;
  private readonly realtime: boolean;
  private readonly syncState: HuamiLegacySyncStateStore;
  private readonly authFlags: number;
  private readonly cryptFlags: number;
  private readonly samples: HuamiMinuteSample[] = [];
  private readonly done: Promise<void>;
  private resolveDone!: () => void;
  private rejectDone!: (error: unknown) => void;
  private settled = false;
  private sampleSize: 4 | 8;
  private authWaiter: AuthWaiter | null = null;
  private round: FetchRound | null = null;
  private stage: HuamiLegacyFailure = "init";
  private started = false;
  private realtimeEnabled = false;
  private closed = false;

  constructor(private readonly options: HuamiLegacySessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? (() => new Date());
    this.initDelayMs = options.initDelayMs ?? HUAMI_LEGACY_INIT_DELAY_MS;
    this.watchdogMs = options.watchdogMs ?? HUAMI_LEGACY_WATCHDOG_MS;
    this.lookbackMs = options.lookbackMs ?? HUAMI_LEGACY_LOOKBACK_MS;
    this.maxRounds = options.maxRounds ?? HUAMI_LEGACY_MAX_ROUNDS;
    this.realtime = options.realtime ?? true;
    this.syncState = options.syncState ?? defaultHuamiLegacySyncStateStore;
    this.authFlags = options.authFlags ?? 0x08;
    this.cryptFlags = options.cryptFlags ?? 0x00;
    this.sampleSize =
      options.sampleSize ??
      (options.sampleSizeRule ? resolveSampleSize(options.sampleSizeRule) : 4);
    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.done.catch(() => undefined);
  }

  /** Starts the chain. Safe to call once; later calls are ignored. */
  start(authKey?: string | Uint8Array): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.monitorAll();
    void this.run(authKey);
  }

  /** Resolves when the chain finishes; rejects on a fatal auth/fetch error. */
  whenDone(): Promise<void> {
    return this.done;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.realtimeEnabled) {
      this.realtimeEnabled = false;
      const { heartRateServiceUuid, heartRateControlUuid } = this.options.profile;
      if (heartRateServiceUuid && heartRateControlUuid)
        await this.writeChar(
          heartRateServiceUuid,
          heartRateControlUuid,
          HUAMI_HR_STOP_CONTINUOUS,
        ).catch(() => undefined);
    }
    this.failPending(new Error("HUAMI_CLOSED"));
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    this.settleResolve();
  }

  /** Sends a chunked config write on the chunked characteristic. */
  async writeChunked(type: number, data: Uint8Array, mtu = 23): Promise<void> {
    const chunkedUuid = this.options.profile.chunkedUuid;
    if (!chunkedUuid) throw new Error("HUAMI_CHUNKED_UNAVAILABLE");
    for (const chunk of buildChunkedWrites(type, data, mtu)) {
      await this.writeChar(this.options.profile.serviceUuid, chunkedUuid, chunk);
    }
  }

  // -------------------------------------------------------------------------
  // Chain
  // -------------------------------------------------------------------------

  private async run(authKey: string | Uint8Array | undefined): Promise<void> {
    try {
      if (this.initDelayMs > 0) {
        await new Promise<void>((resolve) => this.timers.setTimeout(resolve, this.initDelayMs));
      }
      if (this.closed) return this.settleResolve();
      this.stage = "auth";
      await this.authenticate(authKey);
      if (this.closed) return this.settleResolve();
      this.stage = "init";
      await this.initialize();
      if (this.closed) return this.settleResolve();
      this.stage = "steps";
      await this.fetchActivity();
      if (this.closed) return this.settleResolve();
      if (this.realtime)
        await this.enableRealtimeHeartRate().catch(() => this.options.onFailure?.("heart_rate"));
      this.settleResolve();
    } catch (error) {
      this.options.onFailure?.(this.stage);
      this.settleReject(error);
    }
  }

  private async authenticate(authKey: string | Uint8Array | undefined): Promise<void> {
    const source = authKey ?? this.options.authKey;
    if (source === undefined) throw new Error("HUAMI_AUTH_KEY_REQUIRED");
    const key = typeof source === "string" ? parseHuamiAuthKey(source) : Uint8Array.from(source);
    if (key.length !== 16) throw new Error("HUAMI_AUTH_KEY_LENGTH");
    const crypto = this.options.crypto ?? (await loadHuamiAuthCrypto());

    if (this.cryptFlags === 0) {
      await this.authExchange(buildAuthSendKey(this.authFlags, key), HUAMI_AUTH_SEND_KEY);
    }
    const random = await this.authExchange(
      buildAuthRequestRandom(this.authFlags, this.cryptFlags),
      HUAMI_AUTH_REQUEST_RANDOM,
    );
    const challenge = parseAuthChallenge(random);
    if (!challenge) throw new Error("HUAMI_AUTH_CHALLENGE_INVALID");
    const encrypted = encryptAuthChallenge(key, challenge, crypto);
    await this.authExchange(
      buildAuthSendEncrypted(this.authFlags, this.cryptFlags, encrypted),
      HUAMI_AUTH_SEND_ENCRYPTED,
    );
  }

  private async authExchange(frame: Uint8Array, command: number): Promise<Uint8Array> {
    const wait = this.waitForAuth();
    await this.writeAuth(frame);
    const value = await wait;
    const response = parseAuthResponse(value);
    if (!response || response.command !== command)
      throw new Error("HUAMI_AUTH_UNEXPECTED_RESPONSE");
    if (response.status === HUAMI_AUTH_FAIL) throw new Error("HUAMI_AUTH_FAILED");
    if (response.status !== HUAMI_AUTH_SUCCESS) throw new Error("HUAMI_AUTH_UNEXPECTED_RESPONSE");
    return value;
  }

  private async initialize(): Promise<void> {
    if (this.options.sampleSize === undefined && this.options.sampleSizeRule) {
      const firmware = await this.readFirmwareVersion().catch(() => null);
      this.sampleSize = resolveSampleSize(this.options.sampleSizeRule, firmware);
    }
    const { currentTimeServiceUuid, currentTimeUuid } = this.options.profile;
    if (currentTimeServiceUuid && currentTimeUuid) {
      const now = this.now();
      await this.writeChar(
        currentTimeServiceUuid,
        currentTimeUuid,
        buildCurrentTimeFrame(now, -now.getTimezoneOffset()),
      ).catch(() => this.options.onFailure?.("init"));
    }
  }

  private async readFirmwareVersion(): Promise<string | null> {
    const read = this.options.device.readCharacteristicForService;
    const { deviceInfoServiceUuid, firmwareRevisionUuid } = this.options.profile;
    if (!read || !deviceInfoServiceUuid || !firmwareRevisionUuid) return null;
    const characteristic = await read.call(
      this.options.device,
      deviceInfoServiceUuid,
      firmwareRevisionUuid,
    );
    if (!characteristic?.value) return null;
    const version = ascii(decodeBase64(characteristic.value)).trim();
    return version || null;
  }

  private async fetchActivity(): Promise<void> {
    const now = this.now().getTime();
    let since = this.syncState.getLastSync(this.options.deviceId) ?? now - this.lookbackMs;
    try {
      for (let round = 0; round < this.maxRounds; round += 1) {
        if (this.closed) return;
        const samples = await this.fetchRound(new Date(since));
        if (!samples.length) return;
        for (const sample of samples) {
          this.samples.push(sample);
          for (const record of minuteSampleToRecords(sample)) this.options.onRecord(record);
        }
        const last = samples[samples.length - 1]!.timestamp;
        const next = last + 60_000;
        this.syncState.setLastSync(this.options.deviceId, next);
        if (next - since < 1000) return;
        if (next >= this.now().getTime()) return;
        since = next;
      }
    } finally {
      for (const session of segmentSleepSessions(this.samples)) this.options.onRecord(session);
    }
  }

  private async fetchRound(since: Date): Promise<readonly HuamiMinuteSample[]> {
    const round: FetchRound = {
      buffer: [],
      expected: 0,
      startTime: null,
      lastCounter: -1,
      start: deferred<Uint8Array>(),
      data: deferred<Uint8Array>(),
      ack: deferred<Uint8Array>(),
    };
    this.round = round;
    try {
      await this.writeControl(buildActivityStartFrame(since, -since.getTimezoneOffset()));
      const startValue = await this.withWatchdog(round.start.promise, "HUAMI_FETCH_START_TIMEOUT");
      const response = parseActivityControlResponse(startValue);
      if (!response || response.kind !== "start") throw new Error("HUAMI_FETCH_START_INVALID");
      round.expected = response.expectedLength;
      round.startTime = response.startTime;

      if (round.expected === 0) {
        await this.writeControl(buildActivityAckFrame());
        await this.withWatchdog(round.ack.promise, "HUAMI_FETCH_ACK_TIMEOUT").catch(
          () => undefined,
        );
        return [];
      }

      await this.writeControl(buildActivityFetchFrame());
      await this.withWatchdog(round.data.promise, "HUAMI_FETCH_DATA_TIMEOUT");
      await this.writeControl(buildActivityAckFrame());
      await this.withWatchdog(round.ack.promise, "HUAMI_FETCH_ACK_TIMEOUT").catch(() => undefined);

      if (round.buffer.length < round.expected) throw new Error("HUAMI_FETCH_INCOMPLETE");
      const bytes = Uint8Array.from(round.buffer.slice(0, round.expected));
      return parseActivitySamples(bytes, this.sampleSize, round.startTime!);
    } finally {
      this.round = null;
    }
  }

  private async enableRealtimeHeartRate(): Promise<void> {
    const { heartRateServiceUuid, heartRateControlUuid } = this.options.profile;
    if (!heartRateServiceUuid || !heartRateControlUuid || this.realtimeEnabled) return;
    this.realtimeEnabled = true;
    await this.writeChar(heartRateServiceUuid, heartRateControlUuid, HUAMI_HR_STOP_MANUAL);
    await this.writeChar(heartRateServiceUuid, heartRateControlUuid, HUAMI_HR_START_CONTINUOUS);
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private handleAuth(bytes: Uint8Array): void {
    const waiter = this.authWaiter;
    if (!waiter) return;
    this.authWaiter = null;
    this.timers.clearTimeout(waiter.timer);
    waiter.resolve(bytes);
  }

  private handleControl(bytes: Uint8Array): void {
    const round = this.round;
    if (!round) return;
    const response = parseActivityControlResponse(bytes);
    if (!response) {
      if (bytes.length >= 3 && bytes[0] === HUAMI_RESPONSE && bytes[2] !== HUAMI_SUCCESS) {
        const error = new Error("HUAMI_ACTIVITY_RESPONSE_FAILED");
        round.start.reject(error);
        round.data.reject(error);
        round.ack.reject(error);
      }
      return;
    }
    if (response.kind === "start") round.start.resolve(bytes);
    else if (response.kind === "data") round.data.resolve(bytes);
    else round.ack.resolve(bytes);
  }

  private handleData(bytes: Uint8Array): void {
    const round = this.round;
    if (!round || bytes.length === 0) return;
    const counter = bytes[0]!;
    if (((round.lastCounter + 1) & 0xff) !== counter) {
      round.data.reject(new Error("HUAMI_PACKET_COUNTER"));
      return;
    }
    round.lastCounter = counter;
    for (let index = 1; index < bytes.length; index += 1) round.buffer.push(bytes[index]!);
  }

  private handleHeartRate(bytes: Uint8Array): void {
    const bpm = parseHeartRateMeasurement(bytes);
    if (bpm === null) return;
    this.options.onLiveHeartRate?.({
      type: "heart_rate",
      time: this.now().toISOString(),
      bpm,
    });
  }

  // -------------------------------------------------------------------------
  // Writes and subscriptions
  // -------------------------------------------------------------------------

  private writeAuth(frame: Uint8Array): Promise<void> {
    return this.writeChar(
      this.options.profile.authServiceUuid,
      this.options.profile.authUuid,
      frame,
    );
  }

  private writeControl(frame: Uint8Array): Promise<void> {
    return this.writeChar(
      this.options.profile.serviceUuid,
      this.options.profile.activityControlUuid,
      frame,
    );
  }

  private async writeChar(
    serviceUuid: string,
    characteristicUuid: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("HUAMI_WRITE_UNAVAILABLE");
    await write.call(this.options.device, serviceUuid, characteristicUuid, encodeBase64(bytes));
  }

  private monitorAll(): void {
    const { profile } = this.options;
    this.monitor(profile.authServiceUuid, profile.authUuid, (bytes) => this.handleAuth(bytes));
    this.monitor(profile.serviceUuid, profile.activityControlUuid, (bytes) =>
      this.handleControl(bytes),
    );
    this.monitor(profile.serviceUuid, profile.activityDataUuid, (bytes) => this.handleData(bytes));
    if (profile.heartRateServiceUuid && profile.heartRateMeasurementUuid)
      this.monitor(profile.heartRateServiceUuid, profile.heartRateMeasurementUuid, (bytes) =>
        this.handleHeartRate(bytes),
      );
  }

  private monitor(
    serviceUuid: string,
    characteristicUuid: string,
    handle: (bytes: Uint8Array) => void,
  ): void {
    if (this.closed) return;
    try {
      const subscription = this.options.device.monitorCharacteristicForService(
        serviceUuid,
        characteristicUuid,
        (error, value: Characteristic | null) => {
          if (this.closed) return;
          if (error || !value?.value) {
            this.options.onFailure?.(this.stage);
            return;
          }
          try {
            handle(decodeBase64(value.value));
          } catch {
            this.options.onFailure?.(this.stage);
          }
        },
      );
      this.subscriptions.add(subscription);
    } catch {
      this.options.onFailure?.(this.stage);
    }
  }

  // -------------------------------------------------------------------------
  // Waits
  // -------------------------------------------------------------------------

  private waitForAuth(): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        if (this.authWaiter?.reject !== reject) return;
        this.authWaiter = null;
        reject(new Error("HUAMI_AUTH_TIMEOUT"));
      }, this.watchdogMs);
      this.authWaiter = { resolve, reject, timer };
    });
  }

  private withWatchdog<T>(promise: Promise<T>, code: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => reject(new Error(code)), this.watchdogMs);
      promise.then(
        (value) => {
          this.timers.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          this.timers.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private failPending(error: Error): void {
    const auth = this.authWaiter;
    if (auth) {
      this.authWaiter = null;
      this.timers.clearTimeout(auth.timer);
      auth.reject(error);
    }
    const round = this.round;
    if (round) {
      round.start.reject(error);
      round.data.reject(error);
      round.ack.reject(error);
    }
  }

  private settleResolve(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone();
  }

  private settleReject(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectDone(error);
  }
}

/** Creates a legacy Huami session for a selected profile. */
export function createHuamiLegacySession(options: HuamiLegacySessionOptions): HuamiLegacySession {
  return new HuamiLegacySession(options);
}
