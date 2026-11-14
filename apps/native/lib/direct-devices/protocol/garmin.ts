/**
 * Garmin GFDI + FIT codec (pure, no BLE).
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2, paths relative to
 * `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`:
 * - `service/devices/garmin/communicator/CobsCoDec.java` (COBS variant)
 * - `service/devices/garmin/ChecksumCalculator.java` (CRC-16 nibble table)
 * - `service/devices/garmin/messages/GFDIMessage.java` (framing, type table)
 * - `service/devices/garmin/messages/{DownloadRequest,FileTransferData,
 *   SetFileFlags,SupportedFileTypes,SystemEvent}Message.java`
 * - `service/devices/garmin/messages/status/*` (status payloads)
 * - `service/devices/garmin/messages/FileTransferHandler.java` (directory
 *   records, download queue, chunk CRC)
 * - `service/devices/garmin/FileType.java` (data type / sub type table)
 * - `service/devices/garmin/GarminTimeUtils.java` (epoch offset)
 * - `service/devices/garmin/fit/{FitFile,RecordHeader,RecordDefinition,
 *   RecordData}.java` (FIT container)
 * - `service/devices/garmin/fit/FitImporter.java` (monitoring + sleep
 *   semantics)
 * - `service/devices/garmin/fit/messages/FitMonitoring.java` (timestamp_16
 *   rollover)
 * - `service/devices/garmin/fit/enums/SleepLevel.java`
 * - `service/devices/garmin/devices/garmin/GarminSleepSessionProvider.kt`
 *   (event-bounded sessions, upper-bound stage samples)
 * - `FitCodeGenerator/src/main/resources/fit_profile.json` (field numbers,
 *   base types, scales for the eight message types below)
 *
 * FIT parser choice
 * -----------------
 * Checked npm before hand-rolling:
 * - `fit-file-parser@6.2.7` — MIT (LICENSE: "The MIT License (MIT),
 *   Copyright (c) 2015 Pierre Jacquier"). Parses every message type needed,
 *   but `dist/binary.js` does `import { Buffer } from 'buffer'`, so it needs a
 *   Buffer polyfill in React Native, and it ships a 1.7 MB full FIT profile.
 *   It also applies profile scales and hides the raw definition/`timestamp_16`
 *   layer this port needs to reproduce upstream arithmetic exactly.
 * - `fit-parser@0.10.1` — MIT, older and narrower than the above.
 * Neither is a good fit for an Expo/React Native bundle, so the FIT container
 * is hand-rolled here from the upstream parser and the profile JSON. Only the
 * message types this family emits are described; unknown messages are walked
 * and skipped without losing record alignment.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Garmin epoch offset in seconds (`GarminTimeUtils.GARMIN_TIME_EPOCH`). */
export const GARMIN_TIME_EPOCH = 631_065_600;

/** `.FIT` magic, little-endian (`FitFile.Header.MAGIC`). */
export const GARMIN_FIT_MAGIC = 0x5449462e;

/** GFDI message ids (`GFDIMessage.GarminMessage`). */
export const GARMIN_MESSAGE = {
  RESPONSE: 5000,
  DOWNLOAD_REQUEST: 5002,
  UPLOAD_REQUEST: 5003,
  FILE_TRANSFER_DATA: 5004,
  CREATE_FILE: 5005,
  FILTER: 5007,
  SET_FILE_FLAG: 5008,
  FILE_AVAILABLE: 5009,
  FIT_DEFINITION: 5011,
  FIT_DATA: 5012,
  WEATHER_REQUEST: 5014,
  BATTERY_STATUS: 5023,
  DEVICE_INFORMATION: 5024,
  SYSTEM_EVENT: 5030,
  SUPPORTED_FILE_TYPES_REQUEST: 5031,
  SYNCHRONIZATION: 5037,
  FIND_MY_PHONE_REQUEST: 5039,
  FIND_MY_PHONE_CANCEL: 5040,
  MUSIC_CONTROL: 5041,
  CONFIGURATION: 5050,
  CURRENT_TIME_REQUEST: 5052,
  AUTH_NEGOTIATION: 5101,
} as const;

/**
 * GFDI `AUTH_NEGOTIATION`. The device sends an opaque flag bitmask; upstream
 * replies ACK / `GUESS_OK` with all flags cleared and derives no key.
 */
export const GARMIN_AUTH_NEGOTIATION_MESSAGE_TYPE = 5101;
/** Upstream `AuthNegotiationStatus.GUESS_OK`. */
export const GARMIN_AUTH_NEGOTIATION_GUESS_OK = 0;

/** GFDI status codes (`GFDIMessage.Status` ordinals). */ export const GARMIN_STATUS = {
  ACK: 0,
  NAK: 1,
  UNSUPPORTED: 2,
  DECODE_ERROR: 3,
  CRC_ERROR: 4,
  LENGTH_ERROR: 5,
} as const;

/** `SystemEventMessage.GarminSystemEventType` ordinals. */
export const GARMIN_SYSTEM_EVENT = {
  SYNC_COMPLETE: 0,
  SYNC_FAIL: 1,
  FACTORY_RESET: 2,
  PAIR_START: 3,
  PAIR_COMPLETE: 4,
  PAIR_FAIL: 5,
  HOST_DID_ENTER_FOREGROUND: 6,
  HOST_DID_ENTER_BACKGROUND: 7,
  SYNC_READY: 8,
  NEW_DOWNLOAD_AVAILABLE: 9,
  DEVICE_SOFTWARE_UPDATE: 10,
  DEVICE_DISCONNECT: 11,
  TUTORIAL_COMPLETE: 12,
  SETUP_WIZARD_START: 13,
  SETUP_WIZARD_COMPLETE: 14,
  SETUP_WIZARD_SKIPPED: 15,
  TIME_UPDATED: 16,
  TRIGGER_REBOOT: 17,
} as const;

/** `SetFileFlagsMessage.FileFlags` bit values. */
export const GARMIN_FILE_FLAG = {
  CRYPTO: 0x04,
  APPEND: 0x08,
  ARCHIVE: 0x10,
  ERASE: 0x20,
  WRITE: 0x40,
  READ: 0x80,
} as const;

/** `DownloadRequestMessage.REQUEST_TYPE` ordinals. */
export const GARMIN_REQUEST_TYPE = { CONTINUE: 0, NEW: 1 } as const;

/** `DownloadRequestStatusMessage.DownloadStatus` ordinals. */
export const GARMIN_DOWNLOAD_STATUS = {
  OK: 0,
  INDEX_NOT_FOUND: 1,
  NOT_READABLE: 2,
  NOT_READY: 3,
  INVALID_REQUEST: 4,
  CRC_MISMATCH: 5,
  RANGE_EXCEEDS_FILE: 6,
} as const;

/** `FileTransferDataStatusMessage.TransferStatus` ordinals. */
export const GARMIN_TRANSFER_STATUS = {
  OK: 0,
  RESEND: 1,
  ABORT: 2,
  CRC_MISMATCH: 3,
  OFFSET_MISMATCH: 4,
  SYNC_PAUSED: 5,
} as const;

/** Multi-Link (ML) handle management (`CommunicatorV2`). */
export const GARMIN_ML_CLIENT_ID = 2;
export const GARMIN_ML_REQUEST = {
  REGISTER_ML_REQ: 0,
  REGISTER_ML_RESP: 1,
  CLOSE_HANDLE_REQ: 2,
  CLOSE_HANDLE_RESP: 3,
  UNK_HANDLE: 4,
  CLOSE_ALL_REQ: 5,
  CLOSE_ALL_RESP: 6,
  UNK_REQ: 7,
  UNK_RESP: 8,
} as const;
/** `CommunicatorV2.Service.GFDI`. */
export const GARMIN_ML_SERVICE_GFDI = 1;
/** `MlrCommunicator.MLR_FLAG_MASK` — reliable (MLR) service registrations. */
export const GARMIN_MLR_FLAG_MASK = 0x80;

/**
 * Directory file types this family downloads (`FileType.FILETYPE`). Only the
 * health-monitoring FIT files are fetched in v1; everything else is skipped.
 */
export const GARMIN_FILE_TYPE = {
  DIRECTORY: { dataType: 0, subType: 0 },
  MONITOR_A: { dataType: 128, subType: 15 },
  MONITOR_DAILY: { dataType: 128, subType: 28 },
  MONITOR: { dataType: 128, subType: 32 },
  SLEEP: { dataType: 128, subType: 49 },
  ACTIVITY: { dataType: 128, subType: 4 },
  HRV_STATUS: { dataType: 128, subType: 68 },
} as const;

/** Health FIT file types the v1 sync downloads. */
export const GARMIN_HEALTH_FILE_TYPES: readonly Readonly<{
  dataType: number;
  subType: number;
  name: string;
}>[] = [
  { ...GARMIN_FILE_TYPE.MONITOR_A, name: "MONITOR_A" },
  { ...GARMIN_FILE_TYPE.MONITOR_DAILY, name: "MONITOR_DAILY" },
  { ...GARMIN_FILE_TYPE.MONITOR, name: "MONITOR" },
  { ...GARMIN_FILE_TYPE.SLEEP, name: "SLEEP" },
  // Upstream pulls both by default (`FileType`); workouts and nightly HRV.
  { ...GARMIN_FILE_TYPE.ACTIVITY, name: "ACTIVITY" },
  { ...GARMIN_FILE_TYPE.HRV_STATUS, name: "HRV_STATUS" },
];

/** Directory record size in bytes (`FileTransferHandler.parseDirectoryEntries`). */
export const GARMIN_DIRECTORY_ENTRY_SIZE = 16;

/** FIT message numbers this family understands. */
export const GARMIN_FIT_MESSAGE = {
  FILE_ID: 0,
  SPORT: 12,
  SESSION: 18,
  EVENT: 21,
  WORKOUT: 26,
  ACTIVITY: 34,
  MONITORING: 55,
  MONITORING_HR_DATA: 211,
  SPO2_DATA: 269,
  SLEEP_DATA_RAW: 274,
  RESPIRATION_RATE: 297,
  SLEEP_LEVEL: 275,
  SLEEP_ASSESSMENT: 346,
  HRV_STATUS_SUMMARY: 370,
  NAP_EVENT: 412,
} as const;

/** `SleepLevel` enum (`fit_profile.json` enumerations). */
export const GARMIN_SLEEP_LEVEL = {
  UNMEASURABLE: 0,
  AWAKE: 1,
  LIGHT: 2,
  DEEP: 3,
  REM: 4,
} as const;

/** `Event` enum value used for sleep start/stop (`GarminEventSampleProvider`). */
export const GARMIN_EVENT_DETECT_SLEEP = 74;
/** `EventType` ordinals used for the sleep boundaries. */
export const GARMIN_EVENT_TYPE = { START: 0, STOP: 1 } as const;

/** Upstream `SleepSessionSegmenter` rules, mirrored for stage-only files. */
export const GARMIN_MIN_SESSION_SECONDS = 5 * 60;
export const GARMIN_MAX_WAKE_PHASE_SECONDS = 60 * 60;
export const GARMIN_TRAILING_STAGE_SECONDS = 60;

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// CRC-16/ARC (ChecksumCalculator.java)
// ---------------------------------------------------------------------------

const GARMIN_CRC_CONSTANTS: readonly number[] = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

/** Upstream `ChecksumCalculator.computeCrc`, i.e. CRC-16/ARC. */
export function garminCrc16(bytes: Uint8Array, initial = 0x0000): number {
  let crc = initial;
  for (const byte of bytes) {
    crc = ((crc >> 4) & 4095) ^ GARMIN_CRC_CONSTANTS[crc & 15]!;
    crc ^= GARMIN_CRC_CONSTANTS[byte & 15]!;
    crc = ((crc >> 4) & 4095) ^ GARMIN_CRC_CONSTANTS[crc & 15]!;
    crc ^= GARMIN_CRC_CONSTANTS[(byte >> 4) & 15]!;
  }
  return crc & 0xffff;
}

// ---------------------------------------------------------------------------
// COBS (CobsCoDec.java)
// ---------------------------------------------------------------------------

/**
 * Encodes a payload with the upstream COBS variant: a leading 0x00, COBS
 * blocks, an optional 0x01 for a trailing zero, and a trailing 0x00.
 */
export function encodeGarminCobs(data: Uint8Array): Uint8Array {
  const out: number[] = [0];
  let position = 0;
  let lastByteWasZero = false;
  while (position < data.length) {
    const startPos = position;
    while (position < data.length && data[position] !== 0) position += 1;
    lastByteWasZero = position < data.length && data[position] === 0;
    let payloadSize = position - startPos;
    let start = startPos;
    while (payloadSize >= 0xfe) {
      out.push(0xff);
      for (let index = 0; index < 0xfe; index += 1) out.push(data[start + index]!);
      payloadSize -= 0xfe;
      start += 0xfe;
    }
    out.push(payloadSize + 1);
    for (let index = 0; index < payloadSize; index += 1) out.push(data[start + index]!);
    if (lastByteWasZero) position += 1;
  }
  if (lastByteWasZero) out.push(0x01);
  out.push(0);
  return Uint8Array.from(out);
}

/**
 * Decodes exactly one complete COBS frame (leading and trailing 0x00).
 * Throws `GARMIN_COBS_*` on malformed or truncated input.
 */
export function decodeGarminCobsFrame(frame: Uint8Array): Uint8Array {
  if (frame.length < 4) throw new Error("GARMIN_COBS_TRUNCATED");
  if (frame[0] !== 0 || frame[frame.length - 1] !== 0) throw new Error("GARMIN_COBS_FRAME");
  const out: number[] = [];
  const end = frame.length - 1;
  let offset = 1;
  while (offset < end) {
    const code = frame[offset]!;
    offset += 1;
    if (code === 0) break;
    const payloadSize = code - 1;
    if (offset + payloadSize > end) throw new Error("GARMIN_COBS_TRUNCATED");
    for (let index = 0; index < payloadSize; index += 1) out.push(frame[offset + index]!);
    offset += payloadSize;
    if (code !== 0xff && offset < end) out.push(0);
  }
  return Uint8Array.from(out);
}

/**
 * Streaming COBS decoder. Accumulates BLE notification fragments and yields
 * one decoded message at a time. Malformed frames are dropped and the
 * accumulator resets, matching upstream `CobsCoDec`.
 */
export class GarminCobsDecoder {
  private buffer: number[] = [];

  /**
   * `maxBytes` is upstream's `CobsCoDec(bufferSize)`: 10 000 by default, 0x10000
   * on RFCOMM, where file chunks use the device's whole 0x4000 packet size
   * (GarminRfcommListener).
   */
  constructor(private readonly maxBytes = 10_000) {}

  /**
   * Every complete message in the buffer after `bytes`. A stream read can hold
   * several frames; upstream feeds RFCOMM byte by byte for the same reason.
   */
  acceptAll(bytes: Uint8Array): Uint8Array[] {
    const messages: Uint8Array[] = [];
    let input = bytes;
    for (;;) {
      const before = this.buffer.length + input.length;
      const message = this.accept(input);
      input = new Uint8Array(0);
      if (message) messages.push(message);
      // Stop once nothing was consumed (no complete frame left) or all was.
      if (this.buffer.length === before || this.buffer.length < 4) return messages;
    }
  }

  accept(bytes: Uint8Array): Uint8Array | null {
    for (const byte of bytes) this.buffer.push(byte);
    if (this.buffer.length > this.maxBytes) this.reset();
    if (this.buffer.length < 4) return null;
    if (this.buffer[0] !== 0) {
      this.reset();
      return null;
    }
    const end = this.buffer.indexOf(0, 1);
    if (end < 0) return null;
    const frame = Uint8Array.from(this.buffer.slice(0, end + 1));
    this.buffer = this.buffer.slice(end + 1);
    try {
      return decodeGarminCobsFrame(frame);
    } catch {
      return null;
    }
  }

  reset(): void {
    this.buffer = [];
  }
}

// ---------------------------------------------------------------------------
// GFDI packet framing (GFDIMessage.java)
// ---------------------------------------------------------------------------

export type GarminGfdiFrame = Readonly<{
  /** Raw message type. Incoming frames may carry a sequence number in bit 15. */
  messageType: number;
  payload: Uint8Array;
  /** Sequence number carried in the type word's high bit, when present. */
  sequenceNumber?: number;
}>;

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function writeUint16le(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32le(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Serializes one GFDI message: 2-byte little-endian total length (including
 * the length field and CRC), 2-byte little-endian message type, payload, then
 * the CRC-16/ARC over everything before it.
 *
 * A `sequenceNumber` (0-127) sets the type word's high bit, matching the
 * incoming encoding in `GFDIMessage.parseIncoming`.
 */
export function encodeGarminGfdiFrame(frame: GarminGfdiFrame): Uint8Array {
  if (!Number.isInteger(frame.messageType) || frame.messageType < 0 || frame.messageType > 0xffff) {
    throw new Error("GARMIN_MESSAGE_TYPE");
  }
  let typeWord = frame.messageType;
  if (frame.sequenceNumber !== undefined) {
    if (
      !Number.isInteger(frame.sequenceNumber) ||
      frame.sequenceNumber < 0 ||
      frame.sequenceNumber > 0x7f
    )
      throw new Error("GARMIN_SEQUENCE");
    if (frame.messageType < 5000 || frame.messageType > 5000 + 0xff)
      throw new Error("GARMIN_SEQUENCE_TYPE");
    typeWord = 0x8000 | (frame.sequenceNumber << 8) | (frame.messageType - 5000);
  }
  const total = 4 + frame.payload.length + 2;
  if (total > 0xffff) throw new Error("GARMIN_PACKET_TOO_LARGE");
  const out = new Uint8Array(total);
  writeUint16le(out, 0, total);
  writeUint16le(out, 2, typeWord);
  out.set(frame.payload, 4);
  writeUint16le(out, total - 2, garminCrc16(out.subarray(0, total - 2)));
  return out;
}

/** Parses and verifies one complete GFDI message. */
export function decodeGarminGfdiFrame(bytes: Uint8Array): GarminGfdiFrame {
  if (bytes.length < 6) throw new Error("GARMIN_PACKET_TRUNCATED");
  const length = uint16le(bytes, 0);
  if (length !== bytes.length) throw new Error("GARMIN_PACKET_LENGTH");
  const expectedCrc = uint16le(bytes, length - 2);
  if (garminCrc16(bytes.subarray(0, length - 2)) !== expectedCrc) {
    throw new Error("GARMIN_PACKET_CRC");
  }
  const typeWord = uint16le(bytes, 2);
  const payload = bytes.slice(4, length - 2);
  if ((typeWord & 0x8000) !== 0) {
    // `GFDIMessage.parseIncoming`: sequence number in the high bit, message id
    // in the low byte, offset by 5000.
    return {
      messageType: (typeWord & 0xff) + 5000,
      payload,
      sequenceNumber: (typeWord >> 8) & 0x7f,
    };
  }
  return { messageType: typeWord, payload };
}

// ---------------------------------------------------------------------------
// Write chunking (CommunicatorV1/V2.java)
// ---------------------------------------------------------------------------

export type GarminWriteOptions = Readonly<{
  /** Maximum bytes accepted by one BLE write, including any handle prefix. */
  maxWriteSize: number;
  /** V2 GFDI handle; omitted for v0/v1. */
  handle?: number;
}>;

/**
 * Splits an already-COBS-encoded payload into BLE writes. Upstream reserves
 * one byte per write (`maxWriteSize - 1`) and, for V2, prefixes every chunk
 * with the GFDI handle byte.
 */
export function chunkGarminPayload(payload: Uint8Array, options: GarminWriteOptions): Uint8Array[] {
  const { maxWriteSize, handle } = options;
  if (!Number.isInteger(maxWriteSize) || maxWriteSize < 2) {
    throw new Error("GARMIN_WRITE_SIZE");
  }
  if (handle !== undefined && (!Number.isInteger(handle) || handle < 0 || handle > 0xff)) {
    throw new Error("GARMIN_HANDLE");
  }
  const chunkSize = maxWriteSize - 1;
  const fragments: Uint8Array[] = [];
  if (payload.length <= chunkSize) {
    fragments.push(payload);
  } else {
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      fragments.push(payload.subarray(offset, offset + chunkSize));
    }
  }
  if (handle === undefined) return fragments;
  return fragments.map((fragment) => {
    const out = new Uint8Array(1 + fragment.length);
    out[0] = handle;
    out.set(fragment, 1);
    return out;
  });
}

/** COBS-encodes and chunks one GFDI frame for writing. */
export function encodeGarminGfdiWrites(
  frame: GarminGfdiFrame,
  options: GarminWriteOptions,
): Uint8Array[] {
  return chunkGarminPayload(encodeGarminCobs(encodeGarminGfdiFrame(frame)), options);
}

// ---------------------------------------------------------------------------
// Multi-Link (ML) handle management (CommunicatorV2.java)
// ---------------------------------------------------------------------------

/** `CommunicatorV2.closeAllServices()` — 13 bytes, handle 0. */
export function buildGarminMlCloseAll(): Uint8Array {
  const out = new Uint8Array(13);
  out[0] = 0;
  out[1] = GARMIN_ML_REQUEST.CLOSE_ALL_REQ;
  writeUint32le(out, 2, GARMIN_ML_CLIENT_ID);
  writeUint32le(out, 6, 0);
  writeUint16le(out, 10, 0);
  return out;
}

/** `CommunicatorV2.registerService()` — 13 bytes, handle 0. */
export function buildGarminMlRegisterService(service: number, reliable = false): Uint8Array {
  if (!Number.isInteger(service) || service < 0 || service > 0xffff)
    throw new Error("GARMIN_ML_SERVICE");
  const out = new Uint8Array(13);
  out[0] = 0;
  out[1] = GARMIN_ML_REQUEST.REGISTER_ML_REQ;
  writeUint32le(out, 2, GARMIN_ML_CLIENT_ID);
  writeUint32le(out, 6, 0);
  writeUint16le(out, 10, service);
  out[12] = reliable ? 2 : 0;
  return out;
}

/** `CommunicatorV2.closeService()` — 13 bytes, handle 0. */
export function buildGarminMlCloseService(service: number, handle: number): Uint8Array {
  const out = new Uint8Array(13);
  out[0] = 0;
  out[1] = GARMIN_ML_REQUEST.CLOSE_HANDLE_REQ;
  writeUint32le(out, 2, GARMIN_ML_CLIENT_ID);
  writeUint32le(out, 6, 0);
  writeUint16le(out, 10, service);
  out[12] = handle & 0xff;
  return out;
}

export type GarminMlMessage = Readonly<{
  requestType: number;
  service: number | null;
  status: number | null;
  handle: number | null;
  reliable: number | null;
}>;

/**
 * Parses a handle-management message (`CommunicatorV2.processHandleManagement`).
 * The first byte of the ML payload is the handle (0 for management).
 */
export function parseGarminMlMessage(bytes: Uint8Array): GarminMlMessage | null {
  if (bytes.length < 10) return null;
  const requestType = bytes[1]!;
  const clientId = uint32le(bytes, 2) + uint32le(bytes, 6) * 0x1_0000_0000;
  if (clientId !== GARMIN_ML_CLIENT_ID) return null;
  const service = bytes.length >= 12 ? uint16le(bytes, 10) : null;
  switch (requestType) {
    case GARMIN_ML_REQUEST.REGISTER_ML_RESP:
      if (bytes.length < 14) return null;
      return {
        requestType,
        service,
        status: bytes[12]!,
        handle: bytes[13]!,
        reliable: bytes.length >= 15 ? bytes[14]! : 0,
      };
    case GARMIN_ML_REQUEST.CLOSE_HANDLE_RESP:
      if (bytes.length < 14) return null;
      return { requestType, service, status: bytes[13]!, handle: bytes[12]!, reliable: null };
    case GARMIN_ML_REQUEST.CLOSE_ALL_RESP:
      return { requestType, service: null, status: 0, handle: null, reliable: null };
    default:
      return { requestType, service, status: null, handle: null, reliable: null };
  }
}

// ---------------------------------------------------------------------------
// File transfer messages
// ---------------------------------------------------------------------------

/** One 16-byte directory record (`FileTransferHandler.DirectoryEntry`). */
export type GarminDirectoryEntry = Readonly<{
  fileIndex: number;
  dataType: number;
  subType: number;
  fileNumber: number;
  specificFlags: number;
  fileFlags: number;
  fileSize: number;
  /** Wire timestamp in unix seconds; null for the watch's "no date" sentinel. */
  timestamp: number | null;
}>;

/** Parses a directory payload (16-byte little-endian records). */
export function parseGarminDirectory(bytes: Uint8Array): GarminDirectoryEntry[] {
  if (bytes.length % GARMIN_DIRECTORY_ENTRY_SIZE !== 0) throw new Error("GARMIN_DIRECTORY_LENGTH");
  const entries: GarminDirectoryEntry[] = [];
  for (let offset = 0; offset < bytes.length; offset += GARMIN_DIRECTORY_ENTRY_SIZE) {
    const wireTimestamp = uint32le(bytes, offset + 12);
    entries.push({
      fileIndex: uint16le(bytes, offset),
      dataType: bytes[offset + 2]!,
      subType: bytes[offset + 3]!,
      fileNumber: uint16le(bytes, offset + 4),
      specificFlags: bytes[offset + 6]!,
      fileFlags: bytes[offset + 7]!,
      fileSize: uint32le(bytes, offset + 8),
      timestamp: wireTimestamp === 0 ? null : wireTimestamp,
    });
  }
  return entries;
}

/** True for the all-zero sentinel record the watch emits at the end. */
export function isGarminDirectorySentinel(entry: GarminDirectoryEntry): boolean {
  return (
    entry.fileIndex === 0 &&
    entry.dataType === 0 &&
    entry.subType === 0 &&
    entry.fileNumber === 0 &&
    entry.specificFlags === 0 &&
    entry.fileFlags === 0 &&
    entry.fileSize === 0 &&
    entry.timestamp === null
  );
}

/** True when the entry is a directory (`0/0`). */
export function isGarminDirectoryType(entry: GarminDirectoryEntry): boolean {
  return (
    entry.dataType === GARMIN_FILE_TYPE.DIRECTORY.dataType &&
    entry.subType === GARMIN_FILE_TYPE.DIRECTORY.subType
  );
}

/** True for the health FIT files this family downloads. */
export function isGarminHealthFile(entry: GarminDirectoryEntry): boolean {
  return GARMIN_HEALTH_FILE_TYPES.some(
    (type) => type.dataType === entry.dataType && type.subType === entry.subType,
  );
}

/** ACTIVITY files (workouts) are synced after the other health files. */
export function isGarminActivityFile(entry: GarminDirectoryEntry): boolean {
  return (
    entry.dataType === GARMIN_FILE_TYPE.ACTIVITY.dataType &&
    entry.subType === GARMIN_FILE_TYPE.ACTIVITY.subType
  );
}

/** Upstream file type name for an entry, or null when unsupported. */
export function garminFileTypeName(entry: GarminDirectoryEntry): string | null {
  if (isGarminDirectoryType(entry)) return "DIRECTORY";
  return (
    GARMIN_HEALTH_FILE_TYPES.find(
      (type) => type.dataType === entry.dataType && type.subType === entry.subType,
    )?.name ?? null
  );
}

/** Builds a `DOWNLOAD_REQUEST` (5002) payload. */
export function buildGarminDownloadRequest(input: {
  fileIndex: number;
  dataOffset?: number;
  requestType?: number;
  crcSeed?: number;
  dataSize?: number;
  flags?: number;
}): Uint8Array {
  // `DownloadRequestMessage.generateOutgoing`: short fileIndex, int dataOffset,
  // byte requestType, short crcSeed, int dataSize, byte requestFlags.
  const out = new Uint8Array(14);
  writeUint16le(out, 0, input.fileIndex);
  writeUint32le(out, 2, input.dataOffset ?? 0);
  out[6] = input.requestType ?? GARMIN_REQUEST_TYPE.NEW;
  writeUint16le(out, 7, input.crcSeed ?? 0);
  writeUint32le(out, 9, input.dataSize ?? 0);
  out[13] = input.flags ?? 0;
  return out;
}

/** Builds a `SET_FILE_FLAG` (5008) payload. */
export function buildGarminSetFileFlags(fileIndex: number, flags: number): Uint8Array {
  const out = new Uint8Array(3);
  writeUint16le(out, 0, fileIndex);
  out[2] = flags & 0xff;
  return out;
}

/** Builds a `SYSTEM_EVENT` (5030) payload. */
export function buildGarminSystemEvent(eventType: number, value = 0): Uint8Array {
  return Uint8Array.of(eventType & 0xff, value & 0xff);
}

/** Builds an empty `SUPPORTED_FILE_TYPES_REQUEST` (5031) payload. */
export function buildGarminSupportedFileTypesRequest(): Uint8Array {
  return new Uint8Array(0);
}

/** One `FILE_TRANSFER_DATA` (5004) chunk. */
export type GarminFileTransferData = Readonly<{
  flags: number;
  crc: number;
  dataOffset: number;
  data: Uint8Array;
}>;

/** Parses an incoming `FILE_TRANSFER_DATA` payload. */
export function parseGarminFileTransferData(payload: Uint8Array): GarminFileTransferData {
  if (payload.length < 7) throw new Error("GARMIN_TRANSFER_TRUNCATED");
  return {
    flags: payload[0]!,
    crc: uint16le(payload, 1),
    dataOffset: uint32le(payload, 3),
    data: payload.slice(7),
  };
}

/** Builds the ACK status for an incoming `FILE_TRANSFER_DATA` chunk. */
export function buildGarminTransferDataStatus(dataOffset: number): Uint8Array {
  const out = new Uint8Array(8);
  writeUint16le(out, 0, GARMIN_MESSAGE.FILE_TRANSFER_DATA);
  out[2] = GARMIN_STATUS.ACK;
  out[3] = GARMIN_TRANSFER_STATUS.OK;
  writeUint32le(out, 4, dataOffset);
  return out;
}

// ---------------------------------------------------------------------------
// Handshake replies (`GarminSupport.onMessage`: every handled incoming message
// gets its status, then its reply). Upstream sends nothing for message types
// it does not parse (`UnhandledMessage`: `GenericStatusMessage` with
// `sendOutgoing = false`).
// ---------------------------------------------------------------------------

/** A `RESPONSE` (5000) payload: original type and a `GARMIN_STATUS` code (`GenericStatusMessage`). */
export function buildGarminStatusPayload(originalMessageType: number, status: number): Uint8Array {
  const out = new Uint8Array(3);
  writeUint16le(out, 0, originalMessageType);
  out[2] = status & 0xff;
  return out;
}

/** The fields of an incoming `DEVICE_INFORMATION` (5024) this family uses. */
export type GarminDeviceInformation = Readonly<{
  protocolVersion: number;
  productNumber: number;
  softwareVersion: number;
  maxPacketSize: number;
}>;

/** Parses the fixed head of `DEVICE_INFORMATION` (`DeviceInformationMessage.parseIncoming`). */
export function parseGarminDeviceInformation(payload: Uint8Array): GarminDeviceInformation {
  if (payload.length < 12) throw new Error("GARMIN_DEVICE_INFORMATION_TRUNCATED");
  return {
    protocolVersion: uint16le(payload, 0),
    productNumber: uint16le(payload, 2),
    softwareVersion: uint16le(payload, 8),
    maxPacketSize: uint16le(payload, 10),
  };
}

/**
 * The Bluetooth Classic address a dual-mode device appends to
 * `DEVICE_INFORMATION` (`DeviceInformationMessage.parseIncoming`): after the
 * fixed head and three length-prefixed strings, a `hasMac` byte; when it is 1,
 * the BLE then the Classic address follow, 6 bytes each, little-endian.
 * Returns `AA:BB:CC:DD:EE:FF` (upstream's `%02X` format), or null when absent
 * or truncated (upstream would fail the whole message with an underflow).
 */
export function parseGarminClassicAddress(payload: Uint8Array): string | null {
  let at = 12;
  for (let index = 0; index < 3; index += 1) {
    if (at >= payload.length) return null;
    at += 1 + payload[at]!;
  }
  if (at >= payload.length || payload[at] !== 1) return null;
  const classic = at + 1 + 6;
  if (classic + 6 > payload.length) return null;
  return Array.from(payload.subarray(classic, classic + 6))
    .reverse()
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join(":");
}

/** Upstream's own values (`DeviceInformationMessage`: protocol 150, software 7791, the rest -1). */
const OUR_PROTOCOL_VERSION = 150;
const OUR_SOFTWARE_VERSION = 7791;
/** ASCII-only names, written as GFDI strings (length byte, then the bytes). */
const OUR_BLUETOOTH_NAME = "OpenValens";
const OUR_MANUFACTURER = "OpenValens";
const OUR_DEVICE = "phone";

/**
 * The `RESPONSE` payload that answers `DEVICE_INFORMATION`
 * (`DeviceInformationMessage.generateOutgoing`): sent after the plain ACK.
 */
export function buildGarminDeviceInformationReply(incomingProtocolVersion: number): Uint8Array {
  const names = [OUR_BLUETOOTH_NAME, OUR_MANUFACTURER, OUR_DEVICE];
  const out = new Uint8Array(15 + names.reduce((sum, name) => sum + 1 + name.length, 0) + 1);
  writeUint16le(out, 0, GARMIN_MESSAGE.DEVICE_INFORMATION);
  out[2] = GARMIN_STATUS.ACK;
  writeUint16le(out, 3, OUR_PROTOCOL_VERSION);
  writeUint16le(out, 5, 0xffff); // product number -1
  writeUint32le(out, 7, 0xffffffff); // unit number -1
  writeUint16le(out, 11, OUR_SOFTWARE_VERSION);
  writeUint16le(out, 13, 0xffff); // max packet size -1
  let at = 15;
  for (const name of names) {
    out[at++] = name.length;
    for (let index = 0; index < name.length; index += 1) out[at++] = name.charCodeAt(index);
  }
  out[at] = Math.floor(incomingProtocolVersion / 100) === 1 ? 1 : 0;
  return out;
}

/**
 * `GarminCapability.setToBinary(OUR_CAPABILITIES)`: all 129 capabilities but
 * GPS_EPHEMERIS_DOWNLOAD, LIVETRACK, LIVETRACK_AUTO_START and 104–111,
 * 114–119. Computed from the enum order at the pinned commit.
 */
export const GARMIN_OUR_CAPABILITIES = Uint8Array.of(
  0xff,
  0xff,
  0x3f,
  0xef,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0x00,
  0x03,
  0xff,
  0x01,
);

/** Our `CONFIGURATION` (5050) payload (`ConfigurationMessage.generateOutgoing`). */
export function buildGarminConfiguration(): Uint8Array {
  const out = new Uint8Array(1 + GARMIN_OUR_CAPABILITIES.length);
  out[0] = GARMIN_OUR_CAPABILITIES.length;
  out.set(GARMIN_OUR_CAPABILITIES, 1);
  return out;
}

/**
 * The status for an incoming `AUTH_NEGOTIATION` (`AuthNegotiationStatusMessage`):
 * ACK, `GUESS_OK`, and the watch's unknown byte and low flag byte echoed back.
 */
export function buildGarminAuthNegotiationStatus(payload: Uint8Array): Uint8Array {
  if (payload.length < 5) throw new Error("GARMIN_AUTH_TRUNCATED");
  const out = new Uint8Array(9);
  writeUint16le(out, 0, GARMIN_AUTH_NEGOTIATION_MESSAGE_TYPE);
  out[2] = GARMIN_STATUS.ACK;
  out[3] = GARMIN_AUTH_NEGOTIATION_GUESS_OK;
  out[4] = payload[0]!;
  // Upstream round-trips the flags through an 8-value enum: only the low byte survives.
  out[5] = payload[1]!;
  return out;
}

/** One parsed `RESPONSE` (5000) status payload. */
export type GarminStatusMessage = Readonly<{
  originalMessageType: number;
  status: number;
  downloadStatus: number | null;
  maxFileSize: number | null;
  transferStatus: number | null;
  transferOffset: number | null;
}>;

/** Parses a `RESPONSE` (5000) payload for the message types this family uses. */
export function parseGarminStatus(payload: Uint8Array): GarminStatusMessage {
  if (payload.length < 3) throw new Error("GARMIN_STATUS_TRUNCATED");
  const originalMessageType = uint16le(payload, 0);
  const status = payload[2]!;
  if (originalMessageType === GARMIN_MESSAGE.DOWNLOAD_REQUEST) {
    if (payload.length < 8) throw new Error("GARMIN_STATUS_TRUNCATED");
    return {
      originalMessageType,
      status,
      downloadStatus: payload[3]!,
      maxFileSize: uint32le(payload, 4),
      transferStatus: null,
      transferOffset: null,
    };
  }
  if (originalMessageType === GARMIN_MESSAGE.FILE_TRANSFER_DATA) {
    if (payload.length < 8) throw new Error("GARMIN_STATUS_TRUNCATED");
    return {
      originalMessageType,
      status,
      downloadStatus: null,
      maxFileSize: null,
      transferStatus: payload[3]!,
      transferOffset: uint32le(payload, 4),
    };
  }
  return {
    originalMessageType,
    status,
    downloadStatus: null,
    maxFileSize: null,
    transferStatus: null,
    transferOffset: null,
  };
}

// ---------------------------------------------------------------------------
// FIT container
// ---------------------------------------------------------------------------

export type GarminFitFieldDefinition = Readonly<{
  number: number;
  size: number;
  baseType: number;
}>;

export type GarminFitDefinition = Readonly<{
  localType: number;
  bigEndian: boolean;
  messageNumber: number;
  fields: readonly GarminFitFieldDefinition[];
  devFields: readonly GarminFitFieldDefinition[];
}>;

/** One decoded FIT data message. Values are raw (unscaled) numbers. */
export type GarminFitMessage = Readonly<{
  messageNumber: number;
  /** Resolved timestamp in unix seconds, when the record carried one. */
  timestamp: number | null;
  fields: ReadonlyMap<number, number>;
  /** STRING fields, decoded as upstream: UTF-8 up to the first NUL; empty ones omitted. */
  strings?: ReadonlyMap<number, string>;
}>;

/** Base type identifiers (`fit/baseTypes/BaseType.java`). */
const FIT_BASE_TYPE = {
  ENUM: 0x00,
  SINT8: 0x01,
  UINT8: 0x02,
  STRING: 0x07,
  UINT8Z: 0x0a,
  BYTE: 0x0d,
  SINT16: 0x83,
  UINT16: 0x84,
  SINT32: 0x85,
  UINT32: 0x86,
  FLOAT32: 0x88,
  FLOAT64: 0x89,
  UINT16Z: 0x8b,
  UINT32Z: 0x8c,
  SINT64: 0x8e,
  UINT64: 0x8f,
  UINT64Z: 0x90,
} as const;

type FitBaseTypeInfo = Readonly<{
  width: number;
  signed: boolean;
  /** Invalid sentinel (all bits set for non-Z types, zero for Z types). */
  invalid: number;
  floating: boolean;
}>;

function fitBaseTypeInfo(baseType: number): FitBaseTypeInfo | null {
  switch (baseType) {
    case FIT_BASE_TYPE.ENUM:
    case FIT_BASE_TYPE.UINT8:
    case FIT_BASE_TYPE.BYTE:
      return { width: 1, signed: false, invalid: 0xff, floating: false };
    case FIT_BASE_TYPE.SINT8:
      return { width: 1, signed: true, invalid: 0x7f, floating: false };
    case FIT_BASE_TYPE.UINT8Z:
      return { width: 1, signed: false, invalid: 0, floating: false };
    case FIT_BASE_TYPE.SINT16:
      return { width: 2, signed: true, invalid: 0x7fff, floating: false };
    case FIT_BASE_TYPE.UINT16:
      return { width: 2, signed: false, invalid: 0xffff, floating: false };
    case FIT_BASE_TYPE.UINT16Z:
      return { width: 2, signed: false, invalid: 0, floating: false };
    case FIT_BASE_TYPE.SINT32:
      return { width: 4, signed: true, invalid: 0x7fffffff, floating: false };
    case FIT_BASE_TYPE.UINT32:
      return { width: 4, signed: false, invalid: 0xffffffff, floating: false };
    case FIT_BASE_TYPE.UINT32Z:
      return { width: 4, signed: false, invalid: 0, floating: false };
    case FIT_BASE_TYPE.FLOAT32:
      return { width: 4, signed: true, invalid: 0xffffffff, floating: true };
    case FIT_BASE_TYPE.FLOAT64:
      return { width: 8, signed: true, invalid: 0xffffffff, floating: true };
    case FIT_BASE_TYPE.SINT64:
      return { width: 8, signed: true, invalid: 0x7fffffff, floating: false };
    case FIT_BASE_TYPE.UINT64:
    case FIT_BASE_TYPE.UINT64Z:
      return { width: 8, signed: false, invalid: 0xffffffff, floating: false };
    case FIT_BASE_TYPE.STRING:
      return null;
    default:
      // Unknown base type: upstream falls back to opaque BYTE handling.
      return { width: 1, signed: false, invalid: -1, floating: false };
  }
}

function readFitNumber(
  bytes: Uint8Array,
  offset: number,
  baseType: number,
  bigEndian: boolean,
): number | null {
  const info = fitBaseTypeInfo(baseType);
  if (!info) return null;
  if (offset + info.width > bytes.length) throw new Error("GARMIN_FIT_TRUNCATED");
  let value = 0;
  if (bigEndian) {
    for (let index = 0; index < info.width; index += 1)
      value = (value * 256 + bytes[offset + index]!) % 0x1_0000_0000;
  } else {
    for (let index = info.width - 1; index >= 0; index -= 1)
      value = (value * 256 + bytes[offset + index]!) % 0x1_0000_0000;
  }
  if (info.floating) {
    const buffer = new ArrayBuffer(info.width);
    const view = new DataView(buffer);
    const slice = bytes.subarray(offset, offset + info.width);
    for (let index = 0; index < info.width; index += 1)
      view.setUint8(bigEndian ? index : info.width - 1 - index, slice[index]!);
    return info.width === 4 ? view.getFloat32(0, bigEndian) : view.getFloat64(0, bigEndian);
  }
  if (info.signed) {
    const limit = 2 ** (info.width * 8 - 1);
    if (value >= limit) value -= limit * 2;
    if (value === info.invalid) return null;
    return value;
  }
  if (info.invalid >= 0 && value === info.invalid) return null;
  return value;
}

/**
 * Parses a FIT file into its data messages.
 *
 * Walks the header, every definition and data record (including compressed
 * timestamps and developer fields) so unknown message types are skipped
 * without losing alignment. Throws `GARMIN_FIT_*` on malformed input.
 */
export function parseGarminFitFile(bytes: Uint8Array): GarminFitMessage[] {
  if (bytes.length < 12) throw new Error("GARMIN_FIT_TRUNCATED");
  const headerSize = bytes[0]!;
  if (headerSize < 12) throw new Error("GARMIN_FIT_HEADER");
  const dataSize = uint32le(bytes, 4);
  if (uint32le(bytes, 8) !== GARMIN_FIT_MAGIC) throw new Error("GARMIN_FIT_MAGIC");
  const dataEnd = headerSize + dataSize;
  if (dataEnd > bytes.length) throw new Error("GARMIN_FIT_TRUNCATED");

  const definitions = new Map<number, GarminFitDefinition>();
  const messages: GarminFitMessage[] = [];
  let referenceTimestamp: number | null = null;
  let offset = headerSize;

  while (offset < dataEnd) {
    const header = bytes[offset]!;
    offset += 1;
    let localType: number;
    let definition = false;
    let developerData = false;
    let timeOffset: number | null = null;
    if ((header & 0x80) !== 0) {
      // Compressed timestamp: local type in bits 5-6, offset in bits 0-4.
      localType = (header >> 5) & 0x03;
      timeOffset = header & 0x1f;
      if (referenceTimestamp === null)
        throw new Error("GARMIN_FIT_COMPRESSED_TIMESTAMP_WITHOUT_REFERENCE");
      const base: number = referenceTimestamp & ~0x1f;
      referenceTimestamp =
        timeOffset >= (referenceTimestamp & 0x1f) ? base + timeOffset : base + timeOffset + 0x20;
    } else {
      definition = (header & 0x40) !== 0;
      developerData = (header & 0x20) !== 0;
      localType = header & 0x0f;
    }

    if (definition) {
      if (offset + 5 > dataEnd) throw new Error("GARMIN_FIT_TRUNCATED");
      offset += 1; // reserved
      const bigEndian = bytes[offset] === 1;
      offset += 1;
      const messageNumber = bigEndian
        ? (bytes[offset]! << 8) | bytes[offset + 1]!
        : uint16le(bytes, offset);
      offset += 2;
      const fieldCount = bytes[offset]!;
      offset += 1;
      const fields: GarminFitFieldDefinition[] = [];
      for (let index = 0; index < fieldCount; index += 1) {
        if (offset + 3 > dataEnd) throw new Error("GARMIN_FIT_TRUNCATED");
        fields.push({
          number: bytes[offset]!,
          size: bytes[offset + 1]!,
          baseType: bytes[offset + 2]!,
        });
        offset += 3;
      }
      const devFields: GarminFitFieldDefinition[] = [];
      if (developerData) {
        if (offset + 1 > dataEnd) throw new Error("GARMIN_FIT_TRUNCATED");
        const devCount = bytes[offset]!;
        offset += 1;
        for (let index = 0; index < devCount; index += 1) {
          if (offset + 3 > dataEnd) throw new Error("GARMIN_FIT_TRUNCATED");
          devFields.push({
            number: bytes[offset]!,
            size: bytes[offset + 1]!,
            baseType: FIT_BASE_TYPE.BYTE,
          });
          offset += 3;
        }
      }
      definitions.set(localType, {
        localType,
        bigEndian,
        messageNumber,
        fields,
        devFields,
      });
      continue;
    }

    const definitionForType = definitions.get(localType);
    if (!definitionForType) throw new Error("GARMIN_FIT_DEFINITION_MISSING");
    const values = new Map<number, number>();
    let strings: Map<number, string> | undefined;
    for (const field of definitionForType.fields) {
      if (offset + field.size > dataEnd) throw new Error("GARMIN_FIT_TRUNCATED");
      if (field.baseType === FIT_BASE_TYPE.STRING) {
        // `RecordData.decode`: the bytes up to the first NUL, as UTF-8.
        const raw = bytes.subarray(offset, offset + field.size);
        const zero = raw.indexOf(0);
        const text = new TextDecoder().decode(zero < 0 ? raw : raw.subarray(0, zero));
        if (text) (strings ??= new Map()).set(field.number, text);
        offset += field.size;
        continue;
      }
      const value = readFitNumber(bytes, offset, field.baseType, definitionForType.bigEndian);
      if (value !== null) values.set(field.number, value);
      offset += field.size;
    }
    for (const field of definitionForType.devFields) {
      if (offset + field.size > dataEnd) throw new Error("GARMIN_FIT_TRUNCATED");
      offset += field.size;
    }

    let timestamp: number | null = null;
    const rawTimestamp = values.get(253);
    if (rawTimestamp !== undefined) {
      referenceTimestamp = rawTimestamp;
      timestamp = rawTimestamp + GARMIN_TIME_EPOCH;
    } else if (timeOffset !== null && referenceTimestamp !== null) {
      timestamp = referenceTimestamp + GARMIN_TIME_EPOCH;
    }
    messages.push({
      messageNumber: definitionForType.messageNumber,
      timestamp,
      fields: values,
      ...(strings ? { strings } : {}),
    });
  }

  // File CRC: the last two bytes after the data section.
  if (bytes.length >= dataEnd + 2) {
    const expected = uint16le(bytes, dataEnd);
    const actual = garminCrc16(bytes.subarray(0, dataEnd));
    if (expected !== 0 && expected !== actual) throw new Error("GARMIN_FIT_CRC");
  }
  return messages;
}

// ---------------------------------------------------------------------------
// FIT message semantics
// ---------------------------------------------------------------------------

export type GarminMonitoringSample = Readonly<{
  /** Epoch milliseconds of the sample start (floored to the minute). */
  timestamp: number;
  steps: number;
  heartRate: number | null;
  distanceMeters: number | null;
  activeCalories: number | null;
  activityType: number | null;
  intensity: number | null;
}>;

export type GarminSleepLevelSample = Readonly<{
  timestamp: number;
  level: number;
}>;

export type GarminEventSample = Readonly<{
  timestamp: number;
  event: number;
  eventType: number | null;
  data: number | null;
}>;

export type GarminNapSample = Readonly<{
  startTime: number;
  endTime: number;
}>;

function fitFieldsOf(message: GarminFitMessage): ReadonlyMap<number, number> {
  return message.fields;
}

function isoMinute(timestamp: number): string {
  return new Date(Math.floor(timestamp / MINUTE_MS) * MINUTE_MS).toISOString();
}

/**
 * Decodes MONITORING (55) samples.
 *
 * `timestamp_16` (field 26) is a rolling 16-bit second counter resolved
 * against the previous monitoring timestamp exactly like
 * `FitMonitoring.computeTimestamp`. `cycles` (field 3) carries the profile's
 * scale of 2, and `FitImporter.persistActivitySamples` multiplies the
 * per-activity sum by 2 again, so the emitted step count is the raw wire
 * value; the two-step arithmetic is kept here so a future profile change is
 * visible in one place.
 */
export function decodeGarminMonitoring(
  messages: readonly GarminFitMessage[],
): GarminMonitoringSample[] {
  // `FitImporter.persistActivitySamples` groups monitoring messages by resolved
  // timestamp and keeps one value per activity type per minute: Garmin reports
  // cumulative per-activity totals, so a later record for the same activity
  // overwrites the earlier one, and the sample value is the sum across the
  // activity types present. Steps are `getCycles()` (the profile's `cycles`
  // field, scale 2) multiplied back by 2, i.e. the raw wire value. Distance and
  // active calories follow the same last-per-type-then-sum rule; heart rate and
  // intensity take the last non-null value.
  type Accumulator = {
    stepsByActivity: Map<number, number>;
    distanceByActivity: Map<number, number>;
    caloriesByActivity: Map<number, number>;
    heartRate: number | null;
    activityType: number | null;
    intensity: number | null;
  };
  const byTimestamp = new Map<number, Accumulator>();
  let lastTimestamp: number | null = null;
  for (const message of messages) {
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.MONITORING) continue;
    const fields = fitFieldsOf(message);
    const timestamp16 = fields.get(26);
    let timestamp: number | null = null;
    if (timestamp16 !== undefined && lastTimestamp !== null) {
      const reference: number = lastTimestamp - GARMIN_TIME_EPOCH;
      let diff: number = (timestamp16 & 0xffff) - (reference & 0xffff);
      if (diff < -32768) diff += 65536;
      else if (diff > 32768) diff -= 65536;
      timestamp = lastTimestamp + diff;
    } else if (lastTimestamp !== null) {
      timestamp = lastTimestamp;
    } else if (message.timestamp !== null) {
      timestamp = message.timestamp;
    }
    if (timestamp === null) continue;
    lastTimestamp = timestamp;

    const activityTypeIntensity = fields.get(24);
    const activityType =
      fields.get(5) ?? (activityTypeIntensity !== undefined ? activityTypeIntensity & 0x1f : null);
    const activityKey = activityType ?? -1;

    let accumulator = byTimestamp.get(timestamp);
    if (!accumulator) {
      accumulator = {
        stepsByActivity: new Map(),
        distanceByActivity: new Map(),
        caloriesByActivity: new Map(),
        heartRate: null,
        activityType,
        intensity: null,
      };
      byTimestamp.set(timestamp, accumulator);
    }

    // `getCycles()` reads only the `cycles` field (profile scale 2); there is no
    // `cycles_16` fallback upstream.
    const cycles = fields.get(3);
    if (cycles !== undefined) accumulator.stepsByActivity.set(activityKey, cycles);
    const distance = fields.get(2);
    if (distance !== undefined) accumulator.distanceByActivity.set(activityKey, distance);
    const activeCalories = fields.get(19);
    if (activeCalories !== undefined)
      accumulator.caloriesByActivity.set(activityKey, activeCalories);

    const heartRate = fields.get(27);
    if (heartRate !== undefined && heartRate >= 1 && heartRate <= 254)
      accumulator.heartRate = heartRate;
    if (activityTypeIntensity !== undefined)
      accumulator.intensity = (activityTypeIntensity >> 5) & 0x07;
  }

  const samples: GarminMonitoringSample[] = [];
  for (const [timestamp, accumulator] of byTimestamp) {
    let rawSteps = 0;
    for (const cycles of accumulator.stepsByActivity.values()) rawSteps += cycles;
    let rawDistance = 0;
    for (const distance of accumulator.distanceByActivity.values()) rawDistance += distance;
    let calories = 0;
    for (const value of accumulator.caloriesByActivity.values()) calories += value;
    samples.push({
      timestamp: timestamp * 1000,
      steps: Math.round(rawSteps),
      heartRate: accumulator.heartRate,
      distanceMeters: accumulator.distanceByActivity.size > 0 ? rawDistance / 100 : null,
      activeCalories: accumulator.caloriesByActivity.size > 0 ? calories : null,
      activityType: accumulator.activityType,
      intensity: accumulator.intensity,
    });
  }
  return samples.sort((left, right) => left.timestamp - right.timestamp);
}

/** Decodes SLEEP_LEVEL (275) samples. */
export function decodeGarminSleepLevels(
  messages: readonly GarminFitMessage[],
): GarminSleepLevelSample[] {
  const samples: GarminSleepLevelSample[] = [];
  for (const message of messages) {
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.SLEEP_LEVEL) continue;
    const level = message.fields.get(0);
    if (level === undefined || message.timestamp === null) continue;
    samples.push({ timestamp: message.timestamp * 1000, level });
  }
  return samples;
}

/** Decodes EVENT (21) samples. */
export function decodeGarminEvents(messages: readonly GarminFitMessage[]): GarminEventSample[] {
  const samples: GarminEventSample[] = [];
  for (const message of messages) {
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.EVENT) continue;
    const event = message.fields.get(0);
    if (event === undefined || message.timestamp === null) continue;
    samples.push({
      timestamp: message.timestamp * 1000,
      event,
      eventType: message.fields.get(1) ?? null,
      data: message.fields.get(3) ?? null,
    });
  }
  return samples;
}

/** Decodes NAP_EVENT (412) samples. */
export function decodeGarminNaps(messages: readonly GarminFitMessage[]): GarminNapSample[] {
  const naps: GarminNapSample[] = [];
  for (const message of messages) {
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.NAP_EVENT) continue;
    const start = message.fields.get(0);
    const end = message.fields.get(2);
    if (start === undefined || end === undefined || end <= start) continue;
    // `start_time` / `end_time` are DateTime fields, so the profile's offset
    // already converts them to unix seconds (`FieldDefinitionDateTime`).
    naps.push({
      startTime: (start + GARMIN_TIME_EPOCH) * 1000,
      endTime: (end + GARMIN_TIME_EPOCH) * 1000,
    });
  }
  return naps;
}

export type GarminStepsRecord = Readonly<{
  type: "steps";
  startTime: string;
  endTime: string;
  count: number;
}>;

export type GarminHeartRateRecord = Readonly<{
  type: "heart_rate";
  time: string;
  bpm: number;
}>;

export type GarminSleepStage = Readonly<{
  stage: "awake" | "light" | "deep" | "rem";
  startTime: string;
  endTime: string;
}>;

export type GarminSleepSession = Readonly<{
  type: "sleep_session";
  startTime: string;
  endTime: string;
  stages?: readonly GarminSleepStage[];
}>;

/** Nightly HRV: `hrv_status_summary.last_night_average`, in ms. */
export type GarminHrvRecord = Readonly<{ type: "hrv_rmssd"; time: string; rmssdMs: number }>;

/** The watch's resting heart rate as of `time` (`monitoring_hr_data`). */
export type GarminRestingHeartRateRecord = Readonly<{
  type: "resting_heart_rate";
  time: string;
  bpm: number;
}>;

/** One workout from the first `session` of an ACTIVITY file. */
export type GarminWorkoutRecord = Readonly<{
  type: "workout";
  startTime: string;
  endTime: string;
  /** Lowercased FIT `Sport` name, e.g. `running`. */
  activity: string;
  /** The watch's name for the workout, when it has one. */
  title: string | null;
}>;

/** One SpO₂ reading (`spo2_data`), percent. */
export type GarminSpo2Record = Readonly<{
  type: "oxygen_saturation";
  time: string;
  percent: number;
}>;

/** One respiration reading (`respiration_rate`), breaths per minute. */
export type GarminRespirationRecord = Readonly<{
  type: "respiratory_rate";
  time: string;
  breathsPerMinute: number;
}>;

export type GarminRecord =
  | GarminSpo2Record
  | GarminRespirationRecord
  | GarminStepsRecord
  | GarminHeartRateRecord
  | GarminSleepSession
  | GarminHrvRecord
  | GarminRestingHeartRateRecord
  | GarminWorkoutRecord;

/** Converts one monitoring sample to the frozen exact-minute record shapes. */
export function garminMonitoringToRecords(sample: GarminMonitoringSample): readonly GarminRecord[] {
  const records: GarminRecord[] = [
    {
      type: "steps",
      startTime: isoMinute(sample.timestamp),
      endTime: new Date(
        Math.floor(sample.timestamp / MINUTE_MS) * MINUTE_MS + MINUTE_MS,
      ).toISOString(),
      count: sample.steps,
    },
  ];
  if (sample.heartRate !== null) {
    records.push({
      type: "heart_rate",
      time: isoMinute(sample.timestamp),
      bpm: sample.heartRate,
    });
  }
  return records;
}

function sleepStageOf(level: number): GarminSleepStage["stage"] | null {
  switch (level) {
    case GARMIN_SLEEP_LEVEL.AWAKE:
      return "awake";
    case GARMIN_SLEEP_LEVEL.LIGHT:
      return "light";
    case GARMIN_SLEEP_LEVEL.DEEP:
      return "deep";
    case GARMIN_SLEEP_LEVEL.REM:
      return "rem";
    default:
      return null;
  }
}

/**
 * Builds stages from upper-bound SLEEP_LEVEL samples, matching
 * `GarminSleepSessionProvider`: each sample's timestamp ends the stage that
 * started at the previous boundary, and the session start seeds the first
 * stage.
 */
function stagesBetween(
  levels: readonly GarminSleepLevelSample[],
  start: number,
  end: number,
): GarminSleepStage[] {
  // Each sample's timestamp is the end of the stage it reports, so the stage
  // covers [previous boundary, sample timestamp] (`GarminSleepSessionProvider`).
  const stages: GarminSleepStage[] = [];
  let previous = start;
  for (const sample of levels) {
    if (sample.timestamp <= start || sample.timestamp > end) continue;
    const stage = sleepStageOf(sample.level);
    if (!stage) continue;
    if (sample.timestamp <= previous) continue;
    stages.push({
      stage,
      startTime: new Date(previous).toISOString(),
      endTime: new Date(sample.timestamp).toISOString(),
    });
    previous = sample.timestamp;
  }
  if (stages.length > 0 && previous < end) {
    const last = stages[stages.length - 1]!;
    stages[stages.length - 1] = { ...last, endTime: new Date(end).toISOString() };
  }
  return stages;
}

/**
 * Segments SLEEP_LEVEL samples when the file has no sleep EVENT pairs,
 * mirroring the huami-legacy `SleepSessionSegmenter` rules: a session starts
 * at the first measurable sleep level, a wake phase longer than 60 minutes
 * closes it, sessions of five minutes or less are discarded, stages are
 * contiguous runs, and the final stage is extended by 60 s.
 */
function segmentSleepLevels(levels: readonly GarminSleepLevelSample[]): GarminSleepSession[] {
  const ordered = [...levels].sort((left, right) => left.timestamp - right.timestamp);
  const sessions: GarminSleepSession[] = [];
  let first = -1;
  let last = -1;
  let wakeMs = 0;
  let previous: GarminSleepLevelSample | null = null;

  const emit = () => {
    if (first === -1 || last === -1) return;
    const start = ordered[first]!.timestamp;
    const end = ordered[last]!.timestamp + GARMIN_TRAILING_STAGE_SECONDS * 1000;
    if (end - start <= GARMIN_MIN_SESSION_SECONDS * 1000) return;
    const stages: GarminSleepStage[] = [];
    let stageStart = start;
    let stage = sleepStageOf(ordered[first]!.level) ?? "light";
    for (let index = first + 1; index <= last; index += 1) {
      const sample = ordered[index]!;
      const next = sleepStageOf(sample.level) ?? stage;
      if (next !== stage) {
        stages.push({
          stage,
          startTime: new Date(stageStart).toISOString(),
          endTime: new Date(sample.timestamp).toISOString(),
        });
        stage = next;
        stageStart = sample.timestamp;
      }
    }
    stages.push({
      stage,
      startTime: new Date(stageStart).toISOString(),
      endTime: new Date(end).toISOString(),
    });
    sessions.push({
      type: "sleep_session",
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      stages,
    });
  };

  const reset = () => {
    first = -1;
    last = -1;
    wakeMs = 0;
  };

  for (let index = 0; index < ordered.length; index += 1) {
    const sample = ordered[index]!;
    if (
      previous &&
      first !== -1 &&
      sample.timestamp - previous.timestamp > GARMIN_MAX_WAKE_PHASE_SECONDS * 1000
    ) {
      emit();
      reset();
    }
    const sleeping =
      sleepStageOf(sample.level) !== null && sample.level !== GARMIN_SLEEP_LEVEL.AWAKE;
    if (sleeping) {
      if (first === -1) first = index;
      last = index;
      wakeMs = 0;
    } else if (first !== -1) {
      if (previous) wakeMs += sample.timestamp - previous.timestamp;
      if (wakeMs > GARMIN_MAX_WAKE_PHASE_SECONDS * 1000) {
        emit();
        reset();
      }
    }
    previous = sample;
  }
  emit();
  return sessions;
}

/**
 * Derives sleep sessions from EVENT pairs (event 74, type 0/1), NAP_EVENT
 * records, and SLEEP_LEVEL samples.
 *
 * EVENT-bounded sessions follow upstream: stages are the upper-bound sleep
 * levels inside the pair, and a session without stages becomes a single light
 * stage. Files without EVENT pairs fall back to huami-style segmentation.
 */
export function segmentGarminSleepSessions(input: {
  levels: readonly GarminSleepLevelSample[];
  events: readonly GarminEventSample[];
  naps: readonly GarminNapSample[];
}): GarminSleepSession[] {
  const { levels, events, naps } = input;
  const orderedLevels = [...levels].sort((left, right) => left.timestamp - right.timestamp);
  const sleepEvents = events
    .filter((event) => event.event === GARMIN_EVENT_DETECT_SLEEP)
    .sort((left, right) => left.timestamp - right.timestamp);
  const sessions: GarminSleepSession[] = [];

  let start: number | null = null;
  for (const event of sleepEvents) {
    if (event.eventType === GARMIN_EVENT_TYPE.START) {
      start = event.timestamp;
      continue;
    }
    if (event.eventType !== GARMIN_EVENT_TYPE.STOP || start === null) continue;
    const end = event.timestamp;
    if (end > start) {
      const stages = stagesBetween(orderedLevels, start, end);
      sessions.push({
        type: "sleep_session",
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        stages:
          stages.length > 0
            ? stages
            : [
                {
                  stage: "light",
                  startTime: new Date(start).toISOString(),
                  endTime: new Date(end).toISOString(),
                },
              ],
      });
    }
    start = null;
  }

  if (sleepEvents.length === 0) sessions.push(...segmentSleepLevels(orderedLevels));

  for (const nap of naps) {
    sessions.push({
      type: "sleep_session",
      startTime: new Date(nap.startTime).toISOString(),
      endTime: new Date(nap.endTime).toISOString(),
      stages: [
        {
          stage: "light",
          startTime: new Date(nap.startTime).toISOString(),
          endTime: new Date(nap.endTime).toISOString(),
        },
      ],
    });
  }

  return sessions.sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
}

/**
 * Decodes a FIT file into the frozen record shapes: exact-minute `steps`,
 * `heart_rate` points, and `sleep_session` records.
 */
export function garminFitRecords(bytes: Uint8Array): GarminRecord[] {
  const messages = parseGarminFitFile(bytes);
  return garminFitRecordsFromMessages(messages);
}

/** Same as {@link garminFitRecords} for an already parsed message list. */
export function garminFitRecordsFromMessages(
  messages: readonly GarminFitMessage[],
): GarminRecord[] {
  const records: GarminRecord[] = [];
  for (const sample of decodeGarminMonitoring(messages))
    records.push(...garminMonitoringToRecords(sample));
  records.push(
    ...segmentGarminSleepSessions({
      levels: decodeGarminSleepLevels(messages),
      events: decodeGarminEvents(messages),
      naps: decodeGarminNaps(messages),
    }),
  );
  records.push(...decodeGarminHrv(messages));
  records.push(...decodeGarminRestingHeartRate(messages));
  records.push(...decodeGarminWorkout(messages));
  records.push(...decodeGarminSpo2(messages));
  records.push(...decodeGarminRespiration(messages));
  return records;
}

// ---------------------------------------------------------------------------
// HRV, resting heart rate and workouts (docs/research/notes/Garmin MLR
// transport/garmin-fit-health-metrics.md). Upstream carries the last record
// timestamp forward when a record has none; so do these decoders.
// ---------------------------------------------------------------------------

/**
 * Nightly HRV from `hrv_status_summary` (370) field 1 `last_night_average`,
 * UINT16 raw/128 ms, rounded as upstream stores it. Weekly average, the
 * 5-minute high and the baselines are not nightly RMSSD values.
 */
export function decodeGarminHrv(messages: readonly GarminFitMessage[]): GarminHrvRecord[] {
  const out: GarminHrvRecord[] = [];
  let last: number | null = null;
  for (const message of messages) {
    if (message.timestamp !== null) last = message.timestamp;
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.HRV_STATUS_SUMMARY || last === null) continue;
    const raw = message.fields.get(1);
    if (raw === undefined) continue;
    const rmssdMs = Math.round(raw / 128);
    if (rmssdMs <= 0) continue;
    out.push({ type: "hrv_rmssd", time: new Date(last * 1000).toISOString(), rmssdMs });
  }
  return out;
}

/**
 * Resting heart rate from `monitoring_hr_data` (211): field 1
 * `current_day_resting_heart_rate` (what the watch displays, upstream's
 * choice), else field 0. UINT8 bpm; 0xFF is already dropped as invalid.
 */
export function decodeGarminRestingHeartRate(
  messages: readonly GarminFitMessage[],
): GarminRestingHeartRateRecord[] {
  const out: GarminRestingHeartRateRecord[] = [];
  let last: number | null = null;
  for (const message of messages) {
    if (message.timestamp !== null) last = message.timestamp;
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.MONITORING_HR_DATA || last === null) continue;
    const bpm = message.fields.get(1) ?? message.fields.get(0);
    if (bpm === undefined || bpm < 20 || bpm > 250) continue;
    out.push({ type: "resting_heart_rate", time: new Date(last * 1000).toISOString(), bpm });
  }
  return out;
}

/**
 * SpO₂ from `spo2_data` (269) field 0 `reading_spo2`, UINT8 %. Upstream keeps
 * every mode (manual, automatic, unknown) and skips values of 0 or less
 * (`FitImporter`); readings below 50% are not physiological and are dropped.
 */
export function decodeGarminSpo2(messages: readonly GarminFitMessage[]): GarminSpo2Record[] {
  const out: GarminSpo2Record[] = [];
  let last: number | null = null;
  for (const message of messages) {
    if (message.timestamp !== null) last = message.timestamp;
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.SPO2_DATA || last === null) continue;
    const percent = message.fields.get(0);
    if (percent === undefined || percent < 50 || percent > 100) continue;
    out.push({ type: "oxygen_saturation", time: new Date(last * 1000).toISOString(), percent });
  }
  return out;
}

/**
 * Respiration from `respiration_rate` (297) field 0, SINT16 scale 100,
 * breaths/min; values of 0 or less are skipped as upstream (negatives are the
 * watch's "no reading" markers).
 */
export function decodeGarminRespiration(
  messages: readonly GarminFitMessage[],
): GarminRespirationRecord[] {
  const out: GarminRespirationRecord[] = [];
  let last: number | null = null;
  for (const message of messages) {
    if (message.timestamp !== null) last = message.timestamp;
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.RESPIRATION_RATE || last === null) continue;
    const raw = message.fields.get(0);
    if (raw === undefined || raw <= 0) continue;
    const breathsPerMinute = raw / 100;
    if (breathsPerMinute > 80) continue;
    out.push({
      type: "respiratory_rate",
      time: new Date(last * 1000).toISOString(),
      breathsPerMinute,
    });
  }
  return out;
}

/** FIT profile `Sport` enum (fit_profile.json at the pinned commit), lowercased. */
const GARMIN_SPORT_NAMES = new Map<number, string>([
  [0, "generic"],
  [1, "running"],
  [2, "cycling"],
  [3, "transition"],
  [4, "fitness_equipment"],
  [5, "swimming"],
  [6, "basketball"],
  [7, "soccer"],
  [8, "tennis"],
  [9, "american_football"],
  [10, "training"],
  [11, "walking"],
  [12, "cross_country_skiing"],
  [13, "alpine_skiing"],
  [14, "snowboarding"],
  [15, "rowing"],
  [16, "mountaineering"],
  [17, "hiking"],
  [18, "multisport"],
  [19, "paddling"],
  [20, "flying"],
  [21, "e_biking"],
  [22, "motorcycling"],
  [23, "boating"],
  [24, "driving"],
  [25, "golf"],
  [26, "hang_gliding"],
  [27, "horseback_riding"],
  [28, "hunting"],
  [29, "fishing"],
  [30, "inline_skating"],
  [31, "rock_climbing"],
  [32, "sailing"],
  [33, "ice_skating"],
  [34, "sky_diving"],
  [35, "snowshoeing"],
  [36, "snowmobiling"],
  [37, "stand_up_paddleboarding"],
  [38, "surfing"],
  [39, "wakeboarding"],
  [40, "water_skiing"],
  [41, "kayaking"],
  [42, "rafting"],
  [43, "windsurfing"],
  [44, "kitesurfing"],
  [45, "tactical"],
  [46, "jumpmaster"],
  [47, "boxing"],
  [48, "floor_climbing"],
  [49, "baseball"],
  [50, "softball_fast_pitch"],
  [51, "softball_slow_pitch"],
  [52, "stopwatch"],
  [53, "diving"],
  [56, "shooting"],
  [57, "auto_racing"],
  [58, "winter_sport"],
  [59, "grinding"],
  [60, "health_monitoring"],
  [61, "marine"],
  [62, "hiit"],
  [63, "video_gaming"],
  [64, "racket"],
  [65, "wheelchair_push_walk"],
  [66, "wheelchair_push_run"],
  [67, "meditation"],
  [68, "para_sport"],
  [69, "disc_golf"],
  [70, "team_sport"],
  [71, "cricket"],
  [72, "rugby"],
  [73, "hockey"],
  [74, "lacrosse"],
  [75, "volleyball"],
  [76, "water_tubing"],
  [77, "wakesurfing"],
  [78, "water_sport"],
  [79, "archery"],
  [80, "mixed_martial_arts"],
  [81, "motor_sports"],
  [82, "snorkeling"],
  [83, "dance"],
  [84, "jump_rope"],
  [85, "pool_apnea"],
  [86, "mobility"],
  [87, "geocaching"],
  [88, "canoeing"],
  [99, "trolling_motor"],
]);

/**
 * Cuts to at most `max` UTF-16 code units (the upload contract's measure),
 * never splitting a surrogate pair.
 */
function truncateUtf16(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** The lowercased FIT sport name; unknown codes keep their number. */
export function garminSportName(sport: number | undefined): string {
  if (sport === undefined) return "generic";
  return GARMIN_SPORT_NAMES.get(sport) ?? `sport_${sport}`;
}

/**
 * One workout per ACTIVITY file, from the first `session` (18) only, as
 * upstream: start = field 2 `start_time` (else `file_id.time_created`),
 * end = start + field 7 `total_elapsed_time` (raw/1000 s), sport = field 5.
 * A multi-sport file is one workout with the first leg's sport.
 */
export function decodeGarminWorkout(messages: readonly GarminFitMessage[]): GarminWorkoutRecord[] {
  const session = messages.find((message) => message.messageNumber === GARMIN_FIT_MESSAGE.SESSION);
  if (!session) return [];
  const fileId = messages.find((message) => message.messageNumber === GARMIN_FIT_MESSAGE.FILE_ID);
  const rawStart = session.fields.get(2) ?? fileId?.fields.get(4);
  const elapsed = session.fields.get(7);
  if (rawStart === undefined || elapsed === undefined || elapsed <= 0) return [];
  const start = (rawStart + GARMIN_TIME_EPOCH) * 1000;
  const end = start + elapsed;
  // `GarminWorkoutParser`: activity name, then workout name, then the
  // session's sport profile name, then the sport's name (first of each).
  const first = (messageNumber: number, field: number) =>
    messages.find((message) => message.messageNumber === messageNumber)?.strings?.get(field);
  const title =
    first(GARMIN_FIT_MESSAGE.ACTIVITY, 8) ||
    first(GARMIN_FIT_MESSAGE.WORKOUT, 8) ||
    session.strings?.get(110) ||
    first(GARMIN_FIT_MESSAGE.SPORT, 3) ||
    null;
  return [
    {
      type: "workout",
      startTime: new Date(start).toISOString(),
      endTime: new Date(Math.ceil(end / 1000) * 1000).toISOString(),
      activity: garminSportName(session.fields.get(5)),
      title: title ? truncateUtf16(title, 200) : null,
    },
  ];
}

/** Sleep score from a SLEEP_ASSESSMENT (346) message, when present. */
export function garminSleepAssessmentScore(messages: readonly GarminFitMessage[]): number | null {
  for (const message of messages) {
    if (message.messageNumber !== GARMIN_FIT_MESSAGE.SLEEP_ASSESSMENT) continue;
    const score = message.fields.get(6);
    if (score !== undefined) return score;
  }
  return null;
}
