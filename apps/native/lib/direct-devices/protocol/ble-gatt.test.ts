/**
 * Byte-vector tests for the generic Bluetooth GATT measurement parsers.
 *
 * Vectors are constructed from the Bluetooth SIG layouts and Gadgetbridge's
 * profile parsers at revision 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 * AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  parseBloodPressureMeasurement,
  parseHeartRateMeasurement,
  parseTemperatureMeasurement,
} from "./ble-gatt";

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

/** IEEE-11073 SFLOAT raw bytes (16-bit, little-endian). */
function sfloat(mantissa: number, exponent: number): number[] {
  const raw = ((exponent & 0xf) << 12) | (mantissa & 0xfff);
  return u16(raw);
}

/** IEEE-11073 FLOAT32 raw bytes (24-bit mantissa + 8-bit exponent, LE). */
function float32(mantissa: number, exponent: number): number[] {
  const raw = (((exponent & 0xff) << 24) | (mantissa & 0xffffff)) >>> 0;
  return [raw & 0xff, (raw >>> 8) & 0xff, (raw >>> 16) & 0xff, (raw >>> 24) & 0xff];
}

const RECEIVED_AT = new Date("2026-01-02T03:04:05.000Z");

// ---------------------------------------------------------------------------
// Heart Rate Measurement (0x2A37)
// ---------------------------------------------------------------------------

test("heart rate: uint8 BPM with no optional fields", () => {
  expect(parseHeartRateMeasurement(Uint8Array.from([0x00, 72]), RECEIVED_AT)).toEqual({
    type: "heart_rate",
    time: RECEIVED_AT.toISOString(),
    bpm: 72,
    sensorContact: "unsupported",
    energyExpended: null,
    rrIntervalsMs: [],
  });
});

test("heart rate: uint16 BPM when flag bit0 is set", () => {
  const sample = parseHeartRateMeasurement(Uint8Array.from([0x01, ...u16(300)]), RECEIVED_AT);
  expect(sample?.bpm).toBe(300);
});

test("heart rate: sensor contact supported and detected / not detected", () => {
  expect(parseHeartRateMeasurement(Uint8Array.from([0x06, 70]), RECEIVED_AT)?.sensorContact).toBe(
    "detected",
  );
  expect(parseHeartRateMeasurement(Uint8Array.from([0x04, 70]), RECEIVED_AT)?.sensorContact).toBe(
    "not_detected",
  );
});

test("heart rate: energy expended is parsed but kept out of the canonical payload", () => {
  const sample = parseHeartRateMeasurement(Uint8Array.from([0x08, 70, ...u16(258)]), RECEIVED_AT);
  expect(sample?.energyExpended).toBe(258);
  expect(sample?.bpm).toBe(70);
});

test("heart rate: RR intervals use (raw * 1000) / 1024 ms", () => {
  const sample = parseHeartRateMeasurement(
    Uint8Array.from([0x10, 60, ...u16(1024), ...u16(512)]),
    RECEIVED_AT,
  );
  expect(sample?.rrIntervalsMs).toEqual([1000, 500]);
});

test("heart rate: rejects zero BPM and truncated payloads", () => {
  expect(parseHeartRateMeasurement(Uint8Array.from([0x00, 0]), RECEIVED_AT)).toBeNull();
  expect(parseHeartRateMeasurement(Uint8Array.from([0x01, 0x2c]), RECEIVED_AT)).toBeNull();
  expect(parseHeartRateMeasurement(Uint8Array.from([]), RECEIVED_AT)).toBeNull();
});

// ---------------------------------------------------------------------------
// Blood Pressure Measurement (0x2A35)
// ---------------------------------------------------------------------------

function bloodPressure(flags: number, values: number[]): Uint8Array {
  return Uint8Array.from([
    flags,
    ...sfloat(120, 0),
    ...sfloat(80, 0),
    ...sfloat(100, 0),
    ...values,
  ]);
}

test("blood pressure: mmHg values from three SFLOATs", () => {
  expect(parseBloodPressureMeasurement(bloodPressure(0x00, []), RECEIVED_AT)).toEqual({
    type: "blood_pressure",
    time: RECEIVED_AT.toISOString(),
    systolic: 120,
    diastolic: 80,
    meanArterialPressure: 100,
    pulseRate: null,
    userId: null,
    deviceTimestamp: false,
  });
});

test("blood pressure: kPa flag converts with 7.50061683 and rounds to mmHg", () => {
  const sample = parseBloodPressureMeasurement(
    Uint8Array.from([
      0x01,
      ...sfloat(160, -1), // 16.0 kPa -> 120 mmHg
      ...sfloat(107, -1), // 10.7 kPa -> 80 mmHg
      ...sfloat(133, -1), // 13.3 kPa -> 100 mmHg
    ]),
    RECEIVED_AT,
  );
  expect(sample).toMatchObject({ systolic: 120, diastolic: 80, meanArterialPressure: 100 });
});

test("blood pressure: device timestamp is interpreted as phone-local wall time", () => {
  const sample = parseBloodPressureMeasurement(
    bloodPressure(0x02, [0xea, 0x07, 11, 9, 12, 34, 56]),
    RECEIVED_AT,
  );
  expect(sample?.deviceTimestamp).toBe(true);
  expect(sample?.time).toBe(new Date(2026, 10, 9, 12, 34, 56).toISOString());
});

test("blood pressure: pulse rate, user id and measurement status are parsed", () => {
  const sample = parseBloodPressureMeasurement(
    bloodPressure(0x04 | 0x08 | 0x10, [...sfloat(72, 0), 1, 0x00, 0x00]),
    RECEIVED_AT,
  );
  expect(sample?.pulseRate).toBe(72);
  expect(sample?.userId).toBe(1);
});

test("blood pressure: every optional field together", () => {
  const sample = parseBloodPressureMeasurement(
    bloodPressure(0x1e, [0xea, 0x07, 11, 9, 12, 34, 56, ...sfloat(72, 0), 1, 0x00, 0x00]),
    RECEIVED_AT,
  );
  expect(sample).toMatchObject({
    systolic: 120,
    diastolic: 80,
    meanArterialPressure: 100,
    pulseRate: 72,
    userId: 1,
    deviceTimestamp: true,
  });
});

test("blood pressure: SFLOAT special values reject the measurement", () => {
  for (const raw of [0x07ff, 0x0800, 0x07fe, 0x0802]) {
    const bytes = Uint8Array.from([0x00, ...u16(raw), ...sfloat(80, 0), ...sfloat(100, 0)]);
    expect(parseBloodPressureMeasurement(bytes, RECEIVED_AT), raw.toString(16)).toBeNull();
  }
});

test("blood pressure: truncated payloads are rejected", () => {
  expect(
    parseBloodPressureMeasurement(Uint8Array.from([0x00, 0x78, 0x00]), RECEIVED_AT),
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// Temperature Measurement (0x2A1C)
// ---------------------------------------------------------------------------

test("temperature: Celsius payload without timestamp or type parses (upstream bug fix)", () => {
  expect(
    parseTemperatureMeasurement(Uint8Array.from([0x00, ...float32(365, -1)]), RECEIVED_AT),
  ).toEqual({
    type: "body_temperature",
    time: RECEIVED_AT.toISOString(),
    celsius: 36.5,
    site: null,
    deviceTimestamp: false,
  });
});

test("temperature: Fahrenheit flag converts to Celsius", () => {
  const sample = parseTemperatureMeasurement(
    Uint8Array.from([0x01, ...float32(986, -1)]),
    RECEIVED_AT,
  );
  expect(sample?.celsius).toBeCloseTo(37, 6);
});

test("temperature: device timestamp flag", () => {
  const sample = parseTemperatureMeasurement(
    Uint8Array.from([0x02, ...float32(365, -1), 0xea, 0x07, 11, 9, 12, 34, 56]),
    RECEIVED_AT,
  );
  expect(sample?.deviceTimestamp).toBe(true);
  expect(sample?.time).toBe(new Date(2026, 10, 9, 12, 34, 56).toISOString());
});

test("temperature: type byte is kept as metadata only", () => {
  const sample = parseTemperatureMeasurement(
    Uint8Array.from([0x04, ...float32(365, -1), 2]),
    RECEIVED_AT,
  );
  expect(sample?.site).toBe(2);
  expect(sample?.celsius).toBe(36.5);
});

test("temperature: timestamp and type together", () => {
  const sample = parseTemperatureMeasurement(
    Uint8Array.from([0x06, ...float32(365, -1), 0xea, 0x07, 11, 9, 12, 34, 56, 2]),
    RECEIVED_AT,
  );
  expect(sample).toMatchObject({ celsius: 36.5, site: 2, deviceTimestamp: true });
});

test("temperature: negative Celsius values sign-extend from bit 23", () => {
  const sample = parseTemperatureMeasurement(
    Uint8Array.from([0x00, ...float32(-50, -1)]),
    RECEIVED_AT,
  );
  expect(sample?.celsius).toBe(-5);
});

test("temperature: FLOAT32 special values and exponent extremes are rejected", () => {
  expect(
    parseTemperatureMeasurement(Uint8Array.from([0x00, ...float32(0x7fffff, 0)]), RECEIVED_AT),
  ).toBeNull();
  expect(
    parseTemperatureMeasurement(Uint8Array.from([0x00, ...float32(0x800000, 0)]), RECEIVED_AT),
  ).toBeNull();
  expect(
    parseTemperatureMeasurement(Uint8Array.from([0x00, ...float32(1, 127)]), RECEIVED_AT),
  ).toBeNull();
  expect(
    parseTemperatureMeasurement(Uint8Array.from([0x00, ...float32(1, -128)]), RECEIVED_AT),
  ).toBeNull();
});

test("temperature: truncated payloads are rejected", () => {
  expect(parseTemperatureMeasurement(Uint8Array.from([0x00, 0x6d]), RECEIVED_AT)).toBeNull();
  expect(parseTemperatureMeasurement(Uint8Array.from([]), RECEIVED_AT)).toBeNull();
});
