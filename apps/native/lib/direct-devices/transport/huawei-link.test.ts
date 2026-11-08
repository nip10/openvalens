/**
 * Tests for the Huawei/Honor BLE transport, TLV codec and packet framing.
 *
 * Framing is ported from `HuaweiPacket.java` / `HuaweiTLV.java` at the pinned
 * revision. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";
import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  decodeHuaweiEncryptedTlv,
  decodeHuaweiPacket,
  decodeHuaweiTlv,
  decodeHuaweiVarint,
  encodeHuaweiEncryptedTlv,
  encodeHuaweiPacket,
  encodeHuaweiTlv,
  encodeHuaweiVarint,
  HONOR_READ_UUID,
  HONOR_SERVICE_UUID,
  HONOR_WRITE_UUID,
  HUAWEI_BLE_SERVICE_UUIDS,
  HUAWEI_READ_UUID,
  HUAWEI_SERVICE_UUID,
  HUAWEI_WRITE_UUID,
  huaweiCrc16,
  HuaweiPacketReassembler,
  NativeHuaweiLink,
  selectHuaweiProfile,
} from "./huawei-link";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

test("TLV round-trips tags, varint lengths and values", () => {
  const encoded = encodeHuaweiTlv([
    { tag: 1, value: Uint8Array.of(1, 2) },
    { tag: 124, value: Uint8Array.of(3) },
  ]);

  expect(hex(encoded)).toBe("010201027c0103");
  expect(decodeHuaweiTlv(encoded)).toEqual([
    { tag: 1, value: Uint8Array.of(1, 2) },
    { tag: 124, value: Uint8Array.of(3) },
  ]);
});

test("varints use the upstream 7-bit big-endian groups", () => {
  expect(hex(encodeHuaweiVarint(0))).toBe("00");
  expect(hex(encodeHuaweiVarint(127))).toBe("7f");
  expect(hex(encodeHuaweiVarint(128))).toBe("8100");
  expect(hex(encodeHuaweiVarint(16384))).toBe("818000");
  expect(decodeHuaweiVarint(Uint8Array.of(0x81, 0x80, 0x00))).toEqual({
    value: 16384,
    size: 3,
  });
});

test("an unsliced packet round-trips with CRC16", () => {
  const [frame] = encodeHuaweiPacket({
    serviceId: 1,
    commandId: 2,
    tlv: Uint8Array.of(3, 1, 4),
  });

  expect(frame).toBeDefined();
  expect(frame![0]).toBe(0x5a);
  expect(frame![3]).toBe(0);
  expect(huaweiCrc16(frame!.subarray(0, frame!.length - 2))).toBe(
    (frame![frame!.length - 2]! << 8) | frame![frame!.length - 1]!,
  );

  const decoded = decodeHuaweiPacket(frame!);
  expect(decoded.sliced).toBe(false);
  const reassembler = new HuaweiPacketReassembler();
  expect(reassembler.accept(decoded)).toEqual({
    serviceId: 1,
    commandId: 2,
    tlv: [{ tag: 3, value: Uint8Array.of(4) }],
  });
});

test("a large packet is sliced and reassembled", () => {
  const tlv = encodeHuaweiTlv([{ tag: 7, value: new Uint8Array(8).fill(7) }]);
  const frames = encodeHuaweiPacket({
    serviceId: 1,
    commandId: 2,
    tlv,
    sliceSize: 12,
  });

  expect(frames).toHaveLength(3);
  expect(frames.map((frame) => frame[3])).toEqual([1, 2, 3]);

  const reassembler = new HuaweiPacketReassembler();
  let parsed = null;
  for (const frame of frames) {
    parsed = reassembler.accept(decodeHuaweiPacket(frame));
  }
  expect(parsed).toEqual({
    serviceId: 1,
    commandId: 2,
    tlv: [{ tag: 7, value: new Uint8Array(8).fill(7) }],
  });
});

test("a two-packet slice sequence ends with slice 3", () => {
  const tlv = encodeHuaweiTlv([{ tag: 7, value: new Uint8Array(4).fill(7) }]);
  const frames = encodeHuaweiPacket({
    serviceId: 1,
    commandId: 2,
    tlv,
    sliceSize: 12,
  });

  expect(frames).toHaveLength(2);
  expect(frames.map((frame) => frame[3])).toEqual([1, 3]);
  const reassembler = new HuaweiPacketReassembler();
  expect(reassembler.accept(decodeHuaweiPacket(frames[0]!))).toBeNull();
  expect(reassembler.accept(decodeHuaweiPacket(frames[1]!))).toEqual({
    serviceId: 1,
    commandId: 2,
    tlv: [{ tag: 7, value: new Uint8Array(4).fill(7) }],
  });
});

test("malformed packets are rejected", () => {
  const [frame] = encodeHuaweiPacket({
    serviceId: 1,
    commandId: 2,
    tlv: Uint8Array.of(3, 1, 4),
  });
  const corrupted = frame!.slice();
  corrupted[corrupted.length - 3] ^= 0xff;
  expect(() => decodeHuaweiPacket(corrupted)).toThrow("HUAWEI_PACKET_CRC");
  expect(() => decodeHuaweiPacket(frame!.slice(0, 5))).toThrow("HUAWEI_PACKET_TRUNCATED");
  const badMagic = frame!.slice();
  badMagic[0] = 0;
  expect(() => decodeHuaweiPacket(badMagic)).toThrow("HUAWEI_MAGIC");
  expect(() => decodeHuaweiTlv(Uint8Array.of(1, 5, 0))).toThrow("HUAWEI_TLV_TRUNCATED");
});

test("the encrypted TLV wrapper round-trips", () => {
  const encoded = encodeHuaweiEncryptedTlv(Uint8Array.of(9, 9), Uint8Array.of(1, 2, 3, 4));
  expect(decodeHuaweiEncryptedTlv(decodeHuaweiTlv(encoded))).toEqual({
    cipherText: Uint8Array.of(9, 9),
    iv: Uint8Array.of(1, 2, 3, 4),
  });
});

test("profiles cover the Huawei and Honor services", () => {
  expect(HUAWEI_BLE_SERVICE_UUIDS.size).toBe(2);
  expect(HUAWEI_SERVICE_UUID).toBe("0000fe86-0000-1000-8000-00805f9b34fb");
  expect(HUAWEI_WRITE_UUID).toBe("0000fe01-0000-1000-8000-00805f9b34fb");
  expect(HUAWEI_READ_UUID).toBe("0000fe02-0000-1000-8000-00805f9b34fb");
  expect(HONOR_SERVICE_UUID).toBe("c5f0ad48-cc27-48fd-9f67-8dc8e8f4a9cb");
  expect(HONOR_WRITE_UUID).toBe("2a5fc8bd-3de4-43cb-9449-354bcdeccc70");
  expect(HONOR_READ_UUID).toBe("a563d757-b216-48bc-8a0f-e8dde1f916aa");
});

test("selectHuaweiProfile checks the service and characteristics", async () => {
  const device = {
    characteristicsForService: async (service: string) =>
      service === HUAWEI_SERVICE_UUID
        ? [{ uuid: HUAWEI_READ_UUID }, { uuid: HUAWEI_WRITE_UUID }]
        : [],
  } as unknown as Device;

  expect(await selectHuaweiProfile(device, [HUAWEI_SERVICE_UUID])).toMatchObject({
    serviceUuid: HUAWEI_SERVICE_UUID,
    vendor: "huawei",
  });
  expect(await selectHuaweiProfile(device, ["180d"])).toBeNull();
});

function fakeDevice() {
  let notify: ((error: unknown, value: Characteristic | null) => void) | undefined;
  let removed = 0;
  const writes: Array<{ service: string; characteristic: string; value: string }> = [];
  const device = {
    mtu: 247,
    monitorCharacteristicForService: (
      _service: string,
      _characteristic: string,
      callback: (error: unknown, value: Characteristic | null) => void,
    ) => {
      notify = callback;
      return {
        remove() {
          removed += 1;
        },
      } as Subscription;
    },
    writeCharacteristicWithResponseForService: async (
      service: string,
      characteristic: string,
      value: string,
    ) => {
      writes.push({ service, characteristic, value });
      return {} as Characteristic;
    },
    writeCharacteristicWithoutResponseForService: async () => ({}) as Characteristic,
  } as unknown as Device;
  return {
    device,
    emit: (value: string) => notify?.(null, { value } as Characteristic),
    writes: () => writes,
    removed: () => removed,
  };
}

test("NativeHuaweiLink subscribes and writes through the profile UUIDs", async () => {
  const fake = fakeDevice();
  const profile = {
    serviceUuid: HUAWEI_SERVICE_UUID,
    readUuid: HUAWEI_READ_UUID,
    writeUuid: HUAWEI_WRITE_UUID,
    vendor: "huawei" as const,
  };
  const link = new NativeHuaweiLink(fake.device, profile);
  const received: Uint8Array[] = [];

  expect(link.maxWriteBytes).toBe(244);
  const unsubscribe = link.subscribe(
    (bytes) => received.push(bytes),
    () => {
      throw new Error("unexpected failure");
    },
  );
  fake.emit("AQID");
  expect(received).toEqual([Uint8Array.of(1, 2, 3)]);

  await link.write(Uint8Array.of(4, 5), new AbortController().signal);
  expect(fake.writes()).toEqual([
    {
      service: HUAWEI_SERVICE_UUID,
      characteristic: HUAWEI_WRITE_UUID,
      value: "BAU=",
    },
  ]);

  unsubscribe();
  expect(fake.removed()).toBe(1);
  await link.close();
});
