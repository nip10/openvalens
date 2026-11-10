/**
 * Tests for the smart-scale connection sessions.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import type { Characteristic } from "react-native-ble-plx";

import {
  BODY_COMPOSITION_MEASUREMENT_UUID,
  LEFU_COMMAND_UUID,
  LEFU_HISTORY_REQUEST,
  LEFU_MEASUREMENT_UUID,
  MI_WEIGHT_MEASUREMENT_UUID,
  WEIGHT_MEASUREMENT_UUID,
  buildLeFuTimeCommand,
  buildLeFuUnitCommand,
  createBleScaleSession,
  selectBleScaleProfile,
} from "./ble-scale";
import {
  BODY_COMPOSITION_SERVICE_UUID,
  LEFU_SCALE_SERVICE_UUID,
  WEIGHT_SCALE_SERVICE_UUID,
} from "../models/ble-scale";
import type { WeightMeasurementSample } from "../protocol/ble-scale";

function characteristic(uuid: string, notifiable = true): Characteristic {
  return { uuid, isNotifiable: notifiable, isIndicatable: false } as Characteristic;
}

function b64(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function miCompositionFrame(): number[] {
  return [0x01, 0x22, ...u16le(2026), 1, 2, 3, 4, 5, ...u16le(500), ...u16le(14_500)];
}

function miSmartRecord(weightRaw: number, second: number): number[] {
  return [0x20, ...u16le(weightRaw), ...u16le(2026), 1, 2, 3, 4, second];
}

function leFuLiveFrame(): number[] {
  const frame = [0xcf, ...u16be(5000), ...u16le(7250), 0, 0, 0, 0, 0, 0];
  let xor = 0;
  for (let index = 0; index < 10; index += 1) xor ^= frame[index]!;
  frame[10] = xor;
  return frame;
}

test("selectBleScaleProfile picks the Mi Body Composition measurement characteristic", async () => {
  const device = {
    characteristicsForService: async (service: string) =>
      service === BODY_COMPOSITION_SERVICE_UUID
        ? [characteristic(BODY_COMPOSITION_MEASUREMENT_UUID)]
        : [],
  };
  expect(
    await selectBleScaleProfile(
      device,
      [BODY_COMPOSITION_SERVICE_UUID],
      "xiaomi_body_composition_scale_2",
    ),
  ).toEqual({
    kind: "mi_composition",
    serviceUuid: BODY_COMPOSITION_SERVICE_UUID,
    characteristicUuid: BODY_COMPOSITION_MEASUREMENT_UUID,
  });
});

test("selectBleScaleProfile picks both Mi Smart Scale weight characteristics", async () => {
  const device = {
    characteristicsForService: async () => [
      characteristic(WEIGHT_MEASUREMENT_UUID),
      characteristic(MI_WEIGHT_MEASUREMENT_UUID),
    ],
  };
  expect(
    await selectBleScaleProfile(device, [WEIGHT_SCALE_SERVICE_UUID], "xiaomi_smart_scale_2"),
  ).toEqual({
    kind: "mi_smart",
    serviceUuid: WEIGHT_SCALE_SERVICE_UUID,
    characteristicUuids: [WEIGHT_MEASUREMENT_UUID, MI_WEIGHT_MEASUREMENT_UUID],
  });
});

test("selectBleScaleProfile requires the LeFu measurement and command characteristics", async () => {
  const device = {
    characteristicsForService: async () => [characteristic(LEFU_MEASUREMENT_UUID)],
  };
  expect(
    await selectBleScaleProfile(device, [LEFU_SCALE_SERVICE_UUID], "lefu_health_scale"),
  ).toBeNull();

  const complete = {
    characteristicsForService: async () => [
      characteristic(LEFU_MEASUREMENT_UUID),
      characteristic(LEFU_COMMAND_UUID),
    ],
  };
  expect(
    await selectBleScaleProfile(complete, [LEFU_SCALE_SERVICE_UUID], "lefu_health_scale"),
  ).toEqual({
    kind: "lefu",
    serviceUuid: LEFU_SCALE_SERVICE_UUID,
    characteristicUuid: LEFU_MEASUREMENT_UUID,
    commandUuid: LEFU_COMMAND_UUID,
  });
});

test("selectBleScaleProfile returns null for a missing service", async () => {
  const device = { characteristicsForService: async () => [] };
  expect(
    await selectBleScaleProfile(
      device,
      ["0000180d-0000-1000-8000-00805f9b34fb"],
      "xiaomi_smart_scale_2",
    ),
  ).toBeNull();
});

test("MiCompositionScaleSession subscribes, parses and emits", async () => {
  const callbacks = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  let removed = 0;
  const device = {
    monitorCharacteristicForService: (
      _service: string,
      characteristicUuid: string,
      callback: (error: unknown, value: Characteristic | null) => void,
    ) => {
      callbacks.set(characteristicUuid, callback);
      return { remove: () => void (removed += 1) };
    },
  };
  const samples: WeightMeasurementSample[] = [];
  const now = new Date(2026, 0, 2, 3, 4, 5, 0);
  const session = createBleScaleSession(
    device as never,
    {
      kind: "mi_composition",
      serviceUuid: BODY_COMPOSITION_SERVICE_UUID,
      characteristicUuid: BODY_COMPOSITION_MEASUREMENT_UUID,
    },
    (sample) => samples.push(sample),
    undefined,
    () => now,
  );
  session.start();
  const callback = callbacks.get(BODY_COMPOSITION_MEASUREMENT_UUID);
  expect(callback).toBeDefined();
  callback!(null, { value: b64(miCompositionFrame()) } as Characteristic);
  expect(samples).toHaveLength(1);
  expect(samples[0]).toMatchObject({
    type: "weight_measurement",
    weightKg: 72.5,
    impedanceOhm: 500,
  });
  await session.close();
  expect(removed).toBe(1);
});

test("MiSmartScaleSession emits both records in one packet", async () => {
  const callbacks = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  const device = {
    monitorCharacteristicForService: (
      _service: string,
      characteristicUuid: string,
      callback: (error: unknown, value: Characteristic | null) => void,
    ) => {
      callbacks.set(characteristicUuid, callback);
      return { remove() {} };
    },
  };
  const samples: WeightMeasurementSample[] = [];
  const session = createBleScaleSession(
    device as never,
    {
      kind: "mi_smart",
      serviceUuid: WEIGHT_SCALE_SERVICE_UUID,
      characteristicUuids: [WEIGHT_MEASUREMENT_UUID],
    },
    (sample) => samples.push(sample),
  );
  session.start();
  callbacks.get(WEIGHT_MEASUREMENT_UUID)!(null, {
    value: b64([...miSmartRecord(14_500, 5), ...miSmartRecord(14_600, 10)]),
  } as Characteristic);
  expect(samples.map((sample) => sample.weightKg)).toEqual([72.5, 73]);
  await session.close();
});

test("LeFuScaleSession writes the upstream init sequence in order", async () => {
  const writes: { service: string; characteristic: string; value: string }[] = [];
  const device = {
    monitorCharacteristicForService: () => ({ remove() {} }),
    writeCharacteristicWithResponseForService: async (
      service: string,
      characteristicUuid: string,
      value: string,
    ) => {
      writes.push({ service, characteristic: characteristicUuid, value });
      return {} as Characteristic;
    },
  };
  const now = new Date(2026, 0, 2, 3, 4, 5, 0);
  const session = createBleScaleSession(
    device as never,
    {
      kind: "lefu",
      serviceUuid: LEFU_SCALE_SERVICE_UUID,
      characteristicUuid: LEFU_MEASUREMENT_UUID,
      commandUuid: LEFU_COMMAND_UUID,
    },
    () => undefined,
    undefined,
    () => now,
  );
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes).toHaveLength(3);
  expect(writes.every((write) => write.service === LEFU_SCALE_SERVICE_UUID)).toBe(true);
  expect(writes.every((write) => write.characteristic === LEFU_COMMAND_UUID)).toBe(true);
  expect([...Buffer.from(writes[0]!.value, "base64")]).toEqual([...buildLeFuUnitCommand()]);
  expect([...Buffer.from(writes[1]!.value, "base64")]).toEqual([...buildLeFuTimeCommand(now)]);
  expect([...Buffer.from(writes[2]!.value, "base64")]).toEqual([...LEFU_HISTORY_REQUEST]);
  await session.close();
});

test("LeFuScaleSession parses notifications and dedupes the duplicate final frame", async () => {
  const callbacks = new Map<string, (error: unknown, value: Characteristic | null) => void>();
  const device = {
    monitorCharacteristicForService: (
      _service: string,
      characteristicUuid: string,
      callback: (error: unknown, value: Characteristic | null) => void,
    ) => {
      callbacks.set(characteristicUuid, callback);
      return { remove() {} };
    },
    writeCharacteristicWithResponseForService: async () => ({}) as Characteristic,
  };
  const samples: WeightMeasurementSample[] = [];
  const now = new Date(2026, 0, 2, 3, 4, 5, 0);
  const session = createBleScaleSession(
    device as never,
    {
      kind: "lefu",
      serviceUuid: LEFU_SCALE_SERVICE_UUID,
      characteristicUuid: LEFU_MEASUREMENT_UUID,
      commandUuid: LEFU_COMMAND_UUID,
    },
    (sample) => samples.push(sample),
    undefined,
    () => now,
  );
  session.start();
  const callback = callbacks.get(LEFU_MEASUREMENT_UUID)!;
  callback(null, { value: b64(leFuLiveFrame()) } as Characteristic);
  callback(null, { value: b64(leFuLiveFrame()) } as Characteristic);
  expect(samples).toHaveLength(1);
  expect(samples[0]).toMatchObject({ weightKg: 72.5, impedanceOhm: 500 });
  await session.close();
});

test("LeFu command builders match upstream byte layouts", () => {
  const unit = buildLeFuUnitCommand();
  expect(Array.from(unit.slice(0, 4))).toEqual([0xfd, 0x37, 0x00, 0x01]);
  let xor = 0;
  for (let index = 0; index < 10; index += 1) xor ^= unit[index]!;
  expect(unit[10]).toBe(xor);

  expect([...buildLeFuTimeCommand(new Date(2026, 0, 2, 3, 4, 5, 0))]).toEqual([
    0xf1, 0x07, 0xea, 0x01, 0x02, 0x03, 0x04, 0x05,
  ]);
  expect([...LEFU_HISTORY_REQUEST]).toEqual([0xf2, 0x00]);
});
