/**
 * Pure Huawei/Honor BLE protocol codec.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `devices/huawei/HuaweiConstants.java` (UUIDs, crypto tags)
 * - `devices/huawei/HuaweiTLV.java` (tag + varint length + value, crypto wrapper)
 * - `devices/huawei/HuaweiPacket.java` (magic 0x5A, slicing, CRC16, encryption)
 * - `devices/huawei/HuaweiCrypto.java` (digests, IV, secret key, AES)
 * - `devices/huawei/packets/DeviceConfig.java` (link params, auth, bond, status)
 * - `devices/huawei/packets/FitnessData.java` (service 0x07 step/sleep records)
 * - `util/CheckSums.java` (`getCRC16`)
 * - `service/devices/huawei/HuaweiSupportProvider.java` (local secret key)
 *
 * Wire layout
 * -----------
 * `5A | len:u16 BE | slice:u8 | [flag:u8] | [sid,cid on the first slice] | TLV | CRC16`
 * `len` counts everything after the 3-byte magic/length header except the CRC.
 * Slice 0x01 = first, 0x02 = middle, 0x03 = last; 0x00 = unsliced. The CRC is
 * `CheckSums.getCRC16(bytes, 0x0000)` over everything before it.
 *
 * TLV is `tag:u8 | varint length | value`. Varints are 7-bit groups, most
 * significant first.
 *
 * All service 0x07 transactions are AES-encrypted and wrapped in TLV tags
 * `{0x7C: 0x01, 0x7D: IV, 0x7E: ciphertext}`. AES-CBC-PKCS7 is the default;
 * AES-GCM (ciphertext || 16-byte tag) is used when the negotiated
 * `encryptMethod == 0x01` or `deviceSupportType == 0x04`.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import {
  HUAWEI_MESSAGE_CHALLENGE,
  HUAWEI_MESSAGE_CHALLENGE_V4,
  HUAWEI_MESSAGE_RESPONSE,
  computeHuaweiDigest,
  concatHuaweiBytes,
  createHuaweiSecretKey,
  type HuaweiCryptoProvider,
} from "../crypto/huawei-auth";

// ---------------------------------------------------------------------------
// UUIDs and profiles
// ---------------------------------------------------------------------------

export const HUAWEI_SERVICE_UUID = "0000fe86-0000-1000-8000-00805f9b34fb";
export const HUAWEI_WRITE_UUID = "0000fe01-0000-1000-8000-00805f9b34fb";
export const HUAWEI_READ_UUID = "0000fe02-0000-1000-8000-00805f9b34fb";

/** Honor's new-protocol GATT UUIDs (`isNewHonorProtocol()` coordinators). */
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
  encryption: 0x7c,
  initVector: 0x7d,
  cipherText: 0x7e,
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
// TLV accessors (HuaweiTLV.getByte/getShort/getInteger/getObject/getObjects)
// ---------------------------------------------------------------------------

function findField(tlv: HuaweiTlv, tag: number): Uint8Array | null {
  for (const field of tlv) if (field.tag === tag) return field.value;
  return null;
}

export function huaweiTlvBytes(tlv: HuaweiTlv, tag: number): Uint8Array | null {
  return findField(tlv, tag);
}

export function huaweiTlvByte(tlv: HuaweiTlv, tag: number): number | null {
  const value = findField(tlv, tag);
  return value && value.length >= 1 ? value[0]! : null;
}

export function huaweiTlvShort(tlv: HuaweiTlv, tag: number): number | null {
  const value = findField(tlv, tag);
  if (!value || value.length < 2) return null;
  return (((value[0]! << 8) | value[1]!) << 16) >> 16;
}

export function huaweiTlvUint16(tlv: HuaweiTlv, tag: number): number | null {
  const value = findField(tlv, tag);
  if (!value || value.length < 2) return null;
  return ((value[0]! << 8) | value[1]!) >>> 0;
}

export function huaweiTlvUint32(tlv: HuaweiTlv, tag: number): number | null {
  const value = findField(tlv, tag);
  if (!value || value.length < 4) return null;
  return ((value[0]! << 24) | (value[1]! << 16) | (value[2]! << 8) | value[3]!) >>> 0;
}

export function huaweiTlvObject(tlv: HuaweiTlv, tag: number): HuaweiTlv | null {
  const value = findField(tlv, tag);
  return value ? decodeHuaweiTlv(value) : null;
}

export function huaweiTlvObjects(tlv: HuaweiTlv, tag: number): HuaweiTlv[] {
  const out: HuaweiTlv[] = [];
  for (const field of tlv) if (field.tag === tag) out.push(decodeHuaweiTlv(field.value));
  return out;
}

// ---------------------------------------------------------------------------
// Packet framing (HuaweiPacket.java)
// ---------------------------------------------------------------------------

export const HUAWEI_MAGIC = 0x5a;
export const HUAWEI_DEFAULT_SLICE_SIZE = 0xf4;
export const HUAWEI_MAX_PACKET_BYTES = 1024 * 1024;

/** Upstream `CheckSums.getCRC16(bytes, initial)`. */
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

/**
 * Parses one frame. `verifyCrc` defaults to true; the session keeps it on and
 * tests use it to prove the CRC vectors.
 */
export function decodeHuaweiPacket(bytes: Uint8Array, verifyCrc = true): HuaweiPacketFrame {
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
  if (verifyCrc) {
    const expectedCrc = uint16be(bytes, payloadStart + payloadLength);
    if (huaweiCrc16(bytes.subarray(0, payloadStart + payloadLength)) !== expectedCrc) {
      throw new Error("HUAWEI_PACKET_CRC");
    }
  }
  return {
    sliced,
    ...(sliced ? { slice, flag: bytes[4]! } : {}),
    payload: bytes.slice(payloadStart, payloadStart + payloadLength),
  };
}

/**
 * Splits a byte stream into whole frames (upstream `HuaweiPacket.parse` +
 * `ResponseManager.handleData`): RFCOMM delivers arbitrary chunks, BLE one
 * frame per notification, so both go through here. Every frame, sliced or
 * not, is `0x5A | u16 length | … | CRC16` and `3 + length + 2` bytes long
 * (at most 65,540). Garbage before a frame is skipped up to the next 0x5A
 * and counted in `discardedBytes`; frames already found are never lost.
 */
export class HuaweiStreamDeframer {
  private buffer = new Uint8Array(0);
  /** Bytes skipped while looking for a frame start; the session reports growth. */
  discardedBytes = 0;

  /** Appends `bytes` and returns every complete frame now available. */
  push(bytes: Uint8Array): Uint8Array[] {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer);
    joined.set(bytes, this.buffer.length);
    this.buffer = joined;
    const frames: Uint8Array[] = [];
    while (this.buffer.length > 0) {
      if (this.buffer[0] !== HUAWEI_MAGIC) {
        const next = this.buffer.indexOf(HUAWEI_MAGIC, 1);
        const skip = next < 0 ? this.buffer.length : next;
        this.discardedBytes += skip;
        this.buffer = this.buffer.slice(skip);
        continue;
      }
      if (this.buffer.length < 3) break;
      const total = 3 + uint16be(this.buffer, 1) + 2;
      if (this.buffer.length < total) break;
      frames.push(this.buffer.slice(0, total));
      this.buffer = this.buffer.slice(total);
    }
    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
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

  accept(frame: HuaweiPacketFrame): HuaweiParsedPacket | null {
    if (!frame.sliced) {
      this.reset();
      return parsePayload(frame.payload);
    }
    if (frame.slice === 1) {
      this.buffer = frame.payload.slice();
      return null;
    }
    if (!this.buffer) throw new Error("HUAWEI_SLICE_SEQUENCE");
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
    return null;
  }

  reset(): void {
    this.buffer = null;
  }
}

// ---------------------------------------------------------------------------
// AES layer (HuaweiCrypto.encrypt/decrypt/initializationVector)
// ---------------------------------------------------------------------------

/**
 * AES provider. `encryptGcm` returns ciphertext || 16-byte tag, matching Java's
 * `Cipher.doFinal` for AES/GCM/NoPadding.
 */
export type HuaweiAesProvider = Readonly<{
  encryptCbc(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Uint8Array;
  decryptCbc(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Uint8Array;
  encryptGcm(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Uint8Array;
  decryptGcm(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Uint8Array;
}>;

export const HUAWEI_ENCRYPTION_COUNTER_MAX = 0xffffffff;

/**
 * `HuaweiCrypto.initializationVector(counter)`: 12 random bytes plus the
 * incremented 32-bit counter, big-endian, in the last four bytes. The counter
 * wraps to 1 at `0xFFFFFFFF`.
 */
export function createHuaweiInitializationVector(
  counter: number,
  randomBytes: Uint8Array,
): { iv: Uint8Array; counter: number } {
  if (randomBytes.length < 12) throw new Error("HUAWEI_IV_RANDOM_LENGTH");
  const next = counter >>> 0 === HUAWEI_ENCRYPTION_COUNTER_MAX ? 1 : ((counter >>> 0) + 1) >>> 0;
  const iv = new Uint8Array(16);
  iv.set(randomBytes.subarray(0, 12), 0);
  iv[12] = (next >>> 24) & 0xff;
  iv[13] = (next >>> 16) & 0xff;
  iv[14] = (next >>> 8) & 0xff;
  iv[15] = next & 0xff;
  return { iv, counter: next };
}

/** True when transactions use AES-GCM (`encryptMethod == 1` or support type 4). */
export function huaweiUsesGcm(encryptMethod: number, deviceSupportType: number): boolean {
  return encryptMethod === 0x01 || deviceSupportType === 0x04;
}

export function encryptHuaweiPayload(
  useGcm: boolean,
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aes: HuaweiAesProvider,
): Uint8Array {
  if (key.length !== 16) throw new Error("HUAWEI_AES_KEY_LENGTH");
  if (iv.length !== 16) throw new Error("HUAWEI_AES_IV_LENGTH");
  return useGcm ? aes.encryptGcm(key, data, iv) : aes.encryptCbc(key, data, iv);
}

export function decryptHuaweiPayload(
  useGcm: boolean,
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aes: HuaweiAesProvider,
): Uint8Array {
  if (key.length !== 16) throw new Error("HUAWEI_AES_KEY_LENGTH");
  if (iv.length !== 16) throw new Error("HUAWEI_AES_IV_LENGTH");
  return useGcm ? aes.decryptGcm(key, data, iv) : aes.decryptCbc(key, data, iv);
}

/** `HuaweiTLV.encryptRaw`: encrypt the serialized TLV and wrap it in 0x7C/0x7D/0x7E. */
export function wrapEncryptedHuaweiTlv(
  payload: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  useGcm: boolean,
  aes: HuaweiAesProvider,
): Uint8Array {
  const cipherText = encryptHuaweiPayload(useGcm, payload, key, iv, aes);
  return encodeHuaweiEncryptedTlv(cipherText, iv);
}

/** `HuaweiTLV.decryptRaw`: decrypt a 0x7C/0x7D/0x7E wrapper back to TLV bytes. */
export function unwrapEncryptedHuaweiTlv(
  tlv: HuaweiTlv,
  key: Uint8Array,
  useGcm: boolean,
  aes: HuaweiAesProvider,
): Uint8Array {
  const encrypted = decodeHuaweiEncryptedTlv(tlv);
  if (!encrypted) throw new Error("HUAWEI_CRYPTO_TLV");
  return decryptHuaweiPayload(useGcm, encrypted.cipherText, key, encrypted.iv, aes);
}

/**
 * Replaces an encrypted response's crypto wrapper with the decrypted TLV.
 * Plaintext responses (and sessions without a secret key) pass through.
 */
export function decryptHuaweiResponse(
  packet: HuaweiParsedPacket,
  options: Readonly<{
    secretKey: Uint8Array | null;
    aes: HuaweiAesProvider;
    useGcm: boolean;
  }>,
): HuaweiParsedPacket {
  if (!options.secretKey) return packet;
  const encryption = findField(packet.tlv, HUAWEI_CRYPTO_TAGS.encryption);
  if (!encryption || encryption.length === 0 || encryption[0] !== 0x01) return packet;
  const plain = unwrapEncryptedHuaweiTlv(
    packet.tlv,
    options.secretKey,
    options.useGcm,
    options.aes,
  );
  return { ...packet, tlv: decodeHuaweiTlv(plain) };
}

/** Lazily loads the AES primitives from `react-native-quick-crypto`. */
export async function loadHuaweiAesProvider(): Promise<HuaweiAesProvider> {
  const native = (await import("react-native-quick-crypto")) as unknown as {
    createCipheriv(
      algorithm: string,
      key: Uint8Array,
      iv: Uint8Array,
    ): {
      setAutoPadding?(value: boolean): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
      getAuthTag?(): Uint8Array;
    };
    createDecipheriv(
      algorithm: string,
      key: Uint8Array,
      iv: Uint8Array,
    ): {
      setAutoPadding?(value: boolean): void;
      setAuthTag?(tag: Uint8Array): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
    };
  };
  return {
    encryptCbc(key, data, iv) {
      const cipher = native.createCipheriv("aes-128-cbc", key, iv);
      return concatHuaweiBytes(cipher.update(data), cipher.final());
    },
    decryptCbc(key, data, iv) {
      const decipher = native.createDecipheriv("aes-128-cbc", key, iv);
      return concatHuaweiBytes(decipher.update(data), decipher.final());
    },
    encryptGcm(key, data, iv) {
      const cipher = native.createCipheriv("aes-128-gcm", key, iv);
      const body = concatHuaweiBytes(cipher.update(data), cipher.final());
      const tag = cipher.getAuthTag?.() ?? new Uint8Array(16);
      return concatHuaweiBytes(body, tag);
    },
    decryptGcm(key, data, iv) {
      if (data.length < 16) throw new Error("HUAWEI_GCM_TRUNCATED");
      const decipher = native.createDecipheriv("aes-128-gcm", key, iv);
      decipher.setAuthTag?.(data.subarray(data.length - 16));
      return concatHuaweiBytes(
        decipher.update(data.subarray(0, data.length - 16)),
        decipher.final(),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Secret key (HuaweiCrypto.createSecretKey / HuaweiSupportProvider)
// ---------------------------------------------------------------------------

/**
 * `HuaweiCrypto.createSecretKey(macAddress)`: the device-side bonding key,
 * derived from the MAC and fixed constants. `authVersion === 1` uses the v1
 * constants; every other version uses the v2/v3 constants.
 */
export function createHuaweiDeviceSecretKey(
  macAddress: string,
  authVersion: number,
  crypto: HuaweiCryptoProvider,
): Uint8Array {
  return createHuaweiSecretKey(macAddress, authVersion, crypto);
}

/**
 * `HuaweiSupportProvider.createSecretKey`: a random 16-byte local key,
 * generated once and persisted per device. It is the AES key for every
 * transaction and the payload of the bond request.
 */
export function generateHuaweiLocalSecretKey(randomBytes: Uint8Array): Uint8Array {
  if (randomBytes.length < 16) throw new Error("HUAWEI_SECRET_KEY_LENGTH");
  return randomBytes.slice(0, 16);
}

/** Persistence for the per-device local secret key. */
export type HuaweiSecretKeyStore = Readonly<{
  get(deviceId: string): Uint8Array | null;
  set(deviceId: string, key: Uint8Array): void;
}>;

/** Isolated in-memory key store (tests and the process-wide default). */
export function createMemoryHuaweiSecretKeyStore(): HuaweiSecretKeyStore {
  const keys = new Map<string, Uint8Array>();
  return {
    get: (deviceId) => keys.get(deviceId) ?? null,
    set: (deviceId, key) => {
      keys.set(deviceId, key.slice());
    },
  };
}

export const defaultHuaweiSecretKeyStore: HuaweiSecretKeyStore = createMemoryHuaweiSecretKeyStore();

/** Returns the stored key or generates and persists a new one. */
export function getOrCreateHuaweiLocalSecretKey(
  store: HuaweiSecretKeyStore,
  deviceId: string,
  randomBytes: Uint8Array,
): Uint8Array {
  const existing = store.get(deviceId);
  if (existing && existing.length === 16) return existing;
  const key = generateHuaweiLocalSecretKey(randomBytes);
  store.set(deviceId, key);
  return key;
}

// ---------------------------------------------------------------------------
// DeviceConfig (service 0x01) auth frames
// ---------------------------------------------------------------------------

export const HUAWEI_DEVICE_CONFIG_SERVICE = 0x01;
export const HUAWEI_LINK_PARAMS_COMMAND = 0x01;
export const HUAWEI_BOND_COMMAND = 0x0e;
export const HUAWEI_BOND_PARAMS_COMMAND = 0x0f;
export const HUAWEI_AUTH_COMMAND = 0x13;
export const HUAWEI_DEVICE_STATUS_COMMAND = 0x16;
export const HUAWEI_SECURITY_NEGOTIATION_COMMAND = 0x33;

/** Upstream device types: 1/3/4 are HiChain, 2 is HiChainLite. */
export const HUAWEI_DEVICE_TYPE_AW = 0x02;

export type HuaweiLinkParams = Readonly<{
  protocolVersion: number;
  sliceSize: number;
  mtu: number;
  interval: number;
  authVersion: number;
  serverNonce: Uint8Array;
  deviceSupportType: number;
  authAlgo: number;
  bondState: number;
  encryptMethod: number;
}>;

/**
 * `DeviceConfig.LinkParams.Request`: tags 0x01-0x04, plus 0x06 for AW devices.
 * Unencrypted and unsliced upstream.
 */
export function buildHuaweiLinkParamsRequest(isAw = false): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x01, value: new Uint8Array(0) },
    { tag: 0x02, value: new Uint8Array(0) },
    { tag: 0x03, value: new Uint8Array(0) },
    { tag: 0x04, value: new Uint8Array(0) },
    ...(isAw ? [{ tag: 0x06, value: new Uint8Array(0) }] : []),
  ]);
}

export function parseHuaweiLinkParamsResponse(tlv: HuaweiTlv): HuaweiLinkParams {
  const nonceField = huaweiTlvBytes(tlv, 0x05);
  if (!nonceField || nonceField.length < 18) throw new Error("HUAWEI_LINK_PARAMS_NONCE");
  return {
    protocolVersion: huaweiTlvByte(tlv, 0x01) ?? 0,
    sliceSize: huaweiTlvUint16(tlv, 0x02) ?? HUAWEI_DEFAULT_SLICE_SIZE,
    mtu: huaweiTlvUint16(tlv, 0x03) ?? 0x14,
    interval: huaweiTlvUint16(tlv, 0x04) ?? 0,
    authVersion: nonceField[1]!,
    serverNonce: nonceField.slice(2, 18),
    deviceSupportType: huaweiTlvByte(tlv, 0x07) ?? 0,
    authAlgo: huaweiTlvByte(tlv, 0x08) ?? 0,
    bondState: huaweiTlvByte(tlv, 0x09) ?? 0,
    encryptMethod: huaweiTlvByte(tlv, 0x0c) ?? 0,
  };
}

/** `DeviceConfig.DeviceStatus.Request`: tag 0x01 to ask, tag 0x02 to notify. */
export function buildHuaweiDeviceStatusRequest(askStatus = true): Uint8Array {
  return encodeHuaweiTlv([
    askStatus ? { tag: 0x01, value: new Uint8Array(0) } : { tag: 0x02, value: Uint8Array.of(0) },
  ]);
}

export function parseHuaweiDeviceStatusResponse(tlv: HuaweiTlv): number {
  return huaweiTlvByte(tlv, 0x01) ?? -1;
}

/**
 * `DeviceConfig.SecurityNegotiation.Request` (HiChainLite path): auth mode,
 * force-not-reconnected, device UUID, type and encrypt method.
 */
export function buildHuaweiSecurityNegotiationRequest(args: {
  authMode: number;
  deviceUuid: Uint8Array;
  phoneModel: string;
  encryptMethod: number;
}): Uint8Array {
  const fields: HuaweiTlvField[] = [{ tag: 0x01, value: Uint8Array.of(args.authMode & 0xff) }];
  if (args.authMode === 0x02 || args.authMode === 0x04) {
    fields.push({ tag: 0x02, value: Uint8Array.of(0x01) });
  }
  fields.push(
    { tag: 0x05, value: args.deviceUuid },
    { tag: 0x03, value: Uint8Array.of(0x01) },
    { tag: 0x04, value: Uint8Array.of(0x00) },
  );
  if (args.authMode === 0x04) {
    fields.push({ tag: 0x06, value: new Uint8Array(0) });
    fields.push({ tag: 0x07, value: utf8(args.phoneModel) });
  }
  if (args.encryptMethod === 0x01) fields.push({ tag: 0x0d, value: Uint8Array.of(0x01) });
  return encodeHuaweiTlv(fields);
}

export type HuaweiSecurityNegotiation = Readonly<{
  authType: number;
  honorPairType: number;
  responseNonce: Uint8Array | null;
}>;

export function parseHuaweiSecurityNegotiationResponse(tlv: HuaweiTlv): HuaweiSecurityNegotiation {
  let authType = -1;
  let pw = -1;
  const authTypeByte = huaweiTlvByte(tlv, 0x01);
  if (authTypeByte === 0x01) authType = 0x0186a0;
  if (authTypeByte === 0x04) pw = 4;
  let honorPairType = -1;
  const pairType = huaweiTlvByte(tlv, 0x02);
  if (pairType !== null) {
    honorPairType = pairType;
    authType = pairType;
    if (pw !== -1) authType ^= pw;
  }
  const override = huaweiTlvByte(tlv, 0x7f);
  if (override !== null) authType = override;
  return {
    authType,
    honorPairType,
    responseNonce: huaweiTlvBytes(tlv, 0x03),
  };
}

/**
 * `DeviceConfig.Auth.Request`: challenge (0x01) and `authVersion || clientNonce`
 * (0x02), plus the auth algorithm for HiChainLite. Unencrypted upstream.
 */
export function buildHuaweiAuthRequest(args: {
  authVersion: number;
  challenge: Uint8Array;
  clientNonce: Uint8Array;
  authMode: number;
  authAlgo: number;
}): Uint8Array {
  if (args.challenge.length !== 0x20) throw new Error("HUAWEI_AUTH_CHALLENGE_LENGTH");
  if (args.clientNonce.length !== 16) throw new Error("HUAWEI_AUTH_NONCE_LENGTH");
  const nonce = new Uint8Array(18);
  nonce[0] = (args.authVersion >>> 8) & 0xff;
  nonce[1] = args.authVersion & 0xff;
  nonce.set(args.clientNonce, 2);
  const fields: HuaweiTlvField[] = [
    { tag: 0x01, value: args.challenge },
    { tag: 0x02, value: nonce },
  ];
  if (args.authMode === 0x02) fields.push({ tag: 0x03, value: Uint8Array.of(args.authAlgo) });
  return encodeHuaweiTlv(fields);
}

export function parseHuaweiAuthResponse(tlv: HuaweiTlv): Uint8Array | null {
  return huaweiTlvBytes(tlv, 0x01);
}

/**
 * `HuaweiCrypto.digestChallenge` / `digestResponse`.
 *
 * Normal mode (`authMode != 0x02`) is the upstream double-HMAC digest over the
 * fixed secret for the negotiated `authVersion`. HiChainLite with
 * `authVersion == 0x02` uses `HMAC(secretKey || message, nonce) || key`, which
 * needs no device-side PIN. Every other HiChainLite combination needs the
 * device PIN code and is deliberately unsupported here.
 */
export function computeHuaweiAuthDigest(args: {
  message: Uint8Array;
  nonce: Uint8Array;
  authMode: number;
  authVersion: number;
  secretKey: Uint8Array | null;
  crypto: HuaweiCryptoProvider;
}): Uint8Array {
  if (args.authMode === 0x02) {
    if (args.authVersion !== 0x02) throw new Error("HUAWEI_HICHAIN_LITE_PINCODE_UNSUPPORTED");
    if (!args.secretKey) throw new Error("HUAWEI_AUTH_SECRET_KEY_REQUIRED");
    const key = concatHuaweiBytes(args.secretKey, args.message);
    const out = new Uint8Array(0x40);
    out.set(args.crypto.hmacSha256(key, args.nonce), 0);
    out.set(key, 0x20);
    return out;
  }
  return computeHuaweiDigest(args.message, args.nonce, args.authVersion, args.crypto);
}

/** The two 2-byte digest messages (`HuaweiCrypto.MESSAGE_*`). */
export const HUAWEI_DIGEST_MESSAGE_CHALLENGE = HUAWEI_MESSAGE_CHALLENGE;
export const HUAWEI_DIGEST_MESSAGE_RESPONSE = HUAWEI_MESSAGE_RESPONSE;
export const HUAWEI_DIGEST_MESSAGE_CHALLENGE_V4 = HUAWEI_MESSAGE_CHALLENGE_V4;

/** The challenge message for a negotiated auth version (v4 has its own tag). */
export function huaweiChallengeMessage(authVersion: number): Uint8Array {
  return authVersion === 4 ? HUAWEI_MESSAGE_CHALLENGE_V4 : HUAWEI_MESSAGE_CHALLENGE;
}

/** `DeviceConfig.BondParams.Request`: serial, fixed 0x02, random MAC, flags. */
export function buildHuaweiBondParamsRequest(args: {
  clientSerial: Uint8Array;
  macAddress: Uint8Array;
}): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x01, value: new Uint8Array(0) },
    { tag: 0x03, value: args.clientSerial },
    { tag: 0x04, value: Uint8Array.of(0x02) },
    { tag: 0x05, value: new Uint8Array(0) },
    { tag: 0x07, value: args.macAddress },
    { tag: 0x09, value: new Uint8Array(0) },
  ]);
}

export type HuaweiBondParams = Readonly<{ status: number; encryptionCounter: number }>;

export function parseHuaweiBondParamsResponse(tlv: HuaweiTlv): HuaweiBondParams {
  return {
    status: huaweiTlvByte(tlv, 0x01) ?? 0,
    encryptionCounter: huaweiTlvUint32(tlv, 0x09) ?? 0,
  };
}

/** `DeviceConfig.Bond.Request`: serial, encrypted local key and its IV. */
export function buildHuaweiBondRequest(args: {
  clientSerial: Uint8Array;
  encryptedKey: Uint8Array;
  iv: Uint8Array;
}): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x01, value: new Uint8Array(0) },
    { tag: 0x03, value: Uint8Array.of(0x00) },
    { tag: 0x05, value: args.clientSerial },
    { tag: 0x06, value: args.encryptedKey },
    { tag: 0x07, value: args.iv },
  ]);
}

/**
 * `HuaweiCrypto.encryptBondingKey`: AES-GCM when `encryptMethod == 1`,
 * otherwise AES-CBC-PKCS7.
 */
export function encryptHuaweiBondingKey(
  encryptMethod: number,
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aes: HuaweiAesProvider,
): Uint8Array {
  return encryptHuaweiPayload(encryptMethod === 0x01, data, key, iv, aes);
}

function utf8(value: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// FitnessData (service 0x07) sync frames
// ---------------------------------------------------------------------------

export const HUAWEI_FITNESS_SERVICE = 0x07;
export const HUAWEI_FITNESS_TOTALS_COMMAND = 0x03;
export const HUAWEI_STEP_DATA_COUNT_COMMAND = 0x0a;
export const HUAWEI_STEP_DATA_COMMAND = 0x0b;
export const HUAWEI_SLEEP_DATA_COUNT_COMMAND = 0x0c;
export const HUAWEI_SLEEP_DATA_COMMAND = 0x0d;

/** Sleep record types (`HuaweiSampleProvider.RawTypes`). */
export const HUAWEI_SLEEP_LIGHT = 0x06;
export const HUAWEI_SLEEP_DEEP = 0x07;

function uint32be(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function uint16beValue(value: number): Uint8Array {
  return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
}

/** `FitnessData.MessageCount.Request`: container 0x81 with start/end u32. */
export function buildHuaweiMessageCountRequest(start: number, end: number): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x81, value: new Uint8Array(0) },
    { tag: 0x03, value: uint32be(start) },
    { tag: 0x04, value: uint32be(end) },
  ]);
}

export function parseHuaweiMessageCountResponse(tlv: HuaweiTlv): number {
  const container = huaweiTlvObject(tlv, 0x81);
  if (!container) throw new Error("HUAWEI_COUNT_CONTAINER");
  return huaweiTlvShort(container, 0x02) ?? 0;
}

/** `FitnessData.FitnessTotals.Request`: tag 0x01. */
export function buildHuaweiFitnessTotalsRequest(): Uint8Array {
  return encodeHuaweiTlv([{ tag: 0x01, value: new Uint8Array(0) }]);
}

export type HuaweiFitnessTotals = Readonly<{
  totalSteps: number;
  totalCalories: number;
  totalDistance: number;
}>;

export function parseHuaweiFitnessTotalsResponse(tlv: HuaweiTlv): HuaweiFitnessTotals {
  const container = huaweiTlvObject(tlv, 0x81);
  let totalSteps = 0;
  let totalCalories = 0;
  let totalDistance = 0;
  if (container) {
    for (const item of huaweiTlvObjects(container, 0x83)) {
      totalSteps += huaweiTlvUint32(item, 0x05) ?? 0;
      totalCalories += huaweiTlvUint16(item, 0x06) ?? 0;
      totalDistance += huaweiTlvUint32(item, 0x07) ?? 0;
    }
  }
  return { totalSteps, totalCalories, totalDistance };
}

/** `FitnessData.MessageData.Request`: container 0x81 with the message index. */
export function buildHuaweiMessageDataRequest(count: number): Uint8Array {
  return encodeHuaweiTlv([
    { tag: 0x81, value: encodeHuaweiTlv([{ tag: 0x02, value: uint16beValue(count) }]) },
  ]);
}

/** One parsed per-minute step sample. */
export type HuaweiStepMinute = Readonly<{
  /** Epoch milliseconds of the exact minute. */
  timestamp: number;
  steps: number;
  calories: number;
  distance: number;
  heartRate: number | null;
  spo2: number | null;
  restingHeartRate: number | null;
}>;

export type HuaweiStepData = Readonly<{
  number: number;
  timestamp: number;
  minutes: readonly HuaweiStepMinute[];
}>;

export type HuaweiStepFeatures = Readonly<{
  steps: number;
  calories: number;
  distance: number;
  heartRate: number;
  spo2: number;
  restingHeartRate: number;
  unknownTags: readonly number[];
}>;

/**
 * `FitnessData.MessageData.StepResponse.parseData`: the feature bitmap selects
 * which values follow. Bitmap 1: 0x02 steps (2B), 0x04 calories (2B), 0x08
 * distance (2B), 0x20 unknown (1B), 0x40 heart rate (1B), 0x80 → bitmap 2.
 * Bitmap 2: 0x01 SpO2 (1B), 0x02 resting HR (1B).
 */
export function parseHuaweiStepFeatures(data: Uint8Array): HuaweiStepFeatures {
  if (data.length === 0) throw new Error("HUAWEI_STEP_DATA_EMPTY");
  let index = 0;
  const bitmap1 = data[index++]!;
  let bitmap2 = 0;
  if ((bitmap1 & 0x80) !== 0) {
    if (data.length <= index) throw new Error("HUAWEI_STEP_BITMAP2_MISSING");
    bitmap2 = data[index++]!;
  }
  let steps = -1;
  let calories = -1;
  let distance = -1;
  let heartRate = -1;
  let spo2 = -1;
  let restingHeartRate = -1;
  const unknownTags: number[] = [];

  for (let bit = 1; bit < 0x80; bit <<= 1) {
    if ((bitmap1 & bit) === 0) continue;
    let value: number;
    if (bit === 0x20 || bit === 0x40) {
      if (data.length - 1 < index) throw new Error("HUAWEI_STEP_DATA_SHORT");
      value = data[index++]!;
    } else {
      if (data.length - 2 < index) throw new Error("HUAWEI_STEP_DATA_SHORT");
      value = (data[index++]! << 8) | data[index++]!;
    }
    if (bit === 0x02) steps = value;
    else if (bit === 0x04) calories = value;
    else if (bit === 0x08) distance = value;
    else if (bit === 0x40) heartRate = value;
    else unknownTags.push(bit);
  }

  if (bitmap2 !== 0) {
    for (let bit = 1; bit <= 0x80; bit <<= 1) {
      if ((bitmap2 & bit) === 0) continue;
      if (data.length - 1 < index) throw new Error("HUAWEI_STEP_DATA_SHORT");
      const value = data[index++]!;
      if (bit === 0x01) spo2 = value;
      else if (bit === 0x02) restingHeartRate = value;
      else unknownTags.push(bit | 0x100);
    }
  }

  return { steps, calories, distance, heartRate, spo2, restingHeartRate, unknownTags };
}

/**
 * `FitnessData.MessageData.StepResponse.parseTlv`: container 0x81 with the
 * message number, base timestamp and 0x84 sub-containers (minute offset 0x05,
 * feature-blob 0x06).
 */
export function parseHuaweiStepDataResponse(tlv: HuaweiTlv): HuaweiStepData {
  const container = huaweiTlvObject(tlv, 0x81);
  if (!container) throw new Error("HUAWEI_STEP_CONTAINER");
  const number = huaweiTlvShort(container, 0x02) ?? 0;
  const base = huaweiTlvUint32(container, 0x03) ?? 0;
  const minutes: HuaweiStepMinute[] = [];
  for (const sub of huaweiTlvObjects(container, 0x84)) {
    const offset = huaweiTlvByte(sub, 0x05) ?? 0;
    const data = huaweiTlvBytes(sub, 0x06) ?? new Uint8Array(0);
    let features: HuaweiStepFeatures;
    try {
      features = parseHuaweiStepFeatures(data);
    } catch {
      // Upstream skips a sub-container whose feature blob is malformed rather
      // than failing the whole transfer.
      continue;
    }
    minutes.push({
      timestamp: (base + 60 * offset) * 1000,
      steps: features.steps,
      calories: features.calories,
      distance: features.distance,
      heartRate: features.heartRate >= 1 && features.heartRate <= 254 ? features.heartRate : null,
      spo2: features.spo2 >= 0 ? features.spo2 : null,
      restingHeartRate:
        features.restingHeartRate >= 1 && features.restingHeartRate <= 254
          ? features.restingHeartRate
          : null,
    });
  }
  return { number, timestamp: base * 1000, minutes };
}

/** One raw sleep record: a contiguous run of one stage. */
export type HuaweiSleepRecord = Readonly<{
  type: number;
  /** Epoch milliseconds. */
  startTime: number;
  /** Epoch milliseconds. */
  endTime: number;
}>;

export type HuaweiSleepData = Readonly<{
  number: number;
  records: readonly HuaweiSleepRecord[];
}>;

/**
 * `FitnessData.MessageData.SleepResponse.parseTlv`: container 0x81 with the
 * message number and 0x83 sub-containers (type 0x04, 6-byte timestamp 0x05:
 * u32 epoch seconds + u16 minutes).
 */
export function parseHuaweiSleepDataResponse(tlv: HuaweiTlv): HuaweiSleepData {
  const container = huaweiTlvObject(tlv, 0x81);
  if (!container) throw new Error("HUAWEI_SLEEP_CONTAINER");
  const number = huaweiTlvShort(container, 0x02) ?? 0;
  const records: HuaweiSleepRecord[] = [];
  for (const sub of huaweiTlvObjects(container, 0x83)) {
    const type = huaweiTlvByte(sub, 0x04) ?? 0;
    const timestamp = huaweiTlvBytes(sub, 0x05);
    if (!timestamp || timestamp.length < 6) continue;
    const start =
      ((timestamp[0]! << 24) | (timestamp[1]! << 16) | (timestamp[2]! << 8) | timestamp[3]!) >>> 0;
    const duration = (timestamp[4]! << 8) | timestamp[5]!;
    records.push({
      type,
      startTime: start * 1000,
      endTime: (start + duration * 60) * 1000,
    });
  }
  return { number, records };
}

// ---------------------------------------------------------------------------
// Records (frozen contract shapes)
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

export type HuaweiStepsRecord = Readonly<{
  type: "steps";
  startTime: string;
  endTime: string;
  count: number;
}>;

export type HuaweiHeartRateRecord = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

export type HuaweiSleepStage = Readonly<{
  stage: "light" | "deep" | "awake";
  startTime: string;
  endTime: string;
}>;

export type HuaweiSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly HuaweiSleepStage[];
}>;

/** Any record a Huawei BLE sync can emit. */
export type HuaweiRecord = HuaweiStepsRecord | HuaweiHeartRateRecord | HuaweiSleepSession;

function isoMinute(timestamp: number): string {
  return new Date(Math.floor(timestamp / MINUTE_MS) * MINUTE_MS).toISOString();
}

/**
 * Converts one parsed minute into the frozen record shapes: always an
 * exact-minute `steps` record, plus a `heart_rate` point when the sample
 * carries a measured value.
 */
export function huaweiStepMinuteToRecords(minute: HuaweiStepMinute): readonly HuaweiRecord[] {
  const start = Math.floor(minute.timestamp / MINUTE_MS) * MINUTE_MS;
  const records: HuaweiRecord[] = [
    {
      type: "steps",
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + MINUTE_MS).toISOString(),
      count: minute.steps >= 0 ? minute.steps : 0,
    },
  ];
  if (minute.heartRate !== null) {
    records.push({ type: "heart_rate", time: isoMinute(start), bpm: minute.heartRate });
  }
  return records;
}

/** Upstream `SleepSessionSegmenter` bounds, mirrored for Huawei sleep records. */
export const HUAWEI_MIN_SESSION_SECONDS = 5 * 60;
export const HUAWEI_MAX_WAKE_PHASE_SECONDS = 60 * 60;
export const HUAWEI_TRAILING_STAGE_SECONDS = 60;

type SleepMinute = Readonly<{ timestamp: number; stage: "light" | "deep" }>;

/**
 * Expands raw sleep records into per-minute stages, then segments them with the
 * legacy-Huami rules: a session starts at the first sleep minute, a gap longer
 * than 60 minutes closes it, sessions of five minutes or less are discarded,
 * and stages are contiguous runs with the final stage extended by 60 s.
 */
export function segmentHuaweiSleepSessions(
  records: readonly HuaweiSleepRecord[],
): readonly HuaweiSleepSession[] {
  const minutes = new Map<number, "light" | "deep">();
  for (const record of records) {
    if (record.type !== HUAWEI_SLEEP_LIGHT && record.type !== HUAWEI_SLEEP_DEEP) continue;
    const stage = record.type === HUAWEI_SLEEP_LIGHT ? "light" : "deep";
    const start = Math.floor(record.startTime / MINUTE_MS) * MINUTE_MS;
    const count = Math.max(0, Math.round((record.endTime - start) / MINUTE_MS));
    for (let index = 0; index < count; index += 1) {
      minutes.set(start + index * MINUTE_MS, stage);
    }
  }
  const samples: SleepMinute[] = [...minutes.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([timestamp, stage]) => ({ timestamp, stage }));

  const sessions: HuaweiSleepSession[] = [];
  const emit = (first: number, last: number) => {
    const start = samples[first]!.timestamp;
    const end = samples[last]!.timestamp + HUAWEI_TRAILING_STAGE_SECONDS * 1000;
    if (end - start <= HUAWEI_MIN_SESSION_SECONDS * 1000) return;
    const stages: HuaweiSleepStage[] = [];
    let stageStart = start;
    let stageKind = samples[first]!.stage;
    for (let index = first + 1; index <= last; index += 1) {
      const kind = samples[index]!.stage;
      if (kind !== stageKind) {
        const stageEnd = samples[index]!.timestamp;
        stages.push({
          stage: stageKind,
          startTime: new Date(stageStart).toISOString(),
          endTime: new Date(stageEnd).toISOString(),
        });
        stageKind = kind;
        stageStart = stageEnd;
      }
    }
    stages.push({
      stage: stageKind,
      startTime: new Date(stageStart).toISOString(),
      endTime: new Date(end).toISOString(),
    });
    sessions.push({
      type: "sleep_session",
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      stages,
    });
  };

  let first = -1;
  let last = -1;
  for (let index = 0; index < samples.length; index += 1) {
    if (first === -1) {
      first = index;
      last = index;
      continue;
    }
    const gap = samples[index]!.timestamp - samples[last]!.timestamp;
    if (gap > HUAWEI_MAX_WAKE_PHASE_SECONDS * 1000) {
      emit(first, last);
      first = index;
    }
    last = index;
  }
  if (first !== -1 && last !== -1) emit(first, last);
  return sessions;
}
