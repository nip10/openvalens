/**
 * Connection session for FitPro (LM517-class) bands and watches.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`service/devices/fitpro/FitProDeviceSupport.java`).
 *
 * On connect the session subscribes to the RX notify characteristic, writes the
 * upstream init priming sequence, then triggers the ack-driven fetch chain:
 * `0x15/0x06` → `0x15/0x07` (start) → `0x15/0x08` (data) → `0x15/0x10` (end) →
 * `0x15/0x02` (steps per day) → `0x15/0x03` (sleep per day). Every packet is
 * acked; the band only sends the next one after an ack, so acks are written
 * from the notification handler rather than from the request loop. Each phase
 * has a 30 s watchdog because a band may never answer; a response re-arms it,
 * so a slow multi-packet transfer is not cut off.
 *
 * Realtime heart rate is enabled after the fetch chain when the model supports
 * it (the ColaCao coordinators disable heart-rate measurement upstream because
 * requests crash the device). Heart-rate packets are parsed and acked whenever
 * they arrive, including during the fetch.
 *
 * Upstream also writes the language, user-data and step-goal settings on every
 * connection. Those are write-only settings with no read-back, so writing
 * defaults would silently overwrite the user's real profile and goal. They are
 * deliberately not sent; see `buildInitPackets`.
 *
 * One unavailable characteristic or failed write must not fail the whole
 * connection; failures are reported through `onFailure` and never thrown.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  FITPRO_NOTIFY_UUID,
  FITPRO_SERVICE_UUID,
  FITPRO_WRITE_UUID,
  type FitProModel,
  type FitProModelId,
} from "../models/fitpro";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  FITPRO_CMD_DAY_TOTALS,
  FITPRO_CMD_FETCH_DATA,
  FITPRO_CMD_FETCH_END,
  FITPRO_CMD_FETCH_START,
  FITPRO_CMD_HEART_RATE_DATA,
  FITPRO_CMD_SLEEP_PER_DAY,
  FITPRO_CMD_STEPS_PER_DAY,
  FITPRO_GROUP_BAND_INFO,
  FITPRO_GROUP_RECEIVE_SPORTS_DATA,
  FITPRO_GROUP_REQUEST_DATA,
  assembleSleepSessions,
  buildAck,
  buildFetchTriggerPacket,
  buildHeartRateMeasurementPacket,
  buildInitPackets,
  createFitProReassembler,
  frameLength,
  parseHeartRatePacket,
  parseSleepPacket,
  parseStepsPacket,
  type FitProFailure,
  type FitProFrame,
  type FitProRecord,
} from "../protocol/fitpro";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Every service a registered FitPro model exposes. */
export const FITPRO_SERVICE_UUIDS: ReadonlySet<string> = new Set([FITPRO_SERVICE_UUID]);

/** Local safety net for a silent fetch phase; upstream has no timeout. */
export const FITPRO_HISTORY_WATCHDOG_MS = 30_000;
/** Upstream writes the init transaction immediately after connect. */
export const FITPRO_INIT_DELAY_MS = 0;

export type FitProProfile = Readonly<{
  modelId: FitProModelId;
  serviceUuid: string;
  /** Phone → band write characteristic (`6e400002-…-cca9d`). */
  writeUuid: string;
  /** Band → phone notify characteristic (`6e400003-…-cca9d`). */
  notifyUuid: string;
  /** Upstream `supportsHeartRateMeasurement()`; gates the realtime request. */
  heartRateMeasurement: boolean;
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
 * Picks the FitPro profile from the connected device's services. The
 * `6e400001-…-cca9d` service with both the write (`6e400002-…`) and notify
 * (`6e400003-…`) characteristics is required. Returns null when anything is
 * missing.
 */
export async function selectFitProProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  model: Pick<FitProModel, "id" | "heartRateMeasurement">,
): Promise<FitProProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(FITPRO_SERVICE_UUID)) return null;
  const characteristics = await characteristicUuidsFor(device, FITPRO_SERVICE_UUID);
  if (!characteristics.includes(FITPRO_WRITE_UUID)) return null;
  if (!characteristics.includes(FITPRO_NOTIFY_UUID)) return null;
  return {
    modelId: model.id,
    serviceUuid: FITPRO_SERVICE_UUID,
    writeUuid: FITPRO_WRITE_UUID,
    notifyUuid: FITPRO_NOTIFY_UUID,
    heartRateMeasurement: model.heartRateMeasurement,
  };
}

export type FitProTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: FitProTimers = {
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

export type FitProSessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice>;
  profile: FitProProfile;
  onRecord: (record: FitProRecord) => void;
  onFailure?: (failure: FitProFailure) => void;
  now?: () => Date;
  timers?: FitProTimers;
  /** Delay before the init sequence. Upstream writes immediately after connect. */
  initDelayMs?: number;
  /** Per-phase watchdog, re-armed by every response. */
  watchdogMs?: number;
  /** Send the upstream init priming sequence. Default true. */
  initialize?: boolean;
  /** Enable realtime heart rate after the fetch. Default: profile capability. */
  realtimeHeartRate?: boolean;
}>;

type PendingKind = Extract<FitProFailure, "steps_interval" | "sleep_session">;

type Pending = {
  kind: PendingKind;
  resolve: () => void;
  timer: unknown;
};

/**
 * One band connection. `start()` subscribes and launches the init + fetch
 * chain; `close()` tears everything down and settles any in-flight phase.
 */
export class FitProSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly reassembler = createFitProReassembler();
  private readonly timers: FitProTimers;
  private readonly now: () => Date;
  private readonly initDelayMs: number;
  private readonly watchdogMs: number;
  private readonly initialize: boolean;
  private readonly realtimeHeartRate: boolean;
  private readonly seen = { steps: false, sleep: false };
  private pending: Pending | null = null;
  private closed = false;

  constructor(private readonly options: FitProSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? (() => new Date());
    this.initDelayMs = options.initDelayMs ?? FITPRO_INIT_DELAY_MS;
    this.watchdogMs = options.watchdogMs ?? FITPRO_HISTORY_WATCHDOG_MS;
    this.initialize = options.initialize ?? true;
    this.realtimeHeartRate = options.realtimeHeartRate ?? options.profile.heartRateMeasurement;
  }

  start(): void {
    if (this.closed) return;
    this.monitor(this.options.profile.serviceUuid, this.options.profile.notifyUuid);
    void this.run();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.finish(null);
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
  }

  // -------------------------------------------------------------------------
  // Chain
  // -------------------------------------------------------------------------

  private async run(): Promise<void> {
    if (this.initDelayMs > 0) {
      await new Promise<void>((resolve) => this.timers.setTimeout(resolve, this.initDelayMs));
    }
    if (this.closed) return;
    if (this.initialize) await this.initializeDevice();
    if (this.closed) return;

    // Phase 1: trigger the transfer and wait for the per-day step packet. The
    // start/data/end markers only re-arm the watchdog; they carry no records.
    await this.request("steps_interval", () => this.write(buildFetchTriggerPacket()));
    if (this.closed || this.seen.sleep) return;

    // Phase 2: the band pushes the sleep packet after it has acked the steps,
    // so this phase only waits (and acks from the notification handler).
    await this.request("sleep_session", async () => undefined);
    if (this.closed || !this.realtimeHeartRate) return;

    await this.write(buildHeartRateMeasurementPacket(true)).catch(() => {
      this.options.onFailure?.("init");
    });
  }

  /** Upstream init priming; see `buildInitPackets` for what is omitted. */
  private async initializeDevice(): Promise<void> {
    for (const packet of buildInitPackets(this.now())) {
      if (this.closed) return;
      try {
        await this.write(packet);
      } catch {
        this.options.onFailure?.("init");
      }
    }
  }

  private async request(kind: PendingKind, send: () => Promise<void>): Promise<void> {
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
      this.pending = { kind, resolve, timer };
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

  /** Re-arms the watchdog for the in-flight phase after a response. */
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

  private finish(kind: PendingKind | null): void {
    const pending = this.pending;
    if (!pending || (kind !== null && pending.kind !== kind)) return;
    this.pending = null;
    this.timers.clearTimeout(pending.timer);
    pending.resolve();
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private handleNotification(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    for (const frame of this.reassembler.push(bytes)) this.handleFrame(frame);
  }

  private handleFrame(frame: FitProFrame): void {
    if (frame.group === FITPRO_GROUP_RECEIVE_SPORTS_DATA) {
      switch (frame.command) {
        case FITPRO_CMD_HEART_RATE_DATA:
          this.handleHeartRate(frame);
          return;
        case FITPRO_CMD_STEPS_PER_DAY:
          this.handleSteps(frame);
          return;
        case FITPRO_CMD_SLEEP_PER_DAY:
          this.handleSleep(frame);
          return;
        case FITPRO_CMD_FETCH_START:
        case FITPRO_CMD_FETCH_DATA:
        case FITPRO_CMD_FETCH_END:
        case FITPRO_CMD_DAY_TOTALS:
          // Acking these is what makes the band send the next packet.
          this.ack(frame);
          this.touch();
          return;
        default:
          return;
      }
    }
    // Upstream acks every band-info and request-data answer.
    if (frame.group === FITPRO_GROUP_BAND_INFO || frame.group === FITPRO_GROUP_REQUEST_DATA) {
      this.ack(frame);
      this.touch();
    }
  }

  private handleSteps(frame: FitProFrame): void {
    const packet = parseStepsPacket(frame.payload);
    this.ack(frame);
    if (!packet) {
      this.options.onFailure?.("steps_interval");
      this.finish("steps_interval");
      return;
    }
    for (const bucket of packet.buckets) this.options.onRecord(bucket.record);
    this.seen.steps = true;
    this.finish("steps_interval");
  }

  private handleSleep(frame: FitProFrame): void {
    const packet = parseSleepPacket(frame.payload);
    this.ack(frame);
    if (!packet) {
      this.options.onFailure?.("sleep_session");
      this.finish("sleep_session");
      return;
    }
    for (const session of assembleSleepSessions(packet.starts)) this.options.onRecord(session);
    this.seen.sleep = true;
    this.finish("sleep_session");
  }

  private handleHeartRate(frame: FitProFrame): void {
    const parsed = parseHeartRatePacket(frame.payload, { reference: this.now() });
    this.ack(frame);
    this.touch();
    if (!parsed) {
      this.options.onFailure?.("heart_rate");
      return;
    }
    this.options.onRecord({ type: "heart_rate", time: parsed.time, bpm: parsed.bpm });
  }

  // -------------------------------------------------------------------------
  // Writes and subscription
  // -------------------------------------------------------------------------

  /** Acks a frame with its own total length, as upstream `sendAck` does. */
  private ack(frame: FitProFrame): void {
    void this.write(buildAck(frame.group, frameLength(frame))).catch(() => {
      this.options.onFailure?.("init");
    });
  }

  private async write(packet: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("FITPRO_WRITE_UNAVAILABLE");
    const { serviceUuid, writeUuid } = this.options.profile;
    await write.call(this.options.device, serviceUuid, writeUuid, encodeBase64(packet));
  }

  private monitor(serviceUuid: string, characteristicUuid: string): void {
    if (this.closed) return;
    try {
      const subscription = this.options.device.monitorCharacteristicForService(
        serviceUuid,
        characteristicUuid,
        (error, value: Characteristic | null) => {
          if (this.closed) return;
          if (error || !value?.value) {
            this.options.onFailure?.("init");
            return;
          }
          try {
            this.handleNotification(decodeBase64(value.value));
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

/** Creates a band session for a selected profile. */
export function createFitProSession(options: FitProSessionOptions): FitProSession {
  return new FitProSession(options);
}
