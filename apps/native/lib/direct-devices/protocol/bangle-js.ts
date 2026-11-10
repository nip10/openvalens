/**
 * Pure Bangle.js / Espruino protocol codecs and parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/banglejs/BangleJSDeviceSupport.java`
 * - `service/devices/banglejs/BangleJSConstants.java`
 * - `devices/banglejs/BangleJSCoordinator.java`
 *
 * Transport
 * ---------
 * The watch exposes the Nordic UART service. Naming is inverted relative to the
 * Nordic convention: phone → watch writes go to the TX characteristic
 * (`6e400002-…`) and watch → phone notifications arrive on the RX
 * characteristic (`6e400003-…`). Writes are chunked; upstream requests MTU 131
 * at init and falls back to 20-byte chunks, which is what this module defaults
 * to because react-native-ble-plx does not expose the negotiated MTU.
 *
 * Framing
 * -------
 * Phone → watch JSON is wrapped: DLE (`0x10`) + `GB(` + JSON + `)\n`
 * (`uartTxJSON`). The time-set command is raw Espruino JavaScript instead, not
 * JSON: DLE + `setTime(<unixSeconds>);E.setTimeZone(<hours>);` + `\n`.
 *
 * Watch → phone notifications are a byte stream, not messages. XON (`0x11`)
 * and XOFF (`0x13`) flow-control bytes are stripped, the rest is accumulated
 * and split on `\n`. Espruino terminates lines with `\r\n`; upstream drops the
 * byte immediately before the newline, which this module expresses as "strip a
 * trailing `\r`". Empty lines are ignored. Lines beginning with `{` are JSON
 * and must carry a `t` key; anything else is ignored.
 *
 * History buckets
 * ---------------
 * `{"t":"actfetch","ts":<millis>}` asks for activity since a timestamp. The
 * watch answers with `{"t":"act","ts":…,"stp":…,"hrm":…,"mov":…,"rt":0}` lines
 * and closes the stream with `{"t":"actfetch","state":"end","count":N}`.
 * Samples are 10-minute buckets. The device health library stores 10-minute
 * records and the actfetch handler shifts each timestamp by +600000 ms, so `ts`
 * is the bucket END. This module therefore treats `ts` as the sample time and
 * derives `startTime = ts - 600000`, `endTime = ts`. Do not "fix" this to
 * `ts .. ts + 600000`: that would shift every bucket 10 minutes forward.
 *
 * Only `rt !== 1` samples are stored. `hrm > 0` yields a heart-rate sample;
 * `stp >= 0` yields the bucket's step count. `mov` is device intensity
 * (normalized /2048 upstream) and is not persisted. `rt:1` samples are the
 * realtime stream requested with `{"t":"act","hrm":true,"stp":false,"int":10}`
 * and are used for live heart rate only.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** DLE prefix that starts every phone → watch frame. */
export const BANGLE_JS_DLE = 0x10;
/** Espruino XON flow-control byte, stripped from inbound notifications. */
export const BANGLE_JS_XON = 0x11;
/** Espruino XOFF flow-control byte, stripped from inbound notifications. */
export const BANGLE_JS_XOFF = 0x13;
/** Upstream requests this MTU at init (`BangleJSDeviceSupport.java:364-366`). */
export const BANGLE_JS_MTU_REQUEST = 131;
/** Upstream's write chunk size before MTU negotiation. */
export const BANGLE_JS_DEFAULT_CHUNK_BYTES = 20;
/** Activity buckets are 10 minutes wide. */
export const BANGLE_JS_BUCKET_MS = 600_000;
/** Default history cursor: now − 1 day. */
export const BANGLE_JS_DEFAULT_LOOKBACK_MS = 86_400_000;
/** On a successful fetch the next cursor is now − 60 s. */
export const BANGLE_JS_SYNC_MARGIN_MS = 60_000;
/** Realtime heart-rate cadence requested from the watch, in seconds. */
export const BANGLE_JS_REALTIME_INTERVAL_SECONDS = 10;

/** One 10-minute activity bucket, matching the frozen record contract. */
export type BangleJsStepsInterval = Readonly<{
  type: "steps_interval";
  startTime: string;
  endTime: string;
  count: number;
}>;

export type BangleJsHeartRateSample = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

/** Any record a Bangle.js session can emit. */
export type BangleJsRecord = BangleJsStepsInterval | BangleJsHeartRateSample;

/** Failure kinds reported by the transport. */
export type BangleJsFailure = "heart_rate" | "steps_interval" | "init";

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * Wraps already-serialized JSON in the phone → watch frame:
 * DLE + `GB(` + json + `)` + LF.
 */
export function buildGbFrame(json: string): Uint8Array {
  const bytes = new Uint8Array(6 + json.length);
  bytes[0] = BANGLE_JS_DLE;
  bytes[1] = 0x47; // G
  bytes[2] = 0x42; // B
  bytes[3] = 0x28; // (
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index);
    if (code > 0xff) throw new RangeError("BANGLE_JS_FRAME_NOT_ASCII");
    bytes[4 + index] = code;
  }
  bytes[4 + json.length] = 0x29; // )
  bytes[5 + json.length] = 0x0a; // LF
  return bytes;
}

/**
 * Splits a frame into write-sized chunks. `mtu` is the number of bytes per
 * write (upstream's default is 20); it must be a positive integer. An empty
 * input produces no writes.
 */
export function chunk(
  bytes: Uint8Array,
  mtu: number = BANGLE_JS_DEFAULT_CHUNK_BYTES,
): Uint8Array[] {
  if (!Number.isInteger(mtu) || mtu < 1) throw new RangeError("BANGLE_JS_INVALID_MTU");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += mtu)
    chunks.push(bytes.slice(offset, Math.min(offset + mtu, bytes.length)));
  return chunks;
}

/**
 * Reassembles the watch → phone byte stream into complete lines.
 *
 * XON/XOFF bytes are dropped, a trailing `\r` is stripped (Espruino sends
 * `\r\n`), and empty lines are skipped. Bytes are interpreted as single-byte
 * characters: Espruino JSON is ASCII, and non-ASCII activity names are
 * metadata that this codebase does not persist.
 */
export class BangleJsLineAssembler {
  private pending: number[] = [];

  push(bytes: Uint8Array): string[] {
    const lines: string[] = [];
    for (const byte of bytes) {
      if (byte === BANGLE_JS_XON || byte === BANGLE_JS_XOFF) continue;
      if (byte === 0x0a) {
        const line = this.takeLine();
        if (line.length) lines.push(line);
        continue;
      }
      this.pending.push(byte);
    }
    return lines;
  }

  /** Drops any partial line; used when a connection ends. */
  reset(): void {
    this.pending = [];
  }

  private takeLine(): string {
    let end = this.pending.length;
    if (end > 0 && this.pending[end - 1] === 0x0d) end -= 1;
    let line = "";
    for (let index = 0; index < end; index += 1) line += String.fromCharCode(this.pending[index]!);
    this.pending = [];
    return line;
  }
}

/**
 * Parses one reassembled line. Only lines that start with `{` are considered;
 * the result must be a JSON object with a string `t` key. Everything else
 * (Espruino log output, partial lines) is ignored by returning null.
 */
export function parseBangleJsLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const packet = parsed as Record<string, unknown>;
  if (typeof packet.t !== "string" || packet.t.length === 0) return null;
  return packet;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** `{"t":"actfetch","ts":<millis>}` — activity history since `tsMillis`. */
export function buildActFetch(tsMillis: number): Uint8Array {
  if (!Number.isFinite(tsMillis)) throw new RangeError("BANGLE_JS_INVALID_TIMESTAMP");
  return buildGbFrame(JSON.stringify({ t: "actfetch", ts: Math.trunc(tsMillis) }));
}

/** `{"t":"act","hrm":true,"stp":false,"int":10}` — start the realtime stream. */
export function buildRealtimeEnable(
  intervalSeconds: number = BANGLE_JS_REALTIME_INTERVAL_SECONDS,
): Uint8Array {
  return buildGbFrame(
    JSON.stringify({
      t: "act",
      hrm: true,
      stp: false,
      int: Math.trunc(intervalSeconds),
    }),
  );
}

/** `{"t":"act","hrm":false,"stp":false,"int":0}` — stop the realtime stream. */
export function buildRealtimeDisable(): Uint8Array {
  return buildGbFrame(JSON.stringify({ t: "act", hrm: false, stp: false, int: 0 }));
}

/**
 * Raw Espruino JavaScript time-set frame (not JSON):
 * DLE + `setTime(<unixSeconds>);E.setTimeZone(<hours>);` + LF.
 *
 * `tzOffsetHours` is the device-local offset from UTC in hours, as Espruino's
 * `E.setTimeZone` expects (for example `-5` for EST). Callers derive it from
 * the phone: `-new Date().getTimezoneOffset() / 60`.
 */
export function buildTimeSet(unixSeconds: number, tzOffsetHours: number): Uint8Array {
  if (!Number.isFinite(unixSeconds) || !Number.isFinite(tzOffsetHours))
    throw new RangeError("BANGLE_JS_INVALID_TIME");
  const script = `setTime(${Math.trunc(unixSeconds)});E.setTimeZone(${formatHours(tzOffsetHours)});`;
  const bytes = new Uint8Array(script.length + 2);
  bytes[0] = BANGLE_JS_DLE;
  for (let index = 0; index < script.length; index += 1) {
    const code = script.charCodeAt(index);
    if (code > 0xff) throw new RangeError("BANGLE_JS_FRAME_NOT_ASCII");
    bytes[1 + index] = code;
  }
  bytes[script.length + 1] = 0x0a;
  return bytes;
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return String(rounded);
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export type BangleJsActSample = Readonly<{
  /** Device timestamp in ms since epoch; the bucket END for history samples. */
  timestamp: number;
  /** Steps in the bucket when the packet carried `stp >= 0`. */
  steps: number | null;
  /** Heart rate in bpm when the packet carried `hrm > 0`. */
  heartRate: number | null;
  /** Raw `mov` intensity; not persisted. */
  intensity: number | null;
  /** Optional activity name from `act`. */
  activity: string | null;
  /** True for `rt:1` realtime samples, false for stored history. */
  realtime: boolean;
}>;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Parses one `act` packet. Returns null when the packet is not an `act` packet
 * or carries no usable timestamp. Missing/negative fields are reported as
 * null rather than guessed.
 */
export function parseActPacket(packet: Record<string, unknown>): BangleJsActSample | null {
  if (packet.t !== "act") return null;
  const timestamp = finiteNumber(packet.ts);
  if (timestamp === null || timestamp <= 0) return null;
  const rawSteps = finiteNumber(packet.stp);
  const rawHeartRate = finiteNumber(packet.hrm);
  return {
    timestamp: Math.trunc(timestamp),
    steps: rawSteps !== null && rawSteps >= 0 ? Math.trunc(rawSteps) : null,
    heartRate: rawHeartRate !== null && rawHeartRate > 0 ? Math.trunc(rawHeartRate) : null,
    intensity: finiteNumber(packet.mov),
    activity: typeof packet.act === "string" && packet.act.length ? packet.act : null,
    realtime: packet.rt === 1,
  };
}

/** Reads the `state` of an `actfetch` reply; null for any other packet. */
export function parseActFetchState(packet: Record<string, unknown>): "start" | "end" | null {
  if (packet.t !== "actfetch") return null;
  if (packet.state === "end") return "end";
  if (packet.state === "start") return "start";
  return null;
}

/** Number of samples announced by an `actfetch` `end` packet, when present. */
export function parseActFetchCount(packet: Record<string, unknown>): number | null {
  const count = finiteNumber(packet.count);
  return count !== null && count >= 0 ? Math.trunc(count) : null;
}

/**
 * Converts a stored (`rt:0`) sample into the frozen record shapes.
 *
 * `ts` is the bucket end, so the interval is `[ts − 600000, ts]`. A sample can
 * yield both a steps interval and a heart-rate point; either may be absent.
 */
export function actSampleToRecords(sample: BangleJsActSample): readonly BangleJsRecord[] {
  if (sample.realtime) return [];
  const records: BangleJsRecord[] = [];
  if (sample.steps !== null)
    records.push({
      type: "steps_interval",
      startTime: new Date(sample.timestamp - BANGLE_JS_BUCKET_MS).toISOString(),
      endTime: new Date(sample.timestamp).toISOString(),
      count: sample.steps,
    });
  if (sample.heartRate !== null)
    records.push({
      type: "heart_rate",
      time: new Date(sample.timestamp).toISOString(),
      bpm: sample.heartRate,
    });
  return records;
}

/** Converts a realtime (`rt:1`) sample into a live heart-rate point. */
export function realtimeSampleToHeartRate(
  sample: BangleJsActSample,
): BangleJsHeartRateSample | null {
  if (!sample.realtime || sample.heartRate === null) return null;
  return {
    type: "heart_rate",
    time: new Date(sample.timestamp).toISOString(),
    bpm: sample.heartRate,
  };
}
