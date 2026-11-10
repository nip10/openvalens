/**
 * Connection session for Moyoung / Da Fit watches.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`service/devices/moyoung/MoyoungDeviceSupport.java` and
 * `service/devices/moyoung/FetchDataOperation.java`).
 *
 * On connect the session subscribes to the `fee3` notify characteristic,
 * requests MTU `model.mtu + 3` (the +3 is BLE overhead, exactly as upstream's
 * `builder.requestMtu(mtu + 3)`), sets the watch clock, then walks the history
 * chain: sleep today (CMD 50) → sleep yesterday (CMD 51 arg 3) → sleep
 * day-before (CMD 51 arg 4) → heart-rate history (CMD 53, chained 0..7) →
 * today's one-minute heart rate (CMD 54, 20 packets) when the model supports
 * it. Every request has a 30 s watchdog because a watch may never answer; a
 * response re-arms it, so a slow multi-packet exchange is not cut off.
 *
 * Clock quirk: the watch keeps time in a hardcoded GMT+8, and CMD 49 carries
 * the phone's wall clock interpreted as GMT+8 plus a literal `0x08` timezone
 * byte that has no effect. The codec does the conversion; this is documented
 * here so nobody "fixes" it to the phone's real offset.
 *
 * Upstream also writes USER_INFO and GOAL_STEP on every connection. Those are
 * write-only settings with no read-back, so writing defaults would silently
 * overwrite the user's real profile and goal. They are deliberately not sent,
 * and neither are the other setting writes (measurement system, alarm query,
 * battery profile) or the realtime heart-rate stream. The standard Device
 * Information service is metadata only and is not needed for capture, so it is
 * not read either.
 *
 * One unavailable characteristic or failed write must not fail the whole
 * connection; failures are reported through `onFailure` and never thrown.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  MOYOUNG_DATA_IN_UUID,
  MOYOUNG_DATA_OUT_UUID,
  MOYOUNG_SERVICE_UUID,
  type MoyoungModel,
  type MoyoungModelId,
} from "../models/moyoung";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  MOYOUNG_ARG_DAY_BEFORE_YESTERDAY_SLEEP,
  MOYOUNG_ARG_YESTERDAY_SLEEP,
  MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN,
  MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN,
  MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP,
  MOYOUNG_CMD_SYNC_SLEEP,
  MOYOUNG_HR_1MIN_PACKET_COUNT,
  MOYOUNG_HR_5MIN_PACKET_COUNT,
  buildHeartRateHistoryPacket,
  buildPastSleepPacket,
  buildSleepTodayPacket,
  buildSyncTimePacket,
  buildTodayHeartRatePacket,
  createMoyoungReassembler,
  fragmentPacket,
  parseHeartRateHistoryPacket,
  parseSleepHistory,
  parseTodayHeartRatePacket,
  sleepDaysAgoOffset,
  type MoyoungFailure,
  type MoyoungRecord,
} from "../protocol/moyoung";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Every service a registered Moyoung model exposes. */
export const MOYOUNG_SERVICE_UUIDS: ReadonlySet<string> = new Set([MOYOUNG_SERVICE_UUID]);

/** Local safety net for a silent history request; upstream has no timeout. */
export const MOYOUNG_HISTORY_WATCHDOG_MS = 30_000;
/** Upstream writes the init transaction immediately after connect. */
export const MOYOUNG_INIT_DELAY_MS = 0;
/** BLE overhead added to the framing MTU when negotiating, as upstream does. */
export const MOYOUNG_MTU_OVERHEAD = 3;

export type MoyoungProfile = Readonly<{
  modelId: MoyoungModelId;
  serviceUuid: string;
  /** Phone → watch packet characteristic (`fee2`). */
  writeUuid: string;
  /** Watch → phone notify characteristic (`fee3`). */
  notifyUuid: string;
  /** Framing MTU from the coordinator: 508, or 20 for KW19-B and P22B1. */
  mtu: number;
  /** Gates the CMD 54 one-minute history request. */
  supportsHeartRateHistory: boolean;
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
 * Picks the Moyoung profile from the connected device's services. The `feea`
 * service with both the write (`fee2`) and notify (`fee3`) characteristics is
 * required. Returns null when anything is missing.
 */
export async function selectMoyoungProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  model: Pick<MoyoungModel, "id" | "mtu" | "supportsHeartRateHistory">,
): Promise<MoyoungProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(MOYOUNG_SERVICE_UUID)) return null;
  const characteristics = await characteristicUuidsFor(device, MOYOUNG_SERVICE_UUID);
  if (!characteristics.includes(MOYOUNG_DATA_OUT_UUID)) return null;
  if (!characteristics.includes(MOYOUNG_DATA_IN_UUID)) return null;
  return {
    modelId: model.id,
    serviceUuid: MOYOUNG_SERVICE_UUID,
    writeUuid: MOYOUNG_DATA_OUT_UUID,
    notifyUuid: MOYOUNG_DATA_IN_UUID,
    mtu: model.mtu,
    supportsHeartRateHistory: model.supportsHeartRateHistory,
  };
}

export type MoyoungTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: MoyoungTimers = {
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

export type MoyoungSessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice> & Partial<MtuDevice>;
  profile: MoyoungProfile;
  onRecord: (record: MoyoungRecord) => void;
  onFailure?: (failure: MoyoungFailure) => void;
  now?: () => Date;
  timers?: MoyoungTimers;
  /** Delay before the init sequence. Upstream writes immediately after connect. */
  initDelayMs?: number;
  /** Per-request watchdog, re-armed by every response. */
  watchdogMs?: number;
}>;

type PendingKind = MoyoungFailure;

type Pending = {
  kind: PendingKind;
  resolve: () => void;
  timer: unknown;
};

/**
 * One watch connection. `start()` subscribes and launches the init + history
 * chain; `close()` tears everything down and settles any in-flight request.
 */
export class MoyoungSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly reassembler = createMoyoungReassembler();
  private readonly timers: MoyoungTimers;
  private readonly now: () => Date;
  private readonly initDelayMs: number;
  private readonly watchdogMs: number;
  private readonly todayPackets = new Set<number>();
  private pending: Pending | null = null;
  private closed = false;

  constructor(private readonly options: MoyoungSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? (() => new Date());
    this.initDelayMs = options.initDelayMs ?? MOYOUNG_INIT_DELAY_MS;
    this.watchdogMs = options.watchdogMs ?? MOYOUNG_HISTORY_WATCHDOG_MS;
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
    await this.requestMtu();
    if (this.closed) return;
    await this.initialize();
    if (this.closed) return;

    const { mtu } = this.options.profile;
    await this.request("sleep_session", () => this.write(buildSleepTodayPacket(mtu)));
    await this.request("sleep_session", () =>
      this.write(buildPastSleepPacket(mtu, MOYOUNG_ARG_YESTERDAY_SLEEP)),
    );
    await this.request("sleep_session", () =>
      this.write(buildPastSleepPacket(mtu, MOYOUNG_ARG_DAY_BEFORE_YESTERDAY_SLEEP)),
    );
    await this.request("heart_rate", () => this.write(buildHeartRateHistoryPacket(mtu, 0)));

    if (this.closed || !this.options.profile.supportsHeartRateHistory) return;
    this.todayPackets.clear();
    await this.request("heart_rate", async () => {
      for (let index = 0; index < MOYOUNG_HR_1MIN_PACKET_COUNT; index += 1)
        await this.write(buildTodayHeartRatePacket(mtu, index));
    });
  }

  /** Best-effort MTU negotiation; iOS ignores it and Android picks the largest. */
  private async requestMtu(): Promise<void> {
    const request = this.options.device.requestMTU;
    if (!request) return;
    try {
      await request.call(this.options.device, this.options.profile.mtu + MOYOUNG_MTU_OVERHEAD);
    } catch {
      // Negotiation is an optimisation; the framing mode comes from the model.
    }
  }

  /** Clock set. See the GMT+8 note in the module header. */
  private async initialize(): Promise<void> {
    try {
      await this.write(buildSyncTimePacket(this.options.profile.mtu, this.now()));
    } catch {
      this.options.onFailure?.("init");
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

  /** Re-arms the watchdog for the in-flight request after a response. */
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
    const packet = this.reassembler.push(bytes);
    if (!packet) return;
    switch (packet.command) {
      case MOYOUNG_CMD_SYNC_SLEEP:
        this.handleSleep(0, packet.payload);
        return;
      case MOYOUNG_CMD_SYNC_PAST_SLEEP_AND_STEP: {
        const arg = packet.payload[0];
        if (arg !== MOYOUNG_ARG_YESTERDAY_SLEEP && arg !== MOYOUNG_ARG_DAY_BEFORE_YESTERDAY_SLEEP)
          return;
        const labelled = arg === MOYOUNG_ARG_YESTERDAY_SLEEP ? 1 : 2;
        this.handleSleep(labelled - sleepDaysAgoOffset(this.now()), packet.payload.slice(1));
        return;
      }
      case MOYOUNG_CMD_QUERY_PAST_HEART_RATE_5MIN:
        this.handleHeartRateHistory(packet.payload);
        return;
      case MOYOUNG_CMD_QUERY_PAST_HEART_RATE_1MIN:
        this.handleTodayHeartRate(packet.payload);
        return;
      default:
        return;
    }
  }

  private handleSleep(daysAgo: number, payload: Uint8Array): void {
    const sessions = parseSleepHistory(payload, { daysAgo, reference: this.now() });
    for (const session of sessions) this.options.onRecord(session);
    this.finish("sleep_session");
  }

  private handleHeartRateHistory(payload: Uint8Array): void {
    const parsed = parseHeartRateHistoryPacket(payload, { now: this.now() });
    if (!parsed) {
      this.options.onFailure?.("heart_rate");
      return;
    }
    for (const sample of parsed.samples) this.options.onRecord(sample);
    this.touch();
    if (parsed.packetIndex >= MOYOUNG_HR_5MIN_PACKET_COUNT - 1) {
      this.finish("heart_rate");
      return;
    }
    void this.write(
      buildHeartRateHistoryPacket(this.options.profile.mtu, parsed.packetIndex + 1),
    ).catch(() => {
      this.finish("heart_rate");
      this.options.onFailure?.("heart_rate");
    });
  }

  private handleTodayHeartRate(payload: Uint8Array): void {
    const parsed = parseTodayHeartRatePacket(payload, { now: this.now() });
    if (!parsed) {
      this.options.onFailure?.("heart_rate");
      return;
    }
    for (const sample of parsed.samples) this.options.onRecord(sample);
    this.todayPackets.add(parsed.packetIndex);
    this.touch();
    if (this.todayPackets.size >= MOYOUNG_HR_1MIN_PACKET_COUNT) this.finish("heart_rate");
  }

  // -------------------------------------------------------------------------
  // Writes and subscription
  // -------------------------------------------------------------------------

  private async write(packet: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("MOYOUNG_WRITE_UNAVAILABLE");
    const { serviceUuid, writeUuid, mtu } = this.options.profile;
    for (const fragment of fragmentPacket(packet, mtu)) {
      await write.call(this.options.device, serviceUuid, writeUuid, encodeBase64(fragment));
    }
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

/** Creates a watch session for a selected profile. */
export function createMoyoungSession(options: MoyoungSessionOptions): MoyoungSession {
  return new MoyoungSession(options);
}
