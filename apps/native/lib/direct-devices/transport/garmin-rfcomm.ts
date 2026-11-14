/**
 * Garmin Edge file transfer over Bluetooth Classic (RFCOMM), Android only
 * (issue #421; decided 2026-11-13).
 *
 * Some Garmin devices, upstream names the Edge 520 Plus, list no FIT files over
 * BLE and serve them only over an RFCOMM link that the device opens towards
 * the phone. Upstream's sequence:
 * - listen with `listenUsingRfcommWithServiceRecord("Garmin SPP", deab91e4-…)`;
 * - once the record exists, run an SDP query (`fetchUuidsWithSdp`) on the
 *   Classic address from DEVICE_INFORMATION, which makes the device connect
 *   within seconds instead of minutes;
 * - the link carries COBS-framed GFDI with no ML/MLR layer, decoded with a
 *   64 KiB buffer;
 * - the device runs its own DEVICE_INFORMATION/CONFIGURATION handshake on the
 *   link; after the capabilities the phone sends supported file types and
 *   SYNC_READY there, and downloads the files there.
 *
 * Ported from Gadgetbridge 8976702fc3d00e6008c91fe994668cb4027f7bc2:
 * `service/devices/garmin/GarminRfcommListener.java` (GRL) and
 * `GarminSupport.java` (GS:505-510, :706-712, :1067-1095). The file sync
 * itself mirrors `GarminSession.syncFiles` in transport/garmin.ts and reuses
 * the GFDI, COBS and FIT code in protocol/garmin.ts. Not sent: the device
 * settings upstream sends before SYNC_READY (`sendDeviceSettings`), which the
 * BLE session does not send either.
 *
 * Nothing here is hardware-validated.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import type { BtClassicAdapter, RfcommLink } from "../../../modules/bt-classic";
import {
  GARMIN_DOWNLOAD_STATUS,
  GARMIN_FILE_FLAG,
  GARMIN_MESSAGE,
  GARMIN_REQUEST_TYPE,
  GARMIN_STATUS,
  GARMIN_SYSTEM_EVENT,
  GarminCobsDecoder,
  buildGarminAuthNegotiationStatus,
  buildGarminConfiguration,
  buildGarminDeviceInformationReply,
  buildGarminDownloadRequest,
  buildGarminSetFileFlags,
  buildGarminStatusPayload,
  buildGarminSupportedFileTypesRequest,
  buildGarminSystemEvent,
  buildGarminTransferDataStatus,
  decodeGarminGfdiFrame,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  garminCrc16,
  garminFitRecords,
  isGarminActivityFile,
  isGarminDirectorySentinel,
  isGarminDirectoryType,
  isGarminHealthFile,
  parseGarminDeviceInformation,
  parseGarminDirectory,
  parseGarminFileTransferData,
  parseGarminStatus,
  type GarminDirectoryEntry,
  type GarminGfdiFrame,
  type GarminRecord,
  type GarminStatusMessage,
} from "../protocol/garmin";
import {
  GARMIN_CONFIGURATION_WAIT_MS,
  GARMIN_MAX_FILE_BYTES,
  GARMIN_MAX_FILES_PER_SYNC,
  GARMIN_TRANSFER_MAX_MS,
  GARMIN_WATCHDOG_MS,
  type GarminFailure,
  type GarminSyncStateStore,
  type GarminTimers,
} from "./garmin";

/** `GarminRfcommListener.UUID_GARMIN_RFCOMM` (GRL:43). */
export const GARMIN_RFCOMM_UUID = "deab91e4-670f-11e1-9ace-30bc4824019b";
/** The SDP service name upstream publishes (GRL:103). */
export const GARMIN_RFCOMM_SERVICE_NAME = "Garmin SPP";
/** `new CobsCoDec(0x10000)`: the device reports a 0x4000 max packet here (GRL:127-128). */
export const GARMIN_RFCOMM_DECODER_BYTES = 0x10000;
/**
 * How long to wait for the device to connect back. Upstream listens for the
 * whole BLE session; after an SDP query the device connects "within seconds"
 * (GRL:65-67), and on its own only "after a few minutes".
 */
export const GARMIN_RFCOMM_ACCEPT_TIMEOUT_MS = 60_000;
export const GARMIN_RFCOMM_SDP_TIMEOUT_MS = 10_000;

/** FIT files have data type 128; a directory without one triggers RFCOMM (FileTransferHandler). */
export const GARMIN_FIT_DATA_TYPE = 128;

export type GarminRfcommSyncOptions = Readonly<{
  btClassic: BtClassicAdapter;
  /** From DEVICE_INFORMATION on the BLE link (`parseGarminClassicAddress`). */
  classicAddress: string;
  /** Same sync-state key as the BLE session, so a file is never fetched twice. */
  deviceId: string;
  onRecord: (record: GarminRecord) => void;
  onFailure?: (failure: GarminFailure) => void;
  syncState: GarminSyncStateStore;
  signal: AbortSignal;
  keepOnDevice?: boolean;
  acceptTimeoutMs?: number;
  sdpTimeoutMs?: number;
  watchdogMs?: number;
  configurationWaitMs?: number;
  maxFiles?: number;
  timers?: GarminTimers;
}>;

/**
 * Listens, triggers the device with an SDP query, and runs the file sync over
 * the accepted link. Resolves `complete: false` when a stalled transfer left
 * files on the device; rejects with a `BT_CLASSIC_*` or `GARMIN_*` code. The
 * server and the accepted socket are always closed.
 */
export async function runGarminRfcommSync(
  options: GarminRfcommSyncOptions,
): Promise<{ complete: boolean }> {
  const { btClassic, signal } = options;
  if (signal.aborted) throw new Error("GARMIN_CLOSED");
  if (!btClassic.isSupported()) throw new Error("BT_CLASSIC_UNSUPPORTED");
  const { link } = await btClassic.listen({
    name: GARMIN_RFCOMM_SERVICE_NAME,
    uuid: GARMIN_RFCOMM_UUID,
    // listenUsingRfcommWithServiceRecord is the secure variant (GRL:103).
    secure: true,
    timeoutMs: options.acceptTimeoutMs ?? GARMIN_RFCOMM_ACCEPT_TIMEOUT_MS,
    signal,
    // "The device looks up our service record when queried, so only query
    // once it exists" (GRL:109-110). The query's result does not matter.
    onListening: () =>
      void btClassic
        .fetchUuids(options.classicAddress, options.sdpTimeoutMs ?? GARMIN_RFCOMM_SDP_TIMEOUT_MS)
        .catch(() => undefined),
  });
  if (signal.aborted) {
    await link.close().catch(() => undefined);
    throw new Error("GARMIN_CLOSED");
  }
  const session = new GarminRfcommSession(link, options);
  const onAbort = () => void session.close();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await session.run();
  } finally {
    signal.removeEventListener("abort", onAbort);
    await session.close();
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

const defaultTimers: GarminTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Transfer = {
  expected: number;
  buffer: Uint8Array;
  received: number;
  crc: number;
  done: Deferred<Uint8Array>;
  touch: () => void;
};

/** One accepted link: GFDI handshake replies, then the directory and file downloads. */
class GarminRfcommSession {
  private readonly decoder = new GarminCobsDecoder(GARMIN_RFCOMM_DECODER_BYTES);
  private readonly configured = deferred<void>();
  private readonly linkLost = deferred<never>();
  private readonly timers: GarminTimers;
  private readonly watchdogMs: number;
  private readonly unsubscribe: () => void;
  private statusWaiter: {
    originalMessageType: number;
    done: Deferred<GarminStatusMessage>;
    onStatus: (status: GarminStatusMessage) => void;
  } | null = null;
  private transfer: Transfer | null = null;
  private stalled = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly link: RfcommLink,
    private readonly options: GarminRfcommSyncOptions,
  ) {
    this.timers = options.timers ?? defaultTimers;
    this.watchdogMs = options.watchdogMs ?? GARMIN_WATCHDOG_MS;
    this.unsubscribe = link.subscribe(
      (bytes) => {
        if (this.closed) return;
        for (const message of this.decoder.acceptAll(bytes)) this.handleMessage(message);
      },
      (reason) => {
        if (reason !== "local") this.fail(new Error("GARMIN_RFCOMM_CLOSED"));
      },
    );
  }

  async run(): Promise<{ complete: boolean }> {
    // GS:1089-1095 runs on the link's own capabilities (its CONFIGURATION).
    await this.race(this.waitForConfiguration());
    await this.writeFrame({
      messageType: GARMIN_MESSAGE.SUPPORTED_FILE_TYPES_REQUEST,
      payload: buildGarminSupportedFileTypesRequest(),
    });
    await this.writeFrame({
      messageType: GARMIN_MESSAGE.SYSTEM_EVENT,
      payload: buildGarminSystemEvent(GARMIN_SYSTEM_EVENT.SYNC_READY),
    });
    // GS:706-712: with the link up, the download starts here.
    await this.syncFiles();
    return { complete: !this.stalled };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.fail(new Error("GARMIN_CLOSED"));
    await this.link.close().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // File sync: the same order, filters and archive rules as GarminSession.
  // -------------------------------------------------------------------------

  private async syncFiles(): Promise<void> {
    const entries = parseGarminDirectory(await this.downloadFile(0));
    const queue = entries
      .filter(
        (entry) =>
          !isGarminDirectorySentinel(entry) &&
          isGarminHealthFile(entry) &&
          entry.fileSize <= GARMIN_MAX_FILE_BYTES,
      )
      .sort(
        (left, right) => Number(isGarminActivityFile(left)) - Number(isGarminActivityFile(right)),
      );
    const maxFiles = this.options.maxFiles ?? GARMIN_MAX_FILES_PER_SYNC;
    let processed = 0;
    for (const entry of queue) {
      if (this.closed) throw new Error("GARMIN_CLOSED");
      if (processed >= maxFiles) break;
      processed += 1;
      const key = `${entry.fileIndex}:${entry.fileNumber}:${entry.fileSize}:${entry.timestamp ?? 0}`;
      if (this.options.syncState.hasDownloaded(this.options.deviceId, key)) {
        await this.archive(entry);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.downloadFile(entry.fileIndex);
      } catch (error) {
        this.options.onFailure?.("file_transfer");
        if (this.closed) throw new Error("GARMIN_CLOSED");
        if (error instanceof Error && error.message === "GARMIN_TRANSFER_TIMEOUT") {
          this.stalled = true;
          return;
        }
        // A dropped link fails every later file too.
        if (error instanceof Error && error.message === "GARMIN_RFCOMM_CLOSED") throw error;
        continue;
      }
      try {
        for (const record of garminFitRecords(bytes)) this.options.onRecord(record);
        this.options.syncState.markDownloaded(this.options.deviceId, key);
      } catch {
        this.options.onFailure?.("fit");
      }
      await this.archive(entry);
    }
  }

  private async archive(entry: GarminDirectoryEntry): Promise<void> {
    if (this.options.keepOnDevice || isGarminDirectoryType(entry)) return;
    await this.writeFrame({
      messageType: GARMIN_MESSAGE.SET_FILE_FLAG,
      payload: buildGarminSetFileFlags(entry.fileIndex, GARMIN_FILE_FLAG.ARCHIVE),
    }).catch(() => this.options.onFailure?.("file_transfer"));
  }

  private async downloadFile(fileIndex: number): Promise<Uint8Array> {
    const wait = deferred<GarminStatusMessage>();
    // A stream read can carry the status and the first chunks together, so the
    // transfer is armed synchronously when the status is handled, not after
    // the await below resumes.
    let transfer: Promise<Uint8Array> | null = null;
    this.statusWaiter = {
      originalMessageType: GARMIN_MESSAGE.DOWNLOAD_REQUEST,
      done: wait,
      onStatus: (status) => {
        if (
          status.status === GARMIN_STATUS.ACK &&
          status.downloadStatus === GARMIN_DOWNLOAD_STATUS.OK &&
          status.maxFileSize !== null &&
          status.maxFileSize <= GARMIN_MAX_FILE_BYTES
        ) {
          transfer = this.receiveTransfer(status.maxFileSize);
          transfer.catch(() => undefined);
        }
      },
    };
    let status: GarminStatusMessage;
    try {
      await this.writeFrame({
        messageType: GARMIN_MESSAGE.DOWNLOAD_REQUEST,
        payload: buildGarminDownloadRequest({ fileIndex, requestType: GARMIN_REQUEST_TYPE.NEW }),
      });
      status = await this.race(this.withWatchdog(wait.promise, "GARMIN_STATUS_TIMEOUT"));
    } finally {
      if (this.statusWaiter?.done === wait) this.statusWaiter = null;
    }
    if (
      status.status !== GARMIN_STATUS.ACK ||
      status.downloadStatus !== GARMIN_DOWNLOAD_STATUS.OK ||
      status.maxFileSize === null
    )
      throw new Error("GARMIN_DOWNLOAD_REJECTED");
    if (status.maxFileSize > GARMIN_MAX_FILE_BYTES) throw new Error("GARMIN_FILE_TOO_LARGE");
    if (!transfer) throw new Error("GARMIN_DOWNLOAD_REJECTED");
    return this.race(transfer);
  }

  private async receiveTransfer(expected: number): Promise<Uint8Array> {
    if (expected === 0) return new Uint8Array(0);
    const done = deferred<Uint8Array>();
    let idle: unknown = null;
    const fail = () => done.reject(new Error("GARMIN_TRANSFER_TIMEOUT"));
    const transfer: Transfer = {
      expected,
      buffer: new Uint8Array(expected),
      received: 0,
      crc: 0,
      done,
      touch: () => {
        if (idle !== null) this.timers.clearTimeout(idle);
        idle = this.timers.setTimeout(fail, this.watchdogMs);
      },
    };
    const cap = this.timers.setTimeout(fail, GARMIN_TRANSFER_MAX_MS);
    transfer.touch();
    this.transfer = transfer;
    try {
      return await done.promise;
    } finally {
      if (idle !== null) this.timers.clearTimeout(idle);
      this.timers.clearTimeout(cap);
      if (this.transfer === transfer) this.transfer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Incoming GFDI
  // -------------------------------------------------------------------------

  private handleMessage(bytes: Uint8Array): void {
    let frame: GarminGfdiFrame;
    try {
      frame = decodeGarminGfdiFrame(bytes);
    } catch {
      return;
    }
    if (frame.messageType === GARMIN_MESSAGE.RESPONSE) {
      let status: GarminStatusMessage;
      try {
        status = parseGarminStatus(frame.payload);
      } catch {
        return;
      }
      const waiter = this.statusWaiter;
      if (waiter && waiter.originalMessageType === status.originalMessageType) {
        this.statusWaiter = null;
        waiter.onStatus(status);
        waiter.done.resolve(status);
      }
      return;
    }
    if (frame.messageType === GARMIN_MESSAGE.FILE_TRANSFER_DATA) {
      this.handleTransferChunk(frame.payload);
      return;
    }
    this.answerDevice(frame);
  }

  private handleTransferChunk(payload: Uint8Array): void {
    const transfer = this.transfer;
    if (!transfer) return;
    let chunk: ReturnType<typeof parseGarminFileTransferData>;
    try {
      chunk = parseGarminFileTransferData(payload);
    } catch {
      transfer.done.reject(new Error("GARMIN_TRANSFER_TRUNCATED"));
      return;
    }
    if (chunk.dataOffset !== transfer.received) {
      transfer.done.reject(new Error("GARMIN_TRANSFER_OFFSET"));
      return;
    }
    const crc = garminCrc16(chunk.data, transfer.crc);
    if (crc !== chunk.crc) {
      transfer.done.reject(new Error("GARMIN_TRANSFER_CRC"));
      return;
    }
    transfer.crc = crc;
    const take = Math.min(chunk.data.length, transfer.expected - transfer.received);
    transfer.buffer.set(chunk.data.subarray(0, take), transfer.received);
    transfer.received += chunk.data.length;
    const offset = transfer.received;
    transfer.touch();
    // Every chunk is acknowledged, or the device stops sending.
    void this.writeFrame({
      messageType: GARMIN_MESSAGE.RESPONSE,
      payload: buildGarminTransferDataStatus(offset),
    }).catch(() => undefined);
    if (offset >= transfer.expected) {
      this.transfer = null;
      transfer.done.resolve(transfer.buffer);
    }
  }

  /** The replies `GarminSession.answerWatch` sends, written on this link (GS:924-944). */
  private answerDevice(frame: GarminGfdiFrame): void {
    const type = frame.messageType;
    const ack = (status: number) => ({
      messageType: GARMIN_MESSAGE.RESPONSE,
      payload: buildGarminStatusPayload(type, status),
    });
    switch (type) {
      case GARMIN_MESSAGE.DEVICE_INFORMATION: {
        let protocolVersion: number;
        try {
          protocolVersion = parseGarminDeviceInformation(frame.payload).protocolVersion;
        } catch {
          return;
        }
        void this.reply([
          ack(GARMIN_STATUS.ACK),
          {
            messageType: GARMIN_MESSAGE.RESPONSE,
            payload: buildGarminDeviceInformationReply(protocolVersion),
          },
        ]);
        return;
      }
      case GARMIN_MESSAGE.CONFIGURATION:
        void this.reply([
          ack(GARMIN_STATUS.ACK),
          { messageType: GARMIN_MESSAGE.CONFIGURATION, payload: buildGarminConfiguration() },
        ]).then(() => this.configured.resolve());
        return;
      case GARMIN_MESSAGE.AUTH_NEGOTIATION: {
        let payload: Uint8Array;
        try {
          payload = buildGarminAuthNegotiationStatus(frame.payload);
        } catch {
          return;
        }
        void this.reply([{ messageType: GARMIN_MESSAGE.RESPONSE, payload }]);
        return;
      }
      case GARMIN_MESSAGE.CURRENT_TIME_REQUEST:
        void this.reply([ack(GARMIN_STATUS.UNSUPPORTED)]);
        return;
      case GARMIN_MESSAGE.BATTERY_STATUS:
      case GARMIN_MESSAGE.SYNCHRONIZATION:
      case GARMIN_MESSAGE.FILE_AVAILABLE:
      case GARMIN_MESSAGE.CREATE_FILE:
      case GARMIN_MESSAGE.WEATHER_REQUEST:
      case GARMIN_MESSAGE.FIND_MY_PHONE_REQUEST:
      case GARMIN_MESSAGE.FIND_MY_PHONE_CANCEL:
      case GARMIN_MESSAGE.MUSIC_CONTROL:
        void this.reply([ack(GARMIN_STATUS.ACK)]);
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Writes and waits
  // -------------------------------------------------------------------------

  /** `GarminRfcommListener.sendMessage`: COBS-encode the GFDI message, in order. */
  private writeFrame(frame: GarminGfdiFrame): Promise<void> {
    if (this.closed) return Promise.reject(new Error("GARMIN_CLOSED"));
    const bytes = encodeGarminCobs(encodeGarminGfdiFrame(frame));
    const next = this.queue.then(() => this.link.write(bytes));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private reply(frames: readonly GarminGfdiFrame[]): Promise<void> {
    let chain = Promise.resolve();
    for (const frame of frames) chain = chain.then(() => this.writeFrame(frame));
    return chain.catch(() => undefined);
  }

  private waitForConfiguration(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = this.timers.setTimeout(
        resolve,
        this.options.configurationWaitMs ?? GARMIN_CONFIGURATION_WAIT_MS,
      );
      void this.configured.promise.then(() => {
        this.timers.clearTimeout(timer);
        resolve();
      });
    });
  }

  private withWatchdog<T>(promise: Promise<T>, code: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => reject(new Error(code)), this.watchdogMs);
      promise.then(
        (value) => {
          this.timers.clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          this.timers.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  /** Settles early when the link drops or the session closes. */
  private race<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.linkLost.promise]);
  }

  private fail(error: Error): void {
    this.linkLost.reject(error);
    this.configured.resolve();
    const status = this.statusWaiter;
    if (status) {
      this.statusWaiter = null;
      status.done.reject(error);
    }
    const transfer = this.transfer;
    if (transfer) {
      this.transfer = null;
      transfer.done.reject(error);
    }
  }
}
