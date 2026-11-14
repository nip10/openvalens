/**
 * Session tests for the Garmin "new sync protocol" over ML and MLR.
 *
 * The fake watch follows `FileSyncServiceHandler.kt`, `ProtocolBufferHandler`
 * and `GarminSupport.downloadFileFromServiceV2` at Gadgetbridge revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 (see
 * `docs/research/notes/Garmin MLR transport/garmin-new-sync-protocol.md`). It
 * is a test double built from the spec, not a hardware capture.
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import { zlibSync } from "fflate";

import {
  GARMIN_FIT_MESSAGE,
  GARMIN_MESSAGE,
  GARMIN_ML_REQUEST,
  GarminCobsDecoder,
  decodeGarminGfdiFrame,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  garminCrc16,
  garminFitRecords,
  parseGarminMlMessage,
  type GarminGfdiFrame,
  type GarminRecord,
} from "../protocol/garmin";
import { decodeGarminMlrHeader, encodeGarminMlrPacket } from "../protocol/garmin-mlr";
import {
  GARMIN_FILE_ACCESS,
  GarminProtobufReassembler,
  buildGarminProtobufPayload,
  buildGarminProtobufStatus,
  chunkGarminProtobuf,
  decodeGarminSmartFileAccess,
  encodeGarminSmartFileAccess,
  parseGarminProtobufPayload,
} from "../protocol/garmin-new-sync";
import {
  bytesField,
  decodeMessage,
  encodeMessage,
  stringField,
  varintField,
} from "../protocol/xiaomi-proto";
import {
  createGarminSession,
  createMemoryGarminSyncStateStore,
  type GarminSessionLink,
} from "./garmin";

// ---------------------------------------------------------------------------
// FIT fixtures
// ---------------------------------------------------------------------------

const UINT8 = 0x02;
const UINT32 = 0x86;
const ENUM = 0x00;

function writeUint32(out: Uint8Array, offset: number, value: number): void {
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

type Field = readonly [number, number, number];

function fitFile(messageNumber: number, fields: readonly Field[], rows: number[][]): Uint8Array {
  const definition = [0x40, 0, 0, messageNumber & 0xff, messageNumber >> 8, fields.length];
  for (const [number, size, base] of fields) definition.push(number, size, base);
  const records = [Uint8Array.from(definition)];
  for (const row of rows) {
    const out = [0];
    fields.forEach(([, size], index) => {
      for (let byte = 0; byte < size; byte += 1) out.push((row[index]! >>> (8 * byte)) & 0xff);
    });
    records.push(Uint8Array.from(out));
  }
  const body = concat(records);
  const header = new Uint8Array(14);
  header[0] = 14;
  header[1] = 0x10;
  writeUint32(header, 4, body.length);
  writeUint32(header, 8, 0x5449462e);
  const withoutCrc = concat([header, body]);
  const crc = garminCrc16(withoutCrc);
  return concat([withoutCrc, Uint8Array.of(crc & 0xff, crc >> 8)]);
}

const MONITORING_FIT = fitFile(
  GARMIN_FIT_MESSAGE.MONITORING,
  [
    [253, 4, UINT32],
    [3, 4, UINT32],
    [27, 1, UINT8],
  ],
  [
    [0x50000, 120, 70],
    [0x50000 + 60, 128, 72],
  ],
);
const SLEEP_FIT = concat([
  fitFile(
    GARMIN_FIT_MESSAGE.EVENT,
    [
      [0, 1, ENUM],
      [1, 1, ENUM],
      [253, 4, UINT32],
    ],
    [
      [74, 0, 0x60000],
      [74, 1, 0x60000 + 90 * 60],
    ],
  ),
]);
const HRV_FIT = fitFile(
  GARMIN_FIT_MESSAGE.HRV_STATUS_SUMMARY,
  [
    [253, 4, UINT32],
    [0, 2, 0x84],
    [1, 2, 0x84],
  ],
  [[0x80000, 50 * 128, 5325]],
);

// ---------------------------------------------------------------------------
// Fake watch
// ---------------------------------------------------------------------------

type WatchFile = {
  uid: number;
  name?: string;
  key?: number;
  bytes: Uint8Array;
  /** Override the compressed stream (e.g. corrupt). */
  stream?: Uint8Array;
  /** Override the first transfer message. */
  first?: Uint8Array;
  pullResult?: number;
  /** Stop after the first message: no data, no close. */
  stall?: boolean;
};

type Peer = { handle: number; expected: number; nextSeq: number };

function uuid(value: number): Uint8Array {
  const out = new Uint8Array(18);
  out[0] = 0x09;
  writeUint32(out, 1, value);
  out[9] = 0x11;
  writeUint32(out, 10, value);
  return out;
}

function itemReference(file: WatchFile): Uint8Array {
  const dataType = [
    ...(file.name === undefined ? [] : [stringField(2, file.name)]),
    ...(file.key === undefined ? [] : [varintField(3, file.key)]),
  ];
  return encodeMessage([
    bytesField(1, uuid(file.uid)),
    bytesField(2, encodeMessage(dataType)),
    varintField(3, file.bytes.length),
  ]);
}

function uidOf(raw: Uint8Array): number {
  const uid = decodeMessage(raw).get(1)![0]!.value as Uint8Array;
  const most = decodeMessage(uid).get(1)![0]!.value as Uint8Array;
  return most[0]! | (most[1]! << 8) | (most[2]! << 16) | (most[3]! << 24);
}

function service(field: number, body: Uint8Array): Uint8Array {
  return encodeMessage([bytesField(field, body)]);
}

class NewSyncWatch implements GarminSessionLink {
  readonly protocol = "v2" as const;
  readonly maxWriteBytes = 244;
  /** Grant MLR when asked. */
  mlr = false;
  /** Pages of the file list (file uids per page). */
  pages: number[][] = [];
  files = new Map<number, WatchFile>();
  /** Data bytes per transfer packet. */
  chunk = 50;
  /** Max protobuf bytes per GFDI message the watch sends (chunked above). */
  protobufChunk = 10_000;
  /** Send a TransferStatusRequest before answering the first pull. */
  askTransferStatus = false;
  /** Send an ItemAddedNotification for this file during the first transfer. */
  announce: WatchFile | null = null;
  /** Send a non-file-access protobuf (core service) right after the handshake. */
  sendCoreRequest = false;
  /** DEVICE_INFORMATION max packet size (sets the phone's protobuf chunk). */
  maxPacket = 375;
  /** Plain ML handle granted to a transfer service. */
  transferHandle = 0x2e;
  /** Per-transfer grant behaviour, consumed in order. */
  transferGrants: ("ok" | "refuse" | "ignore")[] = [];
  /** Delay before the watch closes a finished transfer handle. */
  closeDelayMs = 0;
  readonly transferRegistrations: number[] = [];
  /** Protobuf chunks the phone sent, as [requestId, offset, length]. */
  readonly protobufChunks: number[][] = [];
  private readonly incoming = new GarminProtobufReassembler();

  readonly raw: Uint8Array[] = [];
  readonly gfdi: GarminGfdiFrame[] = [];
  readonly protobufs: { type: number; requestId: number; service: Uint8Array | null }[] = [];
  readonly pulled: number[] = [];
  readonly marked: number[] = [];
  readonly transferRequests: Uint8Array[] = [];
  readonly closedByPhone: number[] = [];
  private listener: ((bytes: Uint8Array) => void) | null = null;
  private gfdiHandle = 0;
  private gfdiPeer: Peer | null = null;
  private readonly gfdiDecoder = new GarminCobsDecoder();
  private transfer: { service: number; handle: number; peer: Peer | null } | null = null;
  private pendingFile: WatchFile | null = null;
  private page = 0;
  private watchRequestId = 100;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  subscribeRaw(onNotification: (bytes: Uint8Array) => void): () => void {
    this.listener = onNotification;
    return () => {
      this.listener = null;
    };
  }

  setHandle(): void {}

  async close(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.listener = null;
  }

  private later(callback: () => void, ms = 1): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, ms);
    this.timers.add(timer);
  }

  private notify(bytes: Uint8Array): void {
    this.listener?.(bytes);
  }

  private management(type: number, body: number[]): Uint8Array {
    const out = new Uint8Array(10 + body.length);
    out[1] = type;
    writeUint32(out, 2, 2);
    out.set(body, 10);
    return out;
  }

  private sendData(peer: Peer | null, handle: number, data: Uint8Array): void {
    if (!peer) {
      this.notify(Uint8Array.of(handle, ...data));
      return;
    }
    this.notify(encodeGarminMlrPacket(peer.handle, peer.expected, peer.nextSeq, data));
    peer.nextSeq = (peer.nextSeq + 1) % 64;
  }

  emit(frame: GarminGfdiFrame): void {
    const encoded = encodeGarminCobs(encodeGarminGfdiFrame(frame));
    for (let offset = 0; offset < encoded.length; offset += 60) {
      this.sendData(this.gfdiPeer, this.gfdiHandle, encoded.subarray(offset, offset + 60));
    }
  }

  emitProtobuf(type: number, requestId: number, serviceBytes: Uint8Array): void {
    const smart = encodeGarminSmartFileAccess(serviceBytes);
    for (const chunk of chunkGarminProtobuf(requestId, smart, this.protobufChunk)) {
      this.emit({ messageType: type, payload: buildGarminProtobufPayload(chunk) });
    }
  }

  async writeRaw(bytes: Uint8Array): Promise<void> {
    this.raw.push(bytes);
    const message = parseGarminMlMessage(bytes);
    if (!message) return;
    if (message.requestType === GARMIN_ML_REQUEST.CLOSE_ALL_REQ) {
      this.notify(this.management(GARMIN_ML_REQUEST.CLOSE_ALL_RESP, [0, 0, 0]));
      return;
    }
    if (message.requestType === GARMIN_ML_REQUEST.CLOSE_HANDLE_REQ) {
      this.closedByPhone.push(message.service!);
      const service = message.service!;
      this.later(() =>
        this.notify(
          this.management(GARMIN_ML_REQUEST.CLOSE_HANDLE_RESP, [
            service & 0xff,
            service >> 8,
            bytes[12]!,
            0,
          ]),
        ),
      );
      return;
    }
    if (message.requestType !== GARMIN_ML_REQUEST.REGISTER_ML_REQ) return;
    const service = message.service!;
    const reliable = this.mlr && bytes[12] === 2;
    if (service === 1) {
      this.gfdiHandle = reliable ? 0x86 : 5;
      this.gfdiPeer = reliable ? { handle: 0x86, expected: 0, nextSeq: 0 } : null;
      this.notify(
        this.management(GARMIN_ML_REQUEST.REGISTER_ML_RESP, [
          1,
          0,
          0,
          this.gfdiHandle,
          reliable ? 1 : 0,
        ]),
      );
      // protocol 150, max packet `maxPacket`.
      this.emit({
        messageType: GARMIN_MESSAGE.DEVICE_INFORMATION,
        payload: Uint8Array.of(
          150,
          0,
          0xdb,
          0x0c,
          0xd2,
          4,
          0,
          0,
          0xd0,
          7,
          this.maxPacket & 0xff,
          this.maxPacket >> 8,
          0,
          0,
          0,
        ),
      });
      return;
    }
    this.transferRegistrations.push(service);
    const grant = this.transferGrants.shift() ?? "ok";
    if (grant === "ignore") return;
    if (grant === "refuse") {
      // A 13-byte refusal: status, no handle (`CommunicatorV2:359-367`).
      this.later(() =>
        this.notify(
          this.management(GARMIN_ML_REQUEST.REGISTER_ML_RESP, [service & 0xff, service >> 8, 4]),
        ),
      );
      return;
    }
    const handle = reliable ? 0x87 : this.transferHandle;
    this.transfer = {
      service,
      handle,
      peer: reliable ? { handle, expected: 0, nextSeq: 0 } : null,
    };
    this.later(() =>
      this.notify(
        this.management(GARMIN_ML_REQUEST.REGISTER_ML_RESP, [
          service & 0xff,
          service >> 8,
          0,
          handle,
          reliable ? 1 : 0,
        ]),
      ),
    );
  }

  async writePacket(bytes: Uint8Array): Promise<void> {
    await Promise.resolve();
    const transfer = this.transfer;
    if (transfer && !transfer.peer && bytes[0] === transfer.handle) {
      this.onTransferRequest(bytes.subarray(1));
      return;
    }
    if ((bytes[0]! & 0x80) === 0) return;
    const header = decodeGarminMlrHeader(bytes[0]!, bytes[1]!);
    const peer =
      this.gfdiPeer && header.handle === (this.gfdiPeer.handle & 7)
        ? this.gfdiPeer
        : transfer?.peer && header.handle === (transfer.peer.handle & 7)
          ? transfer.peer
          : null;
    if (!peer || bytes.length <= 2 || header.seqNum !== peer.expected) return;
    peer.expected = (peer.expected + 1) % 64;
    this.notify(encodeGarminMlrPacket(peer.handle, peer.expected, 0));
    if (peer === this.gfdiPeer) {
      let message = this.gfdiDecoder.accept(bytes.subarray(2));
      while (message) {
        this.handleFrame(decodeGarminGfdiFrame(message));
        message = this.gfdiDecoder.accept(new Uint8Array(0));
      }
    } else {
      this.onTransferRequest(bytes.subarray(2));
    }
  }

  async write(frame: GarminGfdiFrame): Promise<void> {
    this.handleFrame(frame);
  }

  private handleFrame(frame: GarminGfdiFrame): void {
    this.gfdi.push(frame);
    const original = frame.payload[0]! | (frame.payload[1]! << 8);
    if (
      frame.messageType === GARMIN_MESSAGE.RESPONSE &&
      original === GARMIN_MESSAGE.DEVICE_INFORMATION &&
      frame.payload.length > 3
    ) {
      this.emit({ messageType: GARMIN_MESSAGE.CONFIGURATION, payload: Uint8Array.of(2, 1, 0x80) });
      if (this.sendCoreRequest) {
        // Smart{13: CoreService{}}: not file access.
        const smart = encodeMessage([bytesField(13, new Uint8Array(0))]);
        this.emit({
          messageType: GARMIN_MESSAGE.PROTOBUF_REQUEST,
          payload: buildGarminProtobufPayload({
            requestId: 77,
            dataOffset: 0,
            totalLength: smart.length,
            data: smart,
          }),
        });
      }
      return;
    }
    if (frame.messageType === GARMIN_MESSAGE.DOWNLOAD_REQUEST) {
      // The legacy directory "flush": an empty directory (one sentinel).
      const status = new Uint8Array(8);
      status[0] = 0x8a;
      status[1] = 0x13;
      writeUint32(status, 4, 16);
      this.emit({ messageType: GARMIN_MESSAGE.RESPONSE, payload: status });
      const chunk = new Uint8Array(7 + 16);
      const crc = garminCrc16(new Uint8Array(16));
      chunk[1] = crc & 0xff;
      chunk[2] = crc >> 8;
      this.later(() =>
        this.emit({ messageType: GARMIN_MESSAGE.FILE_TRANSFER_DATA, payload: chunk }),
      );
      return;
    }
    if (
      frame.messageType !== GARMIN_MESSAGE.PROTOBUF_REQUEST &&
      frame.messageType !== GARMIN_MESSAGE.PROTOBUF_RESPONSE
    )
      return;
    const chunk = parseGarminProtobufPayload(frame.payload);
    this.protobufChunks.push([chunk.requestId, chunk.dataOffset, chunk.data.length]);
    const accepted = this.incoming.accept(chunk);
    if (accepted.kind !== "complete") {
      // The watch keeps the chunk and asks for the next one (`ProtobufStatusMessage`).
      this.emit({
        messageType: GARMIN_MESSAGE.RESPONSE,
        payload: buildGarminProtobufStatus({
          originalMessageType: frame.messageType,
          requestId: chunk.requestId,
          dataOffset: chunk.dataOffset,
          chunkStatus: 0,
          statusCode: 0,
        }),
      });
      return;
    }
    const serviceBytes = decodeGarminSmartFileAccess(accepted.bytes);
    this.protobufs.push({
      type: frame.messageType,
      requestId: chunk.requestId,
      service: serviceBytes,
    });
    if (!serviceBytes || frame.messageType !== GARMIN_MESSAGE.PROTOBUF_REQUEST) return;
    const fields = decodeMessage(serviceBytes);
    const reply = (field: number, body: Uint8Array) =>
      this.later(() =>
        this.emitProtobuf(GARMIN_MESSAGE.PROTOBUF_RESPONSE, chunk.requestId, service(field, body)),
      );
    if (fields.has(GARMIN_FILE_ACCESS.ITEM_LIST_REQUEST)) {
      const uids = this.pages[this.page] ?? [];
      const last = this.page >= this.pages.length - 1;
      this.page += 1;
      reply(
        GARMIN_FILE_ACCESS.ITEM_LIST_RESPONSE,
        encodeMessage([
          varintField(1, 0),
          ...(last ? [] : [varintField(2, 5)]),
          ...uids.map((uid) => bytesField(4, itemReference(this.files.get(uid)!))),
        ]),
      );
      return;
    }
    if (fields.has(GARMIN_FILE_ACCESS.PULL_ITEM_REQUEST)) {
      const request = decodeMessage(fields.get(1)![0]!.value as Uint8Array);
      const uid = uidOf(request.get(1)![0]!.value as Uint8Array);
      this.pulled.push(uid);
      this.pendingFile = this.files.get(uid)!;
      if (this.askTransferStatus) {
        this.askTransferStatus = false;
        this.watchRequestId += 1;
        const id = this.watchRequestId;
        this.later(() =>
          this.emitProtobuf(
            GARMIN_MESSAGE.PROTOBUF_REQUEST,
            id,
            service(GARMIN_FILE_ACCESS.TRANSFER_STATUS_REQUEST, encodeMessage([varintField(2, 9)])),
          ),
        );
      }
      reply(
        GARMIN_FILE_ACCESS.PULL_ITEM_RESPONSE,
        encodeMessage([varintField(1, this.pendingFile.pullResult ?? 0), varintField(3, 0x1234)]),
      );
      return;
    }
    if (fields.has(GARMIN_FILE_ACCESS.MODIFY_FLAGS_REQUEST)) {
      const request = decodeMessage(
        fields.get(GARMIN_FILE_ACCESS.MODIFY_FLAGS_REQUEST)![0]!.value as Uint8Array,
      );
      this.marked.push(
        uidOf(encodeMessage([bytesField(1, request.get(1)![0]!.value as Uint8Array)])),
      );
      reply(GARMIN_FILE_ACCESS.MODIFY_FLAGS_RESPONSE, encodeMessage([varintField(1, 0)]));
    }
  }

  private onTransferRequest(request: Uint8Array): void {
    this.transferRequests.push(request.slice());
    const transfer = this.transfer!;
    const file = this.pendingFile!;
    const stream = file.stream ?? zlibSync(file.bytes);
    this.later(() => {
      this.sendData(transfer.peer, transfer.handle, file.first ?? Uint8Array.of(0, 0, 0));
      if (this.announce) {
        const announced = this.announce;
        this.announce = null;
        this.files.set(announced.uid, announced);
        this.watchRequestId += 1;
        this.emitProtobuf(
          GARMIN_MESSAGE.PROTOBUF_REQUEST,
          this.watchRequestId,
          service(
            GARMIN_FILE_ACCESS.ITEM_ADDED_NOTIFICATION,
            encodeMessage([bytesField(1, itemReference(announced))]),
          ),
        );
      }
      if (file.stall) return;
      for (let offset = 0; offset < stream.length; offset += this.chunk) {
        this.sendData(transfer.peer, transfer.handle, stream.subarray(offset, offset + this.chunk));
      }
      // The watch ends the file by closing the handle.
      const close = () =>
        this.notify(
          this.management(GARMIN_ML_REQUEST.CLOSE_HANDLE_RESP, [
            transfer.service & 0xff,
            transfer.service >> 8,
            transfer.handle,
            0,
          ]),
        );
      if (this.closeDelayMs > 0) this.later(close, this.closeDelayMs);
      else close();
    });
  }

  /** Statuses the phone sent for protobufs, as [type, requestId?, chunk, code]. */
  protobufStatuses(): number[][] {
    return this.gfdi
      .filter((frame) => {
        const original = frame.payload[0]! | (frame.payload[1]! << 8);
        return (
          frame.messageType === GARMIN_MESSAGE.RESPONSE &&
          (original === GARMIN_MESSAGE.PROTOBUF_REQUEST ||
            original === GARMIN_MESSAGE.PROTOBUF_RESPONSE)
        );
      })
      .map((frame) =>
        frame.payload.length === 3
          ? [frame.payload[0]! | (frame.payload[1]! << 8)]
          : [
              frame.payload[0]! | (frame.payload[1]! << 8),
              frame.payload[3]! | (frame.payload[4]! << 8),
              frame.payload[9]!,
              frame.payload[10]!,
            ],
      );
  }

  systemEvents(): number[] {
    return this.gfdi
      .filter((frame) => frame.messageType === GARMIN_MESSAGE.SYSTEM_EVENT)
      .map((frame) => frame.payload[0]!);
  }
}

const FILES: WatchFile[] = [
  { uid: 0x11, name: "FIT_TYPE_32", key: 32, bytes: MONITORING_FIT },
  { uid: 0x12, name: "FIT_TYPE_49", key: 49, bytes: SLEEP_FIT },
  { uid: 0x13, name: "FIT_TYPE_44", key: 44, bytes: new Uint8Array(40) }, // METRICS: skipped
  { uid: 0x14, key: 32, bytes: MONITORING_FIT }, // key-only name
  { uid: 0x15, name: "fit_type_68", bytes: HRV_FIT },
];

function fixture(
  options: {
    mlr?: boolean;
    files?: WatchFile[];
    pages?: number[][];
    keepOnDevice?: boolean;
    watchdogMs?: number;
    syncState?: ReturnType<typeof createMemoryGarminSyncStateStore>;
  } = {},
) {
  const watch = new NewSyncWatch();
  watch.mlr = options.mlr ?? false;
  for (const file of options.files ?? FILES) watch.files.set(file.uid, file);
  watch.pages = options.pages ?? [[0x11, 0x12, 0x13, 0x14], [0x15]];
  const records: GarminRecord[] = [];
  const failures: string[] = [];
  const session = createGarminSession({
    device: {} as never,
    profile: {
      protocol: "v2",
      serviceUuid: "6a4e2800-667b-11e3-949a-0800200c9a66",
      readUuid: "6a4e2810-667b-11e3-949a-0800200c9a66",
      writeUuid: "6a4e2820-667b-11e3-949a-0800200c9a66",
      handlePrefixed: true,
    },
    deviceId: "venu-x1",
    modelId: "garmin_venu_x1",
    mlr: options.mlr ? "preferred" : "off",
    onRecord: (record) => records.push(record),
    onFailure: (failure) => failures.push(failure),
    initDelayMs: 0,
    configurationWaitMs: 1_000,
    watchdogMs: options.watchdogMs ?? 300,
    keepOnDevice: options.keepOnDevice,
    syncState: options.syncState ?? createMemoryGarminSyncStateStore(),
    link: watch,
  });
  return { watch, session, records, failures };
}

const expectedRecords = (...files: Uint8Array[]) => files.flatMap((file) => garminFitRecords(file));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const mlr of [false, true]) {
  test(`new sync over ${mlr ? "MLR" : "ML"}: flush, paged list, pull, transfer, mark synced`, async () => {
    const f = fixture({ mlr });
    f.session.start();
    await f.session.whenDone();

    // The legacy directory flush comes first.
    expect(
      f.watch.gfdi.some((frame) => frame.messageType === GARMIN_MESSAGE.DOWNLOAD_REQUEST),
    ).toBe(true);
    // Two list pages (the first had a session id), then the health files.
    const requests = f.watch.protobufs.filter(
      (entry) => entry.type === GARMIN_MESSAGE.PROTOBUF_REQUEST,
    );
    const lists = requests.filter((entry) =>
      decodeMessage(entry.service!).has(GARMIN_FILE_ACCESS.ITEM_LIST_REQUEST),
    );
    expect(lists).toHaveLength(2);
    expect(
      decodeMessage(decodeMessage(lists[1]!.service!).get(9)![0]!.value as Uint8Array).get(1)![0]!
        .value,
    ).toBe(5);
    // Request ids count up from 1.
    expect(requests.map((entry) => entry.requestId).slice(0, 3)).toEqual([1, 2, 3]);
    expect(f.watch.pulled).toEqual([0x11, 0x12, 0x14, 0x15]);
    expect(f.watch.marked).toEqual([0x11, 0x12, 0x14, 0x15]);
    // One transfer service registration per file, reliable iff MLR.
    const registrations = f.watch.raw.filter(
      (bytes) => bytes[1] === GARMIN_ML_REQUEST.REGISTER_ML_REQ && bytes[10] === 0x18,
    );
    expect(registrations).toHaveLength(4);
    expect(registrations.every((bytes) => bytes[11] === 0x20 && bytes[12] === (mlr ? 2 : 0))).toBe(
      true,
    );
    expect(f.watch.transferRequests.map((bytes) => Array.from(bytes))).toEqual(
      Array.from({ length: 4 }, () => [0, 0, 0x34, 0x12, 0, 0]),
    );
    // The same records as the legacy path for the same FIT bytes.
    expect(f.records).toEqual(expectedRecords(MONITORING_FIT, SLEEP_FIT, MONITORING_FIT, HRV_FIT));
    expect(f.failures).toEqual([]);
    expect(f.session.complete).toBe(true);
    expect(f.watch.systemEvents()).toEqual([8, 0]);
    // Each protobuf from the watch got the "processed, no reply" status.
    expect(f.watch.protobufStatuses().every((status) => status[2] === 0 && status[3] === 0)).toBe(
      true,
    );
  });
}

test("keep-on-device leaves files unflagged, and a later sync does not download them twice", async () => {
  const syncState = createMemoryGarminSyncStateStore();
  const first = fixture({ keepOnDevice: true, syncState, pages: [[0x11]] });
  first.session.start();
  await first.session.whenDone();
  expect(first.watch.pulled).toEqual([0x11]);
  expect(first.watch.marked).toEqual([]);

  const second = fixture({ syncState, pages: [[0x11, 0x12]] });
  second.session.start();
  await second.session.whenDone();
  expect(second.watch.pulled).toEqual([0x12]);
  // Already downloaded: marked synced without a download.
  expect(second.watch.marked).toEqual([0x11, 0x12]);
});

test("a TransferStatusRequest is answered with next_transfer_priority = 1", async () => {
  const f = fixture({ pages: [[0x11]] });
  f.watch.askTransferStatus = true;
  f.session.start();
  await f.session.whenDone();
  const responses = f.watch.protobufs.filter(
    (entry) => entry.type === GARMIN_MESSAGE.PROTOBUF_RESPONSE,
  );
  expect(responses).toHaveLength(1);
  expect(responses[0]!.requestId).toBe(101);
  expect(Array.from(responses[0]!.service!)).toEqual([0xaa, 0x01, 0x02, 0x08, 0x01]);
  // A complete message answered with a protobuf gets the generic ACK first.
  expect(f.watch.protobufStatuses()).toContainEqual([GARMIN_MESSAGE.PROTOBUF_REQUEST]);
  expect(f.records).toEqual(expectedRecords(MONITORING_FIT));
});

test("a file the watch announces mid-sync is downloaded too", async () => {
  const f = fixture({ pages: [[0x11]] });
  f.watch.announce = { uid: 0x21, name: "FIT_TYPE_68", bytes: HRV_FIT };
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.pulled).toEqual([0x11, 0x21]);
});

test("a chunked list response is reassembled, each chunk ACKed with KEPT", async () => {
  const f = fixture();
  f.watch.protobufChunk = 30;
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.pulled).toEqual([0x11, 0x12, 0x14, 0x15]);
  const statuses = f.watch.protobufStatuses();
  expect(statuses.length).toBeGreaterThan(6);
  expect(statuses.every((status) => status.length === 4 && status[2] === 0)).toBe(true);
});

test("a protobuf that is not file access gets upstream's DISCARDED status", async () => {
  const f = fixture({ pages: [[]] });
  f.watch.sendCoreRequest = true;
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.protobufStatuses()).toContainEqual([GARMIN_MESSAGE.PROTOBUF_REQUEST, 77, 1, 100]);
});

test("refused pulls, bad first messages and corrupt streams skip the file", async () => {
  const files: WatchFile[] = [
    { uid: 0x31, name: "FIT_TYPE_32", bytes: MONITORING_FIT, pullResult: 3 },
    { uid: 0x32, name: "FIT_TYPE_32", bytes: MONITORING_FIT, first: Uint8Array.of(0, 0, 0, 1) },
    {
      uid: 0x33,
      name: "FIT_TYPE_32",
      bytes: MONITORING_FIT,
      stream: Uint8Array.of(0x78, 0x9c, 1, 2, 3, 4, 5),
    },
    { uid: 0x34, name: "FIT_TYPE_49", bytes: SLEEP_FIT },
  ];
  const f = fixture({ files, pages: [[0x31, 0x32, 0x33, 0x34]] });
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.pulled).toEqual([0x31, 0x32, 0x33, 0x34]);
  expect(f.watch.marked).toEqual([0x34]);
  expect(f.records).toEqual(expectedRecords(SLEEP_FIT));
  expect(f.failures).toEqual(["file_transfer", "file_transfer", "fit"]);
  // The rejected stream's handle was given back.
  // Each rejected stream was closed by the watch already: no redundant close.
  expect(f.watch.closedByPhone).toEqual([]);
  expect(f.session.complete).toBe(true);
});

test("a stalled transfer stops the sync and leaves the rest on the watch", async () => {
  const files: WatchFile[] = [
    { uid: 0x41, name: "FIT_TYPE_32", bytes: MONITORING_FIT, stall: true },
    { uid: 0x42, name: "FIT_TYPE_49", bytes: SLEEP_FIT },
  ];
  const f = fixture({ files, pages: [[0x41, 0x42]], watchdogMs: 60 });
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.pulled).toEqual([0x41]);
  expect(f.failures).toContain("file_transfer");
  expect(f.session.complete).toBe(false);
  expect(f.watch.systemEvents()).toEqual([8]);
});

test("workouts are pulled after the health files", async () => {
  const workout = fitFile(GARMIN_FIT_MESSAGE.SESSION, [[253, 4, UINT32]], [[0x70000]]);
  const files: WatchFile[] = [
    { uid: 0x51, name: "FIT_TYPE_4", bytes: workout },
    { uid: 0x52, name: "FIT_TYPE_32", bytes: MONITORING_FIT },
  ];
  const f = fixture({ files, pages: [[0x51, 0x52]] });
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.pulled).toEqual([0x52, 0x51]);
});

test("a model without the new sync protocol never sends a protobuf", async () => {
  const watch = new NewSyncWatch();
  watch.pages = [[0x11]];
  watch.files.set(0x11, FILES[0]!);
  const session = createGarminSession({
    device: {} as never,
    profile: {
      protocol: "v2",
      serviceUuid: "6a4e2800-667b-11e3-949a-0800200c9a66",
      readUuid: "6a4e2810-667b-11e3-949a-0800200c9a66",
      writeUuid: "6a4e2820-667b-11e3-949a-0800200c9a66",
      handlePrefixed: true,
    },
    deviceId: "fenix",
    modelId: "garmin_fenix_7",
    onRecord: () => undefined,
    initDelayMs: 0,
    configurationWaitMs: 100,
    watchdogMs: 200,
    syncState: createMemoryGarminSyncStateStore(),
    link: watch,
  });
  session.start();
  await session.whenDone();
  expect(watch.protobufs).toEqual([]);
  expect(watch.pulled).toEqual([]);
});

test("close() during a transfer settles and stops the transfer channel", async () => {
  const files: WatchFile[] = [
    { uid: 0x61, name: "FIT_TYPE_32", bytes: MONITORING_FIT, stall: true },
  ];
  const f = fixture({ mlr: true, files, pages: [[0x61]], watchdogMs: 5_000 });
  f.session.start();
  for (let i = 0; i < 50 && f.watch.transferRequests.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(f.watch.transferRequests).toHaveLength(1);
  await f.session.close();
  await expect(f.session.whenDone()).resolves.toBeUndefined();
  // No MLR retransmission or ACK after close.
  const before = f.watch.raw.length;
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  expect(f.watch.raw.length).toBe(before);
});

test("outgoing protobufs are chunked at maxPacketSize - 20 and continued on the watch's status", async () => {
  const f = fixture({ pages: [[0x11]] });
  f.watch.maxPacket = 40; // 20-byte chunks
  f.session.start();
  await f.session.whenDone();
  // The 45-byte list request went out as 3 chunks, each after the last's status.
  expect(f.watch.protobufChunks.slice(0, 3)).toEqual([
    [1, 0, 20],
    [1, 20, 20],
    [1, 40, 5],
  ]);
  expect(f.watch.pulled).toEqual([0x11]);
  expect(f.records).toEqual(expectedRecords(MONITORING_FIT));
});

test("a refused transfer registration skips the file at once", async () => {
  const f = fixture({ pages: [[0x11, 0x12]], watchdogMs: 5_000 });
  f.watch.transferGrants = ["refuse"];
  const started = Date.now();
  f.session.start();
  await f.session.whenDone();
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(f.watch.pulled).toEqual([0x11, 0x12]);
  expect(f.records).toEqual(expectedRecords(SLEEP_FIT));
  expect(f.failures).toEqual(["file_transfer"]);
  // The refused service id is free again.
  expect(f.watch.transferRegistrations).toEqual([0x2018, 0x2018]);
});

test("an unanswered transfer registration ends the sync incomplete", async () => {
  const f = fixture({ pages: [[0x11, 0x12]], watchdogMs: 60 });
  f.watch.transferGrants = ["ignore"];
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.pulled).toEqual([0x11]);
  expect(f.session.complete).toBe(false);
  expect(f.watch.systemEvents()).toEqual([8]);
});

test("the answer to our own close does not cut the next file short", async () => {
  const files: WatchFile[] = [
    { uid: 0x71, name: "FIT_TYPE_32", bytes: MONITORING_FIT, first: Uint8Array.of(9) },
    { uid: 0x72, name: "FIT_TYPE_49", bytes: SLEEP_FIT },
  ];
  const f = fixture({ files, pages: [[0x71, 0x72]] });
  // The watch's own close of the rejected file arrives late, after ours.
  f.watch.closeDelayMs = 15;
  f.session.start();
  await f.session.whenDone();
  expect(f.watch.closedByPhone).toEqual([0x2018]);
  // The id we closed is not reused, so the watch's late close cannot match.
  expect(f.watch.transferRegistrations).toEqual([0x2018, 0x4018]);
  expect(f.records).toEqual(expectedRecords(SLEEP_FIT));
  expect(f.failures).toEqual(["file_transfer"]);
  expect(f.session.complete).toBe(true);
});

test("a plain ML transfer handle with the msb set stays on the transfer path (#5476)", async () => {
  const f = fixture({ pages: [[0x11]] });
  f.watch.transferHandle = 0xae;
  f.session.start();
  await f.session.whenDone();
  expect(f.records).toEqual(expectedRecords(MONITORING_FIT));
  expect(f.failures).toEqual([]);
});
