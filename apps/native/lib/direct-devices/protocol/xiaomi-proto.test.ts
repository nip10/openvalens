/**
 * Tests for the minimal Xiaomi protobuf wire codec.
 *
 * Field numbers come from the pinned upstream `.proto` files
 * (`xiaomi.proto`, `xiaomi/wear_account.proto`, `xiaomi/wear_system.proto`).
 * AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  decodeAppConfirm,
  decodeAppVerify,
  decodeCommand,
  decodeCompanionDevice,
  decodeDeviceInfo,
  decodeDeviceVerify,
  decodeMessage,
  decodeSystem,
  encodeAppConfirm,
  encodeAppVerify,
  encodeCommand,
  encodeCompanionDevice,
  encodeDeviceInfo,
  encodeDeviceVerify,
  encodeMessage,
  encodeSystem,
  varintField,
  type ProtoField,
} from "./xiaomi-proto";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

test("Command encodes the upstream field numbers", () => {
  const encoded = encodeCommand({
    type: 1,
    subtype: 26,
    auth: { appVerify: { nonce: bytes(1, 2, 3) } },
  });

  expect(hex(encoded)).toBe("0801101a1a08f201050a03010203");
});

test("AppVerify round-trips nonce, device id and dynamic-code flag", () => {
  const encoded = encodeAppVerify({
    nonce: bytes(1, 2, 3),
    deviceId: "dev",
    checkDynamicCode: true,
  });

  expect(hex(encoded)).toBe("0a0301020312036465761801");
  expect(decodeAppVerify(encoded)).toEqual({
    nonce: bytes(1, 2, 3),
    deviceId: "dev",
    checkDynamicCode: true,
  });
});

test("DeviceVerify and AppConfirm round-trip", () => {
  const deviceVerify = encodeDeviceVerify({ nonce: bytes(1, 2), hmac: bytes(3, 4) });
  expect(decodeDeviceVerify(deviceVerify)).toEqual({ nonce: bytes(1, 2), hmac: bytes(3, 4) });

  const appConfirm = encodeAppConfirm({
    encryptedNonces: bytes(5, 6),
    encryptedDeviceInfo: bytes(7, 8),
  });
  expect(decodeAppConfirm(appConfirm)).toEqual({
    encryptedNonces: bytes(5, 6),
    encryptedDeviceInfo: bytes(7, 8),
  });
});

test("CompanionDevice round-trips the float API level and strings", () => {
  const encoded = encodeCompanionDevice({
    unknown1: 0,
    phoneApiLevel: 34,
    phoneName: "Pixel",
    unknown3: 224,
    region: "US",
  });

  expect(decodeCompanionDevice(encoded)).toEqual({
    unknown1: 0,
    phoneApiLevel: 34,
    phoneName: "Pixel",
    unknown3: 224,
    region: "US",
  });
});

test("DeviceInfo and System round-trip", () => {
  const deviceInfo = { serialNumber: "SN", firmware: "1.0", unknown3: "", model: "Band" };
  expect(decodeDeviceInfo(encodeDeviceInfo(deviceInfo))).toEqual(deviceInfo);

  const system = {
    battery: { level: 80, state: 2 },
    deviceInfo,
  };
  expect(decodeSystem(encodeSystem(system))).toEqual(system);
});

test("Command with a System payload round-trips", () => {
  const command = {
    type: 2,
    subtype: 2,
    system: { deviceInfo: { serialNumber: "SN", firmware: "1.0", model: "Band" } },
    status: 0,
  };

  expect(decodeCommand(encodeCommand(command))).toEqual(command);
});

test("unknown fields are skipped", () => {
  const encoded = encodeMessage([varintField(1, 1), varintField(99, 123)]);
  expect(decodeCommand(encoded)).toEqual({ type: 1 });
});

test("fixed64 unknown fields are skipped", () => {
  const fields: ProtoField[] = [
    { field: 1, wireType: 1, value: new Uint8Array(8) },
    varintField(1, 1),
  ];
  expect(decodeCommand(encodeMessage(fields))).toEqual({ type: 1 });
});

test("boundary field numbers are accepted", () => {
  const low = encodeMessage([varintField(1, 7)]);
  expect(decodeMessage(low).get(1)?.[0]?.value).toBe(7);

  const high = encodeMessage([varintField(0x1fffffff, 9)]);
  expect(decodeMessage(high).get(0x1fffffff)?.[0]?.value).toBe(9);
});

test("invalid field numbers are rejected", () => {
  expect(() => encodeMessage([varintField(0, 1)])).toThrow("PROTO_FIELD_NUMBER");
  expect(() => encodeMessage([varintField(0x20000000, 1)])).toThrow("PROTO_FIELD_NUMBER");
  expect(() => decodeMessage(bytes(0x00))).toThrow("PROTO_FIELD_NUMBER");
});

test("truncated and oversized messages are rejected", () => {
  expect(() => decodeMessage(bytes(0x08))).toThrow("PROTO_TRUNCATED");
  expect(() => decodeMessage(bytes(0x0a, 0x05, 0x01))).toThrow("PROTO_TRUNCATED");
  expect(() => decodeMessage(new Uint8Array(10), 5)).toThrow("PROTO_TOO_LARGE");
});

test("malformed varints are rejected", () => {
  const overlong = new Uint8Array(11);
  overlong[0] = 0x08;
  overlong.fill(0x80, 1, 11);
  expect(() => decodeMessage(overlong)).toThrow("PROTO_VARINT_OVERFLOW");
});

test("groups and unknown wire types are rejected", () => {
  expect(() => decodeMessage(bytes(0x0b))).toThrow("PROTO_GROUP_UNSUPPORTED");
  expect(() => decodeMessage(bytes(0x0c))).toThrow("PROTO_GROUP_UNSUPPORTED");
  expect(() => decodeMessage(bytes(0x0e))).toThrow("PROTO_WIRE_TYPE");
});

test("wrong wire types and missing required fields are rejected", () => {
  expect(() => decodeCommand(bytes(0x0a, 0x01, 0x00))).toThrow("PROTO_WIRE_TYPE");
  expect(() => decodeCommand(bytes(0x10, 0x1a))).toThrow("PROTO_REQUIRED_COMMAND_TYPE");
  expect(() => decodeAppVerify(bytes(0x12, 0x03, 0x64, 0x65, 0x76))).toThrow(
    "PROTO_REQUIRED_APP_VERIFY_NONCE",
  );
});

test("invalid UTF-8 is rejected", () => {
  expect(() => decodeAppVerify(bytes(0x0a, 0x01, 0x00, 0x12, 0x01, 0xff))).toThrow(
    "PROTO_INVALID_UTF8",
  );
});
