import { expect, test } from "bun:test";

import { detectBluetoothLeHardware, isDirectBluetoothUnavailable } from "./bluetooth-availability";

test("the hardware check reports a missing BLE radio and treats a failed check as available", () => {
  expect(detectBluetoothLeHardware(() => true)).toBe(true);
  expect(detectBluetoothLeHardware(() => false)).toBe(false);
  expect(
    detectBluetoothLeHardware(() => {
      throw new Error("no native module");
    }),
  ).toBe(true);
});

test("Settings › Devices says Bluetooth is unavailable without BLE hardware or when the radio says so (#524)", () => {
  expect(isDirectBluetoothUnavailable({ hasBluetoothLe: false, bluetooth: "unknown" })).toBe(true);
  expect(isDirectBluetoothUnavailable({ hasBluetoothLe: true, bluetooth: "unsupported" })).toBe(
    true,
  );
  for (const bluetooth of ["unknown", "powered_on", "powered_off", "unauthorized"] as const)
    expect(isDirectBluetoothUnavailable({ hasBluetoothLe: true, bluetooth })).toBe(false);
});
