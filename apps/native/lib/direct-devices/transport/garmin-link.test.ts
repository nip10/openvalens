/**
 * Tests for the Garmin BLE transport, COBS framing and GFDI packet codec.
 *
 * Framing is ported from `CobsCoDec.java`, `GFDIMessage.java` and
 * `ChecksumCalculator.java` at the pinned revision. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";
import type { Characteristic, Device, Subscription } from "react-native-ble-plx";

import {
  chunkGarminPayload,
  decodeGarminCobsFrame,
  decodeGarminGfdiFrame,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  encodeGarminGfdiWrites,
  GARMIN_AUTH_NEGOTIATION_GUESS_OK,
  GARMIN_AUTH_NEGOTIATION_MESSAGE_TYPE,
  GARMIN_BLE_PROFILES,
  GARMIN_BLE_SERVICE_UUIDS,
  GARMIN_GFDI_V0_RECEIVE_UUID,
  GARMIN_GFDI_V0_SEND_UUID,
  GARMIN_GFDI_V0_SERVICE_UUID,
  GARMIN_GFDI_V1_RECEIVE_UUID,
  GARMIN_GFDI_V1_SEND_UUID,
  GARMIN_GFDI_V1_SERVICE_UUID,
  GARMIN_ML_GFDI_SERVICE_UUID,
  GARMIN_ML_RECEIVE_UUIDS,
  GARMIN_ML_SEND_UUIDS,
  GarminCobsDecoder,
  garminCrc16,
  NativeGarminLink,
  selectGarminProfile,
} from "./garmin-link";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function fakeDevice(characteristics: Record<string, string[]> = {}) {
  let notify: ((error: unknown, value: Characteristic | null) => void) | undefined;
  let removed = 0;
  const writes: Array<{ service: string; characteristic: string; value: string }> = [];
  const device = {
    mtu: 247,
    characteristicsForService: async (service: string) =>
      (characteristics[service] ?? []).map((uuid) => ({ uuid })),
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
  } as unknown as Device;
  return {
    device,
    emit: (value: string) => notify?.(null, { value } as Characteristic),
    writes: () => writes,
    removed: () => removed,
  };
}

test("the service UUID set covers v0, v1, v2 and watch apps", () => {
  expect(GARMIN_BLE_SERVICE_UUIDS.has(GARMIN_GFDI_V0_SERVICE_UUID)).toBe(true);
  expect(GARMIN_BLE_SERVICE_UUIDS.has(GARMIN_GFDI_V1_SERVICE_UUID)).toBe(true);
  expect(GARMIN_BLE_SERVICE_UUIDS.has(GARMIN_ML_GFDI_SERVICE_UUID)).toBe(true);
  expect(GARMIN_BLE_SERVICE_UUIDS.size).toBe(4);
  expect(GARMIN_ML_RECEIVE_UUIDS).toHaveLength(5);
  expect(GARMIN_ML_SEND_UUIDS).toHaveLength(5);
});

test("selectGarminProfile prefers the first ML_GFDI pair, then v1, then v0", async () => {
  const v2 = fakeDevice({
    [GARMIN_ML_GFDI_SERVICE_UUID]: [GARMIN_ML_RECEIVE_UUIDS[0]!, GARMIN_ML_SEND_UUIDS[0]!],
  });
  await expect(
    selectGarminProfile(v2.device, [GARMIN_ML_GFDI_SERVICE_UUID]),
  ).resolves.toMatchObject({
    protocol: "v2",
    readUuid: GARMIN_ML_RECEIVE_UUIDS[0],
    writeUuid: GARMIN_ML_SEND_UUIDS[0],
    handlePrefixed: true,
  });

  const v1 = fakeDevice({
    [GARMIN_GFDI_V1_SERVICE_UUID]: [GARMIN_GFDI_V1_RECEIVE_UUID, GARMIN_GFDI_V1_SEND_UUID],
  });
  await expect(
    selectGarminProfile(v1.device, [GARMIN_GFDI_V1_SERVICE_UUID]),
  ).resolves.toMatchObject({
    protocol: "v1",
    handlePrefixed: false,
  });

  const v0 = fakeDevice({
    [GARMIN_GFDI_V0_SERVICE_UUID]: [GARMIN_GFDI_V0_RECEIVE_UUID, GARMIN_GFDI_V0_SEND_UUID],
  });
  await expect(
    selectGarminProfile(v0.device, [GARMIN_GFDI_V0_SERVICE_UUID]),
  ).resolves.toMatchObject({
    protocol: "v0",
    handlePrefixed: false,
  });

  const none = fakeDevice();
  await expect(selectGarminProfile(none.device, ["180d"])).resolves.toBeNull();
});

test("selectGarminProfile skips a v2 service without a complete characteristic pair", async () => {
  const fake = fakeDevice({
    [GARMIN_ML_GFDI_SERVICE_UUID]: [GARMIN_ML_RECEIVE_UUIDS[0]!],
  });
  await expect(selectGarminProfile(fake.device, [GARMIN_ML_GFDI_SERVICE_UUID])).resolves.toBeNull();
});

test("Garmin auth negotiation is an opaque flag probe, not a key flow", () => {
  expect(GARMIN_AUTH_NEGOTIATION_MESSAGE_TYPE).toBe(5101);
  expect(GARMIN_AUTH_NEGOTIATION_GUESS_OK).toBe(0);
});

test("garminCrc16 is CRC-16/ARC", () => {
  expect(garminCrc16(new TextEncoder().encode("123456789"))).toBe(0xbb3d);
  expect(garminCrc16(Uint8Array.of())).toBe(0);
});

test("COBS round-trips payloads with zeros and 0xfe block boundaries", () => {
  const payloads = [
    Uint8Array.of(0),
    Uint8Array.of(1, 2, 3),
    Uint8Array.of(1, 0, 2),
    Uint8Array.of(0, 0, 0),
    Uint8Array.from({ length: 300 }, (_, index) => (index % 7 === 0 ? 0 : index & 0xff)),
    Uint8Array.from({ length: 300 }, (_, index) => index & 0xff || 1),
  ];
  for (const payload of payloads) {
    const encoded = encodeGarminCobs(payload);
    expect(encoded[0], hex(payload)).toBe(0);
    expect(encoded[encoded.length - 1], hex(payload)).toBe(0);
    expect(hex(decodeGarminCobsFrame(encoded)), hex(payload)).toBe(hex(payload));
  }
});

test("GarminCobsDecoder reassembles fragments and queued frames", () => {
  const first = encodeGarminCobs(Uint8Array.of(1, 2, 3));
  const second = encodeGarminCobs(Uint8Array.of(4, 0, 5));
  const decoder = new GarminCobsDecoder();

  expect(decoder.accept(first.subarray(0, 3))).toBeNull();
  expect(decoder.accept(first.subarray(3))).toEqual(Uint8Array.of(1, 2, 3));

  const joined = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  expect(decoder.accept(joined)).toEqual(Uint8Array.of(1, 2, 3));
  expect(decoder.accept(Uint8Array.of())).toEqual(Uint8Array.of(4, 0, 5));
});

test("COBS rejects malformed and truncated frames", () => {
  expect(() => decodeGarminCobsFrame(Uint8Array.of(0, 2, 1))).toThrow("GARMIN_COBS_TRUNCATED");
  expect(() => decodeGarminCobsFrame(Uint8Array.of(1, 2, 1, 0))).toThrow("GARMIN_COBS_FRAME");
  expect(() => decodeGarminCobsFrame(Uint8Array.of(0, 5, 1, 0))).toThrow("GARMIN_COBS_TRUNCATED");

  const decoder = new GarminCobsDecoder();
  expect(decoder.accept(Uint8Array.of(0, 5, 1, 0))).toBeNull();
  expect(decoder.accept(encodeGarminCobs(Uint8Array.of(9, 8)))).toEqual(Uint8Array.of(9, 8));
});

test("GFDI frames round-trip length, type, payload and CRC", () => {
  const frame = encodeGarminGfdiFrame({ messageType: 5001, payload: Uint8Array.of(1, 2, 3) });
  expect(frame).toHaveLength(9);
  expect(frame[0]).toBe(9);
  expect(frame[1]).toBe(0);
  expect(frame[2]).toBe(0x89);
  expect(frame[3]).toBe(0x13);
  expect(garminCrc16(frame.subarray(0, frame.length - 2))).toBe(
    frame[frame.length - 2]! | (frame[frame.length - 1]! << 8),
  );
  expect(decodeGarminGfdiFrame(frame)).toEqual({
    messageType: 5001,
    payload: Uint8Array.of(1, 2, 3),
  });
});

test("GFDI rejects bad length, bad CRC and out-of-range message types", () => {
  const frame = encodeGarminGfdiFrame({ messageType: 5101, payload: Uint8Array.of(7) });
  const badLength = frame.slice();
  badLength[0] = (badLength[0]! + 1) & 0xff;
  expect(() => decodeGarminGfdiFrame(badLength)).toThrow("GARMIN_PACKET_LENGTH");

  const badCrc = frame.slice();
  badCrc[badCrc.length - 1] = badCrc[badCrc.length - 1]! ^ 0xff;
  expect(() => decodeGarminGfdiFrame(badCrc)).toThrow("GARMIN_PACKET_CRC");

  expect(() => decodeGarminGfdiFrame(Uint8Array.of(1, 2, 3))).toThrow("GARMIN_PACKET_TRUNCATED");
  expect(() => encodeGarminGfdiFrame({ messageType: 0x10000, payload: Uint8Array.of() })).toThrow(
    "GARMIN_MESSAGE_TYPE",
  );
  expect(() => encodeGarminGfdiFrame({ messageType: 1, payload: new Uint8Array(0xfffe) })).toThrow(
    "GARMIN_PACKET_TOO_LARGE",
  );
});

test("write chunking reserves one byte per write and prefixes v2 handles", () => {
  const payload = Uint8Array.from({ length: 50 }, (_, index) => index);
  const chunks = chunkGarminPayload(payload, { maxWriteSize: 20 });
  expect(chunks.map((chunk) => chunk.length)).toEqual([19, 19, 12]);
  expect(hex(chunks[0]!)).toBe(hex(payload.subarray(0, 19)));

  const handled = chunkGarminPayload(payload, { maxWriteSize: 20, handle: 7 });
  expect(handled.map((chunk) => chunk.length)).toEqual([20, 20, 13]);
  expect(handled.every((chunk) => chunk[0] === 7)).toBe(true);
  expect(hex(handled[0]!.subarray(1))).toBe(hex(payload.subarray(0, 19)));

  expect(chunkGarminPayload(Uint8Array.of(1, 2), { maxWriteSize: 20 })).toEqual([
    Uint8Array.of(1, 2),
  ]);
  expect(() => chunkGarminPayload(payload, { maxWriteSize: 1 })).toThrow("GARMIN_WRITE_SIZE");
  expect(() => chunkGarminPayload(payload, { maxWriteSize: 20, handle: 256 })).toThrow(
    "GARMIN_HANDLE",
  );
});

test("encodeGarminGfdiWrites produces chunks that reassemble to the frame", () => {
  const frame = { messageType: 5004, payload: Uint8Array.from({ length: 100 }, (_, i) => i) };
  const chunks = encodeGarminGfdiWrites(frame, { maxWriteSize: 20 });
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  expect(decodeGarminGfdiFrame(decodeGarminCobsFrame(joined))).toEqual(frame);

  const handled = encodeGarminGfdiWrites(frame, { maxWriteSize: 20, handle: 3 });
  expect(handled.every((chunk) => chunk.length <= 20 && chunk[0] === 3)).toBe(true);
  const stripped = new Uint8Array(handled.reduce((total, chunk) => total + chunk.length - 1, 0));
  offset = 0;
  for (const chunk of handled) {
    stripped.set(chunk.subarray(1), offset);
    offset += chunk.length - 1;
  }
  expect(decodeGarminGfdiFrame(decodeGarminCobsFrame(stripped))).toEqual(frame);
});

test("NativeGarminLink subscribes, decodes COBS and writes through the profile", async () => {
  const fake = fakeDevice();
  const link = new NativeGarminLink(fake.device, GARMIN_BLE_PROFILES[5]!);
  const received: Uint8Array[] = [];

  expect(link.maxWriteBytes).toBe(244);
  const unsubscribe = link.subscribe(
    (bytes) => received.push(bytes),
    () => {
      throw new Error("unexpected failure");
    },
  );
  const frame = encodeGarminGfdiFrame({ messageType: 5001, payload: Uint8Array.of(1, 2) });
  fake.emit(Buffer.from(encodeGarminCobs(frame)).toString("base64"));
  expect(received).toEqual([frame]);

  await link.write(
    { messageType: 5001, payload: Uint8Array.of(1, 2) },
    new AbortController().signal,
  );
  expect(fake.writes()).toEqual([
    {
      service: GARMIN_GFDI_V1_SERVICE_UUID,
      characteristic: GARMIN_GFDI_V1_SEND_UUID,
      value: Buffer.from(encodeGarminCobs(frame)).toString("base64"),
    },
  ]);

  unsubscribe();
  expect(fake.removed()).toBe(1);
  await link.close();
});

test("NativeGarminLink requires a handle for v2 writes", async () => {
  const fake = fakeDevice();
  const v2 = GARMIN_BLE_PROFILES[0]!;
  const withoutHandle = new NativeGarminLink(fake.device, v2);
  await expect(
    withoutHandle.write(
      { messageType: 5001, payload: Uint8Array.of(1) },
      new AbortController().signal,
    ),
  ).rejects.toThrow("GARMIN_HANDLE_REQUIRED");

  const withHandle = new NativeGarminLink(fake.device, v2, undefined, 5);
  await withHandle.write(
    { messageType: 5001, payload: Uint8Array.of(1) },
    new AbortController().signal,
  );
  const writes = fake.writes();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.service).toBe(GARMIN_ML_GFDI_SERVICE_UUID);
  expect(writes[0]!.characteristic).toBe(GARMIN_ML_SEND_UUIDS[0]);
  const written = Uint8Array.from(Buffer.from(writes[0]!.value, "base64"));
  expect(written[0]).toBe(5);
  expect(decodeGarminCobsFrame(written.subarray(1))).toEqual(
    encodeGarminGfdiFrame({ messageType: 5001, payload: Uint8Array.of(1) }),
  );
});
