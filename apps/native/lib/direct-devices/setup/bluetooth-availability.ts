import type { HelioSetupSnapshot } from "./types";

/**
 * Whether this phone has Bluetooth LE hardware (#524). Bluetooth is optional
 * in the Android manifest, so phones and tablets without it can install the
 * app. An unknown answer (the check itself failed) counts as available and
 * leaves it to the radio's own state.
 */
export function detectBluetoothLeHardware(
  check: () => boolean = () =>
    (
      require("../../../modules/bt-classic") as typeof import("../../../modules/bt-classic")
    ).hasBluetoothLeHardware(),
): boolean {
  try {
    return check();
  } catch {
    return true;
  }
}

/**
 * Settings › Devices shows "Bluetooth isn't available on this device" in place
 * of the nearby-device scan when the hardware is missing, or when the radio
 * reported it unsupported.
 */
export function isDirectBluetoothUnavailable(input: {
  hasBluetoothLe: boolean;
  bluetooth: HelioSetupSnapshot["bluetooth"];
}): boolean {
  return !input.hasBluetoothLe || input.bluetooth === "unsupported";
}
