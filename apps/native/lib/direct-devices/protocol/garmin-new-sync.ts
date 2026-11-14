/**
 * Garmin "new sync protocol" codec (pure, no BLE): protobuf `FileAccess`
 * messages inside GFDI `PROTOBUF_REQUEST`/`PROTOBUF_RESPONSE`, the raw zlib
 * stream on a `FILE_TRANSFER_*` ML/MLR service, and file selection.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 (paths relative to
 * `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`):
 * - `service/devices/garmin/FileSyncServiceHandler.kt` (list, pull, flags)
 * - `service/devices/garmin/ProtocolBufferHandler.java` (chunking, statuses)
 * - `service/devices/garmin/messages/ProtobufMessage.java`,
 *   `messages/status/ProtobufStatusMessage.java` (GFDI payloads)
 * - `service/devices/garmin/GarminSupport.java` `downloadFileFromServiceV2`
 *   (transfer request, first message, zlib)
 * - `service/devices/garmin/FileType.java` (type names)
 * - `util/CompressionUtils.kt` (zlib inflate)
 * - `GBProtobufGenerator/src/main/proto/garmin/gdi_file_access.proto`,
 *   `gdi_data_types.proto`, `gdi_smart_proto.proto` (field numbers)
 *
 * Byte-level spec, with line cites, INFERRED and UNKNOWN markers:
 * `docs/research/notes/Garmin MLR transport/garmin-new-sync-protocol.md`.
 * Nothing here is hardware-validated; the vectors are hand-encoded from the
 * `.proto` files.
 *
 * The protobuf wire codec is the hand-written one in `./xiaomi-proto`. zlib is
 * `fflate` (MIT, pure JS): React Native has no Node `zlib` at runtime.
 *
 * Licence: AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { Unzlib } from "fflate";

import { GARMIN_FILE_TYPE, GARMIN_MESSAGE } from "./garmin";
import {
  bytesField,
  decodeMessage,
  encodeMessage,
  stringField,
  varintField,
  type ProtoField,
  type ProtoValue,
} from "./xiaomi-proto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `CommunicatorV2.Service.FILE_TRANSFER_*`, in `startTransfer` order. */
export const GARMIN_FILE_TRANSFER_SERVICES: readonly number[] = [
  0x2018, 0x4018, 0x6018, 0xa018, 0xc018, 0xe018,
];

/** `ProtocolBufferHandler.maxChunkSize` before DEVICE_INFORMATION arrives. */
export const GARMIN_PROTOBUF_DEFAULT_CHUNK = 375;
/** GFDI header (2 length, 2 type, 14 protobuf header) plus the CRC. */
export const GARMIN_PROTOBUF_OVERHEAD = 20;
/** Local cap on one reassembled protobuf (not upstream). */
export const GARMIN_PROTOBUF_MAX_BYTES = 1024 * 1024;
/** Local cap on protobufs being reassembled at once (not upstream). */
export const GARMIN_PROTOBUF_MAX_PENDING = 8;

/** `ProtobufStatusMessage.ProtobufChunkStatus` ordinals. */
export const GARMIN_PROTOBUF_CHUNK = { KEPT: 0, DISCARDED: 1 } as const;
/** `ProtobufStatusMessage.ProtobufStatusCode` codes. */
export const GARMIN_PROTOBUF_STATUS = {
  NO_ERROR: 0,
  UNKNOWN_REQUEST_ID: 100,
  DUPLICATE_PACKET: 101,
  MISSING_PACKET: 102,
  EXCEEDED_TOTAL_PROTOBUF_LENGTH: 103,
  PROTOBUF_PARSE_ERROR: 200,
  UNKNOWN: 201,
} as const;

/** `Smart.file_access_service` (`gdi_smart_proto.proto:88`). */
const SMART_FILE_ACCESS_SERVICE = 43;

/** `FileAccess.Service` fields (`gdi_file_access.proto:263-289`). */
export const GARMIN_FILE_ACCESS = {
  PULL_ITEM_REQUEST: 1,
  PULL_ITEM_RESPONSE: 2,
  TRANSFER_STATUS_REQUEST: 5,
  ITEM_LIST_REQUEST: 9,
  ITEM_LIST_RESPONSE: 10,
  ITEM_ADDED_NOTIFICATION: 12,
  MODIFY_FLAGS_REQUEST: 15,
  MODIFY_FLAGS_RESPONSE: 16,
  ITEM_UPDATED_NOTIFICATION: 17,
  RESOURCE_UPDATE_NOTIFICATION: 20,
  TRANSFER_STATUS_RESPONSE: 21,
  SYNC_BUTTON_NOTIFICATION: 22,
} as const;

/** `FileSyncServiceHandler.handle` dispatch order (`FileSyncServiceHandler.kt:32-47`). */
const DISPATCH_ORDER = [
  GARMIN_FILE_ACCESS.ITEM_ADDED_NOTIFICATION,
  GARMIN_FILE_ACCESS.ITEM_LIST_RESPONSE,
  GARMIN_FILE_ACCESS.PULL_ITEM_RESPONSE,
  GARMIN_FILE_ACCESS.MODIFY_FLAGS_RESPONSE,
  GARMIN_FILE_ACCESS.TRANSFER_STATUS_REQUEST,
  GARMIN_FILE_ACCESS.ITEM_UPDATED_NOTIFICATION,
  GARMIN_FILE_ACCESS.SYNC_BUTTON_NOTIFICATION,
  GARMIN_FILE_ACCESS.RESOURCE_UPDATE_NOTIFICATION,
] as const;

/** `FileSyncServiceHandler.FLAGS_SYNCED` = 42405 (0xA5A5), as fixed64 LE. */
const FLAGS_SYNCED = Uint8Array.of(0xa5, 0xa5, 0, 0, 0, 0, 0, 0);
/** `ItemAccessResult.SUCCESS`. */
export const GARMIN_ITEM_ACCESS_SUCCESS = 0;
/** `PullItemDataRequest` constants (`FileSyncServiceHandler.kt:206-214`). */
const PULL_PRIORITY = 24;
const MULTILINK_TRANSPORT_PIPE = 0;
const COMPRESSION_WINDOW = 15;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function lastOf(fields: Map<number, ProtoValue[]>, field: number): ProtoValue | undefined {
  const values = fields.get(field);
  return values && values.length > 0 ? values[values.length - 1] : undefined;
}

function varintOf(fields: Map<number, ProtoValue[]>, field: number): number | undefined {
  const value = lastOf(fields, field);
  if (!value) return undefined;
  if (value.wireType !== 0) throw new Error("GARMIN_PROTO_WIRE_TYPE");
  return value.value as number;
}

function bytesOf(fields: Map<number, ProtoValue[]>, field: number): Uint8Array | undefined {
  const value = lastOf(fields, field);
  if (!value) return undefined;
  if (value.wireType !== 2) throw new Error("GARMIN_PROTO_WIRE_TYPE");
  return value.value as Uint8Array;
}

function allBytesOf(fields: Map<number, ProtoValue[]>, field: number): Uint8Array[] {
  return (fields.get(field) ?? []).map((value) => {
    if (value.wireType !== 2) throw new Error("GARMIN_PROTO_WIRE_TYPE");
    return value.value as Uint8Array;
  });
}

/** Strict UTF-8 decode (type names are ASCII in practice). */
function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// ---------------------------------------------------------------------------
// GFDI protobuf carriage (ProtobufMessage / ProtobufStatusMessage)
// ---------------------------------------------------------------------------

export type GarminProtobufChunk = Readonly<{
  requestId: number;
  dataOffset: number;
  totalLength: number;
  data: Uint8Array;
}>;

/** `ProtobufMessage.parseIncoming` (`ProtobufMessage.java:44-52`). */
export function parseGarminProtobufPayload(payload: Uint8Array): GarminProtobufChunk {
  if (payload.length < 14) throw new Error("GARMIN_PROTOBUF_TRUNCATED");
  const dataLength = uint32le(payload, 10);
  if (payload.length < 14 + dataLength) throw new Error("GARMIN_PROTOBUF_TRUNCATED");
  return {
    requestId: uint16le(payload, 0),
    dataOffset: uint32le(payload, 2),
    totalLength: uint32le(payload, 6),
    data: payload.slice(14, 14 + dataLength),
  };
}

/** `ProtobufMessage.generateOutgoing` payload (`ProtobufMessage.java:83-93`). */
export function buildGarminProtobufPayload(chunk: GarminProtobufChunk): Uint8Array {
  const out = new Uint8Array(14 + chunk.data.length);
  writeUint16le(out, 0, chunk.requestId);
  writeUint32le(out, 2, chunk.dataOffset);
  writeUint32le(out, 6, chunk.totalLength);
  writeUint32le(out, 10, chunk.data.length);
  out.set(chunk.data, 14);
  return out;
}

/**
 * Splits one protobuf into GFDI payload chunks of `maxChunkSize` bytes
 * (`ProtocolBufferHandler.prepareProtobufMessage` and `getNextChunk`).
 */
export function chunkGarminProtobuf(
  requestId: number,
  bytes: Uint8Array,
  maxChunkSize: number,
): GarminProtobufChunk[] {
  if (!Number.isInteger(maxChunkSize) || maxChunkSize < 1) throw new Error("GARMIN_PROTOBUF_CHUNK");
  const chunks: GarminProtobufChunk[] = [];
  for (let offset = 0; offset < bytes.length; offset += maxChunkSize) {
    chunks.push({
      requestId,
      dataOffset: offset,
      totalLength: bytes.length,
      data: bytes.slice(offset, offset + maxChunkSize),
    });
  }
  return chunks;
}

/** `ProtobufStatusMessage.generateOutgoing` payload (11 bytes, `ProtobufStatusMessage.java:91-102`). */
export function buildGarminProtobufStatus(input: {
  originalMessageType: number;
  requestId: number;
  dataOffset: number;
  chunkStatus: number;
  statusCode: number;
}): Uint8Array {
  const out = new Uint8Array(11);
  writeUint16le(out, 0, input.originalMessageType);
  out[2] = 0; // GFDI ACK
  writeUint16le(out, 3, input.requestId);
  writeUint32le(out, 5, input.dataOffset);
  out[9] = input.chunkStatus;
  out[10] = input.statusCode;
  return out;
}

export type GarminProtobufStatus = Readonly<{
  originalMessageType: number;
  status: number;
  requestId: number;
  dataOffset: number;
  chunkStatus: number;
  statusCode: number;
  /** `ProtobufStatusMessage.isOK`. */
  ok: boolean;
}>;

/** `ProtobufStatusMessage.parseIncoming`; null when not a protobuf status. */
export function parseGarminProtobufStatus(payload: Uint8Array): GarminProtobufStatus | null {
  if (payload.length < 11) return null;
  const originalMessageType = uint16le(payload, 0);
  if (
    originalMessageType !== GARMIN_MESSAGE.PROTOBUF_REQUEST &&
    originalMessageType !== GARMIN_MESSAGE.PROTOBUF_RESPONSE
  ) {
    return null;
  }
  const status = payload[2]!;
  const chunkStatus = payload[9]!;
  const statusCode = payload[10]!;
  return {
    originalMessageType,
    status,
    requestId: uint16le(payload, 3),
    dataOffset: uint32le(payload, 5),
    chunkStatus,
    statusCode,
    ok:
      status === 0 &&
      chunkStatus === GARMIN_PROTOBUF_CHUNK.KEPT &&
      statusCode === GARMIN_PROTOBUF_STATUS.NO_ERROR,
  };
}

export type GarminProtobufAccept =
  | Readonly<{ kind: "chunk" }>
  | Readonly<{ kind: "complete"; bytes: Uint8Array; single: boolean }>
  | Readonly<{ kind: "dropped" }>;

/**
 * Incoming reassembly (`ProtocolBufferHandler.processChunkedMessage`,
 * `ProtobufFragment`). A chunk at offset 0 starts or replaces the buffer for
 * its request id; a later chunk must start exactly where the buffer ends.
 * Upstream throws on a mismatch; this drops the buffer instead.
 */
export class GarminProtobufReassembler {
  private readonly pending = new Map<
    number,
    { total: number; parts: Uint8Array[]; held: number }
  >();

  accept(chunk: GarminProtobufChunk): GarminProtobufAccept {
    if (chunk.totalLength > GARMIN_PROTOBUF_MAX_BYTES) {
      this.pending.delete(chunk.requestId);
      return { kind: "dropped" };
    }
    // `ProtobufMessage.isComplete`: offset 0 and the whole message.
    if (chunk.dataOffset === 0 && chunk.data.length === chunk.totalLength) {
      return { kind: "complete", bytes: chunk.data, single: true };
    }
    let entry = this.pending.get(chunk.requestId);
    if (chunk.dataOffset === 0) {
      if (!entry && this.pending.size >= GARMIN_PROTOBUF_MAX_PENDING) {
        const oldest = this.pending.keys().next().value!;
        this.pending.delete(oldest);
      }
      entry = { total: chunk.totalLength, parts: [chunk.data], held: chunk.data.length };
      this.pending.set(chunk.requestId, entry);
    } else {
      if (!entry || chunk.dataOffset !== entry.held) {
        this.pending.delete(chunk.requestId);
        return { kind: "dropped" };
      }
      entry.parts.push(chunk.data);
      entry.held += chunk.data.length;
    }
    if (entry.held > entry.total) {
      this.pending.delete(chunk.requestId);
      return { kind: "dropped" };
    }
    if (entry.held < entry.total) return { kind: "chunk" };
    this.pending.delete(chunk.requestId);
    return { kind: "complete", bytes: concat(entry.parts), single: false };
  }

  reset(): void {
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Smart / FileAccess messages
// ---------------------------------------------------------------------------

/** `Smart{file_access_service = <service>}`. */
export function encodeGarminSmartFileAccess(service: Uint8Array): Uint8Array {
  return encodeMessage([bytesField(SMART_FILE_ACCESS_SERVICE, service)]);
}

/** The `FileAccess.Service` bytes inside a `Smart`, or null when absent. */
export function decodeGarminSmartFileAccess(smart: Uint8Array): Uint8Array | null {
  return (
    bytesOf(decodeMessage(smart, GARMIN_PROTOBUF_MAX_BYTES), SMART_FILE_ACCESS_SERVICE) ?? null
  );
}

function uuidMessage(most: Uint8Array, least: Uint8Array): Uint8Array {
  return encodeMessage([
    { field: 1, wireType: 1, value: most },
    { field: 2, wireType: 1, value: least },
  ]);
}

const SYNCED_UUID = uuidMessage(FLAGS_SYNCED, FLAGS_SYNCED);

/** `FileSyncServiceHandler.requestFileList` (`FileSyncServiceHandler.kt:178-197`). */
export function buildGarminItemListRequest(
  input: { sessionId?: number; transactionId?: number } = {},
): Uint8Array {
  const fields: ProtoField[] = [];
  if (input.sessionId !== undefined) fields.push(varintField(1, input.sessionId));
  else if (input.transactionId !== undefined) fields.push(varintField(2, input.transactionId));
  fields.push(bytesField(4, SYNCED_UUID), bytesField(5, SYNCED_UUID));
  return encodeMessage([bytesField(GARMIN_FILE_ACCESS.ITEM_LIST_REQUEST, encodeMessage(fields))]);
}

/** `FileSyncServiceHandler.requestFile` (`FileSyncServiceHandler.kt:199-215`). */
export function buildGarminPullItemRequest(item: Uint8Array): Uint8Array {
  const request = encodeMessage([
    bytesField(1, item),
    varintField(2, PULL_PRIORITY),
    varintField(3, MULTILINK_TRANSPORT_PIPE),
    varintField(4, 0),
    varintField(5, COMPRESSION_WINDOW),
  ]);
  return encodeMessage([bytesField(GARMIN_FILE_ACCESS.PULL_ITEM_REQUEST, request)]);
}

/** `FileSyncServiceHandler.markSynced` (`FileSyncServiceHandler.kt:217-244`). */
export function buildGarminModifyFlagsRequest(uid: Uint8Array): Uint8Array {
  const request = encodeMessage([bytesField(1, uid), bytesField(2, SYNCED_UUID)]);
  return encodeMessage([bytesField(GARMIN_FILE_ACCESS.MODIFY_FLAGS_REQUEST, request)]);
}

/** `FileSyncServiceHandler.handleTransferStatusRequest` reply (`FileSyncServiceHandler.kt:78-86`). */
export function buildGarminTransferStatusResponse(): Uint8Array {
  return encodeMessage([
    bytesField(GARMIN_FILE_ACCESS.TRANSFER_STATUS_RESPONSE, encodeMessage([varintField(1, 1)])),
  ]);
}

export type GarminDataType = Readonly<{
  format?: number;
  gdxmlString?: string;
  gdxmlStringKey?: number;
}>;

export type GarminItemReference = Readonly<{
  /** The `ItemReference` bytes as received (re-sent in `PullItemDataRequest`). */
  raw: Uint8Array;
  /** The `uid` UUID message bytes (re-sent in `ModifyFlagsRequest`). */
  uid: Uint8Array | null;
  /** Stable key: `uid:<most hex>:<least hex>` (fixed64 bytes, little-endian). */
  key: string | null;
  dataType: GarminDataType | null;
  dataSize: number | null;
  modifiedTime: number | null;
}>;

function decodeDataType(bytes: Uint8Array): GarminDataType {
  const fields = decodeMessage(bytes, GARMIN_PROTOBUF_MAX_BYTES);
  const name = bytesOf(fields, 2);
  return {
    format: varintOf(fields, 1),
    gdxmlString: name === undefined ? undefined : utf8(name),
    gdxmlStringKey: varintOf(fields, 3),
  };
}

function uuidKey(uid: Uint8Array): string | null {
  const fields = decodeMessage(uid, GARMIN_PROTOBUF_MAX_BYTES);
  const most = lastOf(fields, 1);
  const least = lastOf(fields, 2);
  if (most?.wireType !== 1 || least?.wireType !== 1) return null;
  return `uid:${hex(most.value as Uint8Array)}:${hex(least.value as Uint8Array)}`;
}

/** Decodes one `ItemReference` (`gdi_file_access.proto:155-169`). */
export function decodeGarminItemReference(raw: Uint8Array): GarminItemReference {
  const fields = decodeMessage(raw, GARMIN_PROTOBUF_MAX_BYTES);
  const uid = bytesOf(fields, 1) ?? null;
  const dataType = bytesOf(fields, 2);
  return {
    raw,
    uid,
    key: uid ? uuidKey(uid) : null,
    dataType: dataType === undefined ? null : decodeDataType(dataType),
    dataSize: varintOf(fields, 3) ?? null,
    modifiedTime: varintOf(fields, 7) ?? null,
  };
}

export type GarminFileAccessMessage =
  | Readonly<{
      kind: "item_list_response";
      status: number | null;
      sessionId: number | null;
      nextTransactionId: number | null;
      items: GarminItemReference[];
    }>
  | Readonly<{ kind: "item_added_notification"; items: GarminItemReference[] }>
  | Readonly<{ kind: "pull_item_response"; result: number | null; transferHandle: number | null }>
  | Readonly<{ kind: "transfer_status_request" }>
  | Readonly<{ kind: "modify_flags_response" }>
  | Readonly<{ kind: "item_updated_notification" }>
  | Readonly<{ kind: "sync_button_notification" }>
  | Readonly<{ kind: "resource_update_notification" }>
  | Readonly<{ kind: "unhandled" }>;

/** `FileSyncServiceHandler.handle`: the first present message, in upstream order. */
export function decodeGarminFileAccessService(service: Uint8Array): GarminFileAccessMessage {
  const fields = decodeMessage(service, GARMIN_PROTOBUF_MAX_BYTES);
  const field = DISPATCH_ORDER.find((number) => fields.has(number));
  if (field === undefined) return { kind: "unhandled" };
  const body = bytesOf(fields, field) ?? new Uint8Array(0);
  switch (field) {
    case GARMIN_FILE_ACCESS.ITEM_LIST_RESPONSE: {
      const list = decodeMessage(body, GARMIN_PROTOBUF_MAX_BYTES);
      return {
        kind: "item_list_response",
        status: varintOf(list, 1) ?? null,
        sessionId: varintOf(list, 2) ?? null,
        nextTransactionId: varintOf(list, 3) ?? null,
        items: allBytesOf(list, 4).map(decodeGarminItemReference),
      };
    }
    case GARMIN_FILE_ACCESS.ITEM_ADDED_NOTIFICATION:
      return {
        kind: "item_added_notification",
        items: allBytesOf(decodeMessage(body, GARMIN_PROTOBUF_MAX_BYTES), 1).map(
          decodeGarminItemReference,
        ),
      };
    case GARMIN_FILE_ACCESS.PULL_ITEM_RESPONSE: {
      const pull = decodeMessage(body, GARMIN_PROTOBUF_MAX_BYTES);
      return {
        kind: "pull_item_response",
        result: varintOf(pull, 1) ?? null,
        transferHandle: varintOf(pull, 3) ?? null,
      };
    }
    case GARMIN_FILE_ACCESS.TRANSFER_STATUS_REQUEST:
      return { kind: "transfer_status_request" };
    case GARMIN_FILE_ACCESS.MODIFY_FLAGS_RESPONSE:
      return { kind: "modify_flags_response" };
    case GARMIN_FILE_ACCESS.ITEM_UPDATED_NOTIFICATION:
      return { kind: "item_updated_notification" };
    case GARMIN_FILE_ACCESS.SYNC_BUTTON_NOTIFICATION:
      return { kind: "sync_button_notification" };
    default:
      return { kind: "resource_update_notification" };
  }
}

// ---------------------------------------------------------------------------
// File selection (FileSyncServiceHandler.conditionallyDownload, FileType)
// ---------------------------------------------------------------------------

/**
 * The FIT file types this family decodes, by upstream `typeName`
 * (`FIT_TYPE_<subtype>` for data type 128, `FileType.java:230-232`), all
 * `pull = true` upstream.
 */
const HEALTH_TYPE_NAMES: ReadonlyMap<string, number> = new Map(
  [
    GARMIN_FILE_TYPE.MONITOR_A,
    GARMIN_FILE_TYPE.MONITOR_DAILY,
    GARMIN_FILE_TYPE.MONITOR,
    GARMIN_FILE_TYPE.SLEEP,
    GARMIN_FILE_TYPE.ACTIVITY,
    GARMIN_FILE_TYPE.HRV_STATUS,
  ].map((type) => [`FIT_TYPE_${type.subType}`, type.subType]),
);

export type GarminSyncItem = Readonly<{
  item: GarminItemReference;
  /** Canonical upstream type name, e.g. `FIT_TYPE_32`. */
  typeName: string;
  subType: number;
  /** The `ItemReference` to pull, with `data_type` rewritten as upstream. */
  request: Uint8Array;
}>;

/**
 * Re-encodes an `ItemReference` with `data_type = DataType{gdxml_string}`,
 * keeping every other field as received (`FileSyncServiceHandler.kt:284-293`).
 */
function withTypeName(item: GarminItemReference, typeName: string): Uint8Array {
  // Upstream rewrites unless the item already carries exactly this string.
  if (item.dataType?.gdxmlString === typeName) return item.raw;
  const fields = decodeMessage(item.raw, GARMIN_PROTOBUF_MAX_BYTES);
  const out: ProtoField[] = [];
  const typed = (field: number, value: ProtoValue): ProtoField =>
    ({ field, wireType: value.wireType, value: value.value }) as ProtoField;
  const numbers = [...fields.keys()].filter((number) => number !== 2).sort((a, b) => a - b);
  for (const number of numbers.filter((n) => n < 2)) {
    for (const value of fields.get(number)!) out.push(typed(number, value));
  }
  out.push(bytesField(2, encodeMessage([stringField(2, typeName)])));
  for (const number of numbers.filter((n) => n > 2)) {
    for (const value of fields.get(number)!) out.push(typed(number, value));
  }
  return encodeMessage(out);
}

/**
 * `handleItemListResponse` + `conditionallyDownload` for one response or
 * notification: resolves type names (string, else the key's string seen
 * earlier in the same message, else `DEVICE_XML`/`TYPE_<key>` for a formatted
 * type) and keeps the health FIT types this family decodes. Items of other
 * types are left on the watch untouched (upstream would pull its other
 * `pull` types too; we have no decoder for them).
 */
export function selectGarminSyncItems(items: readonly GarminItemReference[]): GarminSyncItem[] {
  const names = new Map<number, string>();
  const selected: GarminSyncItem[] = [];
  for (const item of items) {
    const dataType = item.dataType;
    if (!dataType) continue;
    if (dataType.gdxmlStringKey !== undefined && dataType.gdxmlString !== undefined) {
      names.set(dataType.gdxmlStringKey, dataType.gdxmlString);
    }
    let name: string | undefined;
    if (dataType.gdxmlString !== undefined) name = dataType.gdxmlString;
    else if (dataType.gdxmlStringKey !== undefined) name = names.get(dataType.gdxmlStringKey);
    if (!name) {
      if (dataType.format === undefined) continue;
      name = dataType.gdxmlStringKey === 3 ? "DEVICE_XML" : `TYPE_${dataType.gdxmlStringKey}`;
    }
    const canonical = name.toUpperCase();
    const subType = HEALTH_TYPE_NAMES.get(canonical);
    if (subType === undefined || !item.key || !item.uid) continue;
    selected.push({ item, typeName: canonical, subType, request: withTypeName(item, canonical) });
  }
  return selected;
}

/** True for workouts, which upstream syncs like any file but can be large. */
export function isGarminActivitySyncItem(item: GarminSyncItem): boolean {
  return item.subType === GARMIN_FILE_TYPE.ACTIVITY.subType;
}

// ---------------------------------------------------------------------------
// File transfer service stream (GarminSupport.downloadFileFromServiceV2)
// ---------------------------------------------------------------------------

/** `00 00 <transfer handle u16 LE> 00 00` (`GarminSupport.java:2038-2047`). */
export function buildGarminTransferRequest(transferHandle: number): Uint8Array {
  if (!Number.isInteger(transferHandle) || transferHandle < 0)
    throw new Error("GARMIN_TRANSFER_HANDLE");
  const out = new Uint8Array(6);
  // Upstream `putShort((short) fileHandle)` keeps the low 16 bits.
  writeUint16le(out, 2, transferHandle & 0xffff);
  return out;
}

/**
 * Collects one transfer: the first message must pass upstream's
 * `ArrayUtils.equals({0,0,0}, value, 0)`, i.e. be at most 3 bytes, all zero
 * (`GarminSupport.java:2197-2208`, `ArrayUtils.java:35-55`); every later
 * message is appended (`GarminSupport.java:2209-2211`).
 */
export class GarminTransferStream {
  private started = false;
  private readonly parts: Uint8Array[] = [];
  private held = 0;

  constructor(private readonly maxBytes: number) {}

  get size(): number {
    return this.held;
  }

  accept(message: Uint8Array): void {
    if (!this.started) {
      if (message.length > 3 || message.some((byte) => byte !== 0)) {
        throw new Error("GARMIN_TRANSFER_FIRST_MESSAGE");
      }
      this.started = true;
      return;
    }
    if (this.held + message.length > this.maxBytes) throw new Error("GARMIN_FILE_TOO_LARGE");
    this.parts.push(message.slice());
    this.held += message.length;
  }

  /** The compressed bytes; an empty buffer is a failed transfer (`GarminSupport.java:2052-2055`). */
  finish(): Uint8Array {
    if (!this.started || this.held === 0) throw new Error("GARMIN_TRANSFER_EMPTY");
    return concat(this.parts);
  }
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let offset = 0; offset < bytes.length;) {
    const end = Math.min(offset + 3800, bytes.length);
    for (; offset < end; offset += 1) {
      a += bytes[offset]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * `CompressionUtils.inflate`: a zlib stream (`java.util.zip.Inflater()`,
 * header and Adler-32 trailer). Streams through `fflate.Unzlib` so the output
 * is capped while it grows, and checks the Adler-32 that `fflate` skips.
 * Unlike upstream (whose loop never ends on a truncated stream), a truncated
 * stream is an error. INFERRED: the trailer is the last 4 bytes received.
 */
export function inflateGarminZlib(data: Uint8Array, maxBytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  let ended = false;
  const inflater = new Unzlib((chunk, final) => {
    total += chunk.length;
    if (total > maxBytes) throw new Error("GARMIN_FILE_TOO_LARGE");
    parts.push(chunk);
    if (final) ended = true;
  });
  const step = 1024;
  try {
    for (let offset = 0; offset < data.length; offset += step) {
      inflater.push(data.subarray(offset, offset + step), offset + step >= data.length);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "GARMIN_FILE_TOO_LARGE") throw error;
    throw new Error("GARMIN_INFLATE_FAILED");
  }
  if (!ended) throw new Error("GARMIN_INFLATE_FAILED");
  const out = concat(parts);
  if (data.length < 6) throw new Error("GARMIN_INFLATE_FAILED");
  const trailer =
    ((data[data.length - 4]! << 24) |
      (data[data.length - 3]! << 16) |
      (data[data.length - 2]! << 8) |
      data[data.length - 1]!) >>>
    0;
  if (trailer !== adler32(out)) throw new Error("GARMIN_INFLATE_CHECKSUM");
  return out;
}
