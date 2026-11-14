/**
 * Tests for the Garmin new-sync-protocol codec.
 *
 * Vectors are hand-encoded from `gdi_file_access.proto`, `gdi_data_types.proto`
 * and `gdi_smart_proto.proto` and the Java builders at Gadgetbridge revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2, as tabulated in
 * `docs/research/notes/Garmin MLR transport/garmin-new-sync-protocol.md`.
 * None is a hardware capture. AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import { zlibSync } from "fflate";

import {
  GARMIN_PROTOBUF_MAX_BYTES,
  GARMIN_PROTOBUF_MAX_PENDING,
  GarminProtobufReassembler,
  GarminTransferStream,
  buildGarminItemListRequest,
  buildGarminModifyFlagsRequest,
  buildGarminProtobufPayload,
  buildGarminProtobufStatus,
  buildGarminPullItemRequest,
  buildGarminTransferRequest,
  buildGarminTransferStatusResponse,
  chunkGarminProtobuf,
  decodeGarminFileAccessService,
  decodeGarminItemReference,
  decodeGarminSmartFileAccess,
  encodeGarminSmartFileAccess,
  inflateGarminZlib,
  parseGarminProtobufPayload,
  parseGarminProtobufStatus,
  selectGarminSyncItems,
} from "./garmin-new-sync";
import { bytesField, encodeMessage, stringField, varintField } from "./xiaomi-proto";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
const bytes = (text: string): Uint8Array =>
  Uint8Array.from(
    text
      .replace(/\s+/g, "")
      .match(/../g)!
      .map((pair) => Number.parseInt(pair, 16)),
  );
const ascii = (text: string) => hex(new TextEncoder().encode(text));

const SYNCED_UUID = "09 a5 a5 00 00 00 00 00 00 11 a5 a5 00 00 00 00 00 00";
/** uid {0x1122334455667788, 0x99aabbccddeeff00}, fixed64 little-endian. */
const UID = "09 88 77 66 55 44 33 22 11 11 00 ff ee dd cc bb aa 99";

function uuid(most: number, least: number): Uint8Array {
  const out = new Uint8Array(18);
  out[0] = 0x09;
  new DataView(out.buffer).setUint32(1, most, true);
  out[9] = 0x11;
  new DataView(out.buffer).setUint32(10, least, true);
  return out;
}

function item(input: {
  uid?: Uint8Array;
  name?: string;
  key?: number;
  format?: number;
  size?: number;
  modified?: number;
}): Uint8Array {
  const dataType = [
    ...(input.format === undefined ? [] : [varintField(1, input.format)]),
    ...(input.name === undefined ? [] : [stringField(2, input.name)]),
    ...(input.key === undefined ? [] : [varintField(3, input.key)]),
  ];
  return encodeMessage([
    bytesField(1, input.uid ?? uuid(1, 1)),
    ...(dataType.length ? [bytesField(2, encodeMessage(dataType))] : []),
    ...(input.size === undefined ? [] : [varintField(3, input.size)]),
    ...(input.modified === undefined ? [] : [varintField(7, input.modified)]),
  ]);
}

// ---------------------------------------------------------------------------
// Protobuf vectors (spec §4)
// ---------------------------------------------------------------------------

test("ItemListRequest vectors match FileSyncServiceHandler.requestFileList", () => {
  const first = buildGarminItemListRequest();
  expect(hex(first)).toBe(`4a 28 22 12 ${SYNCED_UUID} 2a 12 ${SYNCED_UUID}`);
  // Smart{43: …}: tag 43 << 3 | 2 = 346 = da 02; 45 bytes in all.
  const smart = encodeGarminSmartFileAccess(first);
  expect(smart).toHaveLength(45);
  expect(hex(smart.subarray(0, 3))).toBe("da 02 2a");
  expect(decodeGarminSmartFileAccess(smart)).toEqual(first);
  // A cursor takes precedence over a page id.
  expect(hex(buildGarminItemListRequest({ sessionId: 7, transactionId: 9 }))).toBe(
    `4a 2a 08 07 22 12 ${SYNCED_UUID} 2a 12 ${SYNCED_UUID}`,
  );
  expect(hex(buildGarminItemListRequest({ transactionId: 300 }))).toBe(
    `4a 2b 10 ac 02 22 12 ${SYNCED_UUID} 2a 12 ${SYNCED_UUID}`,
  );
});

test("PullItemDataRequest vector matches FileSyncServiceHandler.requestFile", () => {
  const reference = bytes(`0a 12 ${UID} 12 0d 12 0b ${ascii("FIT_TYPE_32")}`);
  expect(hex(buildGarminPullItemRequest(reference))).toBe(
    `0a 2d 0a 23 ${hex(reference)} 10 18 18 00 20 00 28 0f`,
  );
});

test("ModifyFlagsRequest and TransferStatusResponse vectors", () => {
  expect(hex(buildGarminModifyFlagsRequest(bytes(UID)))).toBe(
    `7a 28 0a 12 ${UID} 12 12 ${SYNCED_UUID}`,
  );
  const reply = buildGarminTransferStatusResponse();
  expect(hex(reply)).toBe("aa 01 02 08 01");
  expect(hex(encodeGarminSmartFileAccess(reply))).toBe("da 02 05 aa 01 02 08 01");
});

test("the transfer request is 00 00 <handle LE16> 00 00", () => {
  expect(hex(buildGarminTransferRequest(0x1234))).toBe("00 00 34 12 00 00");
  expect(hex(buildGarminTransferRequest(0x12345))).toBe("00 00 45 23 00 00");
});

// ---------------------------------------------------------------------------
// GFDI protobuf carriage (spec §3)
// ---------------------------------------------------------------------------

test("protobuf payloads and statuses have upstream's layout", () => {
  const payload = buildGarminProtobufPayload({
    requestId: 0x0102,
    dataOffset: 5,
    totalLength: 9,
    data: Uint8Array.of(0xaa, 0xbb),
  });
  expect(hex(payload)).toBe("02 01 05 00 00 00 09 00 00 00 02 00 00 00 aa bb");
  expect(parseGarminProtobufPayload(payload)).toEqual({
    requestId: 0x0102,
    dataOffset: 5,
    totalLength: 9,
    data: Uint8Array.of(0xaa, 0xbb),
  });
  expect(() => parseGarminProtobufPayload(payload.subarray(0, 15))).toThrow(
    "GARMIN_PROTOBUF_TRUNCATED",
  );
  const status = buildGarminProtobufStatus({
    originalMessageType: 5044,
    requestId: 3,
    dataOffset: 0,
    chunkStatus: 1,
    statusCode: 100,
  });
  expect(hex(status)).toBe("b4 13 00 03 00 00 00 00 00 01 64");
  expect(parseGarminProtobufStatus(status)).toMatchObject({ requestId: 3, ok: false });
  const ok = buildGarminProtobufStatus({
    originalMessageType: 5043,
    requestId: 9,
    dataOffset: 355,
    chunkStatus: 0,
    statusCode: 0,
  });
  expect(parseGarminProtobufStatus(ok)).toMatchObject({ requestId: 9, dataOffset: 355, ok: true });
  // A download status (5002) is not a protobuf status.
  expect(parseGarminProtobufStatus(bytes("8a 13 00 00 00 00 00 00 00 00 00"))).toBeNull();
});

test("outgoing protobufs are chunked at maxChunkSize", () => {
  const data = Uint8Array.from({ length: 10 }, (_, index) => index);
  const chunks = chunkGarminProtobuf(4, data, 4);
  expect(chunks.map((chunk) => [chunk.dataOffset, chunk.totalLength, chunk.data.length])).toEqual([
    [0, 10, 4],
    [4, 10, 4],
    [8, 10, 2],
  ]);
  expect(chunkGarminProtobuf(4, data, 375)).toHaveLength(1);
});

test("incoming protobufs reassemble in order and drop what upstream cannot merge", () => {
  const assembler = new GarminProtobufReassembler();
  expect(
    assembler.accept({ requestId: 1, dataOffset: 0, totalLength: 2, data: Uint8Array.of(1, 2) }),
  ).toEqual({ kind: "complete", bytes: Uint8Array.of(1, 2), single: true });
  expect(
    assembler.accept({ requestId: 2, dataOffset: 0, totalLength: 5, data: Uint8Array.of(1, 2) }),
  ).toEqual({ kind: "chunk" });
  expect(
    assembler.accept({ requestId: 2, dataOffset: 2, totalLength: 5, data: Uint8Array.of(3, 4, 5) }),
  ).toEqual({ kind: "complete", bytes: Uint8Array.of(1, 2, 3, 4, 5), single: false });
  // A gap, an unknown request id and an oversize total are dropped.
  assembler.accept({ requestId: 3, dataOffset: 0, totalLength: 6, data: Uint8Array.of(1, 2) });
  expect(
    assembler.accept({ requestId: 3, dataOffset: 3, totalLength: 6, data: Uint8Array.of(4) }),
  ).toEqual({ kind: "dropped" });
  expect(
    assembler.accept({ requestId: 3, dataOffset: 2, totalLength: 6, data: Uint8Array.of(3) }),
  ).toEqual({ kind: "dropped" });
  expect(
    assembler.accept({
      requestId: 4,
      dataOffset: 0,
      totalLength: GARMIN_PROTOBUF_MAX_BYTES + 1,
      data: Uint8Array.of(1),
    }),
  ).toEqual({ kind: "dropped" });
  // Overlong data for its total is dropped too.
  assembler.accept({ requestId: 5, dataOffset: 0, totalLength: 3, data: Uint8Array.of(1, 2) });
  expect(
    assembler.accept({ requestId: 5, dataOffset: 2, totalLength: 3, data: Uint8Array.of(3, 4) }),
  ).toEqual({ kind: "dropped" });
});

test("at most a few protobufs are reassembled at once", () => {
  const assembler = new GarminProtobufReassembler();
  for (let id = 0; id <= GARMIN_PROTOBUF_MAX_PENDING; id += 1) {
    assembler.accept({ requestId: id, dataOffset: 0, totalLength: 3, data: Uint8Array.of(1) });
  }
  // The oldest (id 0) was evicted.
  expect(
    assembler.accept({ requestId: 0, dataOffset: 1, totalLength: 3, data: Uint8Array.of(2, 3) }),
  ).toEqual({ kind: "dropped" });
  expect(
    assembler.accept({ requestId: 1, dataOffset: 1, totalLength: 3, data: Uint8Array.of(2, 3) })
      .kind,
  ).toBe("complete");
});

// ---------------------------------------------------------------------------
// FileAccess decode and file selection (spec §4.3-4.4)
// ---------------------------------------------------------------------------

test("an ItemListResponse decodes status, cursor, page id and items", () => {
  const first = item({ uid: bytes(UID), name: "FIT_TYPE_32", key: 32, size: 1234, modified: 99 });
  const service = encodeMessage([
    bytesField(
      10,
      encodeMessage([
        varintField(1, 0),
        varintField(2, 17),
        varintField(3, 40),
        bytesField(4, first),
      ]),
    ),
  ]);
  const message = decodeGarminFileAccessService(service);
  expect(message).toMatchObject({
    kind: "item_list_response",
    status: 0,
    sessionId: 17,
    nextTransactionId: 40,
  });
  if (message.kind !== "item_list_response") throw new Error("kind");
  expect(message.items[0]).toEqual({
    raw: first,
    uid: bytes(UID),
    key: "uid:8877665544332211:00ffeeddccbbaa99",
    dataType: { format: undefined, gdxmlString: "FIT_TYPE_32", gdxmlStringKey: 32 },
    dataSize: 1234,
    modifiedTime: 99,
  });
});

test("FileAccess messages dispatch in FileSyncServiceHandler.handle order", () => {
  const pull = encodeMessage([
    bytesField(2, encodeMessage([varintField(1, 0), varintField(3, 0x2a)])),
  ]);
  expect(decodeGarminFileAccessService(pull)).toEqual({
    kind: "pull_item_response",
    result: 0,
    transferHandle: 0x2a,
  });
  // ItemAddedNotification wins over an ItemListResponse in the same Service.
  const both = encodeMessage([
    bytesField(10, encodeMessage([])),
    bytesField(12, encodeMessage([bytesField(1, item({ name: "FIT_TYPE_49" }))])),
  ]);
  expect(decodeGarminFileAccessService(both).kind).toBe("item_added_notification");
  expect(decodeGarminFileAccessService(bytesFieldOnly(5)).kind).toBe("transfer_status_request");
  expect(decodeGarminFileAccessService(bytesFieldOnly(16)).kind).toBe("modify_flags_response");
  expect(decodeGarminFileAccessService(bytesFieldOnly(22)).kind).toBe("sync_button_notification");
  expect(decodeGarminFileAccessService(bytesFieldOnly(3)).kind).toBe("unhandled");
  expect(decodeGarminSmartFileAccess(encodeMessage([bytesField(13, Uint8Array.of())]))).toBeNull();
});

function bytesFieldOnly(field: number): Uint8Array {
  return encodeMessage([bytesField(field, new Uint8Array(0))]);
}

test("selection keeps the health FIT types, resolving names like upstream", () => {
  const items = [
    item({ uid: uuid(1, 1), name: "FIT_TYPE_32", key: 32 }),
    item({ uid: uuid(2, 2), key: 32 }), // name from the key seen above
    item({ uid: uuid(3, 3), name: "fit_type_49" }), // case-insensitive
    item({ uid: uuid(4, 4), name: "FIT_TYPE_44" }), // METRICS: not decoded here
    item({ uid: uuid(5, 5), format: 0, key: 3 }), // DEVICE_XML
    item({ uid: uuid(6, 6), format: 0, key: 77 }), // TYPE_77
    item({ uid: uuid(7, 7), key: 4 }), // key never named: ignored
    encodeMessage([bytesField(1, uuid(8, 8))]), // no data type
    item({ uid: uuid(9, 9), name: "FIT_TYPE_4" }),
    item({ uid: uuid(10, 10), name: "FIT_TYPE_68", size: 10 }),
  ].map(decodeGarminItemReference);
  const selected = selectGarminSyncItems(items);
  expect(selected.map((entry) => [entry.typeName, entry.subType])).toEqual([
    ["FIT_TYPE_32", 32],
    ["FIT_TYPE_32", 32],
    ["FIT_TYPE_49", 49],
    ["FIT_TYPE_4", 4],
    ["FIT_TYPE_68", 68],
  ]);
  // Exactly the canonical string: the item is re-sent as received.
  expect(selected[0]!.request).toEqual(items[0]!.raw);
  // Otherwise data_type becomes DataType{gdxml_string}; other fields stay.
  const rewritten = decodeGarminItemReference(selected[1]!.request);
  expect(rewritten.uid).toEqual(items[1]!.uid);
  expect(rewritten.dataType).toEqual({
    format: undefined,
    gdxmlString: "FIT_TYPE_32",
    gdxmlStringKey: undefined,
  });
  // Names from keys live per response (`FileSyncServiceHandler.kt:136`): a
  // key-only item in a later page stays unnamed and is ignored.
  expect(selectGarminSyncItems([items[1]!])).toEqual([]);
  const sized = decodeGarminItemReference(selected[4]!.request);
  expect(sized.dataSize).toBe(10);
  expect(
    decodeGarminItemReference(selectGarminSyncItems([items[2]!])[0]!.request).dataType,
  ).toEqual({ format: undefined, gdxmlString: "FIT_TYPE_49", gdxmlStringKey: undefined });
});

// ---------------------------------------------------------------------------
// Transfer stream and zlib (spec §5)
// ---------------------------------------------------------------------------

test("the first transfer message must be at most three zero bytes", () => {
  for (const first of [[0, 0, 0], [0, 0], [0], []]) {
    const stream = new GarminTransferStream(100);
    stream.accept(Uint8Array.from(first));
    stream.accept(Uint8Array.of(1, 2));
    stream.accept(Uint8Array.of(3));
    expect(stream.finish()).toEqual(Uint8Array.of(1, 2, 3));
  }
  for (const first of [[0, 0, 0, 0], [0, 1], [1]]) {
    expect(() => new GarminTransferStream(100).accept(Uint8Array.from(first))).toThrow(
      "GARMIN_TRANSFER_FIRST_MESSAGE",
    );
  }
  const empty = new GarminTransferStream(100);
  expect(() => empty.finish()).toThrow("GARMIN_TRANSFER_EMPTY");
  empty.accept(Uint8Array.of(0, 0, 0));
  expect(() => empty.finish()).toThrow("GARMIN_TRANSFER_EMPTY");
  const capped = new GarminTransferStream(3);
  capped.accept(Uint8Array.of(0, 0, 0));
  capped.accept(Uint8Array.of(1, 2, 3));
  expect(() => capped.accept(Uint8Array.of(4))).toThrow("GARMIN_FILE_TOO_LARGE");
});

test("zlib streams inflate, with the size capped and the checksum verified", () => {
  const original = Uint8Array.from({ length: 20_000 }, (_, index) => (index * 31) % 253);
  const compressed = zlibSync(original);
  expect(hex(compressed.subarray(0, 1))).toBe("78");
  expect(inflateGarminZlib(compressed, original.length)).toEqual(original);
  expect(() => inflateGarminZlib(compressed, original.length - 1)).toThrow("GARMIN_FILE_TOO_LARGE");
  expect(() => inflateGarminZlib(compressed.subarray(0, compressed.length - 10), 1e6)).toThrow(
    "GARMIN_INFLATE_FAILED",
  );
  const corrupt = compressed.slice();
  corrupt[corrupt.length - 1] ^= 1;
  expect(() => inflateGarminZlib(corrupt, 1e6)).toThrow("GARMIN_INFLATE_CHECKSUM");
  expect(() => inflateGarminZlib(Uint8Array.of(1, 2, 3, 4, 5, 6, 7), 1e6)).toThrow(
    "GARMIN_INFLATE_FAILED",
  );
});

test("review cases: trailing bytes, lenient fields, notification names, empty chunks", () => {
  const original = Uint8Array.from({ length: 300 }, (_, index) => index & 0xff);
  const compressed = zlibSync(original);
  // A few bytes after the zlib trailer are tolerated, as `Inflater` would.
  expect(inflateGarminZlib(Uint8Array.from([...compressed, 1, 2]), 1e6)).toEqual(original);
  // A known field with an unexpected wire type is treated as absent.
  const odd = encodeMessage([
    bytesField(1, uuid(1, 1)),
    bytesField(2, encodeMessage([stringField(2, "FIT_TYPE_32")])),
    bytesField(3, Uint8Array.of(1)), // data_size as bytes
  ]);
  expect(decodeGarminItemReference(odd).dataSize).toBeNull();
  // A malformed item is dropped; the rest of the list survives.
  const list = encodeMessage([
    bytesField(
      10,
      encodeMessage([
        bytesField(4, Uint8Array.of(0x0a, 0x7f)),
        bytesField(4, item({ name: "FIT_TYPE_49" })),
      ]),
    ),
  ]);
  const decoded = decodeGarminFileAccessService(list);
  expect(decoded.kind === "item_list_response" && decoded.items.length).toBe(1);
  // Notifications resolve no names from keys (`FileSyncServiceHandler.kt:97`).
  const named = [
    item({ uid: uuid(1, 1), name: "FIT_TYPE_32", key: 32 }),
    item({ uid: uuid(2, 2), key: 32 }),
  ].map(decodeGarminItemReference);
  expect(selectGarminSyncItems(named, { resolveKeys: false })).toHaveLength(1);
  expect(selectGarminSyncItems(named)).toHaveLength(2);
  // A zero-length continuation chunk does not grow the buffer.
  const assembler = new GarminProtobufReassembler();
  assembler.accept({ requestId: 1, dataOffset: 0, totalLength: 3, data: Uint8Array.of(1) });
  expect(
    assembler.accept({ requestId: 1, dataOffset: 1, totalLength: 3, data: new Uint8Array(0) }),
  ).toEqual({ kind: "dropped" });
});
