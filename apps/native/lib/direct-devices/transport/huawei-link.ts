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
 * Huawei/Honor BLE transport, TLV codec and packet framing.
 *
 * Upstream:
 * - `HuaweiConstants.java` (service/characteristic UUIDs, crypto tags)
 * - `HuaweiPacket.java` (magic 0x5A, length, slice flags, CRC16)
 * - `HuaweiTLV.java` (tag + varint length + value)
 * - `HuaweiLESupport.java` (BLE service set)
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * This is the connection foundation only. History/sync is a later milestone.
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

// ---------------------------------------------------------------------------
// UUIDs and profiles
// ---------------------------------------------------------------------------

export const HUAWEI_SERVICE_UUID = "0000fe86-0000-1000-8000-00805f9b34fb";
export const HUAWEI_WRITE_UUID = "0000fe01-0000-1000-8000-00805f9b34fb";
export const HUAWEI_READ_UUID = "0000fe02-0000-1000-8000-00805f9b34fb";

export const HONOR_SERVICE_UUID = "c5f0ad48-cc27-48fd-9f67-8dc8e8f4a9cb";
export const HONOR_WRITE_UUID = "2a5fc8bd-3de4-43cb-9449-354bcdeccc70";
export const HONOR_READ_UUID = "a563d757-b216-48bc-8a0f-e8dde1f916aa";

/** Every service UUID a Huawei/Honor health wearable may advertise. */
export const HUAWEI_BLE_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  HUAWEI_SERVICE_UUID,
  HONOR_SERVICE_UUID,
]);

export type HuaweiBleProfile = Readonly<{
  serviceUuid: string;
  readUuid: string;
  writeUuid: string;
  vendor: "huawei" | "honor";
}>;

export const HUAWEI_BLE_PROFILES: readonly HuaweiBleProfile[] = [
  {
    serviceUuid: HUAWEI_SERVICE_UUID,
    readUuid: HUAWEI_READ_UUID,
    writeUuid: HUAWEI_WRITE_UUID,
    vendor: "huawei",
  },
  {
    serviceUuid: HONOR_SERVICE_UUID,
    readUuid: HONOR_READ_UUID,
    writeUuid: HONOR_WRITE_UUID,
    vendor: "honor",
  },
];

/** Picks the profile whose service and read/write characteristics are present. */
export async function selectHuaweiProfile(
  device: Pick<Device, "characteristicsForService">,
  serviceUuids: readonly string[],
): Promise<HuaweiBleProfile | null> {
  const services = new Set(serviceUuids.map((uuid) => uuid.toLowerCase()));
  for (const profile of HUAWEI_BLE_PROFILES) {
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
// TLV codec (HuaweiTLV.java)
// ---------------------------------------------------------------------------

export type HuaweiTlvField = Readonly<{ tag: number; value: Uint8Array }>;
export type HuaweiTlv = readonly HuaweiTlvField[];

/** Upstream `VarInt`: 7 bits per byte, most significant group first. */
export function encodeHuaweiVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("HUAWEI_VARINT");
  }
  let size = 0;
  let remaining = value;
  do {
    size += 1;
    remaining = Math.floor(remaining / 128);
  } while (remaining !== 0);
  const out = new Uint8Array(size);
  out[size - 1] = value & 0x7f;
  remaining = value;
  for (let offset = size - 2; offset >= 0; offset -= 1) {
    remaining = Math.floor(remaining / 128);
    out[offset] = (remaining & 0x7f) | 0x80;
  }
  return out;
}

export function decodeHuaweiVarint(bytes: Uint8Array, offset = 0): { value: number; size: number } {
  let value = 0;
  let position = offset;
  for (let index = 0; index < 5; index += 1) {
    if (position >= bytes.length) throw new Error("HUAWEI_TLV_TRUNCATED");
    const byte = bytes[position++]!;
    value += byte & 0x7f;
    if ((byte & 0x80) === 0) return { value, size: position - offset };
    value *= 128;
    if (!Number.isSafeInteger(value)) throw new Error("HUAWEI_VARINT_OVERFLOW");
  }
  throw new Error("HUAWEI_VARINT_OVERFLOW");
}

export function encodeHuaweiTlv(fields: HuaweiTlv): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const field of fields) {
    if (!Number.isInteger(field.tag) || field.tag < 0 || field.tag > 0xff) {
      throw new Error("HUAWEI_TLV_TAG");
    }
    const length = encodeHuaweiVarint(field.value.length);
    const part = new Uint8Array(1 + length.length + field.value.length);
    part[0] = field.tag;
    part.set(length, 1);
    part.set(field.value, 1 + length.length);
    parts.push(part);
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function decodeHuaweiTlv(
  bytes: Uint8Array,
  offset = 0,
  length = bytes.length - offset,
): HuaweiTlv {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error("HUAWEI_TLV_TRUNCATED");
  }
  const fields: HuaweiTlvField[] = [];
  let parsed = 0;
  while (parsed < length) {
    const tag = bytes[offset + parsed]!;
    parsed += 1;
    // Upstream ignores a single trailing null byte from encrypted payloads.
    if (parsed === length && tag === 0) break;
    const varint = decodeHuaweiVarint(bytes, offset + parsed);
    parsed += varint.size;
    if (varint.value > length - parsed) throw new Error("HUAWEI_TLV_TRUNCATED");
    const value = bytes.slice(offset + parsed, offset + parsed + varint.value);
    fields.push({ tag, value });
    parsed += varint.value;
  }
  return fields;
}

export const HUAWEI_CRYPTO_TAGS = Object.freeze({
  encryption: 124,
  initVector: 125,
  cipherText: 126,
});

/** Wraps an already-encrypted payload in the upstream crypto TLV tags. */
export function encodeHuaweiEncryptedTlv(cipherText: Uint8Array, iv: Uint8Array): Uint8Array {
  return encodeHuaweiTlv([
    { tag: HUAWEI_CRYPTO_TAGS.encryption, value: Uint8Array.of(1) },
    { tag: HUAWEI_CRYPTO_TAGS.initVector, value: iv },
    { tag: HUAWEI_CRYPTO_TAGS.cipherText, value: cipherText },
  ]);
}

export function decodeHuaweiEncryptedTlv(
  tlv: HuaweiTlv,
): { cipherText: Uint8Array; iv: Uint8Array } | null {
  let cipherText: Uint8Array | undefined;
  let iv: Uint8Array | undefined;
  for (const field of tlv) {
    if (field.tag === HUAWEI_CRYPTO_TAGS.cipherText) cipherText = field.value;
    else if (field.tag === HUAWEI_CRYPTO_TAGS.initVector) iv = field.value;
  }
  return cipherText && iv ? { cipherText, iv } : null;
}

// ---------------------------------------------------------------------------
// Packet framing (HuaweiPacket.java)
// ---------------------------------------------------------------------------

export const HUAWEI_MAGIC = 0x5a;
export const HUAWEI_DEFAULT_SLICE_SIZE = 0xf4;
export const HUAWEI_MAX_PACKET_BYTES = 1024 * 1024;

/** Upstream `CheckSums.getCRC16(data, 0x0000)`. */
export function huaweiCrc16(bytes: Uint8Array, initial = 0x0000): number {
  let crc = initial;
  for (const byte of bytes) {
    crc = ((crc >>> 8) | (crc << 8)) & 0xffff;
    crc ^= byte & 0xff;
    crc ^= (crc & 0xff) >> 4;
    crc ^= (crc << 12) & 0xffff;
    crc ^= ((crc & 0xff) << 5) & 0xffff;
  }
  return crc & 0xffff;
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function writeUint16be(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

export type HuaweiPacketFrame = Readonly<{
  sliced: boolean;
  slice?: number;
  flag?: number;
  payload: Uint8Array;
}>;

/**
 * Serializes a service/command/TLV packet. Returns one unsliced frame or the
 * upstream slice sequence (slice flags 1, 2, 3).
 */
export function encodeHuaweiPacket(args: {
  serviceId: number;
  commandId: number;
  tlv: Uint8Array;
  sliceSize?: number;
}): Uint8Array[] {
  if (!Number.isInteger(args.serviceId) || args.serviceId < 0 || args.serviceId > 0xff) {
    throw new Error("HUAWEI_SERVICE_ID");
  }
  if (!Number.isInteger(args.commandId) || args.commandId < 0 || args.commandId > 0xff) {
    throw new Error("HUAWEI_COMMAND_ID");
  }
  const sliceSize = args.sliceSize ?? HUAWEI_DEFAULT_SLICE_SIZE;
  if (!Number.isInteger(sliceSize) || sliceSize < 12 || sliceSize > 0xffff) {
    throw new Error("HUAWEI_SLICE_SIZE");
  }
  const body = new Uint8Array(2 + args.tlv.length);
  body[0] = args.serviceId;
  body[1] = args.commandId;
  body.set(args.tlv, 2);

  const headerLength = 5;
  const footerLength = 2;
  const maxBodySize = sliceSize - headerLength - footerLength;
  const packetCount = Math.ceil(body.length / maxBodySize);
  if (packetCount <= 1) {
    const length = body.length + 1;
    const frame = new Uint8Array(4 + body.length + footerLength);
    frame[0] = HUAWEI_MAGIC;
    writeUint16be(frame, 1, length);
    frame[3] = 0;
    frame.set(body, 4);
    writeUint16be(frame, frame.length - 2, huaweiCrc16(frame.subarray(0, frame.length - 2)));
    return [frame];
  }

  const frames: Uint8Array[] = [];
  let offset = 0;
  for (let index = 0; index < packetCount; index += 1) {
    const remaining = body.length - offset;
    const packetSize = Math.min(sliceSize, remaining + headerLength + footerLength);
    const contentSize = packetSize - headerLength - footerLength;
    const slice = index === packetCount - 1 ? 3 : index === 0 ? 1 : 2;
    const frame = new Uint8Array(packetSize);
    frame[0] = HUAWEI_MAGIC;
    writeUint16be(frame, 1, packetSize - headerLength);
    frame[3] = slice;
    frame[4] = index & 0xff;
    frame.set(body.subarray(offset, offset + contentSize), 5);
    offset += contentSize;
    writeUint16be(frame, frame.length - 2, huaweiCrc16(frame.subarray(0, frame.length - 2)));
    frames.push(frame);
  }
  return frames;
}

/** Parses one frame and verifies its CRC. */
export function decodeHuaweiPacket(bytes: Uint8Array): HuaweiPacketFrame {
  if (bytes.length < 5) throw new Error("HUAWEI_PACKET_TRUNCATED");
  if (bytes[0] !== HUAWEI_MAGIC) throw new Error("HUAWEI_MAGIC");
  const expectedSize = uint16be(bytes, 1);
  if (expectedSize < 1) throw new Error("HUAWEI_PACKET_LENGTH");
  const slice = bytes[3]!;
  const sliced = slice === 1 || slice === 2 || slice === 3;
  const payloadStart = sliced ? 5 : 4;
  const payloadLength = sliced ? expectedSize - 2 : expectedSize - 1;
  if (payloadLength < 0) throw new Error("HUAWEI_PACKET_LENGTH");
  const total = payloadStart + payloadLength + 2;
  if (bytes.length < total) throw new Error("HUAWEI_PACKET_TRUNCATED");
  const expectedCrc = uint16be(bytes, payloadStart + payloadLength);
  if (huaweiCrc16(bytes.subarray(0, payloadStart + payloadLength)) !== expectedCrc) {
    throw new Error("HUAWEI_PACKET_CRC");
  }
  return {
    sliced,
    ...(sliced ? { slice, flag: bytes[4]! } : {}),
    payload: bytes.slice(payloadStart, payloadStart + payloadLength),
  };
}

export type HuaweiParsedPacket = Readonly<{
  serviceId: number;
  commandId: number;
  tlv: HuaweiTlv;
}>;

function parsePayload(payload: Uint8Array): HuaweiParsedPacket {
  if (payload.length < 2) throw new Error("HUAWEI_PACKET_TRUNCATED");
  return {
    serviceId: payload[0]!,
    commandId: payload[1]!,
    tlv: decodeHuaweiTlv(payload, 2, payload.length - 2),
  };
}

/** Reassembles the upstream slice sequence (1, 2, …, 3). */
export class HuaweiPacketReassembler {
  private buffer: Uint8Array | null = null;
  private expectedSlice = 1;

  accept(frame: HuaweiPacketFrame): HuaweiParsedPacket | null {
    if (!frame.sliced) {
      this.reset();
      return parsePayload(frame.payload);
    }
    if (frame.slice === 1) {
      this.buffer = frame.payload.slice();
      this.expectedSlice = 2;
      return null;
    }
    if (!this.buffer) throw new Error("HUAWEI_SLICE_SEQUENCE");
    if (frame.slice === 2 && frame.slice !== this.expectedSlice) {
      throw new Error("HUAWEI_SLICE_SEQUENCE");
    }
    if (this.buffer.length + frame.payload.length > HUAWEI_MAX_PACKET_BYTES) {
      throw new Error("HUAWEI_PACKET_TOO_LARGE");
    }
    const joined = new Uint8Array(this.buffer.length + frame.payload.length);
    joined.set(this.buffer, 0);
    joined.set(frame.payload, this.buffer.length);
    if (frame.slice === 3) {
      this.reset();
      return parsePayload(joined);
    }
    this.buffer = joined;
    this.expectedSlice += 1;
    return null;
  }

  reset(): void {
    this.buffer = null;
    this.expectedSlice = 1;
  }
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
