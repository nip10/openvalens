/**
 * Connection session for Colmi / Yawell smart rings.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`service/devices/yawell/ring/YawellRingDeviceSupport.java`).
 *
 * On connect the session subscribes to both notify characteristics, runs the
 * upstream init sequence (phone name, date/time, user preferences, battery),
 * then walks a history chain: activity for days 0..7, heart-rate history for
 * days 0..7, and the sleep big-data request. Every request has a 30 s watchdog
 * because the ring sometimes never answers. Sleep frames arrive fragmented on
 * the V2 notify characteristic and are reassembled before parsing. Once the
 * chain completes, realtime heart rate is enabled and kept alive with `1E 03`
 * every 30 notifications.
 *
 * One unavailable characteristic or failed write must not fail the whole
 * connection; failures are reported through `onFailure` and never thrown.
 *
 * Upstream also reads the standard Device Information service (0x180A) before
 * the init sequence. Those reads are metadata only and are not needed for
 * capture, so they are not performed here.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  COLMI_V1_NOTIFY_UUID,
  COLMI_V1_SERVICE_UUID,
  COLMI_V1_WRITE_UUID,
  COLMI_V2_COMMAND_UUID,
  COLMI_V2_NOTIFY_UUID,
  COLMI_V2_SERVICE_UUID,
  type ColmiRingModelId,
} from "../models/colmi-ring";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  DEFAULT_COLMI_RING_USER_PREFERENCES,
  REALTIME_HEART_RATE_KEEPALIVE,
  SLEEP_HISTORY_REQUEST,
  buildActivityHistoryRequestPacket,
  buildBatteryRequestPacket,
  buildDateTimePacket,
  buildHeartRateHistoryRequestPacket,
  buildPhoneNamePacket,
  buildRealtimeHeartRatePacket,
  buildUserPreferencesPacket,
  createColmiV2Reassembler,
  createHeartRateHistoryAccumulator,
  parseActivityHistoryPacket,
  parseBatteryResponse,
  parseRealtimeHeartRate,
  parseSleepBigData,
  type ColmiRingFailure,
  type ColmiRingRecord,
  type ColmiRingUserPreferences,
  type RingBatteryState,
} from "../protocol/colmi-ring";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Every service a registered ring may expose. */
export const COLMI_RING_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  COLMI_V1_SERVICE_UUID,
  COLMI_V2_SERVICE_UUID,
]);

/** Upstream sync watchdog: abort a history request after 30 s. */
export const COLMI_HISTORY_WATCHDOG_MS = 30_000;
/** Upstream post-connect delay before the init sequence. */
export const COLMI_INIT_DELAY_MS = 2_000;
/** Days of activity and heart-rate history requested on connect. */
export const COLMI_HISTORY_DAYS = 8;
/** Realtime heart-rate keepalive cadence, in received notifications. */
export const COLMI_REALTIME_KEEPALIVE_PACKETS = 30;

export type ColmiRingProfile = Readonly<{
  modelId: ColmiRingModelId;
  v1ServiceUuid: string;
  v1WriteUuid: string;
  v1NotifyUuid: string;
  /** Null when the device does not expose the V2 big-data service. */
  v2ServiceUuid: string | null;
  v2CommandUuid: string | null;
  v2NotifyUuid: string | null;
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
 * Picks the ring profile from the connected device's services. The V1 service
 * with both write and notify characteristics is required; the V2 big-data
 * service is optional (without it sleep history is skipped). Returns null when
 * the required service is absent.
 */
export async function selectColmiRingProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  modelId: ColmiRingModelId,
): Promise<ColmiRingProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(COLMI_V1_SERVICE_UUID)) return null;
  const v1 = await characteristicUuidsFor(device, COLMI_V1_SERVICE_UUID);
  if (!v1.includes(COLMI_V1_WRITE_UUID) || !v1.includes(COLMI_V1_NOTIFY_UUID)) return null;

  let v2ServiceUuid: string | null = null;
  let v2CommandUuid: string | null = null;
  let v2NotifyUuid: string | null = null;
  if (services.has(COLMI_V2_SERVICE_UUID)) {
    const v2 = await characteristicUuidsFor(device, COLMI_V2_SERVICE_UUID);
    if (v2.includes(COLMI_V2_COMMAND_UUID) && v2.includes(COLMI_V2_NOTIFY_UUID)) {
      v2ServiceUuid = COLMI_V2_SERVICE_UUID;
      v2CommandUuid = COLMI_V2_COMMAND_UUID;
      v2NotifyUuid = COLMI_V2_NOTIFY_UUID;
    }
  }

  return {
    modelId,
    v1ServiceUuid: COLMI_V1_SERVICE_UUID,
    v1WriteUuid: COLMI_V1_WRITE_UUID,
    v1NotifyUuid: COLMI_V1_NOTIFY_UUID,
    v2ServiceUuid,
    v2CommandUuid,
    v2NotifyUuid,
  };
}

export type ColmiRingTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: ColmiRingTimers = {
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

export type ColmiRingSessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice>;
  profile: ColmiRingProfile;
  onRecord: (record: ColmiRingRecord) => void;
  onBattery?: (state: RingBatteryState) => void;
  onFailure?: (failure: ColmiRingFailure) => void;
  now?: () => Date;
  timers?: ColmiRingTimers;
  /** Delay before the init sequence; upstream waits 2 s. */
  initDelayMs?: number;
  /** Per-request watchdog; upstream aborts after 30 s. */
  watchdogMs?: number;
  activityDays?: number;
  heartRateDays?: number;
  userPreferences?: ColmiRingUserPreferences;
  /** Enable realtime heart rate after the history chain. Default true. */
  realtimeHeartRate?: boolean;
}>;

type PendingKind = "activity" | "heart_rate" | "sleep";

/** Maps a request kind to the record type its failure is reported as. */
const FAILURE_BY_KIND: Readonly<Record<PendingKind, ColmiRingFailure>> = {
  activity: "steps_interval",
  heart_rate: "heart_rate",
  sleep: "sleep_session",
};

type Pending = {
  kind: PendingKind;
  resolve: () => void;
  timer: unknown;
};

/**
 * One ring connection. `start()` subscribes and launches the init + history
 * chain; `close()` tears everything down and settles any in-flight request.
 */
export class ColmiRingSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly timers: ColmiRingTimers;
  private readonly now: () => Date;
  private readonly initDelayMs: number;
  private readonly watchdogMs: number;
  private readonly activityDays: number;
  private readonly heartRateDays: number;
  private readonly userPreferences: ColmiRingUserPreferences;
  private readonly realtimeHeartRate: boolean;
  private readonly reassembler = createColmiV2Reassembler();
  private readonly heartRateHistory: ReturnType<typeof createHeartRateHistoryAccumulator>;
  private pending: Pending | null = null;
  private realtimeEnabled = false;
  private realtimePackets = 0;
  private closed = false;

  constructor(private readonly options: ColmiRingSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? (() => new Date());
    this.initDelayMs = options.initDelayMs ?? COLMI_INIT_DELAY_MS;
    this.watchdogMs = options.watchdogMs ?? COLMI_HISTORY_WATCHDOG_MS;
    this.activityDays = options.activityDays ?? COLMI_HISTORY_DAYS;
    this.heartRateDays = options.heartRateDays ?? COLMI_HISTORY_DAYS;
    this.userPreferences = options.userPreferences ?? DEFAULT_COLMI_RING_USER_PREFERENCES;
    this.realtimeHeartRate = options.realtimeHeartRate ?? true;
    this.heartRateHistory = createHeartRateHistoryAccumulator({ now: this.now });
  }

  start(): void {
    if (this.closed) return;
    this.monitor(this.options.profile.v1ServiceUuid, this.options.profile.v1NotifyUuid, (bytes) =>
      this.handleV1(bytes),
    );
    const { v2ServiceUuid, v2NotifyUuid } = this.options.profile;
    if (v2ServiceUuid && v2NotifyUuid)
      this.monitor(v2ServiceUuid, v2NotifyUuid, (bytes) => this.handleV2(bytes));
    void this.run();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.finish(null);
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
  }

  /** Sends `1E 01` and starts the keepalive counter. */
  async enableRealtimeHeartRate(): Promise<void> {
    if (this.closed || this.realtimeEnabled) return;
    this.realtimeEnabled = true;
    this.realtimePackets = 0;
    await this.writeV1(buildRealtimeHeartRatePacket(true));
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

    for (let daysAgo = 0; daysAgo < this.activityDays; daysAgo += 1) {
      if (this.closed) return;
      await this.request("activity", () =>
        this.writeV1(buildActivityHistoryRequestPacket(daysAgo)),
      );
    }

    for (let daysAgo = 0; daysAgo < this.heartRateDays; daysAgo += 1) {
      if (this.closed) return;
      const reference = this.now();
      const dayStart = new Date(
        reference.getFullYear(),
        reference.getMonth(),
        reference.getDate() - daysAgo,
      );
      await this.request("heart_rate", () =>
        this.writeV1(buildHeartRateHistoryRequestPacket(dayStart)),
      );
    }

    if (this.closed) return;
    if (this.options.profile.v2CommandUuid && this.options.profile.v2ServiceUuid) {
      await this.request("sleep", () => this.writeV2(SLEEP_HISTORY_REQUEST));
    }

    if (this.closed || !this.realtimeHeartRate) return;
    await this.enableRealtimeHeartRate().catch(() => undefined);
  }

  /** Phone name, date/time, user preferences, battery — upstream order. */
  private async initialize(): Promise<void> {
    const packets = [
      buildPhoneNamePacket(),
      buildDateTimePacket(this.now()),
      buildUserPreferencesPacket(this.userPreferences),
      buildBatteryRequestPacket(),
    ];
    for (const packet of packets) {
      if (this.closed) return;
      try {
        await this.writeV1(packet);
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
        this.options.onFailure?.(FAILURE_BY_KIND[kind]);
        resolve();
      }, this.watchdogMs);
      this.pending = { kind, resolve, timer };
    });
    try {
      await send();
    } catch {
      if (this.pending?.resolve === settle) {
        this.finish(kind);
        this.options.onFailure?.(FAILURE_BY_KIND[kind]);
      }
    }
    await done;
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

  private handleV1(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    switch (bytes[0]) {
      case 0x1e: {
        const bpm = parseRealtimeHeartRate(bytes);
        if (bpm === null) return;
        this.options.onRecord({ type: "heart_rate", time: this.now().toISOString(), bpm });
        this.realtimePackets += 1;
        if (this.realtimePackets % COLMI_REALTIME_KEEPALIVE_PACKETS === 0)
          void this.writeV1(REALTIME_HEART_RATE_KEEPALIVE).catch(() =>
            this.options.onFailure?.("heart_rate"),
          );
        return;
      }
      case 0x03: {
        const battery = parseBatteryResponse(bytes);
        if (battery) this.options.onBattery?.(battery);
        return;
      }
      case 0x43: {
        const packet = parseActivityHistoryPacket(bytes);
        if (!packet) {
          this.options.onFailure?.("steps_interval");
          return;
        }
        if (packet.kind === "empty") {
          this.finish("activity");
          return;
        }
        if (packet.kind === "no_data") {
          // The ring answers 0xF0 when the day has no stored data; the request
          // is complete, so do not wait for the watchdog.
          this.finish("activity");
          return;
        }
        this.options.onRecord(packet.interval);
        if (packet.done) this.finish("activity");
        return;
      }
      case 0x15: {
        const result = this.heartRateHistory.push(bytes);
        if (!result) {
          this.options.onFailure?.("heart_rate");
          return;
        }
        for (const sample of result.samples) this.options.onRecord(sample);
        if (result.done) this.finish("heart_rate");
        return;
      }
      default:
        return;
    }
  }

  private handleV2(bytes: Uint8Array): void {
    if (this.closed) return;
    for (const frame of this.reassembler.push(bytes)) {
      if (frame.type !== 0x27) continue;
      const sessions = parseSleepBigData(frame.payload, { now: this.now });
      for (const session of sessions) this.options.onRecord(session);
      this.finish("sleep");
    }
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  private async writeV1(packet: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("COLMI_WRITE_UNAVAILABLE");
    await write.call(
      this.options.device,
      this.options.profile.v1ServiceUuid,
      this.options.profile.v1WriteUuid,
      encodeBase64(packet),
    );
  }

  private async writeV2(packet: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    const { v2ServiceUuid, v2CommandUuid } = this.options.profile;
    if (!write || !v2ServiceUuid || !v2CommandUuid) throw new Error("COLMI_WRITE_UNAVAILABLE");
    await write.call(this.options.device, v2ServiceUuid, v2CommandUuid, encodeBase64(packet));
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
            this.options.onFailure?.("heart_rate");
            return;
          }
          try {
            handle(decodeBase64(value.value));
          } catch {
            this.options.onFailure?.("heart_rate");
          }
        },
      );
      this.subscriptions.add(subscription);
    } catch {
      this.options.onFailure?.("heart_rate");
    }
  }
}

/** Creates a ring session for a selected profile. */
export function createColmiRingSession(options: ColmiRingSessionOptions): ColmiRingSession {
  return new ColmiRingSession(options);
}
