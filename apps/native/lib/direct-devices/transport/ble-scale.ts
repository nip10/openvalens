/**
 * Connection sessions for Bluetooth smart scales.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Every model in this family is a
 * GATT connection device; there is no advertisement-based capture.
 *
 * - Mi Body Composition Scale 2: subscribe to Body Composition Measurement
 *   0x2A9C on service 0x181B and parse 13-byte frames.
 * - Mi Smart Scale 2: subscribe to Weight Measurement 0x2A2F on service 0x181D
 *   (and the Xiaomi 0x1530 variant) and run the 10-byte record loop. Live and
 *   stored measurements share the same characteristic and layout. Upstream's
 *   config characteristic 0x1542 only selects the display unit, small-object
 *   handling and history reset (`06 [config] 00 [value]`); it is not needed
 *   for live weight capture and is not written here. Upstream also requests
 *   stored history at init by writing `01 [user id]` / `02` to 0x2A2F; that
 *   request needs the upstream account's numeric user id and is not made, so
 *   only live and already-notified records are captured.
 * - LeFu "Health Scale": subscribe to 0xFFF4, then write the upstream init
 *   sequence to 0xFFF1: unit command, time command, history request. Frames
 *   are parsed and deduped with upstream's windows.
 *
 * One unavailable characteristic must not fail the whole connection; failures
 * are reported through `onFailure` and never thrown.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  BODY_COMPOSITION_SERVICE_UUID,
  LEFU_SCALE_SERVICE_UUID,
  MI_SCALE_VENDOR_SERVICE_UUID,
  WEIGHT_SCALE_SERVICE_UUID,
  type BleScaleModelId,
} from "../models/ble-scale";
import { normalizeServiceUuid } from "../models/ble-gatt";
import {
  createLeFuFrameFilter,
  parseLeFuFrame,
  parseMiCompositionScaleFrame,
  parseMiSmartScaleRecords,
  type WeightMeasurementSample,
} from "../protocol/ble-scale";
import { decodeBase64 } from "./ble-gatt-sensors";

/** Bluetooth SIG Body Composition Measurement (Mi Body Composition Scale 2). */
export const BODY_COMPOSITION_MEASUREMENT_UUID = "00002a9c-0000-1000-8000-00805f9b34fb";
/** Bluetooth SIG Weight Measurement (Mi Smart Scale 2 live/history). */
export const WEIGHT_MEASUREMENT_UUID = "00002a2f-0000-1000-8000-00805f9b34fb";
/** Xiaomi-base Weight Measurement used for stored history. */
export const MI_WEIGHT_MEASUREMENT_UUID = "00002a2f-0000-3512-2118-0009af100700";
/** Xiaomi scale config characteristic; documented but not written. */
export const MI_SCALE_CONFIG_UUID = "00001542-0000-3512-2118-0009af100700";
/** LeFu measurement notifications. */
export const LEFU_MEASUREMENT_UUID = "0000fff4-0000-1000-8000-00805f9b34fb";
/** LeFu command writes. */
export const LEFU_COMMAND_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";

/** Every service a registered smart scale may expose. */
export const BLE_SCALE_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  BODY_COMPOSITION_SERVICE_UUID,
  WEIGHT_SCALE_SERVICE_UUID,
  MI_SCALE_VENDOR_SERVICE_UUID,
  LEFU_SCALE_SERVICE_UUID,
]);

export type BleScaleProfile =
  | Readonly<{ kind: "mi_composition"; serviceUuid: string; characteristicUuid: string }>
  | Readonly<{ kind: "mi_smart"; serviceUuid: string; characteristicUuids: readonly string[] }>
  | Readonly<{
      kind: "lefu";
      serviceUuid: string;
      characteristicUuid: string;
      commandUuid: string;
    }>;

type ProfileDevice = Pick<Device, "characteristicsForService">;

async function characteristicUuidsFor(
  device: ProfileDevice,
  serviceUuid: string,
): Promise<readonly string[]> {
  const characteristics = await device.characteristicsForService(serviceUuid);
  return characteristics.map((characteristic) => characteristic.uuid.toLowerCase());
}

/**
 * Picks the capture profile for a model from the connected device's services.
 * Returns null when the expected service/characteristic is absent. Models with
 * no capture implementation (empty `serviceUuids`) never reach this function.
 */
export async function selectBleScaleProfile(
  device: ProfileDevice,
  serviceUuids: readonly string[],
  modelId: BleScaleModelId,
): Promise<BleScaleProfile | null> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));

  if (modelId === "xiaomi_body_composition_scale_2") {
    if (!services.has(BODY_COMPOSITION_SERVICE_UUID)) return null;
    const characteristics = await characteristicUuidsFor(device, BODY_COMPOSITION_SERVICE_UUID);
    if (!characteristics.includes(BODY_COMPOSITION_MEASUREMENT_UUID)) return null;
    return {
      kind: "mi_composition",
      serviceUuid: BODY_COMPOSITION_SERVICE_UUID,
      characteristicUuid: BODY_COMPOSITION_MEASUREMENT_UUID,
    };
  }

  if (modelId === "xiaomi_smart_scale_2") {
    const serviceUuid = services.has(WEIGHT_SCALE_SERVICE_UUID)
      ? WEIGHT_SCALE_SERVICE_UUID
      : services.has(MI_SCALE_VENDOR_SERVICE_UUID)
        ? MI_SCALE_VENDOR_SERVICE_UUID
        : null;
    if (!serviceUuid) return null;
    const characteristics = await characteristicUuidsFor(device, serviceUuid);
    const matches = [WEIGHT_MEASUREMENT_UUID, MI_WEIGHT_MEASUREMENT_UUID].filter((uuid) =>
      characteristics.includes(uuid),
    );
    if (!matches.length) return null;
    return { kind: "mi_smart", serviceUuid, characteristicUuids: matches };
  }

  if (modelId === "lefu_health_scale") {
    if (!services.has(LEFU_SCALE_SERVICE_UUID)) return null;
    const characteristics = await characteristicUuidsFor(device, LEFU_SCALE_SERVICE_UUID);
    if (
      !characteristics.includes(LEFU_MEASUREMENT_UUID) ||
      !characteristics.includes(LEFU_COMMAND_UUID)
    )
      return null;
    return {
      kind: "lefu",
      serviceUuid: LEFU_SCALE_SERVICE_UUID,
      characteristicUuid: LEFU_MEASUREMENT_UUID,
      commandUuid: LEFU_COMMAND_UUID,
    };
  }

  return null;
}

/** A capture session with a synchronous start and an async close. */
export interface BleScaleSession {
  start(): void;
  close(): Promise<void>;
}

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

// ---------------------------------------------------------------------------
// LeFu command builders (upstream OneByoneScaleDeviceSupport)
// ---------------------------------------------------------------------------

/** `FD 37 [unit] [group] 00 00 00 00 00 00 [xor]`, unit 0x00 = kg. */
export function buildLeFuUnitCommand(): Uint8Array {
  const command = Uint8Array.of(0xfd, 0x37, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0);
  let xor = 0;
  for (let index = 0; index < command.length - 1; index += 1) xor ^= command[index]!;
  command[command.length - 1] = xor;
  return command;
}

/** `F1 [year BE] [month] [day] [hour] [minute] [second]`, local time. */
export function buildLeFuTimeCommand(now: Date = new Date()): Uint8Array {
  const year = now.getFullYear();
  return Uint8Array.of(
    0xf1,
    (year >> 8) & 0xff,
    year & 0xff,
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  );
}

/** `F2 00`: request stored measurements. */
export const LEFU_HISTORY_REQUEST: Uint8Array = Uint8Array.of(0xf2, 0x00);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Shared subscription bookkeeping. */
abstract class BaseScaleSession implements BleScaleSession {
  protected readonly subscriptions = new Set<Subscription>();
  protected closed = false;

  constructor(
    protected readonly onFailure?: (recordType: "weight_measurement") => void,
    protected readonly now: () => Date = () => new Date(),
  ) {}

  abstract start(): void;

  async close(): Promise<void> {
    this.closed = true;
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
  }

  protected monitor(
    device: MonitorDevice,
    serviceUuid: string,
    characteristicUuid: string,
    handle: (bytes: Uint8Array) => void,
  ): void {
    if (this.closed) return;
    try {
      const subscription = device.monitorCharacteristicForService(
        serviceUuid,
        characteristicUuid,
        (error, value: Characteristic | null) => {
          if (this.closed) return;
          if (error || !value?.value) {
            this.onFailure?.("weight_measurement");
            return;
          }
          try {
            handle(decodeBase64(value.value));
          } catch {
            this.onFailure?.("weight_measurement");
          }
        },
      );
      this.subscriptions.add(subscription);
    } catch {
      this.onFailure?.("weight_measurement");
    }
  }
}

/** Mi Body Composition Scale 2: 0x2A9C notifications, one frame each. */
export class MiCompositionScaleSession extends BaseScaleSession {
  constructor(
    private readonly device: MonitorDevice,
    private readonly profile: Extract<BleScaleProfile, { kind: "mi_composition" }>,
    private readonly onSample: (sample: WeightMeasurementSample) => void,
    onFailure?: (recordType: "weight_measurement") => void,
    now?: () => Date,
  ) {
    super(onFailure, now);
  }

  start(): void {
    this.monitor(
      this.device,
      this.profile.serviceUuid,
      this.profile.characteristicUuid,
      (bytes) => {
        const sample = parseMiCompositionScaleFrame(bytes, this.now());
        if (sample) this.onSample(sample);
        else this.onFailure?.("weight_measurement");
      },
    );
  }
}

/** Mi Smart Scale 2: 0x2A2F notifications, one or two records per packet. */
export class MiSmartScaleSession extends BaseScaleSession {
  constructor(
    private readonly device: MonitorDevice,
    private readonly profile: Extract<BleScaleProfile, { kind: "mi_smart" }>,
    private readonly onSample: (sample: WeightMeasurementSample) => void,
    onFailure?: (recordType: "weight_measurement") => void,
    now?: () => Date,
  ) {
    super(onFailure, now);
  }

  start(): void {
    for (const characteristicUuid of this.profile.characteristicUuids) {
      this.monitor(this.device, this.profile.serviceUuid, characteristicUuid, (bytes) => {
        // 0x03 is the history-complete command, not a measurement.
        if (bytes.length === 1 && bytes[0] === 0x03) return;
        const samples = parseMiSmartScaleRecords(bytes, this.now());
        if (samples.length) for (const sample of samples) this.onSample(sample);
        else this.onFailure?.("weight_measurement");
      });
    }
  }
}

/** LeFu "Health Scale": 0xFFF4 notifications plus the 0xFFF1 init sequence. */
export class LeFuScaleSession extends BaseScaleSession {
  private readonly filter = createLeFuFrameFilter();

  constructor(
    private readonly device: MonitorDevice & Partial<WriteDevice>,
    private readonly profile: Extract<BleScaleProfile, { kind: "lefu" }>,
    private readonly onSample: (sample: WeightMeasurementSample) => void,
    onFailure?: (recordType: "weight_measurement") => void,
    now?: () => Date,
  ) {
    super(onFailure, now);
  }

  start(): void {
    this.monitor(
      this.device,
      this.profile.serviceUuid,
      this.profile.characteristicUuid,
      (bytes) => {
        const frame = parseLeFuFrame(bytes, this.now());
        // Settling frames, acks and bad checksums are expected traffic.
        if (!frame) return;
        if (this.filter.accept(frame)) this.onSample(frame);
      },
    );
    void this.initialize();
  }

  /** Writes unit, time and history request in upstream order. */
  async initialize(): Promise<void> {
    const write = this.device.writeCharacteristicWithResponseForService;
    if (!write) return;
    try {
      for (const command of [
        buildLeFuUnitCommand(),
        buildLeFuTimeCommand(this.now()),
        LEFU_HISTORY_REQUEST,
      ]) {
        if (this.closed) return;
        await write.call(
          this.device,
          this.profile.serviceUuid,
          this.profile.commandUuid,
          encodeBase64(command),
        );
      }
    } catch {
      this.onFailure?.("weight_measurement");
    }
  }
}

/** Builds the capture session for a selected profile. */
export function createBleScaleSession(
  device: MonitorDevice & Partial<WriteDevice>,
  profile: BleScaleProfile,
  onSample: (sample: WeightMeasurementSample) => void,
  onFailure?: (recordType: "weight_measurement") => void,
  now?: () => Date,
): BleScaleSession {
  switch (profile.kind) {
    case "mi_composition":
      return new MiCompositionScaleSession(device, profile, onSample, onFailure, now);
    case "mi_smart":
      return new MiSmartScaleSession(device, profile, onSample, onFailure, now);
    case "lefu":
      return new LeFuScaleSession(device, profile, onSample, onFailure, now);
  }
}
