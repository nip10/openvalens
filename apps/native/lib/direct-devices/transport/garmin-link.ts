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
// CRC-16/ARC (ChecksumCalculator.java)
// ---------------------------------------------------------------------------

const GARMIN_CRC_CONSTANTS: readonly number[] = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

/** Upstream `ChecksumCalculator.computeCrc`, i.e. CRC-16/ARC. */
export function garminCrc16(bytes: Uint8Array, initial = 0x0000): number {
  let crc = initial;
  for (const byte of bytes) {
    crc = ((crc >> 4) & 4095) ^ GARMIN_CRC_CONSTANTS[crc & 15]!;
    crc ^= GARMIN_CRC_CONSTANTS[byte & 15]!;
    crc = ((crc >> 4) & 4095) ^ GARMIN_CRC_CONSTANTS[crc & 15]!;
    crc ^= GARMIN_CRC_CONSTANTS[(byte >> 4) & 15]!;
  }
  return crc & 0xffff;
}

// ---------------------------------------------------------------------------
// COBS (CobsCoDec.java)
// ---------------------------------------------------------------------------

/**
 * Encodes a payload with the upstream COBS variant: a leading 0x00, COBS
 * blocks, an optional 0x01 for a trailing zero, and a trailing 0x00.
 */
export function encodeGarminCobs(data: Uint8Array): Uint8Array {
  const out: number[] = [0];
  let position = 0;
  let lastByteWasZero = false;
  while (position < data.length) {
    const startPos = position;
    while (position < data.length && data[position] !== 0) position += 1;
    lastByteWasZero = position < data.length && data[position] === 0;
    let payloadSize = position - startPos;
    let start = startPos;
    while (payloadSize >= 0xfe) {
      out.push(0xff);
      for (let index = 0; index < 0xfe; index += 1) out.push(data[start + index]!);
      payloadSize -= 0xfe;
      start += 0xfe;
    }
    out.push(payloadSize + 1);
    for (let index = 0; index < payloadSize; index += 1) out.push(data[start + index]!);
    if (lastByteWasZero) position += 1;
  }
  if (lastByteWasZero) out.push(0x01);
  out.push(0);
  return Uint8Array.from(out);
}

/**
 * Decodes exactly one complete COBS frame (leading and trailing 0x00).
 * Throws `GARMIN_COBS_*` on malformed or truncated input.
 */
export function decodeGarminCobsFrame(frame: Uint8Array): Uint8Array {
  if (frame.length < 4) throw new Error("GARMIN_COBS_TRUNCATED");
  if (frame[0] !== 0 || frame[frame.length - 1] !== 0) throw new Error("GARMIN_COBS_FRAME");
  const out: number[] = [];
  const end = frame.length - 1;
  let offset = 1;
  while (offset < end) {
    const code = frame[offset]!;
    offset += 1;
    if (code === 0) break;
    const payloadSize = code - 1;
    if (offset + payloadSize > end) throw new Error("GARMIN_COBS_TRUNCATED");
    for (let index = 0; index < payloadSize; index += 1) out.push(frame[offset + index]!);
    offset += payloadSize;
    if (code !== 0xff && offset < end) out.push(0);
  }
  return Uint8Array.from(out);
}

/**
 * Streaming COBS decoder. Accumulates BLE notification fragments and yields
 * one decoded message at a time. Malformed frames are dropped and the
 * accumulator resets, matching upstream `CobsCoDec`.
 */
export class GarminCobsDecoder {
  private buffer: number[] = [];

  accept(bytes: Uint8Array): Uint8Array | null {
    for (const byte of bytes) this.buffer.push(byte);
    if (this.buffer.length > 10_000) this.reset();
    if (this.buffer.length < 4) return null;
    if (this.buffer[0] !== 0) {
      this.reset();
      return null;
    }
    const end = this.buffer.indexOf(0, 1);
    if (end < 0) return null;
    const frame = Uint8Array.from(this.buffer.slice(0, end + 1));
    this.buffer = this.buffer.slice(end + 1);
    try {
      return decodeGarminCobsFrame(frame);
    } catch {
      return null;
    }
  }

  reset(): void {
    this.buffer = [];
  }
}

// ---------------------------------------------------------------------------
// GFDI packet framing (GFDIMessage.java)
// ---------------------------------------------------------------------------

export type GarminGfdiFrame = Readonly<{
  /** Raw message type. Incoming frames may carry a sequence number in bit 15. */
  messageType: number;
  payload: Uint8Array;
}>;

/**
 * GFDI `AUTH_NEGOTIATION`. The device sends an opaque flag bitmask; upstream
 * replies ACK / `GUESS_OK` with all flags cleared and derives no key.
 */
export const GARMIN_AUTH_NEGOTIATION_MESSAGE_TYPE = 5101;
/** Upstream `AuthNegotiationStatus.GUESS_OK`. */
export const GARMIN_AUTH_NEGOTIATION_GUESS_OK = 0;

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function writeUint16le(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

/**
 * Serializes one GFDI message: 2-byte little-endian total length (including
 * the length field and CRC), 2-byte little-endian message type, payload, then
 * the CRC-16/ARC over everything before it.
 */
export function encodeGarminGfdiFrame(frame: GarminGfdiFrame): Uint8Array {
  if (!Number.isInteger(frame.messageType) || frame.messageType < 0 || frame.messageType > 0xffff) {
    throw new Error("GARMIN_MESSAGE_TYPE");
  }
  const total = 4 + frame.payload.length + 2;
  if (total > 0xffff) throw new Error("GARMIN_PACKET_TOO_LARGE");
  const out = new Uint8Array(total);
  writeUint16le(out, 0, total);
  writeUint16le(out, 2, frame.messageType);
  out.set(frame.payload, 4);
  writeUint16le(out, total - 2, garminCrc16(out.subarray(0, total - 2)));
  return out;
}

/** Parses and verifies one complete GFDI message. */
export function decodeGarminGfdiFrame(bytes: Uint8Array): GarminGfdiFrame {
  if (bytes.length < 6) throw new Error("GARMIN_PACKET_TRUNCATED");
  const length = uint16le(bytes, 0);
  if (length !== bytes.length) throw new Error("GARMIN_PACKET_LENGTH");
  const expectedCrc = uint16le(bytes, length - 2);
  if (garminCrc16(bytes.subarray(0, length - 2)) !== expectedCrc) {
    throw new Error("GARMIN_PACKET_CRC");
  }
  return {
    messageType: uint16le(bytes, 2),
    payload: bytes.slice(4, length - 2),
  };
}

// ---------------------------------------------------------------------------
// Write chunking (CommunicatorV1/V2.java)
// ---------------------------------------------------------------------------

export type GarminWriteOptions = Readonly<{
  /** Maximum bytes accepted by one BLE write, including any handle prefix. */
  maxWriteSize: number;
  /** V2 GFDI handle; omitted for v0/v1. */
  handle?: number;
}>;

/**
 * Splits an already-COBS-encoded payload into BLE writes. Upstream reserves
 * one byte per write (`maxWriteSize - 1`) and, for V2, prefixes every chunk
 * with the GFDI handle byte.
 */
export function chunkGarminPayload(payload: Uint8Array, options: GarminWriteOptions): Uint8Array[] {
  const { maxWriteSize, handle } = options;
  if (!Number.isInteger(maxWriteSize) || maxWriteSize < 2) {
    throw new Error("GARMIN_WRITE_SIZE");
  }
  if (handle !== undefined && (!Number.isInteger(handle) || handle < 0 || handle > 0xff)) {
    throw new Error("GARMIN_HANDLE");
  }
  const chunkSize = maxWriteSize - 1;
  const fragments: Uint8Array[] = [];
  if (payload.length <= chunkSize) {
    fragments.push(payload);
  } else {
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      fragments.push(payload.subarray(offset, offset + chunkSize));
    }
  }
  if (handle === undefined) return fragments;
  return fragments.map((fragment) => {
    const out = new Uint8Array(1 + fragment.length);
    out[0] = handle;
    out.set(fragment, 1);
    return out;
  });
}

/** COBS-encodes and chunks one GFDI frame for writing. */
export function encodeGarminGfdiWrites(
  frame: GarminGfdiFrame,
  options: GarminWriteOptions,
): Uint8Array[] {
  return chunkGarminPayload(encodeGarminCobs(encodeGarminGfdiFrame(frame)), options);
}

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
  /** Writes one GFDI frame, COBS-encoded and chunked for the profile. */
  write(frame: GarminGfdiFrame, signal: AbortSignal): Promise<void>;
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
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions = new Set<Subscription>();
  private readonly decoder = new GarminCobsDecoder();
  private transaction = 0;

  constructor(
    private readonly device: WriteDevice,
    private readonly profile: GarminBleProfile,
    private readonly manager?: TransactionManager,
    private readonly handle?: number,
  ) {
    this.maxWriteBytes = Math.min(512, Math.max(23, device.mtu ?? 23)) - 3;
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
      for (const chunk of chunks) {
        if (signal.aborted) throw new Error("CANCELLED");
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
      if (signal.aborted) throw new Error("CANCELLED");
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  async close(): Promise<void> {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.clear();
    this.decoder.reset();
    await this.queue;
  }
}
