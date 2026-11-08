/*  Copyright (C) 2023-2026 Gadgetbridge contributors

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
 * Minimal hand-rolled protobuf codec for the Xiaomi connection foundation.
 *
 * Upstream `.proto` sources (pinned revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2):
 * - `GBProtobufGenerator/src/main/proto/xiaomi.proto` (`Command`)
 * - `GBProtobufGenerator/src/main/proto/xiaomi/wear_account.proto`
 *   (`Account`, `Auth.AppVerify`, `Auth.DeviceVerify`, `Auth.AppConfirm`,
 *   `CompanionDevice`)
 * - `GBProtobufGenerator/src/main/proto/xiaomi/wear_system.proto`
 *   (`System`, `Power`, `Battery`, `DeviceInfo`)
 *
 * Only the messages needed to discover, authenticate and read device info are
 * modelled. The wire format is standard protobuf: varint, length-delimited,
 * 32-bit float and 64-bit fixed fields. Unknown fields are skipped; groups
 * (wire types 3/4) are rejected. Every length and varint is bounds-checked.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Maximum accepted message size; Xiaomi control messages are far smaller. */
export const DEFAULT_MAX_PROTO_BYTES = 1024 * 1024;

const MAX_FIELD_NUMBER = 0x1fffffff; // 2^29 - 1

export type ProtoWireType = 0 | 1 | 2 | 5;

export type ProtoValue = Readonly<{
  wireType: ProtoWireType;
  /** Varint/fixed32 as a number; length-delimited/fixed64 as bytes. */
  value: number | Uint8Array;
}>;

export type ProtoField =
  | Readonly<{ field: number; wireType: 0; value: number }>
  | Readonly<{ field: number; wireType: 1; value: Uint8Array }>
  | Readonly<{ field: number; wireType: 2; value: Uint8Array }>
  | Readonly<{ field: number; wireType: 5; value: number }>;

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function assertFieldNumber(field: number): void {
  if (!Number.isInteger(field) || field < 1 || field > MAX_FIELD_NUMBER) {
    throw new Error("PROTO_FIELD_NUMBER");
  }
}

function assertUnsigned(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("PROTO_VARINT");
}

function writeVarint(out: number[], value: number): void {
  assertUnsigned(value);
  let remaining = value;
  while (remaining > 0x7f) {
    out.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  out.push(remaining);
}

function writeTag(out: number[], field: number, wireType: ProtoWireType): void {
  assertFieldNumber(field);
  writeVarint(out, field * 8 + wireType);
}

function writeLengthDelimited(out: number[], field: number, bytes: Uint8Array): void {
  writeTag(out, field, 2);
  writeVarint(out, bytes.length);
  for (const byte of bytes) out.push(byte);
}

function writeFixed32(out: number[], field: number, value: number): void {
  writeTag(out, field, 5);
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value >>> 0, true);
  for (const byte of new Uint8Array(buffer)) out.push(byte);
}

function writeFixed64(out: number[], field: number, bytes: Uint8Array): void {
  if (bytes.length !== 8) throw new Error("PROTO_FIXED64");
  writeTag(out, field, 1);
  for (const byte of bytes) out.push(byte);
}

/** Encodes a list of fields in order. */
export function encodeMessage(fields: readonly ProtoField[]): Uint8Array {
  const out: number[] = [];
  for (const field of fields) {
    switch (field.wireType) {
      case 0:
        writeTag(out, field.field, 0);
        writeVarint(out, field.value);
        break;
      case 1:
        writeFixed64(out, field.field, field.value);
        break;
      case 2:
        writeLengthDelimited(out, field.field, field.value);
        break;
      case 5:
        writeFixed32(out, field.field, field.value);
        break;
    }
  }
  return Uint8Array.from(out);
}

export function varintField(field: number, value: number): ProtoField {
  return { field, wireType: 0, value };
}

export function bytesField(field: number, value: Uint8Array): ProtoField {
  return { field, wireType: 2, value };
}

export function stringField(field: number, value: string): ProtoField {
  return { field, wireType: 2, value: utf8Encode(value) };
}

export function boolField(field: number, value: boolean): ProtoField {
  return { field, wireType: 0, value: value ? 1 : 0 };
}

export function floatField(field: number, value: number): ProtoField {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  const bytes = new Uint8Array(buffer);
  const asUint32 = bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24);
  return { field, wireType: 5, value: asUint32 >>> 0 };
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

class Reader {
  private offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly maxBytes: number,
  ) {
    if (bytes.length > maxBytes) throw new Error("PROTO_TOO_LARGE");
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readVarint(): number {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 10; index += 1) {
      if (this.offset >= this.bytes.length) throw new Error("PROTO_TRUNCATED");
      const byte = this.bytes[this.offset++]!;
      value += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(value)) throw new Error("PROTO_VARINT_OVERFLOW");
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new Error("PROTO_VARINT_OVERFLOW");
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("PROTO_LENGTH");
    if (length > this.remaining) throw new Error("PROTO_TRUNCATED");
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readFixed32(): number {
    if (this.remaining < 4) throw new Error("PROTO_TRUNCATED");
    const value =
      (this.bytes[this.offset]! |
        (this.bytes[this.offset + 1]! << 8) |
        (this.bytes[this.offset + 2]! << 16) |
        (this.bytes[this.offset + 3]! << 24)) >>>
      0;
    this.offset += 4;
    return value;
  }

  readFixed64(): Uint8Array {
    if (this.remaining < 8) throw new Error("PROTO_TRUNCATED");
    const value = this.bytes.slice(this.offset, this.offset + 8);
    this.offset += 8;
    return value;
  }
}

/** Decodes a message into field number → values (last value wins for singular fields). */
export function decodeMessage(
  bytes: Uint8Array,
  maxBytes = DEFAULT_MAX_PROTO_BYTES,
): Map<number, ProtoValue[]> {
  const reader = new Reader(bytes, maxBytes);
  const fields = new Map<number, ProtoValue[]>();
  while (reader.remaining > 0) {
    const tag = reader.readVarint();
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (field < 1 || field > MAX_FIELD_NUMBER) throw new Error("PROTO_FIELD_NUMBER");

    let value: ProtoValue;
    switch (wireType) {
      case 0:
        value = { wireType: 0, value: reader.readVarint() };
        break;
      case 1:
        value = { wireType: 1, value: reader.readFixed64() };
        break;
      case 2: {
        const length = reader.readVarint();
        if (length > maxBytes) throw new Error("PROTO_TOO_LARGE");
        value = { wireType: 2, value: reader.readBytes(length) };
        break;
      }
      case 5:
        value = { wireType: 5, value: reader.readFixed32() };
        break;
      case 3:
      case 4:
        throw new Error("PROTO_GROUP_UNSUPPORTED");
      default:
        throw new Error("PROTO_WIRE_TYPE");
    }
    const existing = fields.get(field);
    if (existing) existing.push(value);
    else fields.set(field, [value]);
  }
  return fields;
}

function lastValue(
  fields: Map<number, ProtoValue[]>,
  field: number,
  wireType: ProtoWireType,
): ProtoValue | undefined {
  const values = fields.get(field);
  if (!values || values.length === 0) return undefined;
  const value = values[values.length - 1]!;
  if (value.wireType !== wireType) throw new Error("PROTO_WIRE_TYPE");
  return value;
}

function readVarintField(fields: Map<number, ProtoValue[]>, field: number): number | undefined {
  const value = lastValue(fields, field, 0);
  return value ? (value.value as number) : undefined;
}

function readBytesField(fields: Map<number, ProtoValue[]>, field: number): Uint8Array | undefined {
  const value = lastValue(fields, field, 2);
  return value ? (value.value as Uint8Array) : undefined;
}

function readStringField(fields: Map<number, ProtoValue[]>, field: number): string | undefined {
  const bytes = readBytesField(fields, field);
  return bytes ? utf8Decode(bytes) : undefined;
}

function readFloatField(fields: Map<number, ProtoValue[]>, field: number): number | undefined {
  const value = lastValue(fields, field, 5);
  if (!value) return undefined;
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value.value as number, true);
  return new DataView(buffer).getFloat32(0, true);
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`PROTO_REQUIRED_${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// UTF-8
// ---------------------------------------------------------------------------

function utf8Encode(value: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        throw new Error("PROTO_INVALID_UTF8");
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("PROTO_INVALID_UTF8");
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index++]!;
    let code: number;
    let continuation: number;
    if (first < 0x80) {
      code = first;
      continuation = 0;
    } else if ((first & 0xe0) === 0xc0) {
      code = first & 0x1f;
      continuation = 1;
    } else if ((first & 0xf0) === 0xe0) {
      code = first & 0x0f;
      continuation = 2;
    } else if ((first & 0xf8) === 0xf0) {
      code = first & 0x07;
      continuation = 3;
    } else {
      throw new Error("PROTO_INVALID_UTF8");
    }
    if (index + continuation > bytes.length) throw new Error("PROTO_INVALID_UTF8");
    for (let count = 0; count < continuation; count += 1) {
      const byte = bytes[index++]!;
      if ((byte & 0xc0) !== 0x80) throw new Error("PROTO_INVALID_UTF8");
      code = (code << 6) | (byte & 0x3f);
    }
    if (
      (continuation === 1 && code < 0x80) ||
      (continuation === 2 && code < 0x800) ||
      (continuation === 3 && code < 0x10000) ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      throw new Error("PROTO_INVALID_UTF8");
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Xiaomi messages (field numbers from the .proto files)
// ---------------------------------------------------------------------------

export type XiaomiAuthAppVerify = {
  nonce: Uint8Array;
  deviceId?: string;
  checkDynamicCode?: boolean;
};

export type XiaomiAuthDeviceVerify = {
  nonce: Uint8Array;
  hmac: Uint8Array;
};

export type XiaomiAuthAppConfirm = {
  encryptedNonces: Uint8Array;
  encryptedDeviceInfo: Uint8Array;
};

export type XiaomiAuthDeviceConfirm = {
  unknown1: boolean;
  deviceCapability?: number;
  deviceCapability2?: number;
};

export type XiaomiAccount = {
  userId?: string;
  status?: number;
  appVerify?: XiaomiAuthAppVerify;
  deviceVerify?: XiaomiAuthDeviceVerify;
  appConfirm?: XiaomiAuthAppConfirm;
  authStep4?: XiaomiAuthDeviceConfirm;
};

export type XiaomiCompanionDevice = {
  unknown1: number;
  phoneApiLevel: number;
  phoneName: string;
  unknown3: number;
  region: string;
};

export type XiaomiBattery = {
  level?: number;
  state?: number;
};

export type XiaomiDeviceInfo = {
  serialNumber: string;
  firmware: string;
  unknown3?: string;
  model: string;
};

export type XiaomiSystem = {
  battery?: XiaomiBattery;
  deviceInfo?: XiaomiDeviceInfo;
};

export type XiaomiCommand = {
  type: number;
  subtype?: number;
  auth?: XiaomiAccount;
  system?: XiaomiSystem;
  status?: number;
};

export function encodeAppVerify(value: XiaomiAuthAppVerify): Uint8Array {
  const fields: ProtoField[] = [bytesField(1, value.nonce)];
  if (value.deviceId !== undefined) fields.push(stringField(2, value.deviceId));
  if (value.checkDynamicCode !== undefined) fields.push(boolField(3, value.checkDynamicCode));
  return encodeMessage(fields);
}

export function decodeAppVerify(bytes: Uint8Array): XiaomiAuthAppVerify {
  const fields = decodeMessage(bytes);
  const checkDynamicCode = readVarintField(fields, 3);
  return {
    nonce: required(readBytesField(fields, 1), "APP_VERIFY_NONCE"),
    deviceId: readStringField(fields, 2),
    checkDynamicCode: checkDynamicCode === undefined ? undefined : checkDynamicCode !== 0,
  };
}

export function encodeDeviceVerify(value: XiaomiAuthDeviceVerify): Uint8Array {
  return encodeMessage([bytesField(1, value.nonce), bytesField(2, value.hmac)]);
}

export function decodeDeviceVerify(bytes: Uint8Array): XiaomiAuthDeviceVerify {
  const fields = decodeMessage(bytes);
  return {
    nonce: required(readBytesField(fields, 1), "DEVICE_VERIFY_NONCE"),
    hmac: required(readBytesField(fields, 2), "DEVICE_VERIFY_HMAC"),
  };
}

export function encodeAppConfirm(value: XiaomiAuthAppConfirm): Uint8Array {
  return encodeMessage([
    bytesField(1, value.encryptedNonces),
    bytesField(2, value.encryptedDeviceInfo),
  ]);
}

export function decodeAppConfirm(bytes: Uint8Array): XiaomiAuthAppConfirm {
  const fields = decodeMessage(bytes);
  return {
    encryptedNonces: required(readBytesField(fields, 1), "APP_CONFIRM_NONCES"),
    encryptedDeviceInfo: required(readBytesField(fields, 2), "APP_CONFIRM_DEVICE_INFO"),
  };
}

export function encodeDeviceConfirm(value: XiaomiAuthDeviceConfirm): Uint8Array {
  const fields: ProtoField[] = [boolField(1, value.unknown1)];
  if (value.deviceCapability !== undefined) {
    fields.push(varintField(2, value.deviceCapability));
  }
  if (value.deviceCapability2 !== undefined) {
    fields.push(varintField(3, value.deviceCapability2));
  }
  return encodeMessage(fields);
}

export function decodeDeviceConfirm(bytes: Uint8Array): XiaomiAuthDeviceConfirm {
  const fields = decodeMessage(bytes);
  return {
    unknown1: required(readVarintField(fields, 1), "DEVICE_CONFIRM_UNKNOWN1") !== 0,
    deviceCapability: readVarintField(fields, 2),
    deviceCapability2: readVarintField(fields, 3),
  };
}

export function encodeAccount(value: XiaomiAccount): Uint8Array {
  const fields: ProtoField[] = [];
  if (value.userId !== undefined) fields.push(stringField(7, value.userId));
  if (value.status !== undefined) fields.push(varintField(8, value.status));
  if (value.appVerify) fields.push(bytesField(30, encodeAppVerify(value.appVerify)));
  if (value.deviceVerify) fields.push(bytesField(31, encodeDeviceVerify(value.deviceVerify)));
  if (value.appConfirm) fields.push(bytesField(32, encodeAppConfirm(value.appConfirm)));
  if (value.authStep4) fields.push(bytesField(33, encodeDeviceConfirm(value.authStep4)));
  return encodeMessage(fields);
}

export function decodeAccount(bytes: Uint8Array): XiaomiAccount {
  const fields = decodeMessage(bytes);
  const appVerify = readBytesField(fields, 30);
  const deviceVerify = readBytesField(fields, 31);
  const appConfirm = readBytesField(fields, 32);
  const authStep4 = readBytesField(fields, 33);
  return {
    userId: readStringField(fields, 7),
    status: readVarintField(fields, 8),
    appVerify: appVerify ? decodeAppVerify(appVerify) : undefined,
    deviceVerify: deviceVerify ? decodeDeviceVerify(deviceVerify) : undefined,
    appConfirm: appConfirm ? decodeAppConfirm(appConfirm) : undefined,
    authStep4: authStep4 ? decodeDeviceConfirm(authStep4) : undefined,
  };
}

export function encodeCompanionDevice(value: XiaomiCompanionDevice): Uint8Array {
  return encodeMessage([
    varintField(1, value.unknown1),
    floatField(2, value.phoneApiLevel),
    stringField(3, value.phoneName),
    varintField(4, value.unknown3),
    stringField(5, value.region),
  ]);
}

export function decodeCompanionDevice(bytes: Uint8Array): XiaomiCompanionDevice {
  const fields = decodeMessage(bytes);
  return {
    unknown1: required(readVarintField(fields, 1), "COMPANION_UNKNOWN1"),
    phoneApiLevel: required(readFloatField(fields, 2), "COMPANION_API_LEVEL"),
    phoneName: required(readStringField(fields, 3), "COMPANION_PHONE_NAME"),
    unknown3: required(readVarintField(fields, 4), "COMPANION_UNKNOWN3"),
    region: required(readStringField(fields, 5), "COMPANION_REGION"),
  };
}

export function encodeBattery(value: XiaomiBattery): Uint8Array {
  const fields: ProtoField[] = [];
  if (value.level !== undefined) fields.push(varintField(1, value.level));
  if (value.state !== undefined) fields.push(varintField(2, value.state));
  return encodeMessage(fields);
}

export function decodeBattery(bytes: Uint8Array): XiaomiBattery {
  const fields = decodeMessage(bytes);
  return { level: readVarintField(fields, 1), state: readVarintField(fields, 2) };
}

export function encodeDeviceInfo(value: XiaomiDeviceInfo): Uint8Array {
  const fields: ProtoField[] = [stringField(1, value.serialNumber), stringField(2, value.firmware)];
  if (value.unknown3 !== undefined) fields.push(stringField(3, value.unknown3));
  fields.push(stringField(4, value.model));
  return encodeMessage(fields);
}

export function decodeDeviceInfo(bytes: Uint8Array): XiaomiDeviceInfo {
  const fields = decodeMessage(bytes);
  return {
    serialNumber: required(readStringField(fields, 1), "DEVICE_INFO_SERIAL"),
    firmware: required(readStringField(fields, 2), "DEVICE_INFO_FIRMWARE"),
    unknown3: readStringField(fields, 3),
    model: required(readStringField(fields, 4), "DEVICE_INFO_MODEL"),
  };
}

export function encodeSystem(value: XiaomiSystem): Uint8Array {
  const fields: ProtoField[] = [];
  if (value.battery) {
    fields.push(bytesField(2, encodeMessage([bytesField(1, encodeBattery(value.battery))])));
  }
  if (value.deviceInfo) fields.push(bytesField(3, encodeDeviceInfo(value.deviceInfo)));
  return encodeMessage(fields);
}

export function decodeSystem(bytes: Uint8Array): XiaomiSystem {
  const fields = decodeMessage(bytes);
  const power = readBytesField(fields, 2);
  const deviceInfo = readBytesField(fields, 3);
  let battery: XiaomiBattery | undefined;
  if (power) {
    const batteryBytes = readBytesField(decodeMessage(power), 1);
    if (batteryBytes) battery = decodeBattery(batteryBytes);
  }
  return {
    battery,
    deviceInfo: deviceInfo ? decodeDeviceInfo(deviceInfo) : undefined,
  };
}

export function encodeCommand(value: XiaomiCommand): Uint8Array {
  const fields: ProtoField[] = [varintField(1, value.type)];
  if (value.subtype !== undefined) fields.push(varintField(2, value.subtype));
  if (value.auth) fields.push(bytesField(3, encodeAccount(value.auth)));
  if (value.system) fields.push(bytesField(4, encodeSystem(value.system)));
  if (value.status !== undefined) fields.push(varintField(100, value.status));
  return encodeMessage(fields);
}

export function decodeCommand(bytes: Uint8Array): XiaomiCommand {
  const fields = decodeMessage(bytes);
  const auth = readBytesField(fields, 3);
  const system = readBytesField(fields, 4);
  return {
    type: required(readVarintField(fields, 1), "COMMAND_TYPE"),
    subtype: readVarintField(fields, 2),
    auth: auth ? decodeAccount(auth) : undefined,
    system: system ? decodeSystem(system) : undefined,
    status: readVarintField(fields, 100),
  };
}
