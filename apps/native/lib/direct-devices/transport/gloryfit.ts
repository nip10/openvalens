/**
 * Connection session for GloryFit smartwatches.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`service/devices/gloryfit/GloryFitSupport.kt` and `GloryFitFetcher.kt`).
 *
 * On connect the session subscribes to both notify characteristics (command
 * `33f2`, bulk data `34f2`), requests MTU 247, sends the firmware/battery
 * probes from `initializeDevice`, then walks the history chain in upstream
 * fetcher order: steps → heart rate → sleep. Every request has a 30 s watchdog
 * because a watch may never answer. Sleep is a two-phase exchange: `31 01`
 * returns the session date on the command characteristic, `32` stage payloads
 * arrive on the bulk-data characteristic, and `31 02` closes the session.
 *
 * One unavailable characteristic or failed write must not fail the whole
 * connection; failures are reported through `onFailure` and never thrown.
 *
 * Upstream also sets the clock, user info, goals, language, units and alarm
 * settings during init. Those affect the watch UI, not capture, so they are not
 * performed here.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  GLORYFIT_CMD_NOTIFY_UUID,
  GLORYFIT_CMD_SERVICE_UUID,
  GLORYFIT_CMD_WRITE_UUID,
  GLORYFIT_DATA_NOTIFY_UUID,
  GLORYFIT_DATA_SERVICE_UUID,
  GLORYFIT_DATA_WRITE_UUID,
  type GloryFitModelId,
} from "../models/gloryfit";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  GLORYFIT_CMD_BATTERY,
  GLORYFIT_CMD_HEART_RATE,
  GLORYFIT_CMD_SLEEP_INFO,
  GLORYFIT_CMD_SLEEP_STAGES,
  GLORYFIT_CMD_STEPS,
  GLORYFIT_CMD_VERSION,
  GLORYFIT_FETCH_END,
  GLORYFIT_MTU_REQUEST,
  buildBatteryCommand,
  buildHeartRateFetchCommand,
  buildSleepFetchCommand,
  buildStepsFetchCommand,
  buildVersionCommand,
  createGloryFitSleepAccumulator,
  parseGloryFitBatteryResponse,
  parseGloryFitHeartRateRecord,
  parseGloryFitSleepInfo,
  parseGloryFitStepsRecord,
  type GloryFitBatteryState,
  type GloryFitFailure,
  type GloryFitRecord,
} from "../protocol/gloryfit";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Every service a registered GloryFit watch exposes. */
export const GLORYFIT_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  GLORYFIT_CMD_SERVICE_UUID,
  GLORYFIT_DATA_SERVICE_UUID,
]);

/** Local safety net for a silent history request. */
export const GLORYFIT_HISTORY_WATCHDOG_MS = 30_000;
/** Delay before the init sequence. Upstream writes immediately after connect. */
export const GLORYFIT_INIT_DELAY_MS = 0;
/** Steps/heart-rate fetch end markers are three bytes (`CMD FD xx`). */
export const GLORYFIT_END_MARKER_LENGTH = 3;

export type GloryFitProfile = Readonly<{
  modelId: GloryFitModelId;
  commandServiceUuid: string;
  commandWriteUuid: string;
  commandNotifyUuid: string;
  dataServiceUuid: string;
  dataWriteUuid: string;
  dataNotifyUuid: string;
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
 * Picks the GloryFit profile from the connected device's services. Both the
 * command and bulk-data services with their write/notify characteristics are
 * required; without the bulk-data service sleep stages cannot be read. Returns
 * null when anything is missing.
 */
export async function selectGloryFitProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  modelId: GloryFitModelId,
): Promise<GloryFitProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  if (!services.has(GLORYFIT_CMD_SERVICE_UUID) || !services.has(GLORYFIT_DATA_SERVICE_UUID))
    return null;
  const command = await characteristicUuidsFor(device, GLORYFIT_CMD_SERVICE_UUID);
  if (!command.includes(GLORYFIT_CMD_WRITE_UUID) || !command.includes(GLORYFIT_CMD_NOTIFY_UUID))
    return null;
  const data = await characteristicUuidsFor(device, GLORYFIT_DATA_SERVICE_UUID);
  if (!data.includes(GLORYFIT_DATA_WRITE_UUID) || !data.includes(GLORYFIT_DATA_NOTIFY_UUID))
    return null;
  return {
    modelId,
    commandServiceUuid: GLORYFIT_CMD_SERVICE_UUID,
    commandWriteUuid: GLORYFIT_CMD_WRITE_UUID,
    commandNotifyUuid: GLORYFIT_CMD_NOTIFY_UUID,
    dataServiceUuid: GLORYFIT_DATA_SERVICE_UUID,
    dataWriteUuid: GLORYFIT_DATA_WRITE_UUID,
    dataNotifyUuid: GLORYFIT_DATA_NOTIFY_UUID,
  };
}

export type GloryFitTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

const defaultTimers: GloryFitTimers = {
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

export type GloryFitSessionOptions = Readonly<{
  device: MonitorDevice & Partial<WriteDevice> & Partial<MtuDevice>;
  profile: GloryFitProfile;
  onRecord: (record: GloryFitRecord) => void;
  onBattery?: (state: GloryFitBatteryState) => void;
  onFailure?: (failure: GloryFitFailure) => void;
  now?: () => Date;
  timers?: GloryFitTimers;
  /** Delay before the init sequence. */
  initDelayMs?: number;
  /** Per-request watchdog. */
  watchdogMs?: number;
}>;

type PendingKind = "steps" | "heart_rate" | "sleep";

/** Maps a request kind to the record type its failure is reported as. */
const FAILURE_BY_KIND: Readonly<Record<PendingKind, GloryFitFailure>> = {
  steps: "steps_interval",
  heart_rate: "heart_rate",
  sleep: "sleep_session",
};

type Pending = {
  kind: PendingKind;
  resolve: () => void;
  timer: unknown;
};

/**
 * One watch connection. `start()` subscribes and launches the init + history
 * chain; `close()` tears everything down and settles any in-flight request.
 */
export class GloryFitSession {
  private readonly subscriptions = new Set<Subscription>();
  private readonly sleep = createGloryFitSleepAccumulator();
  private readonly timers: GloryFitTimers;
  private readonly initDelayMs: number;
  private readonly watchdogMs: number;
  private pending: Pending | null = null;
  private closed = false;

  constructor(private readonly options: GloryFitSessionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.initDelayMs = options.initDelayMs ?? GLORYFIT_INIT_DELAY_MS;
    this.watchdogMs = options.watchdogMs ?? GLORYFIT_HISTORY_WATCHDOG_MS;
  }

  start(): void {
    if (this.closed) return;
    this.monitor(
      this.options.profile.commandServiceUuid,
      this.options.profile.commandNotifyUuid,
      (bytes) => this.handleCommand(bytes),
    );
    this.monitor(
      this.options.profile.dataServiceUuid,
      this.options.profile.dataNotifyUuid,
      (bytes) => this.handleData(bytes),
    );
    void this.run();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.finish(null);
    this.sleep.reset();
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
    await this.initialize();
    if (this.closed) return;

    await this.request("steps", () => this.writeCommand(buildStepsFetchCommand()));
    if (this.closed) return;
    await this.request("heart_rate", () => this.writeCommand(buildHeartRateFetchCommand()));
    if (this.closed) return;
    await this.request("sleep", () => this.writeCommand(buildSleepFetchCommand()));
  }

  /** MTU, firmware and battery probes — upstream `initializeDevice` order. */
  private async initialize(): Promise<void> {
    try {
      await this.options.device.requestMTU?.(GLORYFIT_MTU_REQUEST);
    } catch {
      // Best effort: iOS ignores this and Android negotiates the largest MTU.
    }
    for (const command of [buildVersionCommand(), buildBatteryCommand()]) {
      if (this.closed) return;
      try {
        await this.writeCommand(command);
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
        // Upstream persists each sleep stage as it arrives; if the closing
        // message never comes, keep what was captured before reporting.
        if (kind === "sleep") this.emitSleepSessions();
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

  private emitSleepSessions(): void {
    for (const session of this.sleep.end()) this.options.onRecord(session);
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private handleCommand(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    switch (bytes[0]) {
      case GLORYFIT_CMD_VERSION:
        return;
      case GLORYFIT_CMD_BATTERY: {
        const battery = parseGloryFitBatteryResponse(bytes);
        if (battery) this.options.onBattery?.(battery);
        return;
      }
      case GLORYFIT_CMD_STEPS: {
        if (bytes.length === GLORYFIT_END_MARKER_LENGTH && bytes[1] === GLORYFIT_FETCH_END) {
          this.finish("steps");
          return;
        }
        const record = parseGloryFitStepsRecord(bytes);
        if (record) this.options.onRecord(record);
        return;
      }
      case GLORYFIT_CMD_HEART_RATE: {
        if (bytes.length === GLORYFIT_END_MARKER_LENGTH && bytes[1] === GLORYFIT_FETCH_END) {
          this.finish("heart_rate");
          return;
        }
        for (const sample of parseGloryFitHeartRateRecord(bytes)) this.options.onRecord(sample);
        return;
      }
      case GLORYFIT_CMD_SLEEP_INFO: {
        const info = parseGloryFitSleepInfo(bytes);
        if (!info) return;
        if (info.kind === "date") {
          this.sleep.begin(info.date);
          return;
        }
        this.emitSleepSessions();
        this.finish("sleep");
        return;
      }
      default:
        return;
    }
  }

  private handleData(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    if (bytes[0] === GLORYFIT_CMD_SLEEP_STAGES) this.sleep.pushStages(bytes);
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  private async writeCommand(packet: Uint8Array): Promise<void> {
    const write = this.options.device.writeCharacteristicWithResponseForService;
    if (!write) throw new Error("GLORYFIT_WRITE_UNAVAILABLE");
    await write.call(
      this.options.device,
      this.options.profile.commandServiceUuid,
      this.options.profile.commandWriteUuid,
      encodeBase64(packet),
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
            this.options.onFailure?.("init");
            return;
          }
          try {
            handle(decodeBase64(value.value));
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

/** Creates a GloryFit session for a selected profile. */
export function createGloryFitSession(options: GloryFitSessionOptions): GloryFitSession {
  return new GloryFitSession(options);
}
