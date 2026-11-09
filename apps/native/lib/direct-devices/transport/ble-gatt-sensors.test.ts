/**
 * Tests for the generic GATT live-capture session.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import { BLE_GATT_PROFILES, BleGattSession, selectBleGattProfiles } from "./ble-gatt-sensors";

const HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";

function characteristic(uuid: string, notifiable = true): Characteristic {
  return { uuid, isNotifiable: notifiable, isIndicatable: false } as Characteristic;
}

test("selectBleGattProfiles picks measurement characteristics that notify or indicate", async () => {
  const device = {
    characteristicsForService: async (service: string) =>
      service === HR_SERVICE ? [characteristic(HR_MEASUREMENT)] : [],
  };
  const profiles = await selectBleGattProfiles(device, [HR_SERVICE]);
  expect(profiles).toEqual([BLE_GATT_PROFILES[0]!]);
});

test("selectBleGattProfiles skips a characteristic that is neither notifiable nor indicatable", async () => {
  const device = {
    characteristicsForService: async () => [
      { uuid: HR_MEASUREMENT, isNotifiable: false, isIndicatable: false } as Characteristic,
    ],
  };
  expect(await selectBleGattProfiles(device, [HR_SERVICE])).toEqual([]);
});

test("BleGattSession decodes notifications and emits parsed samples", async () => {
  const callbacks = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  let removed = 0;
  const device = {
    monitorCharacteristicForService: (
      _service: string,
      characteristicUuid: string,
      callback: (error: unknown, value: Characteristic | null) => void,
    ) => {
      callbacks.set(characteristicUuid, callback);
      return {
        remove() {
          removed += 1;
        },
      };
    },
  };
  const samples: unknown[] = [];
  const failures: string[] = [];
  const now = new Date("2026-01-02T03:04:05.000Z");
  const session = new BleGattSession(
    device as never,
    [BLE_GATT_PROFILES[0]!],
    (sample) => samples.push(sample),
    (recordType) => failures.push(recordType),
    () => now,
  );
  session.start();
  const callback = callbacks.get(HR_MEASUREMENT);
  expect(callback).toBeDefined();
  callback!(null, {
    value: Buffer.from([0x00, 72]).toString("base64"),
  } as Characteristic);
  expect(samples).toEqual([
    {
      type: "heart_rate",
      time: now.toISOString(),
      bpm: 72,
      sensorContact: "unsupported",
      energyExpended: null,
      rrIntervalsMs: [],
    },
  ]);
  // Unparseable payloads are reported, not thrown.
  callback!(null, { value: Buffer.from([0x00, 0]).toString("base64") } as Characteristic);
  expect(failures).toEqual(["heart_rate"]);
  await session.close();
  expect(removed).toBe(1);
});
