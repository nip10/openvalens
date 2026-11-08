/*  Copyright (C) 2023-2026 José Rebelo, Yoran Vulker, Andreas Shimokawa

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
 * Xiaomi protobuf BLE transport.
 *
 * Upstream:
 * - `XiaomiUuids.java` (service/characteristic UUIDs)
 * - `XiaomiBleSupport.java` (V1/V2 selection)
 * - `XiaomiCharacteristicV1.java` (V1 chunk framing)
 * - `XiaomiSppPacketV2.java` (V2 SPP framing and CRC-16/ARC)
 * - `XiaomiBleProtocolV2.java` (V2 session config and channel mapping)
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/xiaomi/
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * This is the connection foundation only. It provides the link adapter and
 * the pure framing codecs; activity/history transfer is a later milestone.
 */

import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

// ---------------------------------------------------------------------------
// UUIDs and profiles
// ---------------------------------------------------------------------------

/** Every service UUID a Xiaomi protobuf device may advertise. */
export const XIAOMI_BLE_SERVICE_UUIDS: ReadonlySet<string> = new Set([
  "0000fe95-0000-1000-8000-00805f9b34fb",
  "16186f00-0000-1000-8000-00807f9b34fb",
  "16187f00-0000-1000-8000-00807f9b34fb",
  "1314f000-1000-9000-7000-301291e21220",
  "7495fe00-a7f3-424b-92dd-4a006a3aef56",
]);

export type XiaomiBleProfile = Readonly<{
  protocol: "v1" | "v2";
  serviceUuid: string;
  commandReadUuid: string;
  commandWriteUuid: string;
  activityDataUuid: string | null;
  dataUploadUuid: string | null;
  /** True when command payloads are AES-CCM encrypted after auth. */
  encrypted: boolean;
}>;

/**
 * V1 UUID sets, in upstream `BLE_V1_UUIDS` order. The first entry is the
 * encrypted `fe95` set used by most current devices.
 */
export const XIAOMI_V1_PROFILES: readonly XiaomiBleProfile[] = [
  {
    protocol: "v1",
    serviceUuid: "0000fe95-0000-1000-8000-00805f9b34fb",
    commandReadUuid: "00000051-0000-1000-8000-00805f9b34fb",
    commandWriteUuid: "00000052-0000-1000-8000-00805f9b34fb",
    activityDataUuid: "00000053-0000-1000-8000-00805f9b34fb",
    dataUploadUuid: "00000055-0000-1000-8000-00805f9b34fb",
    encrypted: true,
  },
  {
    protocol: "v1",
    serviceUuid: "16186f00-0000-1000-8000-00807f9b34fb",
    commandReadUuid: "16186f01-0000-1000-8000-00807f9b34fb",
    commandWriteUuid: "16186f02-0000-1000-8000-00807f9b34fb",
    activityDataUuid: "16186f03-0000-1000-8000-00807f9b34fb",
    dataUploadUuid: "16186f04-0000-1000-8000-00807f9b34fb",
    encrypted: false,
  },
  {
    protocol: "v1",
    serviceUuid: "16187f00-0000-1000-8000-00807f9b34fb",
    commandReadUuid: "16187f02-0000-1000-8000-00807f9b34fb",
    commandWriteUuid: "16187f01-0000-1000-8000-00807f9b34fb",
    activityDataUuid: "16187f03-0000-1000-8000-00807f9b34fb",
    dataUploadUuid: "16187f04-0000-1000-8000-00807f9b34fb",
    encrypted: false,
  },
  {
    protocol: "v1",
    serviceUuid: "1314f000-1000-9000-7000-301291e21220",
    commandReadUuid: "1314f005-1000-9000-7000-301291e21220",
    commandWriteUuid: "1314f001-1000-9000-7000-301291e21220",
    activityDataUuid: "1314f002-1000-9000-7000-301291e21220",
    dataUploadUuid: "1314f007-1000-9000-7000-301291e21220",
    encrypted: false,
  },
  {
    protocol: "v1",
    serviceUuid: "7495fe00-a7f3-424b-92dd-4a006a3aef56",
    commandReadUuid: "74950002-a7f3-424b-92dd-4a006a3aef56",
    commandWriteUuid: "74950001-a7f3-424b-92dd-4a006a3aef56",
    activityDataUuid: "74950003-a7f3-424b-92dd-4a006a3aef56",
    dataUploadUuid: null,
    encrypted: false,
  },
];

/** V2 UUID set (Mi Band 9 Active and newer). */
export const XIAOMI_V2_PROFILE: XiaomiBleProfile = {
  protocol: "v2",
  serviceUuid: "0000fe95-0000-1000-8000-00805f9b34fb",
  commandReadUuid: "0000005e-0000-1000-8000-00805f9b34fb",
  commandWriteUuid: "0000005f-0000-1000-8000-00805f9b34fb",
  activityDataUuid: null,
  dataUploadUuid: null,
  encrypted: true,
};

export const XIAOMI_BLE_PROFILES: readonly XiaomiBleProfile[] = [
  ...XIAOMI_V1_PROFILES,
  XIAOMI_V2_PROFILE,
];

/**
 * Picks the V1/V2 profile whose service and command characteristics are
 * present on the connected device. Returns null when none match.
 */
export async function selectXiaomiProfile(
  device: Pick<Device, "characteristicsForService">,
  serviceUuids: readonly string[],
): Promise<XiaomiBleProfile | null> {
  const services = new Set(serviceUuids.map((uuid) => uuid.toLowerCase()));
  const hasCharacteristics = async (profile: XiaomiBleProfile): Promise<boolean> => {
    if (!services.has(profile.serviceUuid)) return false;
    const characteristics = await device.characteristicsForService(profile.serviceUuid);
    const uuids = new Set(
      characteristics.map((characteristic) => characteristic.uuid.toLowerCase()),
    );
    return (
      uuids.has(profile.commandReadUuid) &&
      uuids.has(profile.commandWriteUuid) &&
      (profile.activityDataUuid === null || uuids.has(profile.activityDataUuid))
    );
  };

  if (await hasCharacteristics(XIAOMI_V2_PROFILE)) return XIAOMI_V2_PROFILE;
  for (const profile of XIAOMI_V1_PROFILES) {
    if (await hasCharacteristics(profile)) return profile;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Link adapter (same shape as the Helio link)
// ---------------------------------------------------------------------------

type WriteDevice = Pick<
  Device,
  | "monitorCharacteristicForService"
  | "writeCharacteristicWithResponseForService"
  | "writeCharacteristicWithoutResponseForService"
> & { mtu?: number };

type TransactionManager = { cancelTransaction(id: string): void };

export type XiaomiCharacteristic =
  | "command_read"
  | "command_write"
  | "activity_data"
  | "data_upload";

export interface XiaomiLink {
  readonly maxWriteBytes: number;
  subscribe(
    characteristic: "command_read" | "activity_data",
    onBytes: (bytes: Uint8Array) => void,
    onFailure: () => void,
  ): () => void;
  write(
    characteristic: "command_write" | "command_read" | "data_upload",
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<void>;
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

export class NativeXiaomiLink implements XiaomiLink {
  readonly maxWriteBytes: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions = new Set<Subscription>();
  private transaction = 0;

  constructor(
    private readonly device: WriteDevice,
    private readonly profile: XiaomiBleProfile,
    private readonly manager?: TransactionManager,
  ) {
    this.maxWriteBytes = Math.min(512, Math.max(23, device.mtu ?? 23)) - 3;
  }

  subscribe(
    characteristic: "command_read" | "activity_data",
    onBytes: (bytes: Uint8Array) => void,
    onFailure: () => void,
  ): () => void {
    const uuid =
      characteristic === "command_read"
        ? this.profile.commandReadUuid
        : this.profile.activityDataUuid;
    if (!uuid) throw new Error("XIAOMI_CHARACTERISTIC_UNAVAILABLE");
    const subscription = this.device.monitorCharacteristicForService(
      this.profile.serviceUuid,
      uuid,
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

  write(
    characteristic: "command_write" | "command_read" | "data_upload",
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<void> {
    const task = this.queue.then(async () => {
      if (signal.aborted) throw new Error("CANCELLED");
      const uuid =
        characteristic === "command_write"
          ? this.profile.commandWriteUuid
          : characteristic === "command_read"
            ? this.profile.commandReadUuid
            : this.profile.dataUploadUuid;
      if (!uuid) throw new Error("XIAOMI_CHARACTERISTIC_UNAVAILABLE");
      const transactionId = `xiaomi-${++this.transaction}`;
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
          uuid,
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

// ---------------------------------------------------------------------------
// V1 framing (XiaomiCharacteristicV1)
// ---------------------------------------------------------------------------

export const XIAOMI_V1_ACK = Uint8Array.of(0, 0, 3, 0);
export const XIAOMI_V1_CHUNK_START_ACK = Uint8Array.of(0, 0, 1, 1);
export const XIAOMI_V1_CHUNK_END_ACK = Uint8Array.of(0, 0, 1, 0);

/** Single command: 2-byte zero chunk id, type 2, encryption flag, optional nonce index. */
export function encodeXiaomiV1Single(
  payload: Uint8Array,
  options: { encrypted: boolean; nonceIndex?: number },
): Uint8Array {
  const header = options.encrypted ? 6 : 4;
  const out = new Uint8Array(header + payload.length);
  out[0] = 0;
  out[1] = 0;
  out[2] = 2;
  out[3] = options.encrypted ? 1 : 2;
  if (options.encrypted) {
    const index = options.nonceIndex ?? 0;
    if (!Number.isInteger(index) || index < 0 || index > 0xffff) {
      throw new Error("XIAOMI_NONCE_INDEX");
    }
    out[4] = index & 0xff;
    out[5] = (index >>> 8) & 0xff;
  }
  out.set(payload, header);
  return out;
}

/** Chunked start request: type 0, encryption flag, 2-byte chunk count. */
export function encodeXiaomiV1ChunkedStart(encrypted: boolean, chunkCount: number): Uint8Array {
  if (!Number.isInteger(chunkCount) || chunkCount < 0 || chunkCount > 0xffff) {
    throw new Error("XIAOMI_CHUNK_COUNT");
  }
  return Uint8Array.of(0, 0, 0, encrypted ? 1 : 0, chunkCount & 0xff, (chunkCount >>> 8) & 0xff);
}

/** Chunk packet: 2-byte 1-based chunk index, then payload. */
export function encodeXiaomiV1Chunk(index: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > 0xfffe) {
    throw new Error("XIAOMI_CHUNK_INDEX");
  }
  const chunk = index + 1;
  const out = new Uint8Array(2 + payload.length);
  out[0] = chunk & 0xff;
  out[1] = (chunk >>> 8) & 0xff;
  out.set(payload, 2);
  return out;
}

export type XiaomiV1Inbound =
  | Readonly<{ kind: "chunk"; index: number; payload: Uint8Array }>
  | Readonly<{ kind: "chunk_start"; encrypted: boolean; count: number }>
  | Readonly<{ kind: "chunk_ack"; subtype: number; missing: readonly number[] }>
  | Readonly<{
      kind: "single";
      encrypted: boolean;
      nonceIndex?: number;
      payload: Uint8Array;
    }>
  | Readonly<{ kind: "ack"; result: number }>;

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export function parseXiaomiV1Packet(value: Uint8Array): XiaomiV1Inbound {
  if (value.length < 2) throw new Error("XIAOMI_V1_TRUNCATED");
  const chunk = uint16le(value, 0);
  if (chunk !== 0) {
    return { kind: "chunk", index: chunk, payload: value.slice(2) };
  }
  if (value.length < 3) throw new Error("XIAOMI_V1_TRUNCATED");
  const type = value[2]!;
  switch (type) {
    case 0: {
      if (value.length < 6) throw new Error("XIAOMI_V1_TRUNCATED");
      return {
        kind: "chunk_start",
        encrypted: value[3] === 1,
        count: uint16le(value, 4),
      };
    }
    case 1: {
      if (value.length < 4) throw new Error("XIAOMI_V1_TRUNCATED");
      const missing: number[] = [];
      for (let offset = 4; offset + 1 < value.length; offset += 2) {
        missing.push(uint16le(value, offset));
      }
      return { kind: "chunk_ack", subtype: value[3]!, missing };
    }
    case 2: {
      if (value.length < 5) throw new Error("XIAOMI_V1_TRUNCATED");
      const encrypted = value[3] === 1;
      // Upstream reads the encryption flag and then the payload directly for
      // inbound single commands; the 2-byte nonce index is outbound-only.
      return { kind: "single", encrypted, payload: value.slice(4) };
    }
    case 3: {
      if (value.length < 4) throw new Error("XIAOMI_V1_TRUNCATED");
      return { kind: "ack", result: value[3]! };
    }
    default:
      throw new Error("XIAOMI_V1_UNKNOWN_TYPE");
  }
}

const MAX_V1_CHUNKS = 4096;
const MAX_V1_PAYLOAD = 1024 * 1024;

/** Reassembles inbound V1 chunks after a chunked-start request. */
export class XiaomiV1Reassembler {
  private encrypted = false;
  private count = 0;
  private total = 0;
  private readonly chunks = new Map<number, Uint8Array>();

  start(encrypted: boolean, count: number): void {
    if (!Number.isInteger(count) || count < 1 || count > MAX_V1_CHUNKS) {
      throw new Error("XIAOMI_CHUNK_COUNT");
    }
    this.encrypted = encrypted;
    this.count = count;
    this.total = 0;
    this.chunks.clear();
  }

  get expected(): number {
    return this.count;
  }

  get encryptedChunks(): boolean {
    return this.encrypted;
  }

  accept(index: number, payload: Uint8Array): Uint8Array | null {
    if (this.count === 0) throw new Error("XIAOMI_CHUNK_NOT_STARTED");
    if (!Number.isInteger(index) || index < 1 || index > this.count) {
      throw new Error("XIAOMI_CHUNK_INDEX");
    }
    if (this.chunks.has(index)) throw new Error("XIAOMI_CHUNK_DUPLICATE");
    this.total += payload.length;
    if (this.total > MAX_V1_PAYLOAD) throw new Error("XIAOMI_PAYLOAD_TOO_LARGE");
    this.chunks.set(index, payload);
    if (this.chunks.size < this.count) return null;

    const out = new Uint8Array(this.total);
    let offset = 0;
    for (let current = 1; current <= this.count; current += 1) {
      const chunk = this.chunks.get(current);
      if (!chunk) throw new Error("XIAOMI_CHUNK_MISSING");
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.reset();
    return out;
  }

  reset(): void {
    this.encrypted = false;
    this.count = 0;
    this.total = 0;
    this.chunks.clear();
  }
}

// ---------------------------------------------------------------------------
// V2 framing (XiaomiSppPacketV2)
// ---------------------------------------------------------------------------

export const XIAOMI_V2_PREAMBLE = Uint8Array.of(0xa5, 0xa5);
export const XIAOMI_V2_PACKET_NACK = 0;
export const XIAOMI_V2_PACKET_ACK = 1;
export const XIAOMI_V2_PACKET_SESSION_CONFIG = 2;
export const XIAOMI_V2_PACKET_DATA = 3;

export const XIAOMI_V2_CHANNEL_PROTOBUF = 1;
export const XIAOMI_V2_CHANNEL_DATA = 2;
export const XIAOMI_V2_CHANNEL_ACTIVITY = 5;

export const XIAOMI_V2_OPCODE_SEND_PLAINTEXT = 1;
export const XIAOMI_V2_OPCODE_SEND_ENCRYPTED = 2;

export const XIAOMI_V2_SESSION_START_REQUEST = 1;
export const XIAOMI_V2_SESSION_START_RESPONSE = 2;
export const XIAOMI_V2_SESSION_STOP_REQUEST = 3;
export const XIAOMI_V2_SESSION_STOP_RESPONSE = 4;

/** Upstream CRC-16/ARC variant, including its final bit reversal. */
export function crc16Arc(payload: Uint8Array): number {
  let crc = 0;
  for (const byte of payload) {
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc << 1) & 0xffffffff;
      if ((((crc >>> 16) & 1) ^ ((byte >>> bit) & 1)) === 1) {
        crc = (crc ^ 0x8005) & 0xffffffff;
      }
    }
  }
  let reversed = 0;
  let value = crc;
  for (let bit = 0; bit < 32; bit += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>>= 1;
  }
  return (reversed >>> 16) & 0xffff;
}

export function encodeXiaomiV2Frame(
  packetType: number,
  sequence: number,
  payload: Uint8Array,
): Uint8Array {
  if (!Number.isInteger(packetType) || packetType < 0 || packetType > 0xf) {
    throw new Error("XIAOMI_V2_PACKET_TYPE");
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xff) {
    throw new Error("XIAOMI_V2_SEQUENCE");
  }
  if (payload.length > 0xffff) throw new Error("XIAOMI_V2_PAYLOAD_TOO_LARGE");
  const out = new Uint8Array(8 + payload.length);
  out[0] = XIAOMI_V2_PREAMBLE[0]!;
  out[1] = XIAOMI_V2_PREAMBLE[1]!;
  out[2] = packetType & 0xf;
  out[3] = sequence & 0xff;
  out[4] = payload.length & 0xff;
  out[5] = (payload.length >>> 8) & 0xff;
  const checksum = crc16Arc(payload);
  out[6] = checksum & 0xff;
  out[7] = (checksum >>> 8) & 0xff;
  out.set(payload, 8);
  return out;
}

export type XiaomiV2Frame = Readonly<{
  packetType: number;
  sequence: number;
  payload: Uint8Array;
}>;

export function decodeXiaomiV2Frame(bytes: Uint8Array): XiaomiV2Frame {
  if (bytes.length < 8) throw new Error("XIAOMI_V2_TRUNCATED");
  if (bytes[0] !== XIAOMI_V2_PREAMBLE[0] || bytes[1] !== XIAOMI_V2_PREAMBLE[1]) {
    throw new Error("XIAOMI_V2_PREAMBLE");
  }
  const packetType = bytes[2]! & 0xf;
  const sequence = bytes[3]!;
  const length = uint16le(bytes, 4);
  if (bytes.length < 8 + length) throw new Error("XIAOMI_V2_TRUNCATED");
  const payload = bytes.slice(8, 8 + length);
  if (uint16le(bytes, 6) !== crc16Arc(payload)) throw new Error("XIAOMI_V2_CHECKSUM");
  return { packetType, sequence, payload };
}

/** Incremental V2 stream decoder; returns complete frames and keeps the rest. */
export class XiaomiV2StreamDecoder {
  private buffer = new Uint8Array(0);

  push(bytes: Uint8Array): XiaomiV2Frame[] {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer, 0);
    joined.set(bytes, this.buffer.length);
    this.buffer = joined;

    const frames: XiaomiV2Frame[] = [];
    while (this.buffer.length >= 8) {
      if (this.buffer[0] !== XIAOMI_V2_PREAMBLE[0] || this.buffer[1] !== XIAOMI_V2_PREAMBLE[1]) {
        throw new Error("XIAOMI_V2_PREAMBLE");
      }
      const length = uint16le(this.buffer, 4);
      const total = 8 + length;
      if (this.buffer.length < total) break;
      const frame = this.buffer.slice(0, total);
      frames.push(decodeXiaomiV2Frame(frame));
      this.buffer = this.buffer.slice(total);
    }
    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

/** Upstream session-config start payload (opcode + four TLVs). */
export function encodeXiaomiV2SessionConfigStart(): Uint8Array {
  return Uint8Array.of(
    XIAOMI_V2_SESSION_START_REQUEST,
    // VERSION = 01.00.00
    1,
    0x03,
    0x00,
    0x01,
    0x00,
    0x00,
    // MAX_FRAME_SIZE = 0xfc00
    2,
    0x02,
    0x00,
    0x00,
    0xfc,
    // TX_WIN = 0x0020
    3,
    0x02,
    0x00,
    0x20,
    0x00,
    // SEND_TIMEOUT = 0x2710
    4,
    0x02,
    0x00,
    0x10,
    0x27,
  );
}

export type XiaomiV2SessionConfig = Readonly<{
  opCode: number;
  values: ReadonlyMap<number, Uint8Array>;
}>;

export function decodeXiaomiV2SessionConfig(payload: Uint8Array): XiaomiV2SessionConfig {
  if (payload.length < 1) throw new Error("XIAOMI_V2_SESSION_CONFIG_TRUNCATED");
  const opCode = payload[0]!;
  const values = new Map<number, Uint8Array>();
  let offset = 1;
  while (offset + 3 <= payload.length) {
    const key = payload[offset]!;
    const length = uint16le(payload, offset + 1);
    offset += 3;
    if (offset + length > payload.length) throw new Error("XIAOMI_V2_SESSION_CONFIG_TRUNCATED");
    values.set(key, payload.slice(offset, offset + length));
    offset += length;
  }
  if (offset !== payload.length) throw new Error("XIAOMI_V2_SESSION_CONFIG_TRUNCATED");
  return { opCode, values };
}

export function encodeXiaomiV2DataPacket(
  channel: number,
  opCode: number,
  payload: Uint8Array,
): Uint8Array {
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xf) {
    throw new Error("XIAOMI_V2_CHANNEL");
  }
  const out = new Uint8Array(2 + payload.length);
  out[0] = channel & 0xf;
  out[1] = opCode & 0xff;
  out.set(payload, 2);
  return out;
}

export type XiaomiV2DataPacket = Readonly<{
  channel: number;
  opCode: number;
  payload: Uint8Array;
}>;

export function decodeXiaomiV2DataPacket(payload: Uint8Array): XiaomiV2DataPacket {
  if (payload.length < 2) throw new Error("XIAOMI_V2_DATA_TRUNCATED");
  return {
    channel: payload[0]! & 0xf,
    opCode: payload[1]!,
    payload: payload.slice(2),
  };
}
