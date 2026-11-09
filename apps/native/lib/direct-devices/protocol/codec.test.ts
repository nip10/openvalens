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
    expect(() => decodeServiceList(Uint8Array.of(4, 0, 0))).toThrow("HISTORY_UNSUPPORTED");
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
