/**
 * Connection session for Huawei/Honor BLE health wearables.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/huawei/HuaweiSupportProvider.java` (init + sync chains)
 * - `service/devices/huawei/requests/*.java` (link params, auth, bond, sync)
 * - `devices/huawei/packets/DeviceConfig.java`, `FitnessData.java`
 *
 * Chain
 * -----
 * `GetLinkParams` (0x01 0x01) → `GetDeviceStatus` (0x01 0x16) → auth → sync:
 * sleep count (0x07 0x0C) → step count (0x07 0x0A) → fitness totals (0x07 0x03)
 * → sleep data (0x07 0x0D, count-chained) → step data (0x07 0x0B, count-chained).
 *
 * Auth
 * ----
 * App-layer key exchange, not BLE bonding. Two modes are supported:
 * - normal mode: `GetAuthRequest` (0x01 0x13) digest challenge/response with the
 *   device key derived from the MAC (`createHuaweiDeviceSecretKey`), then
 *   `GetBondParamsRequest` (0x01 0x0F) + `GetBondRequest` (0x01 0x0E) carrying
 *   the AES-encrypted local secret key.
 * - HiChainLite with `authVersion == 0x02`: `GetSecurityNegotiationRequest`
 *   (0x01 0x33) then the same auth/bond chain.
 *
 * Deliberately refused with a typed error (never attempted):
 * - full HiChain / HiChain3 (`deviceSupportType` 1, 3 or 4) — needs on-device
 *   user confirmation;
 * - HiChainLite with `authVersion != 2` — needs the device PIN code;
 * - Honor PAKE/STS (X25519 SPEKE) — not implemented.
 *
 * Deliberately deferred (not implemented, not attempted):
 * - TruSleep file downloads (service 0x0E/0x0F) and dictionary/sequence sleep
 *   (HarmonyOS 5+);
 * - P2P dictionary sync (service 0x34);
 * - stress, ECG and workout records;
 * - SpO2 and resting-HR are parsed from the step bitmap but not emitted as
 *   records (the frozen contract has no such record types);
 * - the dual-channel socket used by Watch 4;
 * - Honor new-protocol devices are reached through their alternate GATT UUIDs,
 *   but their dictionary-based sync is not implemented.
 *
 * Every service 0x07 transaction is AES-encrypted. One unavailable
 * characteristic or failed request must not throw from `start`; failures are
 * reported through `onFailure` and `whenDone()` rejects.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  HUAWEI_AUTH_COMMAND,
  HUAWEI_BOND_COMMAND,
  HUAWEI_BOND_PARAMS_COMMAND,
  HUAWEI_DEVICE_CONFIG_SERVICE,
  HUAWEI_DEVICE_STATUS_COMMAND,
  HUAWEI_DIGEST_MESSAGE_RESPONSE,
  HUAWEI_FITNESS_SERVICE,
  HUAWEI_FITNESS_TOTALS_COMMAND,
  HUAWEI_LINK_PARAMS_COMMAND,
  HUAWEI_SECURITY_NEGOTIATION_COMMAND,
  HUAWEI_SLEEP_DATA_COMMAND,
  HUAWEI_SLEEP_DATA_COUNT_COMMAND,
  HUAWEI_STEP_DATA_COMMAND,
  HUAWEI_STEP_DATA_COUNT_COMMAND,
  HuaweiPacketReassembler,
  buildHuaweiAuthRequest,
  buildHuaweiBondParamsRequest,
  buildHuaweiBondRequest,
  buildHuaweiDeviceStatusRequest,
  buildHuaweiFitnessTotalsRequest,
  buildHuaweiLinkParamsRequest,
  buildHuaweiMessageCountRequest,
  buildHuaweiMessageDataRequest,
  buildHuaweiSecurityNegotiationRequest,
  computeHuaweiAuthDigest,
  createHuaweiDeviceSecretKey,
  createHuaweiInitializationVector,
  decodeHuaweiPacket,
  decryptHuaweiResponse,
  encodeHuaweiPacket,
  encryptHuaweiBondingKey,
  getOrCreateHuaweiLocalSecretKey,
  huaweiChallengeMessage,
  huaweiStepMinuteToRecords,
  huaweiUsesGcm,
  loadHuaweiAesProvider,
  parseHuaweiAuthResponse,
  parseHuaweiBondParamsResponse,
  parseHuaweiDeviceStatusResponse,
  parseHuaweiFitnessTotalsResponse,
  parseHuaweiLinkParamsResponse,
  parseHuaweiMessageCountResponse,
  parseHuaweiSecurityNegotiationResponse,
  parseHuaweiSleepDataResponse,
  parseHuaweiStepDataResponse,
  segmentHuaweiSleepSessions,
  wrapEncryptedHuaweiTlv,
  defaultHuaweiSecretKeyStore,
  type HuaweiAesProvider,
  type HuaweiBleProfile,
  type HuaweiRecord,
  type HuaweiSecretKeyStore,
  type HuaweiSleepRecord,
  type HuaweiTlv,
} from "../protocol/huawei";
import { loadHuaweiCrypto, type HuaweiCryptoProvider } from "../crypto/huawei-auth";

/** Local watchdog for each request; upstream has no explicit timeout. */
export const HUAWEI_SESSION_WATCHDOG_MS = 30_000;
/** Shorter watchdog for the best-effort device-status probe. */
export const HUAWEI_SESSION_STATUS_WATCHDOG_MS = 5_000;
/** Delay before the first write, so the GATT link is ready after connect. */
export const HUAWEI_SESSION_INIT_DELAY_MS = 1_000;
/** Default history cursor: seven days. */
export const HUAWEI_SESSION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Guard against a device that reports an implausible message count. */
export const HUAWEI_SESSION_MAX_MESSAGES = 512;

/** Failure stages reported to the caller. */
export type HuaweiFailure =
  | "init"
  | "auth"
  | "transport"
  | "steps"
  | "heart_rate"
  | "sleep_session";

/** Typed refusals for the auth modes this build does not implement. */
export type HuaweiUnsupportedAuthReason = "hichain" | "hichain_lite_pincode" | "honor_pake";

export class HuaweiUnsupportedAuthError extends Error {
  readonly code = "HUAWEI_AUTH_UNSUPPORTED";
  constructor(readonly reason: HuaweiUnsupportedAuthReason) {
    super(`HUAWEI_AUTH_UNSUPPORTED:${reason}`);
    this.name = "HuaweiUnsupportedAuthError";
  }
}

/** Last-sync cursor storage. Not durable; see the module header. */
export type HuaweiSyncStateStore = Readonly<{
  getLastSync(deviceId: string): number | null;
  setLastSync(deviceId: string, millis: number): void;
}>;

export function createMemoryHuaweiSyncStateStore(): HuaweiSyncStateStore {
  const cursors = new Map<string, number>();
  return {
    getLastSync: (deviceId) => cursors.get(deviceId) ?? null,
    setLastSync: (deviceId, millis) => {
      cursors.set(deviceId, millis);
    },
  };
}

export const defaultHuaweiSyncStateStore: HuaweiSyncStateStore = createMemoryHuaweiSyncStateStore();

export type HuaweiTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: HuaweiTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type MonitorDevice = Pick<Device, "monitorCharacteristicForService">;
type WriteDevice = Pick<Device, "writeCharacteristicWithResponseForService">;

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

function decodeBase64(value: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const character of value.replace(/=+$/, "")) {
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("INVALID_BLE_DATA");
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
}

export type HuaweiSessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice>;
  /** Stable device id used as the cursor and secret-key key. */
  deviceId: string;
  profile: HuaweiBleProfile;
  /** Real device MAC (used for `createSecretKey`). */
  macAddress: string;
  /** Random local MAC sent in bond params; defaults to the real MAC. */
  randomMacAddress?: string;
  /** Stored history records. */
  onRecord: (record: HuaweiRecord) => void;
  onTotals?: (
    totals: Readonly<{
      totalSteps: number;
      totalCalories: number;
      totalDistance: number;
    }>,
  ) => void;
  onFailure?: (failure: HuaweiFailure) => void;
  now?: () => Date;
  timers?: HuaweiTimers;
  /** Hash/HMAC provider; defaults to `react-native-quick-crypto`. */
  crypto?: HuaweiCryptoProvider;
  /** AES provider; defaults to `react-native-quick-crypto`. */
  aes?: HuaweiAesProvider;
  /** Local secret-key persistence; defaults to a process-wide memory store. */
  secretKeyStore?: HuaweiSecretKeyStore;
  /** Random bytes for nonces/keys; defaults to the crypto provider. */
  randomBytes?: (size: number) => Uint8Array;
  initDelayMs?: number;
  watchdogMs?: number;
  statusWatchdogMs?: number;
  lookbackMs?: number;
  syncState?: HuaweiSyncStateStore;
}>;

type Pending = {
  serviceId: number;
  commandId: number;
  resolve: (tlv: HuaweiTlv) => void;
  reject: (error: unknown) => void;
  timer: unknown;
};

/**
 * One device connection. `start()` subscribes and launches the auth + sync
 * chain; `whenDone()` resolves when the chain ends; `close()` tears everything
 * down.
 */
export class HuaweiSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly timers: HuaweiTimers;
  private readonly now: () => Date;
  private readonly initDelayMs: number;
  private readonly watchdogMs: number;
  private readonly statusWatchdogMs: number;
  private readonly lookbackMs: number;
  private readonly syncState: HuaweiSyncStateStore;
  private readonly secretKeyStore: HuaweiSecretKeyStore;
  private readonly reassembler = new HuaweiPacketReassembler();
  private readonly done: Promise<void>;
  private resolveDone!: () => void;
  private rejectDone!: (error: unknown) => void;
  private settled = false;
  private started = false;
  private closed = false;
  private stage: HuaweiFailure = "init";
  private pending: Pending | null = null;
  private crypto: HuaweiCryptoProvider | null = null;
  private aes: HuaweiAesProvider | null = null;
  private secretKey: Uint8Array | null = null;
  private useGcm = false;
  private sliceSize = 0xf4;
  private encryptionCounter = 0;
  private deviceSupportType = 0;
  private authVersion = 0;
  private authMode = 0;
  private authAlgo = 0;
  private encryptMethod = 0;
  private serverNonce: Uint8Array = new Uint8Array(16);
  private sleepRecords: HuaweiSleepRecord[] = [];

  constructor(private readonly options: HuaweiSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? (() => new Date());
    this.initDelayMs = options.initDelayMs ?? HUAWEI_SESSION_INIT_DELAY_MS;
    this.watchdogMs = options.watchdogMs ?? HUAWEI_SESSION_WATCHDOG_MS;
    this.statusWatchdogMs = options.statusWatchdogMs ?? HUAWEI_SESSION_STATUS_WATCHDOG_MS;
    this.lookbackMs = options.lookbackMs ?? HUAWEI_SESSION_LOOKBACK_MS;
    this.syncState = options.syncState ?? defaultHuaweiSyncStateStore;
    this.secretKeyStore = options.secretKeyStore ?? defaultHuaweiSecretKeyStore;
    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.done.catch(() => undefined);
  }

  /** Starts the chain. Safe to call once; later calls are ignored. */
  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.monitor();
    void this.run();
  }

  /** Resolves when the chain finishes; rejects on a fatal auth/sync error. */
  whenDone(): Promise<void> {
    return this.done;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failPending(new Error("HUAWEI_CLOSED"));
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    this.settleResolve();
  }

  // -------------------------------------------------------------------------
  // Chain
  // -------------------------------------------------------------------------

  private async run(): Promise<void> {
    try {
      if (this.initDelayMs > 0) {
        await new Promise<void>((resolve) => this.timers.setTimeout(resolve, this.initDelayMs));
      }
      if (this.closed) return this.settleResolve();
      this.crypto = this.options.crypto ?? (await loadHuaweiCrypto());
      this.aes = this.options.aes ?? (await loadHuaweiAesProvider());
      this.stage = "init";
      await this.negotiate();
      if (this.closed) return this.settleResolve();
      this.stage = "auth";
      await this.authenticate();
      if (this.closed) return this.settleResolve();
      this.stage = "steps";
      await this.sync();
      this.settleResolve();
    } catch (error) {
      this.options.onFailure?.(this.stage);
      this.settleReject(error);
    }
  }

  private async negotiate(): Promise<void> {
    const linkParams = parseHuaweiLinkParamsResponse(
      await this.request(
        HUAWEI_DEVICE_CONFIG_SERVICE,
        HUAWEI_LINK_PARAMS_COMMAND,
        buildHuaweiLinkParamsRequest(),
        { encrypted: false },
      ),
    );
    this.sliceSize = linkParams.sliceSize;
    this.deviceSupportType = linkParams.deviceSupportType;
    this.authVersion = linkParams.authVersion;
    this.serverNonce = linkParams.serverNonce;
    this.authAlgo = linkParams.authAlgo;
    this.encryptMethod = linkParams.encryptMethod;
    this.useGcm = huaweiUsesGcm(this.encryptMethod, this.deviceSupportType);

    // Best effort: some models (AW70) omit the status response.
    try {
      const statusTlv = await this.request(
        HUAWEI_DEVICE_CONFIG_SERVICE,
        HUAWEI_DEVICE_STATUS_COMMAND,
        buildHuaweiDeviceStatusRequest(true),
        { encrypted: false, watchdogMs: this.statusWatchdogMs },
      );
      parseHuaweiDeviceStatusResponse(statusTlv);
    } catch {
      // Ignored; upstream skips this probe for BLE devices.
    }

    if (
      this.deviceSupportType === 0x01 ||
      this.deviceSupportType === 0x03 ||
      this.deviceSupportType === 0x04
    ) {
      throw new HuaweiUnsupportedAuthError("hichain");
    }
    if (this.deviceSupportType === 0x02) {
      this.authMode = 0x02;
      const negotiation = parseHuaweiSecurityNegotiationResponse(
        await this.request(
          HUAWEI_DEVICE_CONFIG_SERVICE,
          HUAWEI_SECURITY_NEGOTIATION_COMMAND,
          buildHuaweiSecurityNegotiationRequest({
            authMode: 0x02,
            deviceUuid: asciiBytes(this.hexString(16)),
            phoneModel: "OpenValens",
            encryptMethod: this.encryptMethod,
          }),
          { encrypted: false },
        ),
      );
      const isHiChain3 =
        (negotiation.authType ^ 0x01) === 0x04 || (negotiation.authType ^ 0x02) === 0x04;
      if (negotiation.authType === 0x0186a0 || isHiChain3) {
        throw new HuaweiUnsupportedAuthError("hichain");
      }
      if (this.authVersion !== 0x02) {
        throw new HuaweiUnsupportedAuthError("hichain_lite_pincode");
      }
    }
  }

  private async authenticate(): Promise<void> {
    const crypto = this.crypto!;
    const aes = this.aes!;
    const clientNonce = this.randomBytes(16);
    const doubleNonce = new Uint8Array(32);
    doubleNonce.set(this.serverNonce, 0);
    doubleNonce.set(clientNonce, 16);

    this.secretKey = getOrCreateHuaweiLocalSecretKey(
      this.secretKeyStore,
      this.options.deviceId,
      this.randomBytes(16),
    );

    const challengeDigest = computeHuaweiAuthDigest({
      message: huaweiChallengeMessage(this.authVersion),
      nonce: doubleNonce,
      authMode: this.authMode,
      authVersion: this.authVersion,
      secretKey: this.secretKey,
      crypto,
    });
    const challenge = challengeDigest.slice(0, 0x20);
    const firstKey = challengeDigest.slice(0x20, 0x30);

    const authResponse = parseHuaweiAuthResponse(
      await this.request(
        HUAWEI_DEVICE_CONFIG_SERVICE,
        HUAWEI_AUTH_COMMAND,
        buildHuaweiAuthRequest({
          authVersion: this.authVersion,
          challenge,
          clientNonce,
          authMode: this.authMode,
          authAlgo: this.authAlgo,
        }),
        { encrypted: false },
      ),
    );
    const expected = computeHuaweiAuthDigest({
      message: HUAWEI_DIGEST_MESSAGE_RESPONSE,
      nonce: doubleNonce,
      authMode: this.authMode,
      authVersion: this.authVersion,
      secretKey: this.secretKey,
      crypto,
    }).slice(0, 0x20);
    if (!authResponse || !equalBytes(authResponse, expected)) {
      throw new Error("HUAWEI_AUTH_FAILED");
    }

    const bondParams = parseHuaweiBondParamsResponse(
      await this.request(
        HUAWEI_DEVICE_CONFIG_SERVICE,
        HUAWEI_BOND_PARAMS_COMMAND,
        buildHuaweiBondParamsRequest({
          clientSerial: this.clientSerial(),
          macAddress: asciiBytes(this.options.randomMacAddress ?? this.options.macAddress),
        }),
        { encrypted: false },
      ),
    );
    this.encryptionCounter = bondParams.encryptionCounter;
    if (this.authMode !== 0x02 && bondParams.status === 1) return;

    const { iv, counter } = createHuaweiInitializationVector(
      this.encryptionCounter,
      this.randomBytes(12),
    );
    this.encryptionCounter = counter;
    let bondingKey: Uint8Array;
    if (this.authMode === 0x02) {
      bondingKey = firstKey;
    } else {
      // createSecretKey needs the real device MAC. iOS exposes an opaque
      // peripheral UUID instead, so normal-mode auth cannot run there.
      if (!/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i.test(this.options.macAddress)) {
        throw new Error("HUAWEI_MAC_UNAVAILABLE");
      }
      bondingKey = createHuaweiDeviceSecretKey(this.options.macAddress, this.authVersion, crypto);
    }
    const encryptedKey = encryptHuaweiBondingKey(
      this.encryptMethod,
      this.secretKey,
      bondingKey,
      iv,
      aes,
    );
    await this.request(
      HUAWEI_DEVICE_CONFIG_SERVICE,
      HUAWEI_BOND_COMMAND,
      buildHuaweiBondRequest({
        clientSerial: this.clientSerial(),
        encryptedKey,
        iv,
      }),
      { encrypted: false },
    );
  }

  private async sync(): Promise<void> {
    const end = Math.floor(this.now().getTime() / 1000);
    const cursor = this.syncState.getLastSync(this.options.deviceId);
    const start =
      cursor !== null ? Math.floor(cursor / 1000) : Math.max(0, end - this.lookbackMs / 1000);

    const sleepCount = parseHuaweiMessageCountResponse(
      await this.request(
        HUAWEI_FITNESS_SERVICE,
        HUAWEI_SLEEP_DATA_COUNT_COMMAND,
        buildHuaweiMessageCountRequest(start, end),
      ),
    );
    const stepCount = parseHuaweiMessageCountResponse(
      await this.request(
        HUAWEI_FITNESS_SERVICE,
        HUAWEI_STEP_DATA_COUNT_COMMAND,
        buildHuaweiMessageCountRequest(start, end),
      ),
    );
    const totals = parseHuaweiFitnessTotalsResponse(
      await this.request(
        HUAWEI_FITNESS_SERVICE,
        HUAWEI_FITNESS_TOTALS_COMMAND,
        buildHuaweiFitnessTotalsRequest(),
      ),
    );
    this.options.onTotals?.(totals);

    if (sleepCount > 0) {
      this.stage = "sleep_session";
      await this.fetchSleep(sleepCount);
    }
    if (stepCount > 0) {
      this.stage = "steps";
      await this.fetchSteps(stepCount);
    }
    for (const session of segmentHuaweiSleepSessions(this.sleepRecords)) {
      this.options.onRecord(session);
    }
  }

  private async fetchSleep(count: number): Promise<void> {
    let index = 0;
    let guard = 0;
    while (index < count && guard < HUAWEI_SESSION_MAX_MESSAGES) {
      if (this.closed) return;
      guard += 1;
      const data = parseHuaweiSleepDataResponse(
        await this.request(
          HUAWEI_FITNESS_SERVICE,
          HUAWEI_SLEEP_DATA_COMMAND,
          buildHuaweiMessageDataRequest(index),
        ),
      );
      this.sleepRecords.push(...data.records);
      if (data.number !== index) return;
      index += 1;
    }
  }

  private async fetchSteps(count: number): Promise<void> {
    let index = 0;
    let guard = 0;
    while (index < count && guard < HUAWEI_SESSION_MAX_MESSAGES) {
      if (this.closed) return;
      guard += 1;
      const data = parseHuaweiStepDataResponse(
        await this.request(
          HUAWEI_FITNESS_SERVICE,
          HUAWEI_STEP_DATA_COMMAND,
          buildHuaweiMessageDataRequest(index),
        ),
      );
      let latest = 0;
      for (const minute of data.minutes) {
        for (const record of huaweiStepMinuteToRecords(minute)) this.options.onRecord(record);
        latest = Math.max(latest, minute.timestamp);
      }
      if (latest > 0) this.syncState.setLastSync(this.options.deviceId, latest + 60_000);
      if (data.number !== index) return;
      index += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  private async request(
    serviceId: number,
    commandId: number,
    tlv: Uint8Array,
    options: Readonly<{ encrypted?: boolean; watchdogMs?: number }> = {},
  ): Promise<HuaweiTlv> {
    const encrypted = options.encrypted ?? true;
    const payload =
      encrypted && this.secretKey
        ? wrapEncryptedHuaweiTlv(tlv, this.secretKey, this.nextIv(), this.useGcm, this.aes!)
        : tlv;
    const frames = encodeHuaweiPacket({
      serviceId,
      commandId,
      tlv: payload,
      sliceSize: this.sliceSize,
    });
    const wait = this.waitFor(serviceId, commandId, options.watchdogMs ?? this.watchdogMs);
    try {
      for (const frame of frames) await this.write(frame);
    } catch (error) {
      this.cancelPending();
      throw error;
    }
    return wait;
  }

  private nextIv(): Uint8Array {
    const { iv, counter } = createHuaweiInitializationVector(
      this.encryptionCounter,
      this.randomBytes(12),
    );
    this.encryptionCounter = counter;
    return iv;
  }

  private randomBytes(size: number): Uint8Array {
    const provider = this.options.randomBytes;
    if (provider) return provider(size);
    if (!this.crypto) throw new Error("HUAWEI_CRYPTO_UNAVAILABLE");
    return this.crypto.randomBytes(size);
  }

  private hexString(size: number): string {
    return Array.from(this.randomBytes(size), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  private clientSerial(): Uint8Array {
    const mac = (this.options.randomMacAddress ?? this.options.macAddress).replace(/:/g, "");
    return asciiBytes(mac.slice(6, 12));
  }

  private async write(frame: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("HUAWEI_WRITE_UNAVAILABLE");
    await write.call(
      this.options.device,
      this.options.profile.serviceUuid,
      this.options.profile.writeUuid,
      encodeBase64(frame),
    );
  }

  private waitFor(serviceId: number, commandId: number, watchdogMs: number): Promise<HuaweiTlv> {
    return new Promise<HuaweiTlv>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        if (this.pending?.reject !== reject) return;
        this.pending = null;
        reject(new Error("HUAWEI_REQUEST_TIMEOUT"));
      }, watchdogMs);
      this.pending = { serviceId, commandId, resolve, reject, timer };
    });
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.timers.clearTimeout(pending.timer);
    pending.reject(error);
  }

  private cancelPending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.timers.clearTimeout(pending.timer);
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private monitor(): void {
    if (this.closed) return;
    try {
      const subscription = this.options.device.monitorCharacteristicForService(
        this.options.profile.serviceUuid,
        this.options.profile.readUuid,
        (error, value: Characteristic | null) => {
          if (this.closed) return;
          if (error || !value?.value) {
            this.options.onFailure?.(this.stage);
            return;
          }
          try {
            this.handle(decodeBase64(value.value));
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

  private handle(bytes: Uint8Array): void {
    const parsed = this.reassembler.accept(decodeHuaweiPacket(bytes));
    if (!parsed) return;
    const packet = decryptHuaweiResponse(parsed, {
      secretKey: this.secretKey,
      aes: this.aes!,
      useGcm: this.useGcm,
    });
    const pending = this.pending;
    if (!pending) return;
    if (packet.serviceId !== pending.serviceId || packet.commandId !== pending.commandId) return;
    this.pending = null;
    this.timers.clearTimeout(pending.timer);
    pending.resolve(packet.tlv);
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

/** Creates a Huawei BLE session for a selected profile. */
export function createHuaweiSession(options: HuaweiSessionOptions): HuaweiSession {
  return new HuaweiSession(options);
}
