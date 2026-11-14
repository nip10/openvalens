/**
 * Garmin "new sync protocol" driver: protobuf request ids, chunking and
 * statuses (`ProtocolBufferHandler`), and the file sync loop
 * (`FileSyncServiceHandler` + `GarminSupport.processDownloadQueue` /
 * `downloadFileFromServiceV2`), on top of a `GarminSession` that owns the
 * BLE link, the ML/MLR handles and the per-file transfer service.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Spec with line cites:
 * `docs/research/notes/Garmin MLR transport/garmin-new-sync-protocol.md`.
 * Used only by the models whose registry entry sets `newSyncProtocol`.
 * Nothing here is hardware-validated.
 *
 * Downloaded files are inflated and handed to `garminFitRecords`, the same
 * decoder as the legacy directory path, so records (types and ids) are
 * unchanged.
 *
 * Local bounds upstream does not have: a watchdog on every awaited response,
 * caps on pages, queued files, file size and reassembled protobufs, and a
 * failed (skipped) file wherever upstream's queue would stall.
 *
 * Licence: AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import {
  GARMIN_MESSAGE,
  GARMIN_STATUS,
  buildGarminStatusPayload,
  garminFitRecords,
  type GarminGfdiFrame,
  type GarminRecord,
} from "../protocol/garmin";
import {
  GARMIN_ITEM_ACCESS_SUCCESS,
  GARMIN_PROTOBUF_CHUNK,
  GARMIN_PROTOBUF_DEFAULT_CHUNK,
  GARMIN_PROTOBUF_OVERHEAD,
  GARMIN_PROTOBUF_STATUS,
  GarminProtobufReassembler,
  buildGarminItemListRequest,
  buildGarminModifyFlagsRequest,
  buildGarminProtobufPayload,
  buildGarminProtobufStatus,
  buildGarminPullItemRequest,
  buildGarminTransferStatusResponse,
  chunkGarminProtobuf,
  decodeGarminFileAccessService,
  decodeGarminSmartFileAccess,
  encodeGarminSmartFileAccess,
  inflateGarminZlib,
  isGarminActivitySyncItem,
  parseGarminProtobufPayload,
  selectGarminSyncItems,
  type GarminFileAccessMessage,
  type GarminItemReference,
  type GarminProtobufChunk,
  type GarminProtobufStatus,
  type GarminSyncItem,
} from "../protocol/garmin-new-sync";
import type { GarminFailure, GarminSyncStateStore, GarminTimers } from "./garmin";

/** Bound on item-list pages followed within one sync (not upstream). */
export const GARMIN_NEW_SYNC_MAX_PAGES = 32;
/** Bound on files queued within one sync (not upstream). */
export const GARMIN_NEW_SYNC_MAX_QUEUED = 1_024;
/** Bound on outgoing protobufs waiting for their next chunk (not upstream). */
const MAX_OUTGOING_CHUNKED = 8;

export type GarminNewSyncHost = Readonly<{
  timers: GarminTimers;
  watchdogMs: number;
  deviceId: string;
  keepOnDevice: boolean;
  maxFiles: number;
  maxFileBytes: number;
  syncState: GarminSyncStateStore;
  writeFrame(frame: GarminGfdiFrame): Promise<void>;
  /**
   * Registers a `FILE_TRANSFER_*` service, asks for `transferHandle` and
   * resolves with the compressed bytes once the watch closes the handle.
   * Rejects `GARMIN_TRANSFER_TIMEOUT` when the data stops arriving.
   */
  openTransfer(transferHandle: number, maxBytes: number): Promise<Uint8Array>;
  onRecord(record: GarminRecord): void;
  onFailure(failure: GarminFailure): void;
  isClosed(): boolean;
}>;

type Kind = GarminFileAccessMessage["kind"];
type Waiter = {
  kind: Kind;
  resolve: (message: GarminFileAccessMessage) => void;
  reject: (error: unknown) => void;
};

export type GarminNewSyncResult = Readonly<{ stalled: boolean }>;

export class GarminNewSyncDriver {
  private lastRequestId = 0;
  private maxChunkSize = GARMIN_PROTOBUF_DEFAULT_CHUNK;
  private readonly reassembler = new GarminProtobufReassembler();
  private readonly outgoing = new Map<number, GarminProtobufChunk[]>();
  private waiter: Waiter | null = null;
  private queue: GarminSyncItem[] | null = null;
  private readonly queuedKeys = new Set<string>();
  private failed: Error | null = null;

  constructor(private readonly host: GarminNewSyncHost) {}

  /** `ProtocolBufferHandler.setMaxPacketSize`, from DEVICE_INFORMATION. */
  setMaxPacketSize(maxPacketSize: number): void {
    // A size that leaves no room for data keeps the default (local guard).
    if (Number.isInteger(maxPacketSize) && maxPacketSize > GARMIN_PROTOBUF_OVERHEAD) {
      this.maxChunkSize = maxPacketSize - GARMIN_PROTOBUF_OVERHEAD;
    }
  }

  /** Ends the driver: the sync loop's pending wait rejects with `error`. */
  fail(error: Error): void {
    this.failed ??= error;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
    this.reassembler.reset();
    this.outgoing.clear();
  }

  // -------------------------------------------------------------------------
  // Incoming GFDI
  // -------------------------------------------------------------------------

  /**
   * An incoming `PROTOBUF_REQUEST` or `PROTOBUF_RESPONSE` (handled alike,
   * `ProtocolBufferHandler.handle`): reassemble, answer with upstream's status,
   * then the protobuf reply if any (`GarminSupport.onMessage`).
   */
  handleProtobufMessage(frame: GarminGfdiFrame): void {
    let chunk: GarminProtobufChunk;
    try {
      chunk = parseGarminProtobufPayload(frame.payload);
    } catch {
      return;
    }
    const type = frame.messageType;
    const protobufStatus = (chunkStatus: number, statusCode: number): GarminGfdiFrame => ({
      messageType: GARMIN_MESSAGE.RESPONSE,
      payload: buildGarminProtobufStatus({
        originalMessageType: type,
        requestId: chunk.requestId,
        dataOffset: chunk.dataOffset,
        chunkStatus,
        statusCode,
      }),
    });
    const kept = () => protobufStatus(GARMIN_PROTOBUF_CHUNK.KEPT, GARMIN_PROTOBUF_STATUS.NO_ERROR);
    const accepted = this.reassembler.accept(chunk);
    // Upstream throws on a chunk it cannot merge and sends nothing.
    if (accepted.kind === "dropped") return;
    if (accepted.kind === "chunk") {
      void this.write([kept()]);
      return;
    }
    // `ProtobufMessage` constructor: a single complete message is ACKed with a
    // generic status unless a handler replaces it.
    const constructorStatus = (): GarminGfdiFrame =>
      accepted.single
        ? {
            messageType: GARMIN_MESSAGE.RESPONSE,
            payload: buildGarminStatusPayload(type, GARMIN_STATUS.ACK),
          }
        : kept();
    let message: GarminFileAccessMessage | null;
    try {
      const service = decodeGarminSmartFileAccess(accepted.bytes);
      message = service ? decodeGarminFileAccessService(service) : null;
    } catch {
      // `Smart.parseFrom` failed: upstream returns with the constructor status.
      void this.write([constructorStatus()]);
      return;
    }
    if (!message) {
      // Not a file access message: upstream's "Unknown protobuf request".
      void this.write([
        protobufStatus(GARMIN_PROTOBUF_CHUNK.DISCARDED, GARMIN_PROTOBUF_STATUS.UNKNOWN_REQUEST_ID),
      ]);
      return;
    }
    if (message.kind === "transfer_status_request") {
      void this.write([constructorStatus()]);
      this.sendProtobuf(
        GARMIN_MESSAGE.PROTOBUF_RESPONSE,
        chunk.requestId,
        buildGarminTransferStatusResponse(),
      );
    } else {
      // Every other file access message is "processed" with no reply.
      void this.write([kept()]);
    }
    this.deliver(message);
  }

  /** An incoming protobuf status: send the next chunk (`processIncoming(ProtobufStatusMessage)`). */
  handleProtobufStatus(status: GarminProtobufStatus): void {
    if (!status.ok) return;
    const chunks = this.outgoing.get(status.requestId);
    if (!chunks) return;
    const next = chunks.find((chunk) => chunk.dataOffset > status.dataOffset);
    if (!next || next === chunks[chunks.length - 1]) this.outgoing.delete(status.requestId);
    if (!next) return;
    void this.write([
      { messageType: status.originalMessageType, payload: buildGarminProtobufPayload(next) },
    ]);
  }

  // -------------------------------------------------------------------------
  // Sync loop
  // -------------------------------------------------------------------------

  /**
   * Lists the watch's unsynced files and downloads the health FIT files one at
   * a time. Resolves `stalled` when a transfer stopped mid-way, so the
   * remaining files stay for the next sync.
   */
  async sync(): Promise<GarminNewSyncResult> {
    const queue: GarminSyncItem[] = [];
    this.queue = queue;
    try {
      let sessionId: number | null = null;
      for (let page = 0; page < GARMIN_NEW_SYNC_MAX_PAGES; page += 1) {
        const response = await this.request(
          buildGarminItemListRequest(sessionId === null ? {} : { sessionId }),
          "item_list_response",
        );
        if (response.kind !== "item_list_response") break;
        this.enqueue(response.items, true);
        // `FileSyncServiceHandler.kt:163-173`: a session id means more pages.
        if (response.sessionId === null) break;
        sessionId = response.sessionId;
      }
      // Monitoring, sleep and HRV first; workouts can be large and slow.
      queue.sort(
        (left, right) =>
          Number(isGarminActivitySyncItem(left)) - Number(isGarminActivitySyncItem(right)),
      );
      let processed = 0;
      // Files the watch announces mid-sync are appended (`ItemAddedNotification`).
      for (let index = 0; index < queue.length; index += 1) {
        if (this.host.isClosed()) return { stalled: false };
        if (processed >= this.host.maxFiles) break;
        const outcome = await this.download(queue[index]!);
        if (outcome === "stalled") return { stalled: true };
        // Files we already hold (e.g. kept on the watch) cost no transfer and
        // do not use up the per-sync budget.
        if (outcome !== "known") processed += 1;
      }
      return { stalled: false };
    } finally {
      this.queue = null;
    }
  }

  private enqueue(items: readonly GarminItemReference[], resolveKeys: boolean): void {
    const queue = this.queue;
    if (!queue) return;
    for (const item of selectGarminSyncItems(items, { resolveKeys })) {
      const key = item.item.key!;
      if (this.queuedKeys.has(key) || queue.length >= GARMIN_NEW_SYNC_MAX_QUEUED) continue;
      this.queuedKeys.add(key);
      queue.push(item);
    }
  }

  private async download(entry: GarminSyncItem): Promise<"done" | "known" | "skipped" | "stalled"> {
    const key = entry.item.key!;
    const size = entry.item.dataSize;
    if (size !== null && size > this.host.maxFileBytes) return "skipped";
    if (this.host.syncState.hasDownloaded(this.host.deviceId, key)) {
      // Already have it (e.g. a kept file, or a lost ModifyFlags): mark again.
      this.markSynced(entry);
      return "known";
    }
    let pull: GarminFileAccessMessage;
    try {
      pull = await this.request(buildGarminPullItemRequest(entry.request), "pull_item_response");
    } catch (error) {
      if (this.host.isClosed() || this.failed) throw error;
      // The watch stopped answering: leave the rest for the next sync.
      this.host.onFailure("file_transfer");
      return "stalled";
    }
    if (
      pull.kind !== "pull_item_response" ||
      pull.result !== GARMIN_ITEM_ACCESS_SUCCESS ||
      pull.transferHandle === null
    ) {
      this.host.onFailure("file_transfer");
      return "skipped";
    }
    let compressed: Uint8Array;
    try {
      compressed = await this.host.openTransfer(pull.transferHandle, this.host.maxFileBytes);
    } catch (error) {
      if (this.host.isClosed() || this.failed) throw error;
      this.host.onFailure("file_transfer");
      // A watch that stops sending, or never grants the transfer service,
      // keeps the rest for the next sync.
      return error instanceof Error &&
        (error.message === "GARMIN_TRANSFER_TIMEOUT" ||
          error.message === "GARMIN_TRANSFER_REGISTER_TIMEOUT")
        ? "stalled"
        : "skipped";
    }
    try {
      const fit = inflateGarminZlib(compressed, this.host.maxFileBytes);
      for (const record of garminFitRecords(fit)) this.host.onRecord(record);
      this.host.syncState.markDownloaded(this.host.deviceId, key);
    } catch {
      // Upstream leaves a file it could not import on the watch.
      this.host.onFailure("fit");
      return "skipped";
    }
    this.markSynced(entry);
    return "done";
  }

  /** `markSynced` after a processed file, unless keep-on-device (`GarminSupport.java:2180-2186`). */
  private markSynced(entry: GarminSyncItem): void {
    if (this.host.keepOnDevice || !entry.item.uid) return;
    // Upstream does not wait for the ModifyFlagsResponse.
    this.sendRequest(buildGarminModifyFlagsRequest(entry.item.uid));
  }

  // -------------------------------------------------------------------------
  // Requests and waits
  // -------------------------------------------------------------------------

  private deliver(message: GarminFileAccessMessage): void {
    if (message.kind === "item_added_notification") this.enqueue(message.items, false);
    const waiter = this.waiter;
    if (waiter && waiter.kind === message.kind) {
      this.waiter = null;
      waiter.resolve(message);
    }
  }

  /** Sends a `FileAccess.Service` request and waits for the reply kind. */
  private request(service: Uint8Array, kind: Kind): Promise<GarminFileAccessMessage> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise<GarminFileAccessMessage>((resolve, reject) => {
      const timer = this.host.timers.setTimeout(() => {
        if (this.waiter === waiter) this.waiter = null;
        reject(new Error("GARMIN_PROTOBUF_TIMEOUT"));
      }, this.host.watchdogMs);
      const waiter: Waiter = {
        kind,
        resolve: (message) => {
          this.host.timers.clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          this.host.timers.clearTimeout(timer);
          reject(error);
        },
      };
      // Upstream does not match replies to request ids; neither do we.
      this.waiter = waiter;
      try {
        this.sendRequest(service);
      } catch (error) {
        if (this.waiter === waiter) this.waiter = null;
        waiter.reject(error);
      }
    });
  }

  private sendRequest(service: Uint8Array): void {
    // `getNextProtobufRequestId`: (last + 1) % 65536, starting at 1.
    this.lastRequestId = (this.lastRequestId + 1) % 65_536;
    this.sendProtobuf(GARMIN_MESSAGE.PROTOBUF_REQUEST, this.lastRequestId, service);
  }

  private sendProtobuf(messageType: number, requestId: number, service: Uint8Array): void {
    const chunks = chunkGarminProtobuf(
      requestId,
      encodeGarminSmartFileAccess(service),
      this.maxChunkSize,
    );
    if (chunks.length > 1) {
      if (this.outgoing.size >= MAX_OUTGOING_CHUNKED) {
        this.outgoing.delete(this.outgoing.keys().next().value!);
      }
      this.outgoing.set(requestId, chunks);
    }
    void this.write([{ messageType, payload: buildGarminProtobufPayload(chunks[0]!) }]);
  }

  /** Writes in order; a lost write surfaces as the watch's (or our) timeout. */
  private write(frames: readonly GarminGfdiFrame[]): Promise<void> {
    let chain = Promise.resolve();
    for (const frame of frames) chain = chain.then(() => this.host.writeFrame(frame));
    return chain.catch(() => undefined);
  }
}
