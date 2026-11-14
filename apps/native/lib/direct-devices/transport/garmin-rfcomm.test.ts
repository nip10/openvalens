/**
 * Garmin Edge over RFCOMM (issue #421): the Classic address in
 * DEVICE_INFORMATION, the 64 KiB stream decoder, and the file sync over an
 * accepted link, against Gadgetbridge 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * (`DeviceInformationMessage`, `CobsCoDec`, `GarminRfcommListener`,
 * `GarminSupport`). AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import type { BtClassicAdapter, RfcommLink } from "../../../modules/bt-classic";
import { garminUsesRfcommFileTransfer, GARMIN_MODELS } from "../models/garmin";
import {
  GARMIN_FIT_MESSAGE,
  GARMIN_MESSAGE,
  GarminCobsDecoder,
  decodeGarminGfdiFrame,
  encodeGarminCobs,
  encodeGarminGfdiFrame,
  garminCrc16,
  parseGarminClassicAddress,
  type GarminGfdiFrame,
  type GarminRecord,
} from "../protocol/garmin";
import { createMemoryGarminSyncStateStore } from "./garmin";
import {
  GARMIN_RFCOMM_SERVICE_NAME,
  GARMIN_RFCOMM_UUID,
  runGarminRfcommSync,
} from "./garmin-rfcomm";

// ---------------------------------------------------------------------------
// DEVICE_INFORMATION Classic address
// ---------------------------------------------------------------------------

/** protocol 150, product, unit, software, max packet, then three strings "F", "Edge", "". */
const HEAD = Uint8Array.of(150, 0, 0xdb, 0x0c, 0xd2, 0x04, 0, 0, 0xd0, 0x07, 0x77, 0x01);
const NAMES = Uint8Array.of(1, 0x46, 4, 0x45, 0x64, 0x67, 0x65, 0);

test("the Classic address is the second 6-byte block, little-endian, formatted %02X", () => {
  const payload = Uint8Array.of(
    ...HEAD,
    ...NAMES,
    1,
    0xa1,
    0xa2,
    0xa3,
    0xa4,
    0xa5,
    0xa6,
    0x0f,
    0x1e,
    0x2d,
    0x3c,
    0x4b,
    0x5a,
    0,
  );
  expect(parseGarminClassicAddress(payload)).toBe("5A:4B:3C:2D:1E:0F");
  // The trailing unknown byte is optional.
  expect(parseGarminClassicAddress(payload.slice(0, -1))).toBe("5A:4B:3C:2D:1E:0F");
});

test("no address without hasMac = 1, nothing after the strings, or a truncated block", () => {
  expect(parseGarminClassicAddress(Uint8Array.of(...HEAD, ...NAMES))).toBeNull();
  expect(parseGarminClassicAddress(Uint8Array.of(...HEAD, ...NAMES, 0, 0))).toBeNull();
  expect(
    parseGarminClassicAddress(Uint8Array.of(...HEAD, ...NAMES, 1, ...new Uint8Array(11))),
  ).toBeNull();
  // A string length running past the end.
  expect(parseGarminClassicAddress(Uint8Array.of(...HEAD, 9, 0x46))).toBeNull();
});

// ---------------------------------------------------------------------------
// Stream decoding
// ---------------------------------------------------------------------------

const frame = (messageType: number, payload: Uint8Array) =>
  encodeGarminCobs(encodeGarminGfdiFrame({ messageType, payload }));

test("acceptAll yields every frame in one stream read, and keeps a partial one", () => {
  const first = frame(GARMIN_MESSAGE.SYSTEM_EVENT, Uint8Array.of(8, 0));
  const second = frame(GARMIN_MESSAGE.SYSTEM_EVENT, Uint8Array.of(0, 0));
  const third = frame(GARMIN_MESSAGE.SYSTEM_EVENT, Uint8Array.of(1, 0));
  const decoder = new GarminCobsDecoder();
  const read = Uint8Array.of(...first, ...second, ...third.subarray(0, 4));
  const messages = decoder.acceptAll(read).map((bytes) => decodeGarminGfdiFrame(bytes).payload[0]);
  expect(messages).toEqual([8, 0]);
  expect(
    decoder.acceptAll(third.subarray(4)).map((bytes) => decodeGarminGfdiFrame(bytes).payload[0]),
  ).toEqual([1]);
});

test("the RFCOMM decoder holds a 0x4000-byte packet that the BLE-sized one drops", () => {
  const big = frame(GARMIN_MESSAGE.FILE_TRANSFER_DATA, new Uint8Array(0x4000).fill(7));
  expect(new GarminCobsDecoder().acceptAll(big)).toEqual([]);
  const [message] = new GarminCobsDecoder(0x10000).acceptAll(big);
  expect(decodeGarminGfdiFrame(message!).payload.length).toBe(0x4000);
});

// ---------------------------------------------------------------------------
// Registry gate
// ---------------------------------------------------------------------------

test("RFCOMM file transfer is gated on the 24 GarminBikeComputerCoordinator models", () => {
  const edge = GARMIN_MODELS.filter((model) => garminUsesRfcommFileTransfer(model.id));
  expect(edge).toHaveLength(24);
  // Exactly the coordinators in upstream's devices/garmin/bike/ package.
  expect(edge.every((model) => model.sourceFile.includes("/devices/garmin/bike/"))).toBe(true);
  expect(
    GARMIN_MODELS.filter((model) => model.sourceFile.includes("/devices/garmin/bike/")),
  ).toHaveLength(24);
  expect(garminUsesRfcommFileTransfer("garmin_edge_520_plus")).toBe(true);
  expect(garminUsesRfcommFileTransfer("garmin_etrex_se")).toBe(false);
  expect(garminUsesRfcommFileTransfer("garmin_fenix_7")).toBe(false);
});

// ---------------------------------------------------------------------------
// File sync over an accepted link
// ---------------------------------------------------------------------------

function writeUint32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

/** One monitoring record (timestamp, cycles = steps, heart rate) in a minimal FIT file. */
function monitoringFit(): Uint8Array {
  const definition = Uint8Array.of(
    0x40,
    0,
    0,
    GARMIN_FIT_MESSAGE.MONITORING & 0xff,
    GARMIN_FIT_MESSAGE.MONITORING >> 8,
    3,
    253,
    4,
    0x86,
    3,
    4,
    0x86,
    27,
    1,
    0x02,
  );
  const record = new Uint8Array(10);
  writeUint32(record, 1, 0x50000);
  writeUint32(record, 5, 120);
  record[9] = 70;
  const body = Uint8Array.of(...definition, ...record);
  const header = new Uint8Array(14);
  header[0] = 14;
  header[1] = 0x10;
  writeUint32(header, 4, body.length);
  writeUint32(header, 8, 0x5449462e);
  const withoutCrc = Uint8Array.of(...header, ...body);
  const crc = garminCrc16(withoutCrc);
  return Uint8Array.of(...withoutCrc, crc & 0xff, crc >> 8);
}

function directory(entries: readonly [number, number, number, number][]): Uint8Array {
  const out = new Uint8Array((entries.length + 1) * 16);
  entries.forEach(([fileIndex, dataType, subType, size], index) => {
    const at = index * 16;
    out[at] = fileIndex;
    out[at + 2] = dataType;
    out[at + 3] = subType;
    writeUint32(out, at + 8, size);
  });
  return out;
}

function statusPayload(original: number, status: number, detail: number, size: number) {
  const out = new Uint8Array(8);
  out[0] = original & 0xff;
  out[1] = original >> 8;
  out[2] = status;
  out[3] = detail;
  writeUint32(out, 4, size);
  return out;
}

/** An Edge on the far end of the accepted socket: COBS GFDI, no ML handle byte. */
function fakeEdge(
  files: Map<number, Uint8Array>,
  options: {
    dropAfterDirectory?: boolean;
    /** Drop the link silently after archiving this file; later writes fail. */
    dropAfterArchive?: number;
    /** Never complete a write of this GFDI message type (a peer that stops reading). */
    hangOn?: number;
  } = {},
) {
  let dropped = false;
  const decoder = new GarminCobsDecoder(0x10000);
  const written: GarminGfdiFrame[] = [];
  const rawWrites: Uint8Array[] = [];
  const order: string[] = [];
  let onBytes: ((bytes: Uint8Array) => void) | undefined;
  let onClosed: ((reason: string) => void) | undefined;
  let closes = 0;
  const send = (...frames: Uint8Array[]) =>
    queueMicrotask(() => onBytes?.(Uint8Array.from(frames.flatMap((bytes) => [...bytes]))));
  const stream = (file: Uint8Array) => {
    let crc = 0;
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < file.length; offset += 0x4000) {
      const chunk = file.subarray(offset, offset + 0x4000);
      crc = garminCrc16(chunk, crc);
      const payload = new Uint8Array(7 + chunk.length);
      payload[1] = crc & 0xff;
      payload[2] = crc >> 8;
      writeUint32(payload, 3, offset);
      payload.set(chunk, 7);
      chunks.push(frame(GARMIN_MESSAGE.FILE_TRANSFER_DATA, payload));
    }
    return chunks;
  };
  const link: RfcommLink = {
    socketId: "rfcomm-9",
    subscribe(bytes, closed) {
      onBytes = bytes;
      onClosed = closed;
      // The device opens with its own handshake on the new link.
      send(frame(GARMIN_MESSAGE.DEVICE_INFORMATION, Uint8Array.of(...HEAD, ...NAMES)));
      return () => {
        onBytes = undefined;
      };
    },
    async write(bytes) {
      if (dropped) throw new Error("BT_CLASSIC_NOT_CONNECTED");
      rawWrites.push(bytes);
      for (const message of decoder.acceptAll(bytes)) {
        if (options.hangOn !== undefined) {
          const type = decodeGarminGfdiFrame(message).messageType;
          if (type === options.hangOn) await new Promise(() => undefined);
        }
        const gfdi = decodeGarminGfdiFrame(message);
        written.push(gfdi);
        const original = gfdi.payload[0]! | (gfdi.payload[1]! << 8);
        if (
          gfdi.messageType === GARMIN_MESSAGE.RESPONSE &&
          original === GARMIN_MESSAGE.DEVICE_INFORMATION &&
          gfdi.payload.length > 3
        ) {
          send(frame(GARMIN_MESSAGE.CONFIGURATION, Uint8Array.of(2, 0x01, 0x80)));
        }
        if (gfdi.messageType === GARMIN_MESSAGE.DOWNLOAD_REQUEST) {
          const index = gfdi.payload[0]! | (gfdi.payload[1]! << 8);
          order.push(`download:${index}`);
          if (index !== 0 && options.dropAfterDirectory) {
            queueMicrotask(() => onClosed?.("remote"));
            continue;
          }
          const file = files.get(index)!;
          // Status and every chunk in one stream read.
          send(
            frame(
              GARMIN_MESSAGE.RESPONSE,
              statusPayload(GARMIN_MESSAGE.DOWNLOAD_REQUEST, 0, 0, file.length),
            ),
            ...stream(file),
          );
        }
        if (gfdi.messageType === GARMIN_MESSAGE.SET_FILE_FLAG) {
          order.push(`archive:${gfdi.payload[0]}`);
          if (gfdi.payload[0] === options.dropAfterArchive) dropped = true;
        }
        if (gfdi.messageType === GARMIN_MESSAGE.SYSTEM_EVENT)
          order.push(`event:${gfdi.payload[0]}`);
        if (gfdi.messageType === GARMIN_MESSAGE.SUPPORTED_FILE_TYPES_REQUEST)
          order.push("file-types");
      }
    },
    async close() {
      closes += 1;
    },
  };
  return { link, written, rawWrites, order, closes: () => closes };
}

function fakeBtClassic(link: RfcommLink, calls: unknown[][]): BtClassicAdapter {
  return {
    isSupported: () => true,
    listBonded: async () => [],
    discover: async () => undefined,
    openRfcomm: async () => {
      throw new Error("unused");
    },
    fetchUuids: async (address, timeoutMs) => {
      calls.push(["fetchUuids", address, timeoutMs]);
      return [];
    },
    listen: async ({ name, uuid, secure, timeoutMs, onListening }) => {
      calls.push(["listen", name, uuid, secure, timeoutMs]);
      onListening?.();
      calls.push(["accepted"]);
      return { link, address: "5A:4B:3C:2D:1E:0F" };
    },
  };
}

test("listens, triggers with an SDP query, then syncs files over the accepted link", async () => {
  const fit = monitoringFit();
  const files = new Map<number, Uint8Array>([
    [0, directory([[1, 128, 32, fit.length]])],
    [1, fit],
  ]);
  const edge = fakeEdge(files);
  const calls: unknown[][] = [];
  const records: GarminRecord[] = [];
  const syncState = createMemoryGarminSyncStateStore();
  const result = await runGarminRfcommSync({
    btClassic: fakeBtClassic(edge.link, calls),
    classicAddress: "5A:4B:3C:2D:1E:0F",
    deviceId: "edge-1",
    onRecord: (record) => records.push(record),
    syncState,
    signal: new AbortController().signal,
    configurationWaitMs: 1_000,
    watchdogMs: 1_000,
  });
  expect(result).toEqual({ complete: true });
  // The SDP query runs once the record exists, before the accept.
  expect(calls).toEqual([
    ["listen", GARMIN_RFCOMM_SERVICE_NAME, GARMIN_RFCOMM_UUID, true, 60_000],
    ["fetchUuids", "5A:4B:3C:2D:1E:0F", 10_000],
    ["accepted"],
  ]);
  // GarminSupport:1089-1095, then the download (GS:706-712), then archive.
  expect(edge.order).toEqual(["file-types", "event:8", "download:0", "download:1", "archive:1"]);
  // Writes are bare COBS frames: no ML handle byte in front.
  expect(edge.rawWrites.every((bytes) => bytes[0] === 0 && bytes.at(-1) === 0)).toBe(true);
  // The device's handshake was answered: ACK + reply, ACK + our CONFIGURATION.
  expect(
    edge.written.filter((gfdi) => gfdi.messageType === GARMIN_MESSAGE.CONFIGURATION),
  ).toHaveLength(1);
  expect(records.some((record) => record.type === "steps")).toBe(true);
  expect(syncState.hasDownloaded("edge-1", `1:0:${fit.length}:0`)).toBe(true);
  expect(edge.closes()).toBe(1);
});

test("a file larger than one RFCOMM packet arrives in 0x4000-byte chunks", async () => {
  const file = new Uint8Array(0x4000 + 100).map((_, index) => index & 0xff);
  // Not a FIT file: the parse fails, which is reported but does not stop the sync.
  const files = new Map<number, Uint8Array>([
    [0, directory([[1, 128, 32, file.length]])],
    [1, file],
  ]);
  const edge = fakeEdge(files);
  const failures: string[] = [];
  const result = await runGarminRfcommSync({
    btClassic: fakeBtClassic(edge.link, []),
    classicAddress: "5A:4B:3C:2D:1E:0F",
    deviceId: "edge-2",
    onRecord: () => undefined,
    onFailure: (failure) => failures.push(failure),
    syncState: createMemoryGarminSyncStateStore(),
    signal: new AbortController().signal,
    configurationWaitMs: 1_000,
    watchdogMs: 1_000,
  });
  expect(result.complete).toBe(true);
  expect(failures).toEqual(["fit"]);
  // Two transfer acks, the second at the full size.
  const acks = edge.written.filter(
    (gfdi) =>
      gfdi.messageType === GARMIN_MESSAGE.RESPONSE &&
      (gfdi.payload[0]! | (gfdi.payload[1]! << 8)) === GARMIN_MESSAGE.FILE_TRANSFER_DATA,
  );
  expect(acks.length).toBeGreaterThanOrEqual(2);
});

test("the device dropping the link fails the sync and closes the socket", async () => {
  const files = new Map<number, Uint8Array>([
    [0, directory([[1, 128, 32, 10]])],
    [1, new Uint8Array(10)],
  ]);
  const edge = fakeEdge(files, { dropAfterDirectory: true });
  await expect(
    runGarminRfcommSync({
      btClassic: fakeBtClassic(edge.link, []),
      classicAddress: "5A:4B:3C:2D:1E:0F",
      deviceId: "edge-3",
      onRecord: () => undefined,
      syncState: createMemoryGarminSyncStateStore(),
      signal: new AbortController().signal,
      configurationWaitMs: 1_000,
      watchdogMs: 1_000,
    }),
  ).rejects.toThrow("GARMIN_RFCOMM_CLOSED");
  expect(edge.closes()).toBe(1);
});

test("an abort closes the session; unsupported adapters refuse up front", async () => {
  const edge = fakeEdge(new Map([[0, directory([])]]));
  const abort = new AbortController();
  const adapter = fakeBtClassic(edge.link, []);
  const pending = runGarminRfcommSync({
    btClassic: {
      ...adapter,
      // The abort lands just as the link is accepted.
      listen: async (options) => {
        const accepted = await adapter.listen(options);
        abort.abort();
        return accepted;
      },
    },
    classicAddress: "5A:4B:3C:2D:1E:0F",
    deviceId: "edge-4",
    onRecord: () => undefined,
    syncState: createMemoryGarminSyncStateStore(),
    signal: abort.signal,
    configurationWaitMs: 1_000,
    watchdogMs: 1_000,
  });
  await expect(pending).rejects.toThrow("GARMIN_CLOSED");
  expect(edge.closes()).toBe(1);

  await expect(
    runGarminRfcommSync({
      btClassic: { ...adapter, isSupported: () => false },
      classicAddress: "5A:4B:3C:2D:1E:0F",
      deviceId: "edge-5",
      onRecord: () => undefined,
      syncState: createMemoryGarminSyncStateStore(),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("BT_CLASSIC_UNSUPPORTED");
});

test("a link lost between files is never reported complete", async () => {
  const fit = monitoringFit();
  const files = new Map<number, Uint8Array>([
    [
      0,
      directory([
        [1, 128, 32, fit.length],
        [2, 128, 32, fit.length],
        [3, 128, 32, fit.length],
      ]),
    ],
    [1, fit],
    [2, fit],
    [3, fit],
  ]);
  // The socket goes away right after the first archive, without onClosed.
  const edge = fakeEdge(files, { dropAfterArchive: 1 });
  await expect(
    runGarminRfcommSync({
      btClassic: fakeBtClassic(edge.link, []),
      classicAddress: "5A:4B:3C:2D:1E:0F",
      deviceId: "edge-6",
      onRecord: () => undefined,
      syncState: createMemoryGarminSyncStateStore(),
      signal: new AbortController().signal,
      configurationWaitMs: 1_000,
      watchdogMs: 1_000,
    }),
  ).rejects.toThrow("BT_CLASSIC_NOT_CONNECTED");
  expect(edge.order).toEqual(["file-types", "event:8", "download:0", "download:1", "archive:1"]);
  expect(edge.closes()).toBe(1);
});

test("a write the device never takes times out and fails the sync", async () => {
  const edge = fakeEdge(new Map([[0, directory([])]]), {
    hangOn: GARMIN_MESSAGE.DOWNLOAD_REQUEST,
  });
  await expect(
    runGarminRfcommSync({
      btClassic: fakeBtClassic(edge.link, []),
      classicAddress: "5A:4B:3C:2D:1E:0F",
      deviceId: "edge-7",
      onRecord: () => undefined,
      syncState: createMemoryGarminSyncStateStore(),
      signal: new AbortController().signal,
      configurationWaitMs: 1_000,
      watchdogMs: 50,
    }),
  ).rejects.toThrow("GARMIN_RFCOMM_WRITE_TIMEOUT");
  expect(edge.closes()).toBe(1);
});

test("a device that never connects back ends the sync incomplete, not failed", async () => {
  const adapter = fakeBtClassic(fakeEdge(new Map()).link, []);
  expect(
    await runGarminRfcommSync({
      btClassic: {
        ...adapter,
        listen: async () => {
          throw new Error("BT_CLASSIC_ACCEPT_TIMEOUT");
        },
      },
      classicAddress: "5A:4B:3C:2D:1E:0F",
      deviceId: "edge-8",
      onRecord: () => undefined,
      syncState: createMemoryGarminSyncStateStore(),
      signal: new AbortController().signal,
    }),
  ).toEqual({ complete: false });
});
