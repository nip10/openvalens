/**
 * Tests for the Xiaomi BLE transport and framing.
 *
 * Framing is ported from `XiaomiCharacteristicV1.java` and
 * `XiaomiSppPacketV2.java` at the pinned revision. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";
import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  crc16Arc,
  decodeXiaomiV2DataPacket,
  decodeXiaomiV2Frame,
  decodeXiaomiV2SessionConfig,
  encodeXiaomiV1Chunk,
  encodeXiaomiV1ChunkedStart,
  encodeXiaomiV1Single,
  encodeXiaomiV2DataPacket,
  encodeXiaomiV2Frame,
  encodeXiaomiV2SessionConfigStart,
  NativeXiaomiLink,
  parseXiaomiV1Packet,
  XIAOMI_BLE_PROFILES,
  XIAOMI_BLE_SERVICE_UUIDS,
  XIAOMI_V1_PROFILES,
  XIAOMI_V2_CHANNEL_PROTOBUF,
  XIAOMI_V2_OPCODE_SEND_ENCRYPTED,
  XIAOMI_V2_PACKET_DATA,
  XIAOMI_V2_PROFILE,
  XiaomiV1Reassembler,
  XiaomiV2StreamDecoder,
} from "./xiaomi-link";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

test("UUID profiles cover the five V1 sets and the V2 set", () => {
  expect(XIAOMI_V1_PROFILES).toHaveLength(5);
  expect(XIAOMI_BLE_PROFILES).toHaveLength(6);
  expect(XIAOMI_BLE_SERVICE_UUIDS.size).toBe(5);
  expect(XIAOMI_V2_PROFILE).toMatchObject({
    protocol: "v2",
    serviceUuid: "0000fe95-0000-1000-8000-00805f9b34fb",
    commandReadUuid: "0000005e-0000-1000-8000-00805f9b34fb",
    commandWriteUuid: "0000005f-0000-1000-8000-00805f9b34fb",
    activityDataUuid: null,
  });
});

test("V1 single commands use the upstream header", () => {
  expect(hex(encodeXiaomiV1Single(Uint8Array.of(1, 2, 3), { encrypted: false }))).toBe(
    "00000202010203",
  );
  expect(hex(encodeXiaomiV1Single(Uint8Array.of(9, 9), { encrypted: true, nonceIndex: 5 }))).toBe(
    "0000020105000909",
  );
});

test("V1 chunked start and chunk headers are little-endian", () => {
  expect(hex(encodeXiaomiV1ChunkedStart(true, 2))).toBe("000000010200");
  expect(hex(encodeXiaomiV1Chunk(0, Uint8Array.of(1, 2)))).toBe("01000102");
  expect(hex(encodeXiaomiV1Chunk(1, Uint8Array.of(3)))).toBe("020003");
});

test("V1 inbound packets parse single, chunked and ack forms", () => {
  expect(parseXiaomiV1Packet(Uint8Array.of(0, 0, 2, 2, 1, 2, 3))).toEqual({
    kind: "single",
    encrypted: false,
    payload: Uint8Array.of(1, 2, 3),
  });
  expect(parseXiaomiV1Packet(Uint8Array.of(0, 0, 2, 1, 9, 9))).toEqual({
    kind: "single",
    encrypted: true,
    payload: Uint8Array.of(9, 9),
  });
  expect(parseXiaomiV1Packet(Uint8Array.of(0, 0, 0, 1, 2, 0))).toEqual({
    kind: "chunk_start",
    encrypted: true,
    count: 2,
  });
  expect(parseXiaomiV1Packet(Uint8Array.of(0, 0, 1, 5, 2, 0, 4, 0))).toEqual({
    kind: "chunk_ack",
    subtype: 5,
    missing: [2, 4],
  });
  expect(parseXiaomiV1Packet(Uint8Array.of(0, 0, 3, 0))).toEqual({ kind: "ack", result: 0 });
  expect(parseXiaomiV1Packet(Uint8Array.of(2, 0, 7, 8))).toEqual({
    kind: "chunk",
    index: 2,
    payload: Uint8Array.of(7, 8),
  });
});

test("V1 reassembler orders chunks and rejects duplicates", () => {
  const reassembler = new XiaomiV1Reassembler();
  reassembler.start(false, 2);
  expect(reassembler.accept(1, Uint8Array.of(1, 2))).toBeNull();
  expect(reassembler.accept(2, Uint8Array.of(3))).toEqual(Uint8Array.of(1, 2, 3));

  reassembler.start(false, 2);
  reassembler.accept(1, Uint8Array.of(1));
  expect(() => reassembler.accept(1, Uint8Array.of(2))).toThrow("XIAOMI_CHUNK_DUPLICATE");
  expect(() => reassembler.accept(3, Uint8Array.of(3))).toThrow("XIAOMI_CHUNK_INDEX");
});

test("V2 CRC-16/ARC matches the upstream bit reversal", () => {
  expect(crc16Arc(new Uint8Array(0))).toBe(0x0000);
  expect(crc16Arc(Uint8Array.of(1, 2, 3))).toBe(0xa110);
  expect(crc16Arc(Uint8Array.of(1))).toBe(0xc0c1);
});

test("V2 frames round-trip with the upstream header and checksum", () => {
  const frame = encodeXiaomiV2Frame(XIAOMI_V2_PACKET_DATA, 7, Uint8Array.of(1, 2, 3));

  expect(hex(frame)).toBe("a5a50307030010a1010203");
  expect(decodeXiaomiV2Frame(frame)).toEqual({
    packetType: XIAOMI_V2_PACKET_DATA,
    sequence: 7,
    payload: Uint8Array.of(1, 2, 3),
  });
});

test("V2 rejects corrupted, truncated and non-preamble frames", () => {
  const frame = encodeXiaomiV2Frame(XIAOMI_V2_PACKET_DATA, 1, Uint8Array.of(1, 2, 3));
  const corrupted = frame.slice();
  corrupted[corrupted.length - 1] = 4;
  expect(() => decodeXiaomiV2Frame(corrupted)).toThrow("XIAOMI_V2_CHECKSUM");
  expect(() => decodeXiaomiV2Frame(frame.slice(0, 9))).toThrow("XIAOMI_V2_TRUNCATED");
  const badPreamble = frame.slice();
  badPreamble[0] = 0;
  expect(() => decodeXiaomiV2Frame(badPreamble)).toThrow("XIAOMI_V2_PREAMBLE");
});

test("V2 stream decoder handles split and concatenated frames", () => {
  const first = encodeXiaomiV2Frame(XIAOMI_V2_PACKET_DATA, 1, Uint8Array.of(1));
  const second = encodeXiaomiV2Frame(XIAOMI_V2_PACKET_DATA, 2, Uint8Array.of(2));
  const decoder = new XiaomiV2StreamDecoder();

  expect(decoder.push(first.slice(0, 5))).toEqual([]);
  expect(decoder.push(first.slice(5))).toEqual([
    { packetType: XIAOMI_V2_PACKET_DATA, sequence: 1, payload: Uint8Array.of(1) },
  ]);
  expect(decoder.push(new Uint8Array([...second, ...first]))).toEqual([
    { packetType: XIAOMI_V2_PACKET_DATA, sequence: 2, payload: Uint8Array.of(2) },
    { packetType: XIAOMI_V2_PACKET_DATA, sequence: 1, payload: Uint8Array.of(1) },
  ]);
});

test("V2 session config and data packets round-trip", () => {
  const config = decodeXiaomiV2SessionConfig(encodeXiaomiV2SessionConfigStart());
  expect(config.opCode).toBe(1);
  expect(config.values.size).toBe(4);
  expect(config.values.get(1)).toEqual(Uint8Array.of(1, 0, 0));
  expect(config.values.get(2)).toEqual(Uint8Array.of(0, 0xfc));

  const data = encodeXiaomiV2DataPacket(
    XIAOMI_V2_CHANNEL_PROTOBUF,
    XIAOMI_V2_OPCODE_SEND_ENCRYPTED,
    Uint8Array.of(9, 8),
  );
  expect(hex(data)).toBe("01020908");
  expect(decodeXiaomiV2DataPacket(data)).toEqual({
    channel: XIAOMI_V2_CHANNEL_PROTOBUF,
    opCode: XIAOMI_V2_OPCODE_SEND_ENCRYPTED,
    payload: Uint8Array.of(9, 8),
  });
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

test("NativeXiaomiLink subscribes and writes through the profile UUIDs", async () => {
  const fake = fakeDevice();
  const link = new NativeXiaomiLink(fake.device, XIAOMI_V1_PROFILES[0]!);
  const received: Uint8Array[] = [];

  expect(link.maxWriteBytes).toBe(244);
  const unsubscribe = link.subscribe(
    "command_read",
    (bytes) => received.push(bytes),
    () => {
      throw new Error("unexpected failure");
    },
  );
  fake.emit("AQID");
  expect(received).toEqual([Uint8Array.of(1, 2, 3)]);

  await link.write("command_write", Uint8Array.of(4, 5), new AbortController().signal);
  expect(fake.writes()).toEqual([
    {
      service: "0000fe95-0000-1000-8000-00805f9b34fb",
      characteristic: "00000052-0000-1000-8000-00805f9b34fb",
      value: "BAU=",
    },
  ]);

  unsubscribe();
  expect(fake.removed()).toBe(1);
  await link.close();
});

test("NativeXiaomiLink rejects characteristics the profile does not have", async () => {
  const fake = fakeDevice();
  const link = new NativeXiaomiLink(fake.device, XIAOMI_V2_PROFILE);

  expect(() =>
    link.subscribe(
      "activity_data",
      () => undefined,
      () => undefined,
    ),
  ).toThrow("XIAOMI_CHARACTERISTIC_UNAVAILABLE");
  await expect(
    link.write("data_upload", Uint8Array.of(1), new AbortController().signal),
  ).rejects.toThrow("XIAOMI_CHARACTERISTIC_UNAVAILABLE");
});

function cancellationPeripheral() {
  const cancellations: Array<() => void> = [];
  const written: string[] = [];
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const device = {
    mtu: 23,
    monitorCharacteristicForService: () => ({ remove() {} }) as Subscription,
    writeCharacteristicWithResponseForService: async (
      _service: string,
      characteristic: string,
      _value: string,
      _transactionId: string,
    ) => {
      written.push(characteristic);
      return new Promise<Characteristic>(() => undefined);
    },
    writeCharacteristicWithoutResponseForService: async () => ({}) as Characteristic,
  } as unknown as Device;
  const manager = {
    cancelTransaction: (_id: string) => {
      const cancel = cancellations.shift();
      cancel?.();
    },
  };
  // The native promise settles only when the matching transaction is cancelled.
  const nativeWrite = device.writeCharacteristicWithResponseForService.bind(device);
  (
    device as unknown as { writeCharacteristicWithResponseForService: typeof nativeWrite }
  ).writeCharacteristicWithResponseForService = async (...args: Parameters<typeof nativeWrite>) => {
    written.push(args[1]);
    markStarted();
    return new Promise<Characteristic>((_resolve, reject) => {
      cancellations.push(() => reject(new Error("native transaction cancelled")));
    });
  };
  return { device, manager, written, started };
}

test("NativeXiaomiLink settles pending native writes on explicit and timed abort", async () => {
  for (const timeout of [false, true]) {
    const fake = cancellationPeripheral();
    const link = new NativeXiaomiLink(fake.device, XIAOMI_V1_PROFILES[1]!, fake.manager);
    const controller = new AbortController();
    const signal = timeout ? AbortSignal.timeout(5) : controller.signal;
    const write = link.write("command_write", Uint8Array.of(1), signal);
    const queued = link.write("command_write", Uint8Array.of(2), signal);
    await fake.started;
    if (!timeout) controller.abort();
    await expect(write).rejects.toThrow("CANCELLED");
    await expect(queued).rejects.toThrow("CANCELLED");
    await link.close();
    expect(fake.written).toHaveLength(1);
  }
});
