/*  Copyright (C) 2024-2026 Daniele Gobbetti, José Rebelo, Thomas Kuehne

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
 * Garmin BLE transport, COBS framing and GFDI packet codec.
 *
 * Upstream:
 * - `CommunicatorV1.java` / `CommunicatorV2.java` (service and characteristic
 *   UUIDs, COBS chunking, V2 ML_GFDI handle prefix)
 * - `CobsCoDec.java` (leading/trailing 0x00 COBS variant)
 * - `GFDIMessage.java` (2-byte little-endian length, message type, CRC-16/ARC)
 * - `ChecksumCalculator.java` (CRC-16/ARC nibble table)
 * - `GarminSupport.java` (V2-first communicator selection, MTU 515)
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/garmin/
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-09
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Auth: there is no application-level key exchange in the wired path. Garmin
 * devices may send GFDI `AUTH_NEGOTIATION` (message type 5101) with an
 * opaque flag bitmask; Gadgetbridge replies with an ACK whose status is
 * `GUESS_OK` and an all-zero flag bitmask, without deriving or storing a key
 * (`AuthNegotiationMessage.java` / `AuthNegotiationStatusMessage.java`). The
 * GFDI enum also reserves STK/LTK/SESSION_* message ids 5102-5112, but
 * `GFDIMessage.parseIncoming` does not implement them; they fall through to
 * `UnhandledMessage`. BLE bonding/pairing is left to the operating system, and
 * `GarminCoordinator.suggestUnbindBeforePair()` returns false. The separate
 * Garmin Connect OAuth token is an HTTP concern for AGPS/weather and is not
 * part of the BLE link.
 *
 * This is the connection foundation only. History/sync is a later milestone.
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  GarminCobsDecoder,
  encodeGarminGfdiWrites,
  type GarminGfdiFrame,
} from "../protocol/garmin";

// ---------------------------------------------------------------------------
// UUIDs and profiles
// ---------------------------------------------------------------------------

/** Bluetooth SIG company id for Garmin International, Inc. */
export const GARMIN_COMPANY_ID = 0x0087;

/** GFDI v0, seen on Vivofit / Forerunner 620. */
export const GARMIN_GFDI_V0_SERVICE_UUID = "9b012401-bc30-ce9a-e111-0f67e491abde";
export const GARMIN_GFDI_V0_SEND_UUID = "df334c80-e6a7-d082-274d-78fc66f85e16";
export const GARMIN_GFDI_V0_RECEIVE_UUID = "4acbcd28-7425-868e-f447-915c8f00d0cb";

/** GFDI v1, seen on Vivomove HR. */
export const GARMIN_GFDI_V1_SERVICE_UUID = "6a4e2401-667b-11e3-949a-0800200c9a66";
export const GARMIN_GFDI_V1_SEND_UUID = "6a4e4c80-667b-11e3-949a-0800200c9a66";
export const GARMIN_GFDI_V1_RECEIVE_UUID = "6a4ecd28-667b-11e3-949a-0800200c9a66";

/** ML_GFDI (v2), used by current watches. */
export const GARMIN_ML_GFDI_SERVICE_UUID = "6a4e2800-667b-11e3-949a-0800200c9a66";
export const GARMIN_ML_RECEIVE_UUIDS: readonly string[] = [
  "6a4e2810-667b-11e3-949a-0800200c9a66",
  "6a4e2811-667b-11e3-949a-0800200c9a66",
  "6a4e2812-667b-11e3-949a-0800200c9a66",
  "6a4e2813-667b-11e3-949a-0800200c9a66",
  "6a4e2814-667b-11e3-949a-0800200c9a66",
];
export const GARMIN_ML_SEND_UUIDS: readonly string[] = [
  "6a4e2820-667b-11e3-949a-0800200c9a66",
  "6a4e2821-667b-11e3-949a-0800200c9a66",
  "6a4e2822-667b-11e3-949a-0800200c9a66",
  "6a4e2823-667b-11e3-949a-0800200c9a66",
  "6a4e2824-667b-11e3-949a-0800200c9a66",
];

/** Connect IQ watch-app channel. Shares the v1 send/receive characteristics. */
export const GARMIN_WATCH_APPS_SERVICE_UUID = "6a4e8022-667b-11e3-949a-0800200c9a66";
export const GARMIN_WATCH_APPS_SEND_UUID = GARMIN_GFDI_V1_SEND_UUID;
export const GARMIN_WATCH_APPS_RECEIVE_UUID = GARMIN_GFDI_V1_RECEIVE_UUID;

/** Every service UUID a Garmin health wearable may advertise. */
export const GARMIN_BLE_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  GARMIN_GFDI_V0_SERVICE_UUID,
  GARMIN_GFDI_V1_SERVICE_UUID,
  GARMIN_ML_GFDI_SERVICE_UUID,
  GARMIN_WATCH_APPS_SERVICE_UUID,
]);

export type GarminProtocol = "v0" | "v1" | "v2";

export type GarminBleProfile = Readonly<{
  protocol: GarminProtocol;
  serviceUuid: string;
  readUuid: string;
  writeUuid: string;
  /** V2 ML_GFDI prefixes every write chunk with a GFDI handle byte. */
  handlePrefixed: boolean;
}>;

/**
 * Profiles in upstream selection order: every ML_GFDI pair first, then v1,
 * then v0. `GarminSupport.initializeDevice()` tries V2 before V1.
 */
export const GARMIN_BLE_PROFILES: readonly GarminBleProfile[] = [
  ...GARMIN_ML_RECEIVE_UUIDS.map((readUuid, index) => ({
    protocol: "v2" as const,
    serviceUuid: GARMIN_ML_GFDI_SERVICE_UUID,
    readUuid,
    writeUuid: GARMIN_ML_SEND_UUIDS[index]!,
    handlePrefixed: true,
  })),
  {
    protocol: "v1",
    serviceUuid: GARMIN_GFDI_V1_SERVICE_UUID,
    readUuid: GARMIN_GFDI_V1_RECEIVE_UUID,
    writeUuid: GARMIN_GFDI_V1_SEND_UUID,
    handlePrefixed: false,
  },
  {
    protocol: "v0",
    serviceUuid: GARMIN_GFDI_V0_SERVICE_UUID,
    readUuid: GARMIN_GFDI_V0_RECEIVE_UUID,
    writeUuid: GARMIN_GFDI_V0_SEND_UUID,
    handlePrefixed: false,
  },
];

/**
 * Picks the first profile whose service and read/write characteristics are
 * present on the connected device. Returns null when none match.
 */
export async function selectGarminProfile(
  device: Pick<Device, "characteristicsForService">,
  serviceUuids: readonly string[],
): Promise<GarminBleProfile | null> {
  const services = new Set(serviceUuids.map((uuid) => uuid.toLowerCase()));
  for (const profile of GARMIN_BLE_PROFILES) {
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
// Codec re-exports (protocol/garmin.ts)
// ---------------------------------------------------------------------------

export {
  chunkGarminPayload,
  decodeGarminCobsFrame,
  decodeGarminGfdiFrame,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  encodeGarminGfdiWrites,
  garminCrc16,
  GARMIN_AUTH_NEGOTIATION_GUESS_OK,
  GARMIN_AUTH_NEGOTIATION_MESSAGE_TYPE,
  GarminCobsDecoder,
} from "../protocol/garmin";
export type { GarminGfdiFrame, GarminWriteOptions } from "../protocol/garmin";

// ---------------------------------------------------------------------------
// Link adapter
// ---------------------------------------------------------------------------

type WriteDevice = Pick<
  Device,
  "monitorCharacteristicForService" | "writeCharacteristicWithResponseForService"
> & { mtu?: number };

type TransactionManager = { cancelTransaction(id: string): void };

export interface GarminLink {
  readonly maxWriteBytes: number;
  subscribe(onMessage: (bytes: Uint8Array) => void, onFailure: () => void): () => void;
  /**
   * Raw BLE notifications, still carrying the V2 GFDI handle prefix. ML
   * handle-management messages are not COBS/GFDI framed, so they can only be
   * routed from this level.
   */
  subscribeRaw(onNotification: (bytes: Uint8Array) => void, onFailure: () => void): () => void;
  /** Writes one GFDI frame, COBS-encoded and chunked for the profile. */
  write(frame: GarminGfdiFrame, signal: AbortSignal): Promise<void>;
  /** Writes raw bytes (ML handle management); no COBS, no handle prefix. */
  writeRaw(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Sets the ML GFDI handle once the device has registered the service. */
  setHandle(handle: number): void;
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

export class NativeGarminLink implements GarminLink {
  readonly maxWriteBytes: number;
  readonly protocol: GarminBleProfile["protocol"];
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions = new Set<Subscription>();
  private readonly decoder = new GarminCobsDecoder();
  private transaction = 0;
  private handle: number | undefined;

  constructor(
    private readonly device: WriteDevice,
    private readonly profile: GarminBleProfile,
    private readonly manager?: TransactionManager,
    handle?: number,
  ) {
    this.maxWriteBytes = Math.min(512, Math.max(23, device.mtu ?? 23)) - 3;
    this.protocol = profile.protocol;
    this.handle = handle;
  }

  setHandle(handle: number): void {
    if (!Number.isInteger(handle) || handle < 0 || handle > 0xff) throw new Error("GARMIN_HANDLE");
    this.handle = handle;
  }

  subscribe(onMessage: (bytes: Uint8Array) => void, onFailure: () => void): () => void {
    const subscription = this.device.monitorCharacteristicForService(
      this.profile.serviceUuid,
      this.profile.readUuid,
      (error, value: Characteristic | null) => {
        if (error || !value?.value) {
          onFailure();
          return;
        }
        try {
          const message = this.decoder.accept(decodeBase64(value.value));
          if (message) onMessage(message);
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

  subscribeRaw(onNotification: (bytes: Uint8Array) => void, onFailure: () => void): () => void {
    const subscription = this.device.monitorCharacteristicForService(
      this.profile.serviceUuid,
      this.profile.readUuid,
      (error, value: Characteristic | null) => {
        if (error || !value?.value) {
          onFailure();
          return;
        }
        try {
          onNotification(decodeBase64(value.value));
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

  write(frame: GarminGfdiFrame, signal: AbortSignal): Promise<void> {
    const task = this.queue.then(async () => {
      if (signal.aborted) throw new Error("CANCELLED");
      if (this.profile.handlePrefixed && this.handle === undefined) {
        throw new Error("GARMIN_HANDLE_REQUIRED");
      }
      const chunks = encodeGarminGfdiWrites(frame, {
        maxWriteSize: this.maxWriteBytes,
        ...(this.profile.handlePrefixed ? { handle: this.handle } : {}),
      });
      for (const chunk of chunks) await this.writeChunk(chunk, signal);
      if (signal.aborted) throw new Error("CANCELLED");
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  writeRaw(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    const task = this.queue.then(async () => {
      if (signal.aborted) throw new Error("CANCELLED");
      // Handle-management frames are written verbatim: the first byte is the
      // (zero) handle and there is no COBS wrapper (`CommunicatorV2`).
      const chunkSize = this.maxWriteBytes - 1;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        if (signal.aborted) throw new Error("CANCELLED");
        await this.writeChunk(bytes.subarray(offset, offset + chunkSize), signal);
      }
      if (signal.aborted) throw new Error("CANCELLED");
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async writeChunk(chunk: Uint8Array, signal: AbortSignal): Promise<void> {
    const transactionId = `garmin-${++this.transaction}`;
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
        encodeBase64(chunk),
        transactionId,
      );
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async close(): Promise<void> {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    this.decoder.reset();
    await this.queue;
  }
}
