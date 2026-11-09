/**
 * Live notification capture for generic Bluetooth GATT sensors.
 *
 * Subscribes to the standard measurement characteristics and forwards parsed
 * samples to the caller. There is no history/backfill path: the device is only
 * read while connected, exactly as the generic GATT profiles allow.
 *
 * Upstream service/characteristic UUIDs (Bluetooth SIG):
 * - 0x180D / 0x2A37 Heart Rate Measurement
 * - 0x1810 / 0x2A35 Blood Pressure Measurement
 * - 0x1809 / 0x2A1C Temperature Measurement
 *
 * Source: Gadgetbridge `service/btle/profiles/{heartrate,bloodpressure,thermometer}/`
 * at revision 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  BLOOD_PRESSURE_SERVICE_UUID,
  HEALTH_THERMOMETER_SERVICE_UUID,
  HEART_RATE_SERVICE_UUID,
  normalizeServiceUuid,
  type BleGattRecordType,
} from "../models/ble-gatt";
import {
  parseBloodPressureMeasurement,
  parseHeartRateMeasurement,
  parseTemperatureMeasurement,
  type BleGattSample,
} from "../protocol/ble-gatt";

/** Bluetooth SIG measurement characteristic UUIDs. */
export const HEART_RATE_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb";
export const BLOOD_PRESSURE_MEASUREMENT_UUID = "00002a35-0000-1000-8000-00805f9b34fb";
export const TEMPERATURE_MEASUREMENT_UUID = "00002a1c-0000-1000-8000-00805f9b34fb";

/** Every service a generic GATT sensor may expose. */
export const BLE_GATT_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  HEART_RATE_SERVICE_UUID,
  BLOOD_PRESSURE_SERVICE_UUID,
  HEALTH_THERMOMETER_SERVICE_UUID,
]);

export type BleGattProfile = Readonly<{
  recordType: BleGattRecordType;
  serviceUuid: string;
  characteristicUuid: string;
}>;

export const BLE_GATT_PROFILES: readonly BleGattProfile[] = [
  {
    recordType: "heart_rate",
    serviceUuid: HEART_RATE_SERVICE_UUID,
    characteristicUuid: HEART_RATE_MEASUREMENT_UUID,
  },
  {
    recordType: "blood_pressure",
    serviceUuid: BLOOD_PRESSURE_SERVICE_UUID,
    characteristicUuid: BLOOD_PRESSURE_MEASUREMENT_UUID,
  },
  {
    recordType: "body_temperature",
    serviceUuid: HEALTH_THERMOMETER_SERVICE_UUID,
    characteristicUuid: TEMPERATURE_MEASUREMENT_UUID,
  },
];

type ProfileDevice = Pick<Device, "characteristicsForService">;

/**
 * Picks every measurement profile whose service and notifiable/indicatable
 * characteristic are present on the connected device. Returns an empty array
 * when none match.
 */
export async function selectBleGattProfiles(
  device: ProfileDevice,
  serviceUuids: readonly string[],
): Promise<readonly BleGattProfile[]> {
  const services = new Set(serviceUuids.map(normalizeServiceUuid));
  const selected: BleGattProfile[] = [];
  for (const profile of BLE_GATT_PROFILES) {
    if (!services.has(profile.serviceUuid)) continue;
    const characteristics = await device.characteristicsForService(profile.serviceUuid);
    const match = characteristics.find(
      (characteristic) => normalizeServiceUuid(characteristic.uuid) === profile.characteristicUuid,
    );
    if (!match) continue;
    // Properties are absent in some test doubles; treat that as acceptable and
    // let the native monitor call fail explicitly if it is not notifiable.
    if (match.isNotifiable === false && match.isIndicatable === false) continue;
    selected.push(profile);
  }
  return selected;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(value: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const char of value.replace(/=+$/, "")) {
    const digit = BASE64_ALPHABET.indexOf(char);
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

type MonitorDevice = Pick<Device, "monitorCharacteristicForService">;

function parseProfile(recordType: BleGattRecordType, bytes: Uint8Array, receivedAt: Date) {
  switch (recordType) {
    case "heart_rate":
      return parseHeartRateMeasurement(bytes, receivedAt);
    case "blood_pressure":
      return parseBloodPressureMeasurement(bytes, receivedAt);
    case "body_temperature":
      return parseTemperatureMeasurement(bytes, receivedAt);
  }
}

/**
 * Live capture session. `start()` subscribes to each selected measurement
 * characteristic; `close()` removes every subscription. Parsed samples are
 * delivered synchronously through `onSample`; unparseable or failed
 * notifications are reported through `onFailure` and never throw.
 */
export class BleGattSession {
  private readonly subscriptions = new Set<Subscription>();
  private closed = false;

  constructor(
    private readonly device: MonitorDevice,
    private readonly profiles: readonly BleGattProfile[],
    private readonly onSample: (sample: BleGattSample) => void,
    private readonly onFailure?: (recordType: BleGattRecordType) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (this.closed) return;
    for (const profile of this.profiles) {
      try {
        const subscription = this.device.monitorCharacteristicForService(
          profile.serviceUuid,
          profile.characteristicUuid,
          (error, value: Characteristic | null) => {
            if (this.closed) return;
            if (error || !value?.value) {
              this.onFailure?.(profile.recordType);
              return;
            }
            try {
              const sample = parseProfile(
                profile.recordType,
                decodeBase64(value.value),
                this.now(),
              );
              if (sample) this.onSample(sample);
              else this.onFailure?.(profile.recordType);
            } catch {
              this.onFailure?.(profile.recordType);
            }
          },
        );
        this.subscriptions.add(subscription);
      } catch {
        // One unavailable characteristic must not fail the whole connection.
        this.onFailure?.(profile.recordType);
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
  }
}
