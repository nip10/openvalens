import { describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";
import fixture from "../__fixtures__/helio-chunked-reference.json";
import { crc32, encodeChunkedMessage } from "./chunked";
import { decodeDeviceDate, decodeServiceList, historyStart, makeStepMinutes } from "./codec";

const provider = {
  createCipheriv: (name: string, key: Uint8Array, iv: Uint8Array) => createCipheriv(name, key, iv),
} as never;
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const sequence = (length: number) => Uint8Array.from({ length }, (_, i) => i);

describe("Helio packet protocol", () => {
  test("matches unchanged upstream Java encoder encrypted and unencrypted packets", () => {
    const key = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
    const actual = encodeChunkedMessage({
      payload: sequence(10),
      endpoint: 0x004b,
      mtu: 23,
      handle: 1,
      encrypted: true,
      sequence: 0x12345678,
      sessionKey: key,
      crypto: provider,
    });
    expect(actual.map(hex)).toEqual(
      fixture.vectors
        .find((v) => v.name === "endpoint004b-short10-mtu23")!
        .chunks.map((c) => c.hex),
    );
    const plain = encodeChunkedMessage({
      payload: sequence(52),
      endpoint: 1,
      mtu: 23,
      handle: 1,
      encrypted: false,
    });
    expect(plain.map(hex)).toEqual(
      fixture.vectors.find((v) => v.name === "auth52-mtu23")!.chunks.map((c) => c.hex),
    );
  });
  test("checks service-list bounds and requires history endpoint", () => {
    expect(decodeServiceList(Uint8Array.of(4, 1, 0, 0x4b, 0, 1)).get(0x4b)).toBe(true);
    expect(() => decodeServiceList(Uint8Array.of(4, 2, 0, 0x4b, 0, 1))).toThrow(
      "INVALID_SERVICE_LIST_LENGTH",
    );
    // Upstream leniency: no 0x004b (control falls back to characteristic 0004),
    // trailing bytes, unknown encryption bytes and duplicates are tolerated.
    expect(decodeServiceList(Uint8Array.of(4, 0, 0)).size).toBe(0);
    expect(decodeServiceList(Uint8Array.of(4, 1, 0, 0x4b, 0, 1, 0xaa)).get(0x4b)).toBe(true);
    expect(decodeServiceList(Uint8Array.of(4, 1, 0, 0x4b, 0, 7)).get(0x4b)).toBe(false);
    expect(decodeServiceList(Uint8Array.of(4, 2, 0, 0x4b, 0, 1, 0x4b, 0, 0)).get(0x4b)).toBe(true);
  });
  test("builds history-start request and unsigned step counts with UTC-minute IDs", () => {
    const start = historyStart({
      version: 1,
      nextMinuteUtc: "2026-11-05T12:00:00.000Z",
      offsetQuarterHours: -20,
    });
    expect(start[0]).toBe(1);
    expect(start[1]).toBe(1);
    expect(start[9]).toBe(0xec);
    const sample = Uint8Array.of(1, 2, 255, 3, 0, 0, 0, 0);
    const rounded = "2026-11-05T11:59:00.000Z";
    const records = makeStepMinutes(sample, rounded, undefined, Date.parse("2026-11-05T12:01:00Z"));
    expect(records[0]?.count).toBe(255);
    expect(records[0]?.externalRecordId).toBe(`minute:${rounded}`);
    expect(() => decodeDeviceDate(Uint8Array.of(0xea, 0x07, 2, 30, 1, 0, 0, 0))).toThrow(
      "INVALID_DEVICE_TIME",
    );
    expect(() => decodeDeviceDate(Uint8Array.of(0xea, 0x07, 1, 1, 0, 0, 60, 0))).toThrow(
      "INVALID_DEVICE_TIME",
    );
    // Explicit quarter-hour offset is applied arithmetically, independent of host timezone/DST.
    expect(
      makeStepMinutes(
        sample,
        "2026-11-05T12:00:00.000Z",
        undefined,
        Date.parse("2026-11-05T12:03:00Z"),
      )[0]?.startTime,
    ).toBe("2026-11-05T12:00:00.000Z");
  });
  test("CRC-32 matches IEEE vector", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

test("Zepp OS samples carry heart rate only for a plausible worn reading", () => {
  const raw = Uint8Array.of(
    // kind, intensity, steps, hr, unknown, sleep, deep, rem
    0,
    10,
    12,
    72,
    0,
    0,
    0,
    0, // worn reading
    115,
    0,
    0,
    80,
    0,
    0,
    0,
    0, // not worn: no heart rate
    118,
    0,
    0,
    80,
    0,
    0,
    0,
    0, // charging: no heart rate
    0,
    0,
    3,
    255,
    0,
    0,
    0,
    0, // 255 = not measured
    0,
    0,
    4,
    0,
    0,
    0,
    0,
    0, // 0 = not measured
  );
  const minutes = makeStepMinutes(
    raw,
    "2026-11-05T12:00:00.000Z",
    undefined,
    Date.parse("2026-11-05T13:00:00Z"),
  );
  expect(minutes.map((minute) => [minute.count, minute.heartRate])).toEqual([
    [12, 72],
    [0, undefined],
    [0, undefined],
    [3, undefined],
    [4, undefined],
  ]);
});
