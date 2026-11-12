/**
 * Tests for the Fossil Hybrid HR session against a simulated watch.
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";
import * as nodeCrypto from "node:crypto";
import type { BleError, Characteristic, Subscription } from "react-native-ble-plx";

import { createFossilHrSession } from "./fossil-hr";
import {
  FOSSIL_AUTH_UUID,
  FOSSIL_FILE_CONTROL_UUID,
  FOSSIL_FILE_DATA_UUID,
  FOSSIL_FIRMWARE_REVISION_UUID,
  FOSSIL_MODEL_NUMBER_UUID,
  FOSSIL_SERVICE_UUID,
  crc32,
  fossilFileIv,
  fossilIncrementIv,
  nodeStyleFossilCrypto,
} from "../protocol/fossil-hr";

const crypto = nodeStyleFossilCrypto(nodeCrypto as never);
const KEY = Uint8Array.from({ length: 16 }, (_, index) => 0x40 + index);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromB64 = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
const le32 = (value: number) => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

type Callback = (error: BleError | null, value: Characteristic | null) => void;

/** A simulated Fossil Gen 6 Hybrid that serves one activity file. */
function fakeWatch(
  options: {
    file?: Uint8Array | null;
    key?: Uint8Array;
    modelNumber?: string;
    firmware?: string;
    packetLength?: number;
    corruptCrc?: boolean;
    stallGet?: boolean;
    /** Sends file packets asynchronously, this far apart. */
    packetDelayMs?: number;
  } = {},
) {
  const watchKey = options.key ?? KEY;
  const monitors = new Map<string, Callback>();
  const writes: { uuid: string; bytes: Uint8Array }[] = [];
  const deletes: number[][] = [];
  let phoneRandom: Uint8Array = new Uint8Array(8);
  let watchRandom: Uint8Array = new Uint8Array(8);
  let verifies = 0;
  const handle = { minor: 0x05, major: 0x01 };
  const notify = (uuid: string, bytes: Uint8Array) =>
    monitors.get(uuid)?.(null, { value: b64(bytes) } as Characteristic);
  const file =
    options.file === undefined
      ? Uint8Array.from({ length: 900 }, (_, i) => (i * 13) & 0xff)
      : options.file;

  const onWrite = (uuid: string, bytes: Uint8Array) => {
    writes.push({ uuid, bytes });
    if (uuid === FOSSIL_AUTH_UUID && bytes[0] === 0x02 && bytes[1] === 0x01) {
      phoneRandom = bytes.slice(3, 11);
      watchRandom = crypto.randomBytes(8);
      const challenge = crypto.aesEcbEncrypt(
        watchKey,
        Uint8Array.from([...watchRandom, ...phoneRandom]),
      );
      notify(FOSSIL_AUTH_UUID, Uint8Array.from([0x03, 0x01, 0x00, 0x00, ...challenge]));
    } else if (uuid === FOSSIL_AUTH_UUID && bytes[0] === 0x02 && bytes[1] === 0x02) {
      const answer = crypto.aesEcbDecrypt(watchKey, bytes.slice(3, 19));
      const ok = Buffer.from(answer).equals(Buffer.from([...phoneRandom, ...watchRandom]));
      if (ok) verifies += 1;
      notify(FOSSIL_AUTH_UUID, Uint8Array.of(0x03, 0x02, ok ? 0x00 : 0x05));
    } else if (uuid === FOSSIL_FILE_CONTROL_UUID && bytes[0] === 0x02) {
      if (!file) {
        notify(FOSSIL_FILE_CONTROL_UUID, Uint8Array.of(0x82, 0xff, 0x01, 0x00, 0, 0, 0, 0));
        return;
      }
      const payload = Uint8Array.of(handle.minor, handle.major, 0x00, 0x00);
      notify(
        FOSSIL_FILE_CONTROL_UUID,
        Uint8Array.of(0x82, 0xff, 0x01, 0x00, ...le32(payload.length)),
      );
      notify(FOSSIL_FILE_DATA_UUID, Uint8Array.from([0x80, ...payload]));
      notify(
        FOSSIL_FILE_CONTROL_UUID,
        Uint8Array.of(0x88, 0xff, 0x01, 0, 0, 0, 0, 0, ...le32(crc32(payload))),
      );
    } else if (uuid === FOSSIL_FILE_CONTROL_UUID && bytes[0] === 0x01 && file) {
      if (bytes[1] !== handle.minor || bytes[2] !== handle.major) throw new Error("wrong handle");
      notify(
        FOSSIL_FILE_CONTROL_UUID,
        Uint8Array.of(0x81, handle.minor, handle.major, 0x00, ...le32(file.length)),
      );
      if (options.stallGet) return;
      const iv = fossilFileIv(phoneRandom, watchRandom);
      const packetLength = options.packetLength ?? 182;
      const payloadSize = packetLength - 1;
      const count = Math.ceil(file.length / payloadSize);
      const summand = Math.ceil(packetLength / 16);
      const packets = Array.from({ length: count }, (_, index) => {
        const marker = (index & 0x7f) | (index === count - 1 ? 0x80 : 0);
        const plain = Uint8Array.from([
          marker,
          ...file.slice(index * payloadSize, (index + 1) * payloadSize),
        ]);
        return crypto.aesCtr(watchKey, fossilIncrementIv(iv, summand * index), plain);
      });
      const crc = options.corruptCrc ? crc32(file) ^ 0xff : crc32(file);
      const finish = () =>
        notify(
          FOSSIL_FILE_CONTROL_UUID,
          Uint8Array.of(0x88, handle.minor, handle.major, 0, 0, 0, 0, 0, ...le32(crc)),
        );
      if (options.packetDelayMs === undefined) {
        for (const packet of packets) notify(FOSSIL_FILE_DATA_UUID, packet);
        finish();
      } else {
        const delay = options.packetDelayMs;
        const send = (index: number) =>
          setTimeout(() => {
            if (index < packets.length) {
              notify(FOSSIL_FILE_DATA_UUID, packets[index]!);
              send(index + 1);
            } else finish();
          }, delay);
        send(0);
      }
    } else if (uuid === FOSSIL_FILE_CONTROL_UUID && bytes[0] === 0x0b) {
      deletes.push([bytes[1]!, bytes[2]!]);
      notify(FOSSIL_FILE_CONTROL_UUID, Uint8Array.of(0x8b, bytes[1]!, bytes[2]!, 0x00));
    }
  };

  const characteristics = [FOSSIL_FILE_CONTROL_UUID, FOSSIL_FILE_DATA_UUID, FOSSIL_AUTH_UUID].map(
    (uuid) => ({ uuid, isWritableWithResponse: true }) as Characteristic,
  );
  let disconnects = 0;
  const device = {
    characteristicsForService: async (service: string) =>
      service === FOSSIL_SERVICE_UUID ? characteristics : [],
    monitorCharacteristicForService: (_service: string, uuid: string, callback: Callback) => {
      monitors.set(uuid, callback);
      return { remove: () => monitors.delete(uuid) } as Subscription;
    },
    readCharacteristicForService: async (_service: string, uuid: string) => ({
      value: b64(
        new TextEncoder().encode(
          uuid === FOSSIL_FIRMWARE_REVISION_UUID
            ? (options.firmware ?? "VA0.0.2.20r.v8")
            : uuid === FOSSIL_MODEL_NUMBER_UUID
              ? (options.modelNumber ?? "VA.0.0")
              : "",
        ),
      ),
    }),
    requestMTU: async () => device,
    writeCharacteristicWithResponseForService: async (
      _service: string,
      uuid: string,
      value: string,
    ) => {
      onWrite(uuid, fromB64(value));
      return {} as Characteristic;
    },
    writeCharacteristicWithoutResponseForService: async () => ({}) as Characteristic,
    cancelConnection: async () => {
      disconnects += 1;
      return device;
    },
  };
  return {
    device,
    writes,
    deletes,
    handle,
    file,
    verifies: () => verifies,
    disconnects: () => disconnects,
    notify,
  };
}

function session(watch: ReturnType<typeof fakeWatch>, extra: { advertisedName?: string } = {}) {
  return createFossilHrSession({
    device: watch.device as never,
    nativeId: "AA:BB:CC:DD:EE:FF",
    advertisedName: extra.advertisedName ?? "Gen 6 Hybrid",
    crypto,
    responseTimeoutMs: 1_000,
  });
}

const signal = () => new AbortController().signal;

test("prepare resolves the model from firmware and model number, with no auth or file access", async () => {
  const watch = fakeWatch();
  const peer = await session(watch).prepare(signal());
  expect(peer.model.id).toBe("fossil_gen_6_hybrid");
  expect(watch.writes).toHaveLength(0);
  const jorn = await session(fakeWatch(), { advertisedName: "Skagen Jorn" }).prepare(signal());
  expect(jorn.model.id).toBe("skagen_jorn_gen_6");
  const hybrid = await session(
    fakeWatch({ modelNumber: "IV.0.0", firmware: "IV0.0.1.12r" }),
  ).prepare(signal());
  expect(hybrid.model.id).toBe("fossil_hybrid_hr");
});

test("a non-HR Q Hybrid or an unknown model number is refused", async () => {
  await expect(
    session(fakeWatch({ firmware: "HW0.0.2.5r", modelNumber: "HW.0.0" })).prepare(signal()),
  ).rejects.toThrow("FOSSIL_MODEL_UNSUPPORTED");
  await expect(session(fakeWatch({ modelNumber: "XX.9.9" })).prepare(signal())).rejects.toThrow(
    "FOSSIL_MODEL_UNSUPPORTED",
  );
});

test("download verifies the key twice, decrypts the file and deletes nothing", async () => {
  const watch = fakeWatch();
  const fossil = session(watch);
  await fossil.prepare(signal());
  const result = await fossil.downloadActivity({ key: KEY, signal: signal() });
  expect(result.status).toBe("file");
  if (result.status !== "file") return;
  expect(result.handle).toEqual(watch.handle);
  expect(result.data).toEqual(watch.file!);
  expect(result.crc).toBe(crc32(watch.file!));
  expect(watch.verifies()).toBe(2);
  expect(watch.deletes).toEqual([]);
  // Order: verify, lookup, verify, get.
  const ops = watch.writes.map(({ uuid, bytes }) =>
    uuid === FOSSIL_AUTH_UUID ? `auth${bytes[1]}` : `file${bytes[0]}`,
  );
  expect(ops).toEqual(["auth1", "auth2", "file2", "auth1", "auth2", "file1"]);
});

test("delete sends exactly the fetched dynamic handle and reports the watch's answer", async () => {
  const watch = fakeWatch();
  const fossil = session(watch);
  await fossil.prepare(signal());
  const result = await fossil.downloadActivity({ key: KEY, signal: signal() });
  if (result.status !== "file") throw new Error("expected a file");
  await expect(fossil.deleteFile({ handle: result.handle, signal: signal() })).resolves.toBe(true);
  expect(watch.deletes).toEqual([[0x05, 0x01]]);
});

test("an empty activity file needs no get and reports empty", async () => {
  const watch = fakeWatch({ file: null });
  const fossil = session(watch);
  await fossil.prepare(signal());
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).resolves.toEqual({
    status: "empty",
  });
  expect(watch.writes.some(({ bytes }) => bytes[0] === 0x01 && bytes.length === 11)).toBe(false);
});

test("a wrong key fails authentication before any file is requested", async () => {
  const watch = fakeWatch({ key: Uint8Array.from({ length: 16 }, () => 0x11) });
  const fossil = session(watch);
  await fossil.prepare(signal());
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).rejects.toThrow(
    "FOSSIL_AUTH_FAILED",
  );
  expect(watch.writes.some(({ uuid }) => uuid === FOSSIL_FILE_CONTROL_UUID)).toBe(false);
});

test("a CRC mismatch yields no data", async () => {
  const watch = fakeWatch({ corruptCrc: true });
  const fossil = session(watch);
  await fossil.prepare(signal());
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).rejects.toThrow(
    "FOSSIL_FILE_CRC_MISMATCH",
  );
});

test("downloads decrypt at the large MTU-512 packet size too", async () => {
  const watch = fakeWatch({
    packetLength: 509,
    file: Uint8Array.from({ length: 3_000 }, (_, i) => i & 0xff),
  });
  const fossil = session(watch);
  await fossil.prepare(signal());
  const result = await fossil.downloadActivity({ key: KEY, signal: signal() });
  expect(result.status === "file" && result.data.length).toBe(3_000);
});

test("cancelling a stalled download rejects CANCELLED and sends no delete", async () => {
  const watch = fakeWatch({ stallGet: true });
  const fossil = session(watch);
  await fossil.prepare(signal());
  const abort = new AbortController();
  const download = fossil.downloadActivity({ key: KEY, signal: abort.signal });
  await new Promise((resolve) => setTimeout(resolve, 10));
  abort.abort();
  await expect(download).rejects.toThrow("CANCELLED");
  expect(watch.deletes).toEqual([]);
});

test("a stalled download times out instead of hanging", async () => {
  const watch = fakeWatch({ stallGet: true });
  const fossil = createFossilHrSession({
    device: watch.device as never,
    nativeId: "AA:BB:CC:DD:EE:FF",
    crypto,
    responseTimeoutMs: 50,
  });
  await fossil.prepare(signal());
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).rejects.toThrow(
    "FOSSIL_RESPONSE_TIMEOUT",
  );
});

test("close disconnects and later calls are refused", async () => {
  const watch = fakeWatch();
  const fossil = session(watch);
  await fossil.prepare(signal());
  await fossil.close();
  expect(watch.disconnects()).toBe(1);
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).rejects.toThrow(
    "CANCELLED",
  );
});

test("an empty sync leaves no stray waiter: the next sync on the same link succeeds", async () => {
  const watch = fakeWatch({ file: null });
  const fossil = session(watch);
  await fossil.prepare(signal());
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).resolves.toEqual({
    status: "empty",
  });
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).resolves.toEqual({
    status: "empty",
  });
});

test("a failed download fails only itself; the next request on the same link works", async () => {
  const watch = fakeWatch({ corruptCrc: true });
  const fossil = session(watch);
  await fossil.prepare(signal());
  await expect(fossil.downloadActivity({ key: KEY, signal: signal() })).rejects.toThrow(
    "FOSSIL_FILE_CRC_MISMATCH",
  );
  await expect(fossil.deleteFile({ handle: watch.handle, signal: signal() })).resolves.toBe(true);
});

test("a transfer longer than the reply timeout succeeds while packets keep arriving", async () => {
  // 12 packets 30 ms apart take ~390 ms; the reply timeout is 100 ms.
  const watch = fakeWatch({
    packetDelayMs: 30,
    file: Uint8Array.from({ length: 2_000 }, (_, i) => i & 0xff),
  });
  const fossil = createFossilHrSession({
    device: watch.device as never,
    nativeId: "AA:BB:CC:DD:EE:FF",
    crypto,
    responseTimeoutMs: 100,
  });
  await fossil.prepare(signal());
  const result = await fossil.downloadActivity({ key: KEY, signal: signal() });
  expect(result.status === "file" && result.data.length).toBe(2_000);
});
