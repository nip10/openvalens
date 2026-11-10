/*  Copyright (C) 2024-2026 Damien Gaignon, Martin.JM, Vitalii Tomin

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * Huawei/Honor BLE link adapter.
 *
 * The pure codec (UUIDs, TLV, 0x5A framing, CRC16, crypto wrapper) lives in
 * `protocol/huawei.ts`; this module re-exports it for the existing imports and
 * adds the `react-native-ble-plx` profile selection and write queue.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import { HUAWEI_BLE_PROFILES, type HuaweiBleProfile } from "../protocol/huawei";

export * from "../protocol/huawei";

/**
 * Picks the profile whose service and read/write characteristics are present.
 * `preferVendor` puts the Honor new-protocol UUIDs first for the coordinators
 * that override `isNewHonorProtocol()`.
 */
export async function selectHuaweiProfile(
  device: Pick<Device, "characteristicsForService">,
  serviceUuids: readonly string[],
  preferVendor?: "huawei" | "honor",
): Promise<HuaweiBleProfile | null> {
  const services = new Set(serviceUuids.map((uuid) => uuid.toLowerCase()));
  const profiles = preferVendor
    ? [...HUAWEI_BLE_PROFILES].sort((left, right) =>
        left.vendor === preferVendor ? -1 : right.vendor === preferVendor ? 1 : 0,
      )
    : HUAWEI_BLE_PROFILES;
  for (const profile of profiles) {
    if (!services.has(profile.serviceUuid)) continue;
    const characteristics = await device.characteristicsForService(profile.serviceUuid);
    const uuids = new Set(
      characteristics.map((characteristic) => characteristic.uuid.toLowerCase()),
    );
    if (uuids.has(profile.readUuid) && uuids.has(profile.writeUuid)) return profile;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Link adapter
// ---------------------------------------------------------------------------

type WriteDevice = Pick<
  Device,
  | "monitorCharacteristicForService"
  | "writeCharacteristicWithResponseForService"
  | "writeCharacteristicWithoutResponseForService"
> & { mtu?: number };

type TransactionManager = { cancelTransaction(id: string): void };

export interface HuaweiLink {
  readonly maxWriteBytes: number;
  subscribe(onBytes: (bytes: Uint8Array) => void, onFailure: () => void): () => void;
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
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

function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += BASE64_ALPHABET[first >> 2]!;
    out += BASE64_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)]!;
    out +=
      second === undefined
        ? "=="
        : BASE64_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)]! +
          (third === undefined ? "=" : BASE64_ALPHABET[third & 63]!);
  }
  return out;
}

export class NativeHuaweiLink implements HuaweiLink {
  readonly maxWriteBytes: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions = new Set<Subscription>();
  private transaction = 0;

  constructor(
    private readonly device: WriteDevice,
    private readonly profile: HuaweiBleProfile,
    private readonly manager?: TransactionManager,
  ) {
    this.maxWriteBytes = Math.min(512, Math.max(23, device.mtu ?? 23)) - 3;
  }

  subscribe(onBytes: (bytes: Uint8Array) => void, onFailure: () => void): () => void {
    const subscription = this.device.monitorCharacteristicForService(
      this.profile.serviceUuid,
      this.profile.readUuid,
      (error, value: Characteristic | null) => {
        if (error || !value?.value) {
          onFailure();
          return;
        }
        try {
          onBytes(decodeBase64(value.value));
        } catch {
          onFailure();
        }
      },
    );
    this.subscriptions.add(subscription);
    return () => {
      subscription.remove();
      this.subscriptions.delete(subscription);
    };
  }

  write(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    const task = this.queue.then(async () => {
      if (signal.aborted) throw new Error("CANCELLED");
      const transactionId = `huawei-${++this.transaction}`;
      const cancel = () => {
        try {
          this.manager?.cancelTransaction(transactionId);
        } catch {
          // Native cancellation is best effort.
        }
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        await this.device.writeCharacteristicWithResponseForService(
          this.profile.serviceUuid,
          this.profile.writeUuid,
          encodeBase64(bytes),
          transactionId,
        );
      } finally {
        signal.removeEventListener("abort", cancel);
      }
      if (signal.aborted) throw new Error("CANCELLED");
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  async close(): Promise<void> {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    await this.queue;
  }
}
