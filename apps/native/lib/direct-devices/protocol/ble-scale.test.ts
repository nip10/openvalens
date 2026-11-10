/**
 * Byte-vector tests for the smart-scale parsers.
 *
 * Vectors follow Gadgetbridge's scale device supports at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 * AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  createLeFuFrameFilter,
  parseLeFuFrame,
  parseMiCompositionScaleFrame,
  parseMiSmartScaleRecords,
  sha256Hex,
  weightMeasurementExternalRecordId,
  weightToKg,
} from "./ble-scale";

const RECEIVED_AT = new Date(2026, 0, 2, 3, 4, 5, 0);

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function timestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number[] {
  return [...u16le(year), month, day, hour, minute, second];
}

function miCompositionFrame(options: {
  flags: number;
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  impedance?: number;
  weightRaw?: number;
}): Uint8Array {
  return Uint8Array.from([
    0x01, // protocol version, ignored
    options.flags,
    ...timestamp(
      options.year ?? 2026,
      options.month ?? 1,
      options.day ?? 2,
      options.hour ?? 3,
      options.minute ?? 4,
      options.second ?? 5,
    ),
    ...u16le(options.impedance ?? 500),
    ...u16le(options.weightRaw ?? 14_500), // 72.5 kg
  ]);
}

function miSmartRecord(options: {
  flags?: number;
  weightRaw?: number;
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
}): number[] {
  return [
    options.flags ?? 0x20,
    ...u16le(options.weightRaw ?? 14_500),
    ...timestamp(
      options.year ?? 2026,
      options.month ?? 1,
      options.day ?? 2,
      options.hour ?? 3,
      options.minute ?? 4,
      options.second ?? 5,
    ),
  ];
}

function leFuLiveFrame(options: {
  impedanceTenths?: number;
  weightHundredths?: number;
  settling?: boolean;
  badChecksum?: boolean;
}): Uint8Array {
  const frame = Uint8Array.from([
    0xcf,
    ...u16be(options.impedanceTenths ?? 5000), // 500.0 ohm
    ...u16le(options.weightHundredths ?? 7250), // 72.50 kg
    0,
    0,
    0,
    0,
    options.settling ? 1 : 0,
    0,
  ]);
  let xor = 0;
  for (let index = 0; index < 10; index += 1) xor ^= frame[index]!;
  frame[10] = options.badChecksum ? (xor ^ 0xff) & 0xff : xor;
  return frame;
}

function leFuStoredFrame(options: {
  impedanceTenths?: number;
  weightHundredths?: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): Uint8Array {
  return Uint8Array.from([
    0xcf,
    ...u16be(options.impedanceTenths ?? 5000),
    ...u16le(options.weightHundredths ?? 7250),
    0,
    0,
    0,
    0,
    0,
    0, // checksum slot is not verified on stored frames
    ...u16be(options.year),
    options.month,
    options.day,
    options.hour,
    options.minute,
    options.second,
  ]);
}

// ---------------------------------------------------------------------------
// Mi Body Composition Scale 2 (0x2A9C)
// ---------------------------------------------------------------------------

test("mi composition: stabilized kilogram frame", () => {
  const sample = parseMiCompositionScaleFrame(
    miCompositionFrame({ flags: 0x22, impedance: 500 }),
    RECEIVED_AT,
  );
  expect(sample).toEqual({
    type: "weight_measurement",
    time: new Date(2026, 0, 2, 3, 4, 5, 0).toISOString(),
    weightKg: 72.5,
    impedanceOhm: 500,
    deviceTimestamp: true,
  });
});

test("mi composition: pounds and jin unit flags", () => {
  const pounds = parseMiCompositionScaleFrame(
    miCompositionFrame({ flags: 0x21, weightRaw: 16_000 }),
    RECEIVED_AT,
  );
  expect(pounds?.weightKg).toBeCloseTo((16_000 / 100) * 0.45359237, 6);
  expect(pounds?.impedanceOhm).toBeNull();

  const jin = parseMiCompositionScaleFrame(
    miCompositionFrame({ flags: 0x30, weightRaw: 14_500 }),
    RECEIVED_AT,
  );
  expect(jin?.weightKg).toBe(72.5);
});

test("mi composition: impedance is only reported when flags bit1 is set", () => {
  expect(
    parseMiCompositionScaleFrame(miCompositionFrame({ flags: 0x20, impedance: 500 }), RECEIVED_AT)
      ?.impedanceOhm,
  ).toBeNull();
  expect(
    parseMiCompositionScaleFrame(miCompositionFrame({ flags: 0x22, impedance: 500 }), RECEIVED_AT)
      ?.impedanceOhm,
  ).toBe(500);
});

test("mi composition: measuring-in-progress impedance 0xFFFE is rejected", () => {
  expect(
    parseMiCompositionScaleFrame(
      miCompositionFrame({ flags: 0x22, impedance: 0xfffe }),
      RECEIVED_AT,
    ),
  ).toBeNull();
});

test("mi composition: bit7 (measuring) and non-stabilized frames are rejected", () => {
  expect(parseMiCompositionScaleFrame(miCompositionFrame({ flags: 0xa2 }), RECEIVED_AT)).toBeNull();
  expect(parseMiCompositionScaleFrame(miCompositionFrame({ flags: 0x02 }), RECEIVED_AT)).toBeNull();
});

test("mi composition: short frames are rejected", () => {
  expect(parseMiCompositionScaleFrame(Uint8Array.from([0x01, 0x22]), RECEIVED_AT)).toBeNull();
});

test("mi composition: implausible device timestamps fall back to receive time", () => {
  const beforeRelease = parseMiCompositionScaleFrame(
    miCompositionFrame({ flags: 0x20, year: 2017, month: 12, day: 31 }),
    RECEIVED_AT,
  );
  expect(beforeRelease?.time).toBe(RECEIVED_AT.toISOString());
  expect(beforeRelease?.deviceTimestamp).toBe(false);

  const farFuture = parseMiCompositionScaleFrame(
    miCompositionFrame({ flags: 0x20, year: 2030 }),
    RECEIVED_AT,
  );
  expect(farFuture?.time).toBe(RECEIVED_AT.toISOString());
  expect(farFuture?.deviceTimestamp).toBe(false);
});

// ---------------------------------------------------------------------------
// Mi Smart Scale 2 (0x2A2F)
// ---------------------------------------------------------------------------

test("mi smart: two records in one packet are both decoded", () => {
  const packet = Uint8Array.from([
    ...miSmartRecord({ weightRaw: 14_500, second: 5 }),
    ...miSmartRecord({ weightRaw: 14_600, second: 10 }),
  ]);
  const samples = parseMiSmartScaleRecords(packet, RECEIVED_AT);
  expect(samples).toHaveLength(2);
  expect(samples[0]).toEqual({
    type: "weight_measurement",
    time: new Date(2026, 0, 2, 3, 4, 5, 0).toISOString(),
    weightKg: 72.5,
    impedanceOhm: null,
    deviceTimestamp: true,
  });
  expect(samples[1]?.weightKg).toBe(73);
});

test("mi smart: the loop stops at a non-stabilized record", () => {
  const packet = Uint8Array.from([
    ...miSmartRecord({ flags: 0x00 }),
    ...miSmartRecord({ weightRaw: 14_600 }),
  ]);
  expect(parseMiSmartScaleRecords(packet, RECEIVED_AT)).toEqual([]);
});

test("mi smart: a trailing partial record is ignored", () => {
  const packet = Uint8Array.from([...miSmartRecord({}), 0x20, 0x01]);
  expect(parseMiSmartScaleRecords(packet, RECEIVED_AT)).toHaveLength(1);
});

test("mi smart: pounds and jin conversion matches upstream weightToKg", () => {
  expect(weightToKg(16_000, 0x21)).toBeCloseTo((16_000 / 100) * 0.45359237, 6);
  expect(weightToKg(14_500, 0x30)).toBe(72.5);
  expect(weightToKg(14_500, 0x20)).toBe(72.5);
});

// ---------------------------------------------------------------------------
// LeFu "Health Scale" (0xCF frames)
// ---------------------------------------------------------------------------

test("lefu: live frame with weight and impedance", () => {
  expect(parseLeFuFrame(leFuLiveFrame({}), RECEIVED_AT)).toEqual({
    type: "weight_measurement",
    time: RECEIVED_AT.toISOString(),
    weightKg: 72.5,
    impedanceOhm: 500,
    deviceTimestamp: false,
    historic: false,
  });
});

test("lefu: settling frames are ignored", () => {
  expect(parseLeFuFrame(leFuLiveFrame({ settling: true }), RECEIVED_AT)).toBeNull();
});

test("lefu: live checksum failure is rejected", () => {
  expect(parseLeFuFrame(leFuLiveFrame({ badChecksum: true }), RECEIVED_AT)).toBeNull();
});

test("lefu: zero impedance is reported as null", () => {
  expect(
    parseLeFuFrame(leFuLiveFrame({ impedanceTenths: 0 }), RECEIVED_AT)?.impedanceOhm,
  ).toBeNull();
});

test("lefu: stored frame carries its device timestamp", () => {
  const stored = leFuStoredFrame({
    year: 2026,
    month: 1,
    day: 2,
    hour: 3,
    minute: 4,
    second: 5,
  });
  expect(parseLeFuFrame(stored, RECEIVED_AT)).toEqual({
    type: "weight_measurement",
    time: new Date(2026, 0, 2, 3, 4, 5, 0).toISOString(),
    weightKg: 72.5,
    impedanceOhm: 500,
    deviceTimestamp: true,
    historic: true,
  });
});

test("lefu: stored frames from the future are rejected", () => {
  const future = leFuStoredFrame({
    year: 2026,
    month: 1,
    day: 2,
    hour: 4,
    minute: 0,
    second: 0,
  });
  expect(parseLeFuFrame(future, RECEIVED_AT)).toBeNull();
});

test("lefu: invalid stored timestamps are rejected", () => {
  const invalid = leFuStoredFrame({
    year: 2026,
    month: 2,
    day: 31,
    hour: 3,
    minute: 4,
    second: 5,
  });
  expect(parseLeFuFrame(invalid, RECEIVED_AT)).toBeNull();
});

test("lefu: the duplicate final frame is deduped", () => {
  const filter = createLeFuFrameFilter();
  const frame = parseLeFuFrame(leFuLiveFrame({}), RECEIVED_AT)!;
  expect(filter.accept(frame)).toBe(true);
  expect(filter.accept(frame)).toBe(false);
});

test("lefu: a stored replay within 90 s of the last live sample is dropped", () => {
  const filter = createLeFuFrameFilter();
  const live = parseLeFuFrame(leFuLiveFrame({}), RECEIVED_AT)!;
  expect(filter.accept(live)).toBe(true);

  const replay = parseLeFuFrame(
    leFuStoredFrame({
      year: 2026,
      month: 1,
      day: 2,
      hour: 3,
      minute: 4,
      second: 35, // 30 s after the live sample
    }),
    new Date(2026, 0, 2, 3, 4, 35, 0),
  )!;
  expect(filter.accept(replay)).toBe(false);

  const later = parseLeFuFrame(
    leFuStoredFrame({
      year: 2026,
      month: 1,
      day: 2,
      hour: 3,
      minute: 5,
      second: 45, // 100 s after the live sample
    }),
    new Date(2026, 0, 2, 3, 5, 45, 0),
  )!;
  expect(filter.accept(later)).toBe(true);
});

test("lefu: live samples less than 3 s apart are dropped", () => {
  const filter = createLeFuFrameFilter();
  const first = parseLeFuFrame(leFuLiveFrame({}), RECEIVED_AT)!;
  const tooSoon = parseLeFuFrame(leFuLiveFrame({}), new Date(RECEIVED_AT.getTime() + 2_000))!;
  const later = parseLeFuFrame(leFuLiveFrame({}), new Date(RECEIVED_AT.getTime() + 3_000))!;
  expect(filter.accept(first)).toBe(true);
  expect(filter.accept(tooSoon)).toBe(false);
  expect(filter.accept(later)).toBe(true);
});

// ---------------------------------------------------------------------------
// externalRecordId
// ---------------------------------------------------------------------------

test("sha256Hex matches known vectors", () => {
  expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("external record ids are content-addressed and dedupe duplicate frames", () => {
  const sample = {
    time: new Date(2026, 0, 2, 3, 4, 5, 0).toISOString(),
    weightKg: 72.5,
    impedanceOhm: 500,
  };
  const first = weightMeasurementExternalRecordId("lefu_health_scale", sample);
  const duplicate = weightMeasurementExternalRecordId("lefu_health_scale", {
    ...sample,
    time: new Date(2026, 0, 2, 3, 4, 5, 900).toISOString(), // same whole second
  });
  expect(first).toBe(duplicate);
  expect(first.startsWith("dd-scale:")).toBe(true);
  expect(first).toHaveLength("dd-scale:".length + 32);

  expect(
    weightMeasurementExternalRecordId("lefu_health_scale", { ...sample, impedanceOhm: null }),
  ).not.toBe(first);
  expect(weightMeasurementExternalRecordId("xiaomi_smart_scale_2", sample)).not.toBe(first);
});
