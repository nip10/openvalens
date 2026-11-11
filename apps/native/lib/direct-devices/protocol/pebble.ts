/**
 * Pure Pebble protocol codecs and parsers.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * - `service/devices/pebble/PebbleProtocol.java`
 * - `service/devices/pebble/ble/PebbleLESupport.java`
 * - `service/devices/pebble/ble/PebbleGATTConstants.java`
 * - `service/devices/pebble/DatalogSessionHealthSteps.java`
 * - `service/devices/pebble/DatalogSessionHealthSleep.java`
 * - `service/devices/pebble/DatalogSessionHealthOverlayData.java`
 * - `service/devices/pebble/DatalogSessionHealthHR.java`
 * - `devices/pebble/PebbleHealthSampleProvider.java`
 *
 * Framing
 * -------
 * `[u16 BE payloadLength][u16 BE endpoint][payload…]`. `payloadLength` excludes
 * the 4-byte prefix (`PebbleProtocol.LENGTH_PREFIX`). There is no checksum or
 * terminator, so a frame is complete exactly when `4 + payloadLength` bytes
 * have arrived.
 *
 * PPoGATT (the BLE shim)
 * ----------------------
 * Every GATT write/notification is `[header][chunk…]` where
 * `header = (serial << 3) | command`:
 *
 * - command 0 = data; the receiver answers with `(serial << 3) | 1` and strips
 *   the header.
 * - command 1 = ACK.
 * - command 2 = request; answered with the magic `03 19 19` when the packet
 *   carried a payload, otherwise `03`.
 *
 * Outbound frames are split into chunks of `calcMaxWriteChunk(mtu) - 1` bytes
 * (the header takes the remaining byte), with the 5-bit serial incrementing
 * per chunk (`(serial + 1) & 0x1f`).
 *
 * DATALOG (endpoint 6778)
 * -----------------------
 * `[command][sessionId][…]`. Opcodes: OPENSESSION 0x01, SENDDATA 0x02,
 * CLOSE 0x03, TIMEOUT 0x07, REPORTSESSIONS 0x84, ACK 0x85, NACK 0x86.
 * SENDDATA carries `items_left` (i32 LE) and `crc` (i32 LE) before the record
 * data. Health sessions are opened by the watch with `uuid == UUID_ZERO` and a
 * log tag: 78 analytics, 81 steps, 83 sleep bounds, 84 sleep overlays,
 * 85 standalone HR (a stub upstream that parses nothing).
 *
 * Steps records (tag 81)
 * ----------------------
 * Accepted record versions {5,6,7,12,13,14}. Per packet: recordVersion (i16
 * LE), timestamp (i32 LE), one unknown byte, recordLength (u8), recordNum
 * (u8), then `recordNum` records of `recordLength` bytes. `timestamp += 60`
 * per record, so each record is one minute. Fields: steps (u8), orientation
 * (u8), intensity (u16 LE), lightIntensity (u8), then v>=5 flags (u8),
 * v>=6 restingCalories/activeCalories/distanceCm (u16 LE each), v>=7
 * heartRate (u8), v>=12 heartRateTotalWeight (u16 LE), v>=13 heartRateZone
 * (u8), v>=14 spoPercent/spoQuality (u8 each).
 *
 * Sleep (tags 83/84)
 * ------------------
 * Tag 83: version (u16 LE), offsetUTC (i32 LE), bedTimeStart (i32 LE),
 * bedTimeEnd (i32 LE), deepSleepSeconds (i32 LE) — one record per sleep
 * period, no stage placement. Tag 84: version (u16 LE, 1 or 3), one unknown
 * u16, type (u16 LE), offsetUTC (i32 LE), timestampStart (i32 LE),
 * durationSeconds (i32 LE). Type 1 light sleep, 2 deep sleep, 3 light nap,
 * 4 deep nap, -1 activity. The overlays are what give the actual stages.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

import type { PebbleRecordType } from "../models/pebble";

// ---------------------------------------------------------------------------
// GATT constants
// ---------------------------------------------------------------------------

/** Pairing/PPoGATT service the watch exposes (`0000fed9-…`). */
export const PEBBLE_SERVICE_UUID = "0000fed9-0000-1000-8000-00805f9b34fb";
/** Connectivity characteristic (`00000001-328e-0fbb-c642-1aa6699bdada`). */
export const PEBBLE_CONNECTIVITY_UUID = "00000001-328e-0fbb-c642-1aa6699bdada";
/** Pairing trigger characteristic (`00000002-…`). */
export const PEBBLE_PAIRING_TRIGGER_UUID = "00000002-328e-0fbb-c642-1aa6699bdada";
/** MTU characteristic (`00000003-…`). */
export const PEBBLE_MTU_UUID = "00000003-328e-0fbb-c642-1aa6699bdada";
/** Connection-parameters characteristic (`00000005-…`). */
export const PEBBLE_CONNECTION_PARAMETERS_UUID = "00000005-328e-0fbb-c642-1aa6699bdada";
/** PPoGATT service (`30000003-…`). */
export const PEBBLE_PPOGATT_SERVICE_UUID = "30000003-328e-0fbb-c642-1aa6699bdada";
/** PPoGATT read/notify characteristic (`30000004-…`). */
export const PEBBLE_PPOGATT_READ_UUID = "30000004-328e-0fbb-c642-1aa6699bdada";
/** PPoGATT write characteristic (`30000006-…`). */
export const PEBBLE_PPOGATT_WRITE_UUID = "30000006-328e-0fbb-c642-1aa6699bdada";
/** Phone-side GATT server service (`10000000-…`). */
export const PEBBLE_GATT_SERVER_SERVICE_UUID = "10000000-328e-0fbb-c642-1aa6699bdada";
/** Phone-side GATT server write characteristic (`10000001-…`). */
export const PEBBLE_GATT_SERVER_WRITE_UUID = "10000001-328e-0fbb-c642-1aa6699bdada";
/** Phone-side GATT server read characteristic (`10000002-…`). */
export const PEBBLE_GATT_SERVER_READ_UUID = "10000002-328e-0fbb-c642-1aa6699bdada";
/** Phone-side GATT server decoy service (`BADBADBA-…`). */
export const PEBBLE_GATT_SERVER_DECOY_SERVICE_UUID = "badbadba-dbad-badb-adba-badbadbadbad";

/** Upstream `gatt.requestMtu(339)` after the MTU characteristic write. */
export const PEBBLE_MTU_REQUEST = 339;
/** `pebble_mtu_limit` preference default/range (`PebbleLESupport`). */
export const PEBBLE_MTU_LIMIT_DEFAULT = 512;
export const PEBBLE_MTU_LIMIT_MIN = 20;
export const PEBBLE_MTU_LIMIT_MAX = 512;

// ---------------------------------------------------------------------------
// Endpoints and opcodes
// ---------------------------------------------------------------------------

export const PEBBLE_ENDPOINT_TIME = 11;
export const PEBBLE_ENDPOINT_FIRMWARE_VERSION = 16;
export const PEBBLE_ENDPOINT_PHONE_VERSION = 17;
export const PEBBLE_ENDPOINT_SYSTEM_MESSAGE = 18;
export const PEBBLE_ENDPOINT_APPLICATION_MESSAGE = 48;
export const PEBBLE_ENDPOINT_LOGS = 2000;
export const PEBBLE_ENDPOINT_PING = 2001;
export const PEBBLE_ENDPOINT_LOG_DUMP = 2002;
export const PEBBLE_ENDPOINT_DATALOG = 6778;
export const PEBBLE_ENDPOINT_SCREENSHOT = 8000;
export const PEBBLE_ENDPOINT_BLOBDB = 0xb1db;
export const PEBBLE_ENDPOINT_HEALTH_SYNC = 911;

export const PEBBLE_DATALOG_OPEN_SESSION = 0x01;
export const PEBBLE_DATALOG_SEND_DATA = 0x02;
export const PEBBLE_DATALOG_CLOSE = 0x03;
export const PEBBLE_DATALOG_TIMEOUT = 0x07;
export const PEBBLE_DATALOG_REPORT_SESSIONS = 0x84;
export const PEBBLE_DATALOG_ACK = 0x85;
export const PEBBLE_DATALOG_NACK = 0x86;

export const PEBBLE_HEALTH_LOG_TAG_ANALYTICS = 78;
export const PEBBLE_HEALTH_LOG_TAG_STEPS = 81;
export const PEBBLE_HEALTH_LOG_TAG_SLEEP = 83;
export const PEBBLE_HEALTH_LOG_TAG_OVERLAY = 84;
export const PEBBLE_HEALTH_LOG_TAG_HEART_RATE = 85;

/** `UUID_ZERO` — the uuid every health session opens with. */
export const PEBBLE_UUID_ZERO = "00000000-0000-0000-0000-000000000000";

export const PEBBLE_BLOBDB_INSERT = 1;
export const PEBBLE_BLOBDB_DELETE = 4;
export const PEBBLE_BLOBDB_CLEAR = 5;
export const PEBBLE_BLOBDB_PREFERENCES = 7;

export const PEBBLE_HEALTH_SYNC_COMMAND_SYNC = 0x01;

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16be(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff]);
}

function u16le(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff]);
}

function u32le(value: number): Uint8Array {
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function readU16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

function readU16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) >>> 0;
}

function readI32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  );
}

function asciiBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) out[index] = value.charCodeAt(index) & 0xff;
  return out;
}

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error("INVALID_UUID");
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1)
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

function readUuid(bytes: Uint8Array, offset: number): string {
  const hex = Array.from(bytes.slice(offset, offset + 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixedString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = Math.min(bytes.length, offset + length);
  while (end < limit && bytes[end] !== 0) end += 1;
  let text = "";
  for (let index = offset; index < end; index += 1) text += String.fromCharCode(bytes[index]!);
  return text;
}

// ---------------------------------------------------------------------------
// Pebble framing
// ---------------------------------------------------------------------------

export const PEBBLE_LENGTH_PREFIX = 4;

/** A decoded Pebble frame. `payload` excludes the 4-byte prefix. */
export type PebbleFrame = Readonly<{ endpoint: number; payload: Uint8Array }>;

/** Encodes `[u16 BE payloadLength][u16 BE endpoint][payload]`. */
export function encodePebbleFrame(endpoint: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(endpoint) || endpoint < 0 || endpoint > 0xffff)
    throw new Error("INVALID_ENDPOINT");
  if (payload.length > 0xffff) throw new Error("PAYLOAD_TOO_LARGE");
  return concat([u16be(payload.length), u16be(endpoint), payload]);
}

/** Encodes a one-byte "simple message" frame. */
export function encodeSimpleMessage(endpoint: number, command: number): Uint8Array {
  return encodePebbleFrame(endpoint, Uint8Array.from([command & 0xff]));
}

/**
 * Decodes exactly one frame. Returns null when the buffer is shorter than the
 * announced frame or when the length prefix does not match the buffer length.
 */
export function decodePebbleFrame(bytes: Uint8Array): PebbleFrame | null {
  if (bytes.length < PEBBLE_LENGTH_PREFIX) return null;
  const length = readU16be(bytes, 0);
  if (bytes.length !== PEBBLE_LENGTH_PREFIX + length) return null;
  return {
    endpoint: readU16be(bytes, 2),
    payload: bytes.slice(PEBBLE_LENGTH_PREFIX),
  };
}

/** Incremental reassembler for frames split across GATT packets. */
export type PebbleReassembler = Readonly<{ push(bytes: Uint8Array): readonly PebbleFrame[] }>;

export function createPebbleReassembler(): PebbleReassembler {
  let buffer = new Uint8Array(0);
  return {
    push(bytes) {
      buffer = concat([buffer, bytes]);
      const frames: PebbleFrame[] = [];
      while (buffer.length >= PEBBLE_LENGTH_PREFIX) {
        const length = readU16be(buffer, 0);
        const total = PEBBLE_LENGTH_PREFIX + length;
        if (buffer.length < total) break;
        frames.push({
          endpoint: readU16be(buffer, 2),
          payload: buffer.slice(PEBBLE_LENGTH_PREFIX, total),
        });
        buffer = buffer.slice(total);
      }
      return frames;
    },
  };
}

// ---------------------------------------------------------------------------
// PPoGATT
// ---------------------------------------------------------------------------

export const PPOGATT_COMMAND_DATA = 0;
export const PPOGATT_COMMAND_ACK = 1;
export const PPOGATT_COMMAND_REQUEST = 2;

/** Decoded PPoGATT header: command (low 3 bits) and serial (high 5 bits). */
export type PpogattHeader = Readonly<{ command: number; serial: number }>;

export function decodePpogattHeader(header: number): PpogattHeader {
  const value = header & 0xff;
  return { command: value & 0x07, serial: (value >>> 3) & 0x1f };
}

/** Encodes a data packet (`header = serial << 3`) carrying `payload`. */
export function encodePpogattData(serial: number, payload: Uint8Array): Uint8Array {
  const header = ((serial & 0x1f) << 3) & 0xff;
  return concat([Uint8Array.from([header]), payload]);
}

/** Encodes the ACK for a received data packet: `(serial << 3) | 1`. */
export function encodePpogattAck(serial: number): Uint8Array {
  return Uint8Array.from([(((serial & 0x1f) << 3) | 1) & 0xff]);
}

/** The reply to a command-2 request: `03 19 19` with a payload, `03` without. */
export function ppogattMagicResponse(hasPayload: boolean): Uint8Array {
  return hasPayload ? Uint8Array.from([0x03, 0x19, 0x19]) : Uint8Array.from([0x03]);
}

/** Next 5-bit serial. */
export function nextPpogattSerial(serial: number): number {
  return (serial + 1) & 0x1f;
}

/** Upstream `AbstractBTLEDeviceSupport.calcMaxWriteChunk`: `min(512, max(23, mtu) - 3)`. */
export function calcMaxWriteChunk(mtu: number): number {
  const safeMtu = Math.max(23, Math.trunc(mtu));
  return Math.min(512, safeMtu - 3);
}

/** Payload bytes per PPoGATT packet (`calcMaxWriteChunk(mtu) - 1`). */
export function ppogattChunkSize(mtu: number): number {
  return calcMaxWriteChunk(mtu) - 1;
}

/**
 * Splits a complete Pebble frame (prefix included) into PPoGATT data packets.
 * The first packet uses `startSerial`; each following packet increments the
 * 5-bit serial.
 */
export function chunkPpogatt(
  frame: Uint8Array,
  mtu: number,
  startSerial = 0,
): readonly Uint8Array[] {
  const chunkSize = ppogattChunkSize(mtu);
  if (chunkSize < 1) throw new Error("INVALID_MTU");
  const packets: Uint8Array[] = [];
  let serial = startSerial & 0x1f;
  for (let offset = 0; offset < frame.length; offset += chunkSize) {
    packets.push(encodePpogattData(serial, frame.slice(offset, offset + chunkSize)));
    serial = nextPpogattSerial(serial);
  }
  return packets;
}

// ---------------------------------------------------------------------------
// DATALOG session frames
// ---------------------------------------------------------------------------

export type PebbleDatalogOpenSession = Readonly<{
  command: "open_session";
  id: number;
  uuid: string;
  timestamp: number;
  logTag: number;
  itemType: number;
  itemSize: number;
}>;

export type PebbleDatalogSendData = Readonly<{
  command: "send_data";
  id: number;
  itemsLeft: number;
  crc: number;
  data: Uint8Array;
}>;

export type PebbleDatalogFrame =
  | PebbleDatalogOpenSession
  | PebbleDatalogSendData
  | Readonly<{ command: "close"; id: number }>
  | Readonly<{ command: "timeout"; id: number }>
  | Readonly<{ command: "ack"; id: number }>
  | Readonly<{ command: "nack"; id: number }>
  | Readonly<{ command: "report_sessions" }>
  | Readonly<{ command: "unknown"; opcode: number; id: number }>;

/** Builds an OPENSESSION payload (without the 4-byte frame prefix). */
export function encodeDatalogOpenSession(args: {
  id: number;
  uuid: string;
  timestamp: number;
  logTag: number;
  itemType: number;
  itemSize: number;
}): Uint8Array {
  return concat([
    Uint8Array.from([PEBBLE_DATALOG_OPEN_SESSION, args.id & 0xff]),
    uuidBytes(args.uuid),
    u32le(args.timestamp),
    u32le(args.logTag),
    Uint8Array.from([args.itemType & 0xff]),
    u16le(args.itemSize),
  ]);
}

/** Builds a SENDDATA payload: `items_left` and `crc` precede the records. */
export function encodeDatalogSendData(args: {
  id: number;
  itemsLeft: number;
  crc: number;
  data: Uint8Array;
}): Uint8Array {
  return concat([
    Uint8Array.from([PEBBLE_DATALOG_SEND_DATA, args.id & 0xff]),
    u32le(args.itemsLeft),
    u32le(args.crc),
    args.data,
  ]);
}

export function encodeDatalogClose(id: number): Uint8Array {
  return Uint8Array.from([PEBBLE_DATALOG_CLOSE, id & 0xff]);
}

export function encodeDatalogTimeout(id: number): Uint8Array {
  return Uint8Array.from([PEBBLE_DATALOG_TIMEOUT, id & 0xff]);
}

/** `[0x85, id]` — the reply that acknowledges a session packet. */
export function encodeDatalogAck(id: number): Uint8Array {
  return Uint8Array.from([PEBBLE_DATALOG_ACK, id & 0xff]);
}

/** `[0x86, id]` — the reply that rejects a session packet. */
export function encodeDatalogNack(id: number): Uint8Array {
  return Uint8Array.from([PEBBLE_DATALOG_NACK, id & 0xff]);
}

/** Wraps a DATALOG payload in an endpoint-6778 frame. */
export function encodeDatalogFrame(payload: Uint8Array): Uint8Array {
  return encodePebbleFrame(PEBBLE_ENDPOINT_DATALOG, payload);
}

/** Decodes a DATALOG payload (the bytes after the 4-byte frame prefix). */
export function decodeDatalogPayload(payload: Uint8Array): PebbleDatalogFrame | null {
  if (payload.length < 1) return null;
  const opcode = payload[0]!;
  const id = payload.length > 1 ? payload[1]! : 0;
  switch (opcode) {
    case PEBBLE_DATALOG_OPEN_SESSION: {
      // 2 opcode/id + 16 uuid + 4 timestamp + 4 tag + 1 type + 2 size = 29
      if (payload.length < 29) return null;
      return {
        command: "open_session",
        id,
        uuid: readUuid(payload, 2),
        timestamp: readI32le(payload, 18),
        logTag: readI32le(payload, 22),
        itemType: payload[26]!,
        itemSize: readU16le(payload, 27),
      };
    }
    case PEBBLE_DATALOG_SEND_DATA: {
      if (payload.length < 10) return null;
      return {
        command: "send_data",
        id,
        itemsLeft: readI32le(payload, 2),
        crc: readI32le(payload, 6),
        data: payload.slice(10),
      };
    }
    case PEBBLE_DATALOG_CLOSE:
      return { command: "close", id };
    case PEBBLE_DATALOG_TIMEOUT:
      return { command: "timeout", id };
    case PEBBLE_DATALOG_ACK:
      return { command: "ack", id };
    case PEBBLE_DATALOG_NACK:
      return { command: "nack", id };
    case PEBBLE_DATALOG_REPORT_SESSIONS:
      return { command: "report_sessions" };
    default:
      return { command: "unknown", opcode, id };
  }
}

// ---------------------------------------------------------------------------
// Health-enable BlobDB writes
// ---------------------------------------------------------------------------

/**
 * Encodes a BlobDB frame. `length = 5 + keyLength + (blob ? blob.length + 2 : 0)`,
 * then `command (u8), token (u16 LE), database (u8), keyLength (u8), key,
 * [blobLength (u16 LE), blob]`. Upstream picks a random token; pass one for
 * deterministic output.
 */
export function encodeBlobdb(args: {
  key: string;
  command: number;
  database: number;
  blob?: Uint8Array | null;
  token?: number;
}): Uint8Array {
  const key = asciiBytes(args.key);
  if (key.length > 255) throw new Error("KEY_TOO_LONG");
  const blob = args.blob ?? null;
  const body = concat([
    Uint8Array.from([args.command & 0xff]),
    u16le(args.token ?? 0),
    Uint8Array.from([args.database & 0xff]),
    Uint8Array.from([key.length]),
    key,
    ...(blob ? [u16le(blob.length), blob] : []),
  ]);
  return encodePebbleFrame(PEBBLE_ENDPOINT_BLOBDB, body);
}

export type PebbleHealthProfile = Readonly<{
  heightCm: number;
  weightKg: number;
  age: number;
  gender: number;
  token?: number;
}>;

/**
 * `encodeActivateHealth(true)` — the `activityPreferences` preference write
 * upstream triggers from `fake://health`. Blob: heightMm (u16 LE),
 * weightDag (u16 LE), tracking 0x01, activity insights 0x00, sleep insights
 * 0x00, age (u8), gender (u8).
 */
export function encodeActivateHealth(profile: PebbleHealthProfile): Uint8Array {
  const blob = concat([
    u16le(Math.round(profile.heightCm * 10)),
    u16le(Math.round(profile.weightKg * 100)),
    Uint8Array.from([0x01, 0x00, 0x00, profile.age & 0xff, profile.gender & 0xff]),
  ]);
  return encodeBlobdb({
    key: "activityPreferences",
    command: PEBBLE_BLOBDB_INSERT,
    database: PEBBLE_BLOBDB_PREFERENCES,
    blob,
    token: profile.token,
  });
}

/** Deactivates health tracking (all-zero blob), as upstream does on app delete. */
export function encodeDeactivateHealth(token?: number): Uint8Array {
  return encodeBlobdb({
    key: "activityPreferences",
    command: PEBBLE_BLOBDB_INSERT,
    database: PEBBLE_BLOBDB_PREFERENCES,
    blob: new Uint8Array(9),
    token,
  });
}

/** `hrmPreferences` write (`fake://hrm`). */
export function encodeActivateHrm(activate: boolean, token?: number): Uint8Array {
  return encodeBlobdb({
    key: "hrmPreferences",
    command: PEBBLE_BLOBDB_INSERT,
    database: PEBBLE_BLOBDB_PREFERENCES,
    blob: Uint8Array.from([activate ? 0x01 : 0x00]),
    token,
  });
}

/** `unitsDistance` write; upstream's "sane" value is metric (`0x00`). */
export function encodeSetSaneDistanceUnit(sane: boolean, token?: number): Uint8Array {
  return encodeBlobdb({
    key: "unitsDistance",
    command: PEBBLE_BLOBDB_INSERT,
    database: PEBBLE_BLOBDB_PREFERENCES,
    blob: Uint8Array.from([sane ? 0x00 : 0x01]),
    token,
  });
}

// ---------------------------------------------------------------------------
// Health sync / firmware version
// ---------------------------------------------------------------------------

/**
 * `encodeHealthSync()`: endpoint 911, payload `01` + `u32 LE 0` (seconds since
 * last sync; 0 asks for everything queued).
 */
export function encodeHealthSync(): Uint8Array {
  return encodePebbleFrame(
    PEBBLE_ENDPOINT_HEALTH_SYNC,
    concat([Uint8Array.from([PEBBLE_HEALTH_SYNC_COMMAND_SYNC]), u32le(0)]),
  );
}

/** `encodeFirmwareVersionReq()`: endpoint 16, command 0. */
export function encodeFirmwareVersionReq(): Uint8Array {
  return encodeSimpleMessage(PEBBLE_ENDPOINT_FIRMWARE_VERSION, 0);
}

export type PebbleFirmwareVersion = Readonly<{
  command: number;
  fwVersion: string;
  gitHash: string;
  flags: number;
  /** Hardware revision byte; index into `PebbleHardware`'s id table. */
  hardwareId: number;
}>;

/**
 * Parses the firmware-version reply: command (u8), 4 skipped bytes, fwVersion
 * (32-byte fixed string), gitHash (8-byte fixed string), flags (u8), hardware
 * revision (u8).
 */
export function parseFirmwareVersion(payload: Uint8Array): PebbleFirmwareVersion | null {
  if (payload.length < 47) return null;
  return {
    command: payload[0]!,
    fwVersion: fixedString(payload, 5, 32),
    gitHash: fixedString(payload, 37, 8),
    flags: payload[45]!,
    hardwareId: payload[46]!,
  };
}

// ---------------------------------------------------------------------------
// Steps records (tag 81)
// ---------------------------------------------------------------------------

export const PEBBLE_STEPS_VERSIONS: readonly number[] = [5, 6, 7, 12, 13, 14];

export type PebbleStepsSample = Readonly<{
  /** Unix seconds; each record advances by 60. */
  timestamp: number;
  version: number;
  steps: number;
  orientation: number;
  intensity: number;
  lightIntensity: number;
  flags?: number;
  restingCalories?: number;
  activeCalories?: number;
  distanceCm?: number;
  heartRate?: number;
  heartRateTotalWeight?: number;
  heartRateZone?: number;
  spoPercent?: number;
  spoQuality?: number;
}>;

export type PebbleStepsPacket = Readonly<{
  version: number;
  timestamp: number;
  recordLength: number;
  samples: readonly PebbleStepsSample[];
}>;

function parseStepsRecord(
  packet: Uint8Array,
  offset: number,
  recordLength: number,
  version: number,
  timestamp: number,
): PebbleStepsSample | null {
  if (offset + recordLength > packet.length) return null;
  let cursor = offset;
  const need = (count: number) => cursor + count <= offset + recordLength;
  if (!need(5)) return null;
  const steps = packet[cursor++]!;
  const orientation = packet[cursor++]!;
  const intensity = readU16le(packet, cursor);
  cursor += 2;
  const lightIntensity = packet[cursor++]!;
  const sample: {
    -readonly [K in keyof PebbleStepsSample]: PebbleStepsSample[K];
  } = { timestamp, version, steps, orientation, intensity, lightIntensity };
  if (version >= 5) {
    if (!need(1)) return null;
    sample.flags = packet[cursor++]!;
  }
  if (version >= 6) {
    if (!need(6)) return null;
    sample.restingCalories = readU16le(packet, cursor);
    sample.activeCalories = readU16le(packet, cursor + 2);
    sample.distanceCm = readU16le(packet, cursor + 4);
    cursor += 6;
  }
  if (version >= 7) {
    if (!need(1)) return null;
    sample.heartRate = packet[cursor++]!;
  }
  if (version >= 12) {
    if (!need(2)) return null;
    sample.heartRateTotalWeight = readU16le(packet, cursor);
    cursor += 2;
  }
  if (version >= 13) {
    if (!need(1)) return null;
    sample.heartRateZone = packet[cursor++]!;
  }
  if (version >= 14) {
    if (!need(2)) return null;
    sample.spoPercent = packet[cursor++]!;
    sample.spoQuality = packet[cursor++]!;
  }
  return sample;
}

/**
 * Parses a steps SENDDATA payload (the bytes after `items_left`/`crc`).
 * Returns null for a malformed message or an unknown record version, which
 * upstream answers with a NACK.
 */
export function parseStepsSessionData(
  data: Uint8Array,
  itemSize: number,
): readonly PebbleStepsPacket[] | null {
  if (!Number.isInteger(itemSize) || itemSize < 9) return null;
  if (data.length === 0 || data.length % itemSize !== 0) return null;
  const packets: PebbleStepsPacket[] = [];
  for (let base = 0; base < data.length; base += itemSize) {
    const packet = data.slice(base, base + itemSize);
    const version = readU16le(packet, 0);
    if (!PEBBLE_STEPS_VERSIONS.includes(version)) return null;
    const timestamp = readI32le(packet, 2);
    // packet[6] is an unknown byte.
    const recordLength = packet[7]!;
    const recordNum = packet[8]!;
    if (recordLength < 5 || recordNum === 0) return null;
    if (9 + recordLength * recordNum > itemSize) return null;
    const samples: PebbleStepsSample[] = [];
    let recordTimestamp = timestamp;
    for (let index = 0; index < recordNum; index += 1) {
      const sample = parseStepsRecord(
        packet,
        9 + index * recordLength,
        recordLength,
        version,
        recordTimestamp,
      );
      if (!sample) return null;
      samples.push(sample);
      recordTimestamp += 60;
    }
    packets.push({ version, timestamp, recordLength, samples });
  }
  return packets;
}

// ---------------------------------------------------------------------------
// Sleep records (tags 83 and 84)
// ---------------------------------------------------------------------------

export const PEBBLE_SLEEP_TYPE_LIGHT_SLEEP = 1;
export const PEBBLE_SLEEP_TYPE_DEEP_SLEEP = 2;
export const PEBBLE_SLEEP_TYPE_LIGHT_NAP = 3;
export const PEBBLE_SLEEP_TYPE_DEEP_NAP = 4;
export const PEBBLE_SLEEP_TYPE_ACTIVITY = -1;

/** Tag 83 record: one sleep period with a total deep-sleep duration. */
export type PebbleSleepBounds = Readonly<{
  version: number;
  offsetUtc: number;
  bedTimeStart: number;
  bedTimeEnd: number;
  deepSleepSeconds: number;
}>;

/** Tag 84 record: one stage interval. */
export type PebbleSleepOverlay = Readonly<{
  version: number;
  type: number;
  offsetUtc: number;
  timestampStart: number;
  durationSeconds: number;
}>;

/** Parses a tag-83 SENDDATA payload. */
export function parseSleepSessionData(
  data: Uint8Array,
  itemSize: number,
): readonly PebbleSleepBounds[] | null {
  if (!Number.isInteger(itemSize) || itemSize < 18) return null;
  if (data.length === 0 || data.length % itemSize !== 0) return null;
  const records: PebbleSleepBounds[] = [];
  for (let base = 0; base < data.length; base += itemSize) {
    const record = data.slice(base, base + itemSize);
    records.push({
      version: readU16le(record, 0),
      offsetUtc: readI32le(record, 2),
      bedTimeStart: readI32le(record, 6),
      bedTimeEnd: readI32le(record, 10),
      deepSleepSeconds: readI32le(record, 14),
    });
  }
  return records;
}

/** Parses a tag-84 SENDDATA payload. */
export function parseOverlaySessionData(
  data: Uint8Array,
  itemSize: number,
): readonly PebbleSleepOverlay[] | null {
  if (!Number.isInteger(itemSize) || itemSize < 18) return null;
  if (data.length === 0 || data.length % itemSize !== 0) return null;
  const records: PebbleSleepOverlay[] = [];
  for (let base = 0; base < data.length; base += itemSize) {
    const record = data.slice(base, base + itemSize);
    records.push({
      version: readU16le(record, 0),
      // record[2..3] is an unknown u16 upstream discards.
      type: readU16le(record, 4),
      offsetUtc: readI32le(record, 6),
      timestampStart: readI32le(record, 10),
      durationSeconds: readI32le(record, 14),
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Contract records
// ---------------------------------------------------------------------------

/** One 1-minute step record (frozen contract `steps`). */
export type PebbleStepsRecord = Readonly<{
  type: "steps";
  startTime: string;
  endTime: string;
  count: number;
}>;

/** One heart-rate point (frozen contract `heart_rate`). */
export type PebbleHeartRateSample = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

export type PebbleSleepStage = Readonly<{
  stage: "light" | "deep";
  startTime: string;
  endTime: string;
}>;

/** One sleep period (frozen contract `sleep_session`). */
export type PebbleSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly PebbleSleepStage[];
}>;

export type PebbleRecord = PebbleStepsRecord | PebbleHeartRateSample | PebbleSleepSession;

/** Failure kinds reported by the transport. */
export type PebbleFailure = PebbleRecordType | "init" | "sync";

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * Turns parsed steps samples into contract records. Each sample is one minute;
 * versions >= 7 also carry a heart-rate reading for that minute.
 */
export function stepsSamplesToRecords(samples: readonly PebbleStepsSample[]): {
  steps: readonly PebbleStepsRecord[];
  heartRate: readonly PebbleHeartRateSample[];
} {
  const steps: PebbleStepsRecord[] = [];
  const heartRate: PebbleHeartRateSample[] = [];
  for (const sample of samples) {
    steps.push({
      type: "steps",
      startTime: iso(sample.timestamp),
      endTime: iso(sample.timestamp + 60),
      count: sample.steps,
    });
    if (sample.heartRate !== undefined && sample.heartRate > 0)
      heartRate.push({ type: "heart_rate", time: iso(sample.timestamp), bpm: sample.heartRate });
  }
  return { steps, heartRate };
}

function sleepStageName(type: number): "light" | "deep" | null {
  switch (type) {
    case PEBBLE_SLEEP_TYPE_LIGHT_SLEEP:
    case PEBBLE_SLEEP_TYPE_LIGHT_NAP:
      return "light";
    case PEBBLE_SLEEP_TYPE_DEEP_SLEEP:
    case PEBBLE_SLEEP_TYPE_DEEP_NAP:
      return "deep";
    default:
      // -1 activity and the walk/run types are not sleep.
      return null;
  }
}

/**
 * Combines tag-83 bounds with tag-84 stage intervals. Overlays are clipped to
 * the sleep period and sorted by start; activity intervals are dropped. When
 * no overlay covers a period, `stages` is omitted rather than inventing a
 * placement for `deepSleepSeconds`.
 */
export function assembleSleepSessions(
  bounds: readonly PebbleSleepBounds[],
  overlays: readonly PebbleSleepOverlay[],
): readonly PebbleSleepSession[] {
  return bounds.map((period) => {
    const start = period.bedTimeStart;
    const end = period.bedTimeEnd;
    const stages: PebbleSleepStage[] = [];
    for (const overlay of overlays) {
      const stage = sleepStageName(overlay.type);
      if (!stage) continue;
      const overlayStart = overlay.timestampStart;
      const overlayEnd = overlay.timestampStart + overlay.durationSeconds;
      const clippedStart = Math.max(overlayStart, start);
      const clippedEnd = Math.min(overlayEnd, end);
      if (clippedEnd <= clippedStart) continue;
      stages.push({ stage, startTime: iso(clippedStart), endTime: iso(clippedEnd) });
    }
    stages.sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
    return {
      type: "sleep_session" as const,
      startTime: iso(start),
      endTime: iso(end),
      ...(stages.length ? { stages } : {}),
    };
  });
}
