/**
 * Pure smart-scale measurement parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/miscale/MiCompositionScaleDeviceSupport.java` (Mi Body
 *   Composition Scale 2, 13-byte Body Composition Measurement 0x2A9C frame)
 * - `service/devices/miscale/WeightMeasurement.java` (shared weight/unit
 *   decoding and the Mi Smart Scale 2 10-byte record loop)
 * - `service/devices/onebyone/OneByoneScaleDeviceSupport.java` (1byone/LeFu
 *   "Health Scale" 0xCF frames)
 *
 * Mi Body Composition Scale 2
 * ---------------------------
 * Frame layout: byte 0 protocol version (ignored), byte 1 flags, bytes 2-8 a
 * 7-byte device timestamp (year u16 LE, month, day, hour, minute, second),
 * bytes 9-10 impedance u16 LE ohms, bytes 11-12 weight u16 LE. A frame is only
 * accepted when flags bit5 (stabilized) is set, bit7 (measuring) is clear, and
 * the impedance slot is not 0xFFFE (impedance measurement in progress).
 * Impedance is reported only when flags bit1 is set (upstream `hasImpedance`).
 * Device timestamps before the scale's 2018-03-15 release or more than one day
 * in the future are replaced by the receive time.
 *
 * Mi Smart Scale 2
 * ----------------
 * Notifications on 0x2A2F are a sequence of 10-byte records: flags (1),
 * weight i16 LE (2), device timestamp (7). A packet often carries two records.
 * Upstream loops `decode` until fewer than 10 bytes remain or a record is not
 * stabilized. There is no impedance sensor on this model.
 *
 * LeFu "Health Scale"
 * -------------------
 * 0xCF frames. Bytes 1-2 are impedance u16 **big-endian** in 0.1 ohm; bytes
 * 3-4 weight u16 **little-endian** in 0.01 kg; byte 9 is 1 while the reading
 * settles and 0 for the final measurement (sent twice); byte 10 is the XOR of
 * bytes 0-9 on live 11-byte frames only. Stored frames are 18 bytes and carry
 * a 7-byte timestamp at bytes 11-17 (year big-endian). Stored timestamps more
 * than five minutes in the future are rejected. Dedupe windows live in
 * `createLeFuFrameFilter`: live samples less than 3 s apart are dropped, and
 * stored frames within 90 s of the last live sample are treated as replays.
 *
 * Timestamps are device-local wall-clock values interpreted with the phone's
 * timezone offset at that instant, matching the existing GATT parsers. The Mi
 * parsers are lenient like upstream's `GregorianCalendar`; the LeFu stored
 * timestamp is strict like upstream's `setLenient(false)`.
 *
 * externalRecordId scheme
 * -----------------------
 * `weightMeasurementExternalRecordId` hashes
 * `modelId | device-or-receive-time-truncated-to-seconds | weightKg (2 dp) |
 * impedance or empty` with SHA-256 and prefixes the first 32 hex characters
 * with `dd-scale:`. Deriving the id from the measurement content (not arrival
 * order) means the LeFu firmware's duplicate final frame, and a stored frame
 * replayed from history, produce the same id and are deduped by the server's
 * unique index.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** A single weight measurement, in kilograms, with optional bio-impedance. */
export type WeightMeasurementSample = Readonly<{
  type: "weight_measurement";
  /** Device timestamp when the frame carried one, otherwise receive time. ISO-8601 UTC. */
  time: string;
  weightKg: number;
  /** Whole ohms. Null when the frame carried no impedance reading. */
  impedanceOhm: number | null;
  /** True when the payload carried its own 7-byte timestamp. */
  deviceTimestamp: boolean;
}>;

/** A LeFu frame, with the live/stored distinction needed for dedupe. */
export type LeFuFrame = WeightMeasurementSample & Readonly<{ historic: boolean }>;

/** Mi Body Composition Scale 2 release date; earlier device clocks are bogus. */
const SCALE_RELEASE_MS = 1_521_072_000_000; // 2018-03-15T00:00:00Z
const ONE_DAY_MS = 86_400_000;
const IMPEDANCE_MEASURING = 0xfffe;

/** LeFu dedupe windows, ported verbatim from upstream. */
export const LEFU_MIN_SAMPLE_INTERVAL_MS = 3_000;
export const LEFU_HISTORY_REPLAY_WINDOW_MS = 90_000;
export const LEFU_MAX_FUTURE_MS = 5 * 60_000;

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

/** Java `ByteBuffer.getShort()` semantics: signed 16-bit little-endian. */
function int16le(bytes: Uint8Array, offset: number): number {
  const value = uint16le(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

/**
 * Builds ISO-8601 UTC from a device-local wall clock, lenient like upstream's
 * `GregorianCalendar(year, month - 1, ...)` (out-of-range fields roll over).
 */
function lenientLocalIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string | null {
  const local = new Date(year, month - 1, day, hour, minute, second, 0);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

/**
 * Builds ISO-8601 UTC from a device-local wall clock, strict like upstream's
 * `GregorianCalendar.setLenient(false)`. Returns null for invalid fields.
 */
function strictLocalIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const local = new Date(year, month - 1, day, hour, minute, second, 0);
  if (Number.isNaN(local.getTime())) return null;
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute ||
    local.getSeconds() !== second
  )
    return null;
  return local.toISOString();
}

/**
 * Converts a raw weight to kilograms using the unit flags, exactly as upstream
 * `WeightMeasurement.weightToKg`: bit0 pounds, bit4 jin, otherwise kilograms.
 */
export function weightToKg(raw: number, flags: number): number {
  if ((flags & 0x01) !== 0) return (raw / 100) * 0.45359237;
  if ((flags & 0x10) !== 0) return (raw / 100) * 0.5;
  return raw / 200;
}

/**
 * Parses a Mi Body Composition Scale 2 (MIBFS) Body Composition Measurement
 * (0x2A9C) notification. Returns null for a short, unstable, measuring, or
 * impedance-measuring frame.
 */
export function parseMiCompositionScaleFrame(
  bytes: Uint8Array,
  receivedAt: Date = new Date(),
): WeightMeasurementSample | null {
  if (bytes.length < 13) return null;
  const flags = bytes[1]!;
  const stabilized = (flags & 0x20) !== 0 && (flags & 0x80) === 0;
  if (!stabilized) return null;

  const rawImpedance = uint16le(bytes, 9);
  if (rawImpedance === IMPEDANCE_MEASURING) return null;

  const deviceTime = lenientLocalIso(
    uint16le(bytes, 2),
    bytes[4]!,
    bytes[5]!,
    bytes[6]!,
    bytes[7]!,
    bytes[8]!,
  );
  if (!deviceTime) return null;

  const weightKg = weightToKg(uint16le(bytes, 11), flags);
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  let time = deviceTime;
  let deviceTimestamp = true;
  const deviceMs = Date.parse(deviceTime);
  if (deviceMs < SCALE_RELEASE_MS || deviceMs > receivedAt.getTime() + ONE_DAY_MS) {
    time = receivedAt.toISOString();
    deviceTimestamp = false;
  }

  return {
    type: "weight_measurement",
    time,
    weightKg,
    impedanceOhm: (flags & 0x02) !== 0 ? rawImpedance : null,
    deviceTimestamp,
  };
}

/**
 * Parses every stabilized 10-byte record in a Mi Smart Scale 2 (0x2A2F)
 * notification. The loop stops at the first non-stabilized record or when
 * fewer than 10 bytes remain, matching upstream's `decode` loop.
 */
export function parseMiSmartScaleRecords(
  bytes: Uint8Array,
  _receivedAt: Date = new Date(),
): readonly WeightMeasurementSample[] {
  const samples: WeightMeasurementSample[] = [];
  let offset = 0;
  while (bytes.length - offset >= 10) {
    const flags = bytes[offset]!;
    if ((flags & 0x20) === 0 || (flags & 0x80) !== 0) break;
    const weightKg = weightToKg(int16le(bytes, offset + 1), flags);
    const time = lenientLocalIso(
      uint16le(bytes, offset + 3),
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
      bytes[offset + 8]!,
      bytes[offset + 9]!,
    );
    offset += 10;
    if (!time || !Number.isFinite(weightKg) || weightKg <= 0) continue;
    samples.push({
      type: "weight_measurement",
      time,
      weightKg,
      impedanceOhm: null,
      deviceTimestamp: true,
    });
  }
  return samples;
}

/**
 * Parses one LeFu "Health Scale" 0xCF frame. Live frames are 11 bytes with an
 * XOR checksum; stored frames are at least 18 bytes and carry a timestamp.
 * Settling frames, bad checksums, invalid stored timestamps and stored frames
 * dated more than five minutes in the future return null. Dedupe is applied
 * separately by `createLeFuFrameFilter`.
 */
export function parseLeFuFrame(bytes: Uint8Array, receivedAt: Date = new Date()): LeFuFrame | null {
  if (bytes[0] !== 0xcf) return null;
  const live = bytes.length === 11;
  if (!live && bytes.length < 18) return null;

  if (live) {
    let xor = 0;
    for (let i = 0; i < 10; i += 1) xor ^= bytes[i]!;
    if (xor !== bytes[10]) return null;
  }

  // Byte 9 is 1 while the reading is still settling.
  if (bytes[9] === 1) return null;

  const weightKg = uint16le(bytes, 3) / 100;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  const impedanceRaw = uint16be(bytes, 1) / 10;
  const historic = !live;

  let time: string;
  if (historic) {
    const parsed = strictLocalIso(
      uint16be(bytes, 11),
      bytes[13]!,
      bytes[14]!,
      bytes[15]!,
      bytes[16]!,
      bytes[17]!,
    );
    if (!parsed) return null;
    if (Date.parse(parsed) - receivedAt.getTime() > LEFU_MAX_FUTURE_MS) return null;
    time = parsed;
  } else {
    time = receivedAt.toISOString();
  }

  return {
    type: "weight_measurement",
    time,
    weightKg,
    impedanceOhm: impedanceRaw !== 0 ? Math.round(impedanceRaw) : null,
    deviceTimestamp: historic,
    historic,
  };
}

export type LeFuFrameFilter = Readonly<{ accept(frame: LeFuFrame): boolean }>;

/**
 * Ports upstream's two dedupe windows:
 * - live samples less than 3 s after the last live sample are dropped (the
 *   scale sends every final measurement twice);
 * - stored frames within 90 s of the last live sample are replays of a
 *   measurement already received live.
 * Only live samples advance the reference timestamp, exactly as upstream.
 */
export function createLeFuFrameFilter(): LeFuFrameFilter {
  let lastLiveMs = Number.NEGATIVE_INFINITY;
  return {
    accept(frame) {
      const ms = Date.parse(frame.time);
      if (frame.historic) return Math.abs(ms - lastLiveMs) >= LEFU_HISTORY_REPLAY_WINDOW_MS;
      if (ms - lastLiveMs < LEFU_MIN_SAMPLE_INTERVAL_MS) return false;
      lastLiveMs = ms;
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic external record id
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Minimal synchronous SHA-256; the native runtime has no sync digest API. */
export function sha256Hex(input: string): string {
  const message = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let block = 0; block < paddedLength; block += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[t]! + w[t]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * Deterministic, content-addressed record id for a weight measurement. The
 * time is truncated to whole seconds so a repeated frame (LeFu sends finals
 * twice) and a history replay hash to the same id. See the module header.
 */
export function weightMeasurementExternalRecordId(
  modelId: string,
  sample: Pick<WeightMeasurementSample, "time" | "weightKg" | "impedanceOhm">,
): string {
  const seconds = Math.floor(Date.parse(sample.time) / 1000);
  const impedance = sample.impedanceOhm === null ? "" : String(sample.impedanceOhm);
  const digest = sha256Hex(`${modelId}|${seconds}|${sample.weightKg.toFixed(2)}|${impedance}`);
  return `dd-scale:${digest.slice(0, 32)}`;
}
