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
 * App-layer key exchange, not BLE bonding. Supported modes:
 * - normal mode: `GetAuthRequest` (0x01 0x13) digest challenge/response with the
 *   device key derived from the MAC (`createHuaweiDeviceSecretKey`), then
 *   `GetBondParamsRequest` (0x01 0x0F) + `GetBondRequest` (0x01 0x0E) carrying
 *   the AES-encrypted local secret key.
 * - HiChainLite: `GetSecurityNegotiationRequest` (0x01 0x33) then the same
 *   auth/bond chain. With `authVersion != 2` the digest is keyed by the PIN the
 *   phone reads from the watch (`GetPincodeRequest`, 0x01 0x2C).
 * - full HiChain / HiChain3: one bind (the user confirms on the watch), then an
 *   authenticate with the stored token on every connection.
 *
 * Refused with a typed error (never attempted): Honor PAKE/STS.
 *
 * Deliberately deferred (not implemented, not attempted):
 * - TruSleep file downloads (service 0x0E/0x0F) and dictionary/sequence sleep
 *   (HarmonyOS 5+);
 * - P2P dictionary sync (service 0x34);
 * - stress, ECG and workout records;
 * - SpO2 and resting-HR are parsed from the step bitmap but not emitted as
 *   records (the frozen contract has no such record types);
 * - the dual-channel socket (0x01 0x3C): opt-in by the phone, so a watch we
 *   never ask keeps every service on the one socket (see the RFCOMM note §2.8);
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
  HUAWEI_DIGEST_MESSAGE_CHALLENGE,
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
  HuaweiStreamDeframer,
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
import type { HuaweiLink } from "./huawei-link";
import {
  buildHuaweiHiChainJson,
  buildHuaweiHiChainRequest,
  buildHuaweiPincodeRequest,
  classifyHuaweiAuthType,
  decryptHuaweiPinCode,
  HUAWEI_HICHAIN_COMMAND,
  HUAWEI_HICHAIN_CONFIRM_TIMEOUT_MS,
  HUAWEI_HICHAIN_GROUP_ID,
  HUAWEI_PINCODE_COMMAND,
  huaweiEqualBytes,
  huaweiHexUpper,
  huaweiHiChainDecryptAuthToken,
  huaweiHiChainEncryptChallenge,
  huaweiHiChainEncryptResult,
  huaweiHiChainPacketKey,
  huaweiHiChainPeerToken,
  huaweiHiChainPinKey,
  huaweiHiChainPsk,
  huaweiHiChainReturnCodeMac,
  huaweiHiChainSelfToken,
  huaweiHiChainSessionKey,
  parseHuaweiHiChainResponse,
  type HuaweiHiChainOperation,
} from "../protocol/huawei-hichain";

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
export type HuaweiUnsupportedAuthReason = "honor_pake";

/** Op-2 step 1 waits longer than upstream's 5 s: Bluetooth Classic adds latency. */
export const HUAWEI_HICHAIN_AUTH_STEP_MS = 10_000;
/**
 * Op-2 step-1 attempts before the watch counts as silent. One timeout can be a
 * slow or busy watch; two in a row (10 s, then 20 s) with no late reply look
 * like a watch that was reset and no longer knows this phone.
 */
export const HUAWEI_HICHAIN_AUTH_ATTEMPTS = 2;

/** Our side of an op-2 step 1 that timed out; a late reply to it is not for the current one. */
type HuaweiHiChainAbandonedStep = Readonly<{
  psk: Uint8Array;
  randSelf: Uint8Array;
  authIdSelf: Uint8Array;
}>;

/** Op-2 retry state for one session: abandoned step 1s, and whether a late reply proved the token. */
type HuaweiHiChainRetry = { abandoned: HuaweiHiChainAbandonedStep[]; tokenProven: boolean };

export class HuaweiUnsupportedAuthError extends Error {
  readonly code = "HUAWEI_AUTH_UNSUPPORTED";
  constructor(readonly reason: HuaweiUnsupportedAuthReason) {
    super(`HUAWEI_AUTH_UNSUPPORTED:${reason}`);
    this.name = "HuaweiUnsupportedAuthError";
  }
}

/**
 * HiChain identity per watch: our persisted id (the watch's group entry is
 * keyed by it, so it survives re-binds) and the bind's auth token. Kept apart
 * from the normal-mode secret key: upstream sharing one slot breaks auth.
 */
export type HuaweiHiChainStore = Readonly<{
  getAndroidId(deviceId: string): string | null;
  setAndroidId(deviceId: string, androidId: string): void;
  getAuthToken(deviceId: string): Uint8Array | null;
  setAuthToken(deviceId: string, token: Uint8Array): void;
  /** Forget the bind (the token); the id stays. */
  clearAuthToken(deviceId: string): void;
}>;

export function createMemoryHuaweiHiChainStore(): HuaweiHiChainStore {
  const ids = new Map<string, string>();
  const tokens = new Map<string, Uint8Array>();
  return {
    getAndroidId: (deviceId) => ids.get(deviceId) ?? null,
    setAndroidId: (deviceId, androidId) => void ids.set(deviceId, androidId),
    getAuthToken: (deviceId) => tokens.get(deviceId) ?? null,
    setAuthToken: (deviceId, token) => void tokens.set(deviceId, Uint8Array.from(token)),
    clearAuthToken: (deviceId) => void tokens.delete(deviceId),
  };
}

/** Process-wide fallback; production passes a durable store. */
export const defaultHuaweiHiChainStore: HuaweiHiChainStore = createMemoryHuaweiHiChainStore();

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

/**
 * True for a step-1 reply whose token proves one of our abandoned op-2 step-1
 * requests: the watch answering it late. Anything else (including what does
 * not parse) is left to the normal parser.
 */
function isLateHuaweiHiChainStepOne(
  crypto: HuaweiCryptoProvider,
  tlv: HuaweiTlv,
  abandoned: readonly HuaweiHiChainAbandonedStep[],
): boolean {
  let reply: ReturnType<typeof parseHuaweiHiChainResponse>;
  try {
    reply = parseHuaweiHiChainResponse(tlv);
  } catch {
    return false;
  }
  if (reply.step !== 1) return false;
  return abandoned.some((step) =>
    huaweiEqualBytes(
      reply.token,
      huaweiHiChainPeerToken(crypto, step.psk, {
        randSelf: step.randSelf,
        randPeer: reply.randPeer,
        authIdSelf: step.authIdSelf,
        authIdPeer: reply.authIdPeer,
      }),
    ),
  );
}

export type HuaweiSessionOptions = Readonly<{
  /** BLE: the connected device and its GATT profile. */
  device?: MonitorDevice & Partial<WriteDevice>;
  profile?: HuaweiBleProfile;
  /**
   * A byte link (Bluetooth Classic RFCOMM); replaces `device`/`profile`.
   * Bytes may arrive in any chunking; the session reframes them.
   */
  link?: HuaweiLink;
  /** "br" applies upstream's Bluetooth Classic differences (spec §3.4). */
  transport?: "ble" | "br";
  /** Upstream `isTransactionCrypted()`; eight BR models send in the clear. */
  transactionsCrypted?: boolean;
  /** HiChain id and bind token; defaults to a process-wide memory store. */
  hichainStore?: HuaweiHiChainStore;
  /**
   * Called right before the bind that asks the user to confirm on the watch.
   * Passing it marks the caller as interactive: a watch that goes silent on a
   * stored token may then be re-bound in the same sync. Without it, that case
   * fails with `HUAWEI_HICHAIN_AUTH_TIMEOUT` and the token is kept.
   */
  onAuthPrompt?: (prompt: "confirm_on_watch") => void;
  /** Stable device id used as the cursor and secret-key key. */
  deviceId: string;
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
  /** False drops the response and keeps waiting (a late reply to an abandoned request). */
  accept?: (tlv: HuaweiTlv) => boolean;
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
  private readonly deframer = new HuaweiStreamDeframer();
  private readonly abort = new AbortController();
  private readonly transport: "ble" | "br";
  private readonly transactionsCrypted: boolean;
  private readonly hichainStore: HuaweiHiChainStore;
  private authPath: "normal" | "lite" | "hichain" = "normal";
  /** HiChain3 (support type 4): fully random IVs instead of the counter. */
  private randomIv = false;
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
    this.transport = options.transport ?? "ble";
    this.transactionsCrypted = options.transactionsCrypted ?? true;
    this.hichainStore = options.hichainStore ?? defaultHuaweiHiChainStore;
    if (!options.link && !(options.device && options.profile))
      throw new Error("HUAWEI_LINK_REQUIRED");
    // The BLE delay lets GATT settle after connect; an RFCOMM socket is ready.
    this.initDelayMs =
      options.initDelayMs ?? (this.transport === "br" ? 0 : HUAWEI_SESSION_INIT_DELAY_MS);
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
    this.abort.abort();
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
      if (this.authPath === "hichain") await this.hichain();
      else await this.authenticate();
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

    if (this.transport === "br") {
      // Upstream acts on the status over BR: only -1, 0 and 1 continue to
      // auth; anything else goes to an unimplemented path, so fail typed
      // instead of stalling.
      const status = parseHuaweiDeviceStatusResponse(
        await this.request(
          HUAWEI_DEVICE_CONFIG_SERVICE,
          HUAWEI_DEVICE_STATUS_COMMAND,
          buildHuaweiDeviceStatusRequest(true),
          { encrypted: false, watchdogMs: this.statusWatchdogMs },
        ),
      );
      if (status !== -1 && status !== 0 && status !== 1)
        throw new Error("HUAWEI_DEVICE_STATUS_UNSUPPORTED");
    } else {
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
    }

    if (
      this.deviceSupportType === 0x01 ||
      this.deviceSupportType === 0x02 ||
      this.deviceSupportType === 0x03 ||
      this.deviceSupportType === 0x04
    ) {
      // `initializeDeviceDealHiChain`: the negotiated authType, not the
      // support type, picks HiChain vs HiChainLite.
      const authMode = this.deviceSupportType === 0x04 ? 0x04 : 0x02;
      // `ParamsProvider.getIv`: any type-4 watch uses fully random IVs.
      this.randomIv = this.deviceSupportType === 0x04;
      const negotiation = parseHuaweiSecurityNegotiationResponse(
        await this.request(
          HUAWEI_DEVICE_CONFIG_SERVICE,
          HUAWEI_SECURITY_NEGOTIATION_COMMAND,
          buildHuaweiSecurityNegotiationRequest({
            authMode,
            deviceUuid: asciiBytes(this.androidId()),
            phoneModel: "OpenValens",
            encryptMethod: this.encryptMethod,
          }),
          { encrypted: false },
        ),
      );
      const kind = classifyHuaweiAuthType(negotiation.authType);
      if (kind === "hichain" || kind === "hichain3") {
        this.authPath = "hichain";
        return;
      }
      if (kind === "hichain_lite") {
        // Upstream keeps the negotiated mode: 4 for a type-4 watch, else 2.
        this.authMode = authMode;
        this.authPath = "lite";
        return;
      }
      throw new Error("HUAWEI_AUTH_NEGOTIATION_FAILED");
    }
  }

  /** Our persisted HiChain id: 16 random bytes as uppercase hex, made once per watch. */
  private androidId(): string {
    const stored = this.hichainStore.getAndroidId(this.options.deviceId);
    if (stored) return stored;
    const created = huaweiHexUpper(this.randomBytes(16));
    this.hichainStore.setAndroidId(this.options.deviceId, created);
    return created;
  }

  // -------------------------------------------------------------------------
  // HiChain (spec huawei-hichain-auth.md §3, §7.3)
  // -------------------------------------------------------------------------

  /**
   * Bind once with the watch's PIN (the user confirms on the watch), then
   * authenticate with the stored token on every connection; the result is the
   * 32-byte packet key. A stored token the watch rejects is forgotten and
   * reported, so a background sync never pops a pairing prompt unannounced.
   *
   * A watch that stays silent on the stored token (upstream: the 5 s op-2
   * timeout, then reconnect, forever; a re-pair from the UI is the only way
   * out) gets one more authenticate with a longer wait, then, only for an
   * interactive caller (`onAuthPrompt`), a bind in the same sync. A late reply
   * that proves the stored token means the watch is slow, not reset: no bind.
   * The stored token is only replaced by a successful bind, so a bind that
   * fails or is not confirmed leaves it in place.
   */
  private async hichain(): Promise<void> {
    const deviceId = this.options.deviceId;
    const stored = this.hichainStore.getAuthToken(deviceId);
    const retry: HuaweiHiChainRetry = { abandoned: [], tokenProven: false };
    let packetKey: Uint8Array | null = null;
    if (stored) {
      try {
        packetKey = await this.hichainAuthenticate(stored, retry);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "HUAWEI_HICHAIN_TOKEN_MISMATCH" || code === "HUAWEI_HICHAIN_REJECTED") {
          this.hichainStore.clearAuthToken(deviceId);
          throw new Error("HUAWEI_HICHAIN_REBIND_REQUIRED", { cause: error });
        }
        // Only a watch that never answered step 1, even late, may have forgotten us.
        const forgotten = code === "HUAWEI_HICHAIN_AUTH_TIMEOUT" && !retry.tokenProven;
        if (!forgotten || !this.options.onAuthPrompt) throw error;
      }
    }
    if (!packetKey) {
      const pin = decryptHuaweiPinCode({
        tlv: await this.request(
          HUAWEI_DEVICE_CONFIG_SERVICE,
          HUAWEI_PINCODE_COMMAND,
          buildHuaweiPincodeRequest(),
          { encrypted: false },
        ),
        authVersion: this.authVersion,
        encryptMethod: this.encryptMethod,
        aes: this.aes!,
      });
      if (this.closed) throw new Error("HUAWEI_CLOSED");
      this.options.onAuthPrompt?.("confirm_on_watch");
      const bound = await this.hichainOperation(1, huaweiHiChainPinKey(this.crypto!, pin), retry);
      if (!bound.authToken) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
      // Replaces a token the (reset) watch no longer knows.
      this.hichainStore.setAuthToken(deviceId, bound.authToken);
      packetKey = await this.hichainAuthenticate(bound.authToken, retry);
    }
    this.secretKey = packetKey;
    this.encryptionCounter = 0;
  }

  /**
   * Op 2 with `token`, retried once when the watch does not answer step 1;
   * attempt n waits n times as long. Each retry is a fresh operation (new
   * randoms and request id).
   */
  private async hichainAuthenticate(
    token: Uint8Array,
    retry: HuaweiHiChainRetry,
  ): Promise<Uint8Array> {
    for (let attempt = 1; ; attempt += 1) {
      if (this.closed) throw new Error("HUAWEI_CLOSED");
      try {
        const { packetKey } = await this.hichainOperation(2, token, retry, attempt);
        if (!packetKey) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
        return packetKey;
      } catch (error) {
        const silent = error instanceof Error && error.message === "HUAWEI_HICHAIN_AUTH_TIMEOUT";
        if (!silent || attempt >= HUAWEI_HICHAIN_AUTH_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * One ISO operation: 1 binds (returns the auth token), 2 authenticates (the
   * packet key). A step-1 reply that proves an abandoned op-2 step 1 is a late
   * answer to it: it is skipped and marks the token as proven. An op-2 step 1
   * that times out joins the abandoned ones.
   */
  private async hichainOperation(
    operation: HuaweiHiChainOperation,
    key: Uint8Array,
    retry: HuaweiHiChainRetry = { abandoned: [], tokenProven: false },
    attempt = 1,
  ): Promise<{ authToken?: Uint8Array; packetKey?: Uint8Array }> {
    const { abandoned } = retry;
    const crypto = this.crypto!;
    const aes = this.aes!;
    const androidId = this.androidId();
    const authIdSelf = asciiBytes(androidId);
    const requestId = BigInt(this.now().getTime());
    const seed = this.randomBytes(32);
    const randSelf = this.randomBytes(16);
    const psk = huaweiHiChainPsk(crypto, key, seed);
    const send = async (
      messageId: number,
      fields: ReadonlyArray<readonly [string, string | number]>,
      options: { isDeviceLevel?: boolean; watchdogMs?: number } = {},
    ) =>
      parseHuaweiHiChainResponse(
        await this.request(
          HUAWEI_DEVICE_CONFIG_SERVICE,
          HUAWEI_HICHAIN_COMMAND,
          buildHuaweiHiChainRequest({
            operation,
            requestId,
            json: buildHuaweiHiChainJson({
              operation,
              messageId,
              requestId,
              androidId,
              fields,
              isDeviceLevel: options.isDeviceLevel,
            }),
          }),
          {
            encrypted: false,
            watchdogMs: options.watchdogMs,
            // A late step-1 answer can land while any later step waits.
            accept:
              abandoned.length > 0
                ? (tlv) => {
                    if (!isLateHuaweiHiChainStepOne(crypto, tlv, abandoned)) return true;
                    retry.tokenProven = true;
                    return false;
                  }
                : undefined,
          },
        ),
      );

    // Step 1: the bind's step 1 is where the watch waits for the user.
    let first: Awaited<ReturnType<typeof send>>;
    try {
      first = await send(
        1,
        [
          ["isoSalt", huaweiHexUpper(randSelf)],
          ["peerAuthId", huaweiHexUpper(authIdSelf)],
          ["operationCode", operation],
          ["seed", huaweiHexUpper(seed)],
          ["peerUserType", 0],
          ...(operation === 2
            ? ([
                ["pkgName", "com.huawei.devicegroupmanage"],
                ["serviceType", HUAWEI_HICHAIN_GROUP_ID],
                ["keyLength", 32],
              ] as const)
            : []),
        ],
        {
          isDeviceLevel: operation === 2 ? false : undefined,
          watchdogMs:
            operation === 1
              ? HUAWEI_HICHAIN_CONFIRM_TIMEOUT_MS
              : Math.max(this.statusWatchdogMs, HUAWEI_HICHAIN_AUTH_STEP_MS) * attempt,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "HUAWEI_REQUEST_TIMEOUT") {
        if (operation === 1) throw new Error("HUAWEI_HICHAIN_CONFIRM_TIMEOUT", { cause: error });
        abandoned.push({ psk, randSelf, authIdSelf });
        throw new Error("HUAWEI_HICHAIN_AUTH_TIMEOUT", { cause: error });
      }
      throw error;
    }
    if (first.step !== 1) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
    const ids = {
      randSelf,
      randPeer: first.randPeer,
      authIdSelf,
      authIdPeer: first.authIdPeer,
    };
    if (!huaweiEqualBytes(first.token, huaweiHiChainPeerToken(crypto, psk, ids)))
      throw new Error("HUAWEI_HICHAIN_TOKEN_MISMATCH");

    // Step 2: our token; the watch proves the PSK with its return-code MAC.
    const second = await send(
      2,
      [
        ["peerAuthId", huaweiHexUpper(authIdSelf)],
        ["token", huaweiHexUpper(huaweiHiChainSelfToken(crypto, psk, ids))],
      ],
      { isDeviceLevel: operation === 2 ? false : undefined },
    );
    if (second.step !== 2) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
    if (!huaweiEqualBytes(second.returnCodeMac, huaweiHiChainReturnCodeMac(crypto, psk)))
      throw new Error("HUAWEI_HICHAIN_TOKEN_MISMATCH");

    const sessionKey = huaweiHiChainSessionKey(crypto, psk, ids.randSelf, ids.randPeer);
    let authToken: Uint8Array | undefined;
    if (operation === 1) {
      // Step 3 (bind only): the watch returns the token under our challenge.
      const nonce = this.randomBytes(12);
      const challenge = this.randomBytes(16);
      const third = await send(3, [
        ["nonce", huaweiHexUpper(nonce)],
        [
          "encData",
          huaweiHexUpper(huaweiHiChainEncryptChallenge(aes, sessionKey, nonce, challenge)),
        ],
      ]);
      if (third.step !== 3) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
      authToken = huaweiHiChainDecryptAuthToken(
        aes,
        sessionKey,
        third.nonce,
        third.encAuthToken,
        challenge,
      );
    }

    // Step 4 (op 2 sends it as message 3 | 0x10); the reply is not verified upstream.
    const nonce = this.randomBytes(12);
    const fourth = await send(operation === 1 ? 4 : 3, [
      ["nonce", huaweiHexUpper(nonce)],
      ["encResult", huaweiHexUpper(huaweiHiChainEncryptResult(aes, sessionKey, nonce))],
      ["operationCode", operation],
    ]);
    if (fourth.step !== 4) throw new Error("HUAWEI_HICHAIN_PROTOCOL");
    if (operation === 1) return { authToken };
    return {
      packetKey: huaweiHiChainPacketKey(crypto, sessionKey, ids.randSelf, ids.randPeer),
    };
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

    // `initializeDeviceHiChainLiteMode`: below auth version 2 the phone first
    // reads the watch's PIN (the user types nothing). Upstream fetches it for a
    // type-4 watch too, though only auth mode 2 keys the digest with it.
    let pinCode: Uint8Array | null = null;
    if (this.authPath === "lite" && this.authVersion !== 0x02) {
      pinCode = decryptHuaweiPinCode({
        tlv: await this.request(
          HUAWEI_DEVICE_CONFIG_SERVICE,
          HUAWEI_PINCODE_COMMAND,
          buildHuaweiPincodeRequest(),
          { encrypted: false },
        ),
        authVersion: this.authVersion,
        encryptMethod: this.encryptMethod,
        aes,
      });
    }

    const challengeDigest = computeHuaweiAuthDigest({
      // `digestChallenge`: auth mode 2 always uses MESSAGE_CHALLENGE (not the v4 one).
      message:
        this.authMode === 0x02
          ? HUAWEI_DIGEST_MESSAGE_CHALLENGE
          : huaweiChallengeMessage(this.authVersion),
      nonce: doubleNonce,
      authMode: this.authMode,
      authVersion: this.authVersion,
      secretKey: this.secretKey,
      pinCode,
      authAlgo: this.authAlgo,
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
      pinCode,
      authAlgo: this.authAlgo,
      crypto,
    }).slice(0, 0x20);
    if (!authResponse || !equalBytes(authResponse, expected)) {
      throw new Error("HUAWEI_AUTH_FAILED");
    }
    // Upstream `initializeDeviceNormalMode` chains bond params and bond only
    // for BLE; on BR normal-mode auth finishes here. HiChainLite always bonds.
    if (this.transport === "br" && this.authPath === "normal") return;

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
    // `GetBondParamsRequest`/`GetBondRequest` branch on auth mode 2, not on the
    // path: a type-4 watch on HiChainLite (auth mode 4) bonds like normal mode.
    if (this.authMode !== 0x02 && bondParams.status === 1) return;

    // `ParamsProvider.getIv`: the counter IV, or a random one for type 4.
    const iv = this.nextIv();
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
    options: Readonly<{
      encrypted?: boolean;
      watchdogMs?: number;
      accept?: (tlv: HuaweiTlv) => boolean;
    }> = {},
  ): Promise<HuaweiTlv> {
    // A close during an await (or inside a callback) must not reach the link.
    if (this.closed) throw new Error("HUAWEI_CLOSED");
    const encrypted = (options.encrypted ?? true) && this.transactionsCrypted;
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
    const wait = this.waitFor(
      serviceId,
      commandId,
      options.watchdogMs ?? this.watchdogMs,
      options.accept,
    );
    try {
      for (const frame of frames) await this.write(frame);
    } catch (error) {
      this.cancelPending();
      throw error;
    }
    return wait;
  }

  private nextIv(): Uint8Array {
    // HiChain3 (support type 4): a fully random IV, no counter.
    if (this.randomIv) return this.randomBytes(16);
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
    if (this.options.link) return this.options.link.write(frame, this.abort.signal);
    const device = this.options.device!;
    const write = device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("HUAWEI_WRITE_UNAVAILABLE");
    await write.call(
      device,
      this.options.profile!.serviceUuid,
      this.options.profile!.writeUuid,
      encodeBase64(frame),
    );
  }

  private waitFor(
    serviceId: number,
    commandId: number,
    watchdogMs: number,
    accept?: (tlv: HuaweiTlv) => boolean,
  ): Promise<HuaweiTlv> {
    return new Promise<HuaweiTlv>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        if (this.pending?.reject !== reject) return;
        this.pending = null;
        reject(new Error("HUAWEI_REQUEST_TIMEOUT"));
      }, watchdogMs);
      this.pending = { serviceId, commandId, accept, resolve, reject, timer };
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
    const link = this.options.link;
    if (link) {
      try {
        const unsubscribe = link.subscribe(
          (bytes) => {
            if (this.closed) return;
            try {
              this.handle(bytes);
            } catch {
              this.options.onFailure?.(this.stage);
            }
          },
          () => {
            if (this.closed) return;
            this.options.onFailure?.(this.stage);
            this.failPending(new Error("HUAWEI_LINK_CLOSED"));
          },
        );
        this.subscriptions.add({ remove: unsubscribe } as Subscription);
      } catch {
        this.options.onFailure?.(this.stage);
      }
      return;
    }
    try {
      const subscription = this.options.device!.monitorCharacteristicForService(
        this.options.profile!.serviceUuid,
        this.options.profile!.readUuid,
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

  /** Reframes a chunk (RFCOMM is a stream; a BLE notification is one frame). */
  private handle(bytes: Uint8Array): void {
    const discarded = this.deframer.discardedBytes;
    const frames = this.deframer.push(bytes);
    if (this.deframer.discardedBytes !== discarded) this.options.onFailure?.(this.stage);
    for (const frame of frames) {
      try {
        this.handleFrame(frame);
      } catch {
        // One bad frame (CRC, decryption) must not drop the frames after it.
        this.options.onFailure?.(this.stage);
      }
    }
  }

  private handleFrame(bytes: Uint8Array): void {
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
    // A late reply to an abandoned request: drop it, keep the watchdog running.
    if (pending.accept && !pending.accept(packet.tlv)) return;
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
