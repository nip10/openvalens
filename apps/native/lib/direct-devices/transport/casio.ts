/**
 * Connection session for Casio watches.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`service/devices/casio/Casio2C2DSupport.java`,
 * `service/devices/casio/AbstractCasioConvoyFetchOperation.java`,
 * `service/devices/casio/gbd200/CasioGBD200DeviceSupport.java`).
 *
 * Roles
 * -----
 * `CasioSupport` models (GB-5600B / GB-6900B / GB-X6900B / STB-1000) make the
 * phone a GATT *server*: the watch connects to it and pushes clock, alarm and
 * notification traffic. There is no recorded-data path, so `start()` finishes
 * immediately and no characteristic is touched. The GB-6900B family also needs
 * Bluetooth toggled on the watch before the first connection; that is surfaced
 * through the registry's `pairingHint`.
 *
 * `Casio2C2DSupport` models make the phone the client. A steps fetch is:
 *
 *   CCCD on (h0011 + h0014) → `00 11 00 00 00` → length echo → CONVOY
 *   payload notifications → parse → `04 11 00 00 00` → CCCD off
 *
 * The CCCDs are toggled around every fetch, as the official app does. When the
 * platform exposes descriptor writes the toggle is an explicit `0x2902` write;
 * otherwise the subscription itself is added and removed, which is the same
 * CCCD transition performed by the BLE stack.
 *
 * Every phase has a 30 s watchdog re-armed by each response, because a watch may
 * never answer (the same safety net the other direct-device sessions use;
 * upstream has a single 30 s operation timeout).
 *
 * GBD-200 main-menu resync
 * ------------------------
 * Entering the watch main menu sends `3d 01` on the all-features characteristic
 * and resets the watch's CONVOY state. Upstream toggles the block CCCDs, runs a
 * dummy steps fetch to warm the state machine, ACKs it and toggles the CCCDs
 * again. This session does the same and then re-runs the steps fetch, since the
 * native session fetches on connection rather than on a later command.
 *
 * GBD-200 sport sessions (a separate init/cap_query/init_sig/version handshake
 * with the session list at `0x46a0`) are not implemented.
 *
 * One unavailable characteristic or failed write must not fail the whole
 * connection; failures are reported through `onFailure` and never thrown.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  CASIO_ALL_FEATURES_UUID,
  CASIO_CCCD_UUID,
  CASIO_CONVOY_UUID,
  CASIO_DATA_REQUEST_UUID,
  CASIO_WATCH_FEATURES_SERVICE_UUID,
  type CasioModel,
  type CasioModelId,
  type CasioRole,
  type CasioStepsSource,
} from "../models/casio";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  CASIO_FEATURE_BLE_PARAM,
  CASIO_FEATURE_STEPS,
  CASIO_LIFE_LOG_LENGTH,
  buildConvoyAck,
  buildConvoyRequest,
  parseCasioSteps,
  parseConvoyEcho,
  type CasioFailure,
  type CasioRecord,
} from "../protocol/casio";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Every service a registered Casio model exposes. */
export const CASIO_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  CASIO_WATCH_FEATURES_SERVICE_UUID,
]);

/** Per-phase watchdog; upstream uses a single 30 s operation timeout. */
export const CASIO_WATCHDOG_MS = 30_000;
/** Upstream's fallback payload length for the GG-B100 life log. */
export const CASIO_LIFE_LOG_FALLBACK_LENGTH = CASIO_LIFE_LOG_LENGTH;

export type CasioProfile = Readonly<{
  modelId: CasioModelId;
  role: CasioRole;
  serviceUuid: string;
  /** Block-transfer request/ACK characteristic (h0011). */
  requestUuid: string;
  /** Block-transfer payload characteristic (h0014). */
  convoyUuid: string;
  /** All-features characteristic (h002d); carries the GBD-200 resync signal. */
  featuresUuid: string;
  /** Feature id requested on h0011; `0x11` for steps and the life log. */
  stepsFeature: number;
  /** True when the payload is XOR 0xFF encoded. */
  xor: boolean;
  /** Steps payload shape, or null when the model has no capture path. */
  source: CasioStepsSource | null;
  /** GBD-200: watch resets CONVOY state when it enters the main menu. */
  mainMenuResync: boolean;
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
 * Picks the Casio profile from the connected device's services.
 *
 * The Watch Features service is required for every model. Models with a steps
 * capture path additionally need the block-transfer characteristics; when they
 * are missing this returns null so the caller can apply the BasicCasio2C2D
 * reconnect workaround. Server-role models and client-role models without an
 * upstream fetch return a profile with `source: null`.
 */
export async function selectCasioProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  model: Pick<CasioModel, "id" | "role" | "stepsSource" | "stepPayloadXor" | "mainMenuResync">,
): Promise<CasioProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(CASIO_WATCH_FEATURES_SERVICE_UUID)) return null;

  const base = {
    modelId: model.id,
    role: model.role,
    serviceUuid: CASIO_WATCH_FEATURES_SERVICE_UUID,
    requestUuid: CASIO_DATA_REQUEST_UUID,
    convoyUuid: CASIO_CONVOY_UUID,
    featuresUuid: CASIO_ALL_FEATURES_UUID,
    stepsFeature: CASIO_FEATURE_STEPS,
    xor: model.stepPayloadXor,
    source: model.stepsSource,
    mainMenuResync: model.mainMenuResync,
  } as const;

  if (model.role !== "client" || model.stepsSource === null) return base;

  const characteristics = await characteristicUuidsFor(device, CASIO_WATCH_FEATURES_SERVICE_UUID);
  if (!characteristics.includes(CASIO_DATA_REQUEST_UUID)) return null;
  if (!characteristics.includes(CASIO_CONVOY_UUID)) return null;
  return base;
}

export type CasioTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: CasioTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type CasioDevice = Pick<
  Device,
  "monitorCharacteristicForService" | "writeCharacteristicWithResponseForService"
> &
  Partial<Pick<Device, "writeDescriptorForService">>;

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

/** CCCD value: notifications enabled (`01 00`). */
const CCCD_ENABLE = "AQA=";
/** CCCD value: notifications disabled (`00 00`). */
const CCCD_DISABLE = "AAA=";

export type CasioSessionOptions = Readonly<{
  device: CasioDevice;
  profile: CasioProfile;
  onRecord: (record: CasioRecord) => void;
  onFailure?: (failure: CasioFailure) => void;
  now?: () => Date;
  timers?: CasioTimers;
  /** Per-phase watchdog, re-armed by every response. */
  watchdogMs?: number;
}>;

/** Which exchange the in-flight watchdog belongs to. */
type PendingPhase = "fetch" | "warmup";

type Pending = {
  kind: CasioFailure;
  phase: PendingPhase;
  resolve: () => void;
  timer: unknown;
};

/**
 * One watch connection. `start()` subscribes (client-role models only) and
 * launches the steps fetch; `close()` tears everything down and settles any
 * in-flight request.
 */
export class CasioSession {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly timers: CasioTimers;
  private readonly now: () => Date;
  private readonly watchdogMs: number;
  private readonly completion: Promise<void>;
  private resolveCompletion!: () => void;
  private pending: Pending | null = null;
  private chunks: Uint8Array[] = [];
  private received = 0;
  private expectedLength: number | null = null;
  private resyncChain: Promise<void> = Promise.resolve();
  private completing = false;
  private closed = false;
  private started = false;

  constructor(private readonly options: CasioSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? (() => new Date());
    this.watchdogMs = options.watchdogMs ?? CASIO_WATCHDOG_MS;
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  /** Settles when the first fetch finishes (or immediately without a data path). */
  whenDone(): Promise<void> {
    return this.completion;
  }

  start(): void {
    if (this.closed || this.started) return;
    this.started = true;
    const { profile } = this.options;
    if (profile.role !== "client" || profile.source === null) {
      // GATT-server role (or a client model with no upstream fetch): the
      // connection itself is the whole feature.
      this.resolveCompletion();
      return;
    }
    this.monitor(profile.requestUuid);
    this.monitor(profile.convoyUuid);
    if (profile.mainMenuResync) this.monitor(profile.featuresUuid);
    void this.runFetch();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.finish(null);
    for (const subscription of this.subscriptions.values()) subscription.remove();
    this.subscriptions.clear();
    this.resolveCompletion();
  }

  // -------------------------------------------------------------------------
  // Fetch chain
  // -------------------------------------------------------------------------

  private async runFetch(): Promise<void> {
    if (this.closed) return;
    await this.setBlockNotifications(true);
    if (this.closed) return;
    this.chunks = [];
    this.received = 0;
    this.expectedLength = null;
    this.completing = false;
    await this.request("steps_interval", "fetch", () =>
      this.write(
        this.options.profile.requestUuid,
        buildConvoyRequest(this.options.profile.stepsFeature),
      ),
    );
    this.resolveCompletion();
  }

  /**
   * GBD-200 warm-up: toggle the block CCCDs, send a dummy steps request, ACK its
   * echo, toggle again, then fetch. Serialised so two `3d 01` frames cannot
   * interleave.
   */
  private handleMainMenuResync(): void {
    if (this.closed) return;
    this.resyncChain = this.resyncChain
      .then(async () => {
        if (this.closed) return;
        await this.setBlockNotifications(false);
        await this.setBlockNotifications(true);
        await this.request("init", "warmup", () =>
          // `FEATURE_SETTING_FOR_BLE` is 0x11, the same id as the steps feature,
          // which is why upstream calls this a dummy steps fetch.
          this.write(this.options.profile.requestUuid, buildConvoyRequest(CASIO_FEATURE_STEPS)),
        );
        if (this.closed) return;
        await this.setBlockNotifications(false);
        await this.setBlockNotifications(true);
        await this.runFetch();
      })
      .catch(() => undefined);
  }

  private async completeFetch(): Promise<void> {
    if (this.completing) return;
    this.completing = true;
    const payload = concatChunks(this.chunks, this.received);
    this.chunks = [];
    this.received = 0;
    this.expectedLength = null;
    const records = parseCasioSteps(payload, {
      source: this.options.profile.source!,
      xor: this.options.profile.xor,
      now: this.now(),
    });
    if (!records) {
      this.options.onFailure?.("steps_interval");
      this.finish("steps_interval");
      return;
    }
    for (const record of records) this.options.onRecord(record);
    try {
      await this.write(
        this.options.profile.requestUuid,
        buildConvoyAck(this.options.profile.stepsFeature),
      );
    } catch {
      // The ACK only tells the watch the block was consumed; the records are
      // already parsed, so a failed write is not a capture failure.
    }
    await this.setBlockNotifications(false);
    this.finish("steps_interval");
  }

  // -------------------------------------------------------------------------
  // Watchdog
  // -------------------------------------------------------------------------

  private async request(
    kind: CasioFailure,
    phase: PendingPhase,
    send: () => Promise<void>,
  ): Promise<void> {
    if (this.closed) return;
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
      const timer = this.timers.setTimeout(() => {
        if (this.pending?.resolve !== settle) return;
        this.pending = null;
        this.options.onFailure?.(kind);
        resolve();
      }, this.watchdogMs);
      this.pending = { kind, phase, resolve, timer };
    });
    try {
      await send();
    } catch {
      if (this.pending?.resolve === settle) {
        this.finish(kind);
        this.options.onFailure?.(kind);
      }
    }
    await done;
  }

  /** Re-arms the watchdog for the in-flight exchange after a response. */
  private touch(): void {
    const pending = this.pending;
    if (!pending) return;
    this.timers.clearTimeout(pending.timer);
    pending.timer = this.timers.setTimeout(() => {
      if (this.pending?.resolve !== pending.resolve) return;
      this.pending = null;
      this.options.onFailure?.(pending.kind);
      pending.resolve();
    }, this.watchdogMs);
  }

  private finish(kind: CasioFailure | null): void {
    const pending = this.pending;
    if (!pending || (kind !== null && pending.kind !== kind)) return;
    this.pending = null;
    this.timers.clearTimeout(pending.timer);
    pending.resolve();
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private handleNotification(characteristicUuid: string, bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    const { profile } = this.options;

    if (characteristicUuid === profile.featuresUuid) {
      if (bytes[0] === CASIO_FEATURE_BLE_PARAM && bytes[1] === 0x01) this.handleMainMenuResync();
      return;
    }

    if (characteristicUuid === profile.requestUuid) {
      const echo = parseConvoyEcho(bytes);
      if (!echo || echo.feature !== profile.stepsFeature) return;
      this.expectedLength = echo.length;
      this.touch();
      if (this.pending?.phase === "warmup") {
        void this.write(profile.requestUuid, buildConvoyAck(profile.stepsFeature))
          .catch(() => undefined)
          .finally(() => this.finish("init"));
      }
      return;
    }

    if (characteristicUuid !== profile.convoyUuid) return;
    this.chunks.push(bytes.slice());
    this.received += bytes.length;
    this.touch();
    this.maybeComplete();
  }

  private maybeComplete(): void {
    if (this.completing || this.pending?.phase !== "fetch") return;
    const expected = this.expectedLength;
    if (expected !== null) {
      if (this.received < expected) return;
    } else if (this.options.profile.source === "life-log") {
      // No echo: upstream falls back to the fixed life-log length.
      if (this.received < CASIO_LIFE_LOG_FALLBACK_LENGTH) return;
    }
    // No echo on the hourly-TLV path: upstream treats the first notification as
    // the complete payload.
    void this.completeFetch();
  }

  // -------------------------------------------------------------------------
  // CCCD and writes
  // -------------------------------------------------------------------------

  /**
   * Turns the block-transfer notifications on or off. Uses an explicit CCCD
   * descriptor write when the platform exposes one, otherwise adds/removes the
   * subscription, which is the same CCCD transition.
   */
  private async setBlockNotifications(enable: boolean): Promise<void> {
    const { profile } = this.options;
    const write = this.options.device.writeDescriptorForService;
    if (write) {
      const value = enable ? CCCD_ENABLE : CCCD_DISABLE;
      for (const uuid of [profile.requestUuid, profile.convoyUuid]) {
        try {
          await write.call(this.options.device, profile.serviceUuid, uuid, CASIO_CCCD_UUID, value);
        } catch {
          // Fall back to the subscription lifecycle for this characteristic.
          if (enable) this.monitor(uuid);
          else this.unmonitor(uuid);
        }
      }
      return;
    }
    for (const uuid of [profile.requestUuid, profile.convoyUuid]) {
      if (enable) this.monitor(uuid);
      else this.unmonitor(uuid);
    }
  }

  private async write(characteristicUuid: string, bytes: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("CASIO_WRITE_UNAVAILABLE");
    await write.call(
      this.options.device,
      this.options.profile.serviceUuid,
      characteristicUuid,
      encodeBase64(bytes),
    );
  }

  private monitor(characteristicUuid: string): void {
    if (this.closed || this.subscriptions.has(characteristicUuid)) return;
    try {
      const subscription = this.options.device.monitorCharacteristicForService(
        this.options.profile.serviceUuid,
        characteristicUuid,
        (error, value: Characteristic | null) => {
          if (this.closed) return;
          if (error || !value?.value) {
            this.options.onFailure?.("init");
            return;
          }
          try {
            this.handleNotification(characteristicUuid, decodeBase64(value.value));
          } catch {
            this.options.onFailure?.("init");
          }
        },
      );
      this.subscriptions.set(characteristicUuid, subscription);
    } catch {
      this.options.onFailure?.("init");
    }
  }

  private unmonitor(characteristicUuid: string): void {
    const subscription = this.subscriptions.get(characteristicUuid);
    if (!subscription) return;
    this.subscriptions.delete(characteristicUuid);
    subscription.remove();
  }
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Creates a watch session for a selected profile. */
export function createCasioSession(options: CasioSessionOptions): CasioSession {
  return new CasioSession(options);
}
