import { expect, test } from "bun:test";
import type { Characteristic, Device, Subscription } from "react-native-ble-plx";
import { computeXiaomiAuthStep3Hmac, type XiaomiAuthCrypto } from "../crypto/xiaomi-auth";
import { decodeCommand, encodeCommand, type XiaomiCommand } from "../protocol/xiaomi-proto";
import { crc32 } from "../protocol/chunked";
import {
  encodeXiaomiActivityFileId,
  parseXiaomiDailyDetails,
  type XiaomiActivityFileId,
  XIAOMI_ACTIVITY_DAILY,
  XIAOMI_ACTIVITY_TYPE,
  XIAOMI_DETAIL_DETAILS,
} from "../protocol/xiaomi-activity";
import {
  encodeXiaomiV1Chunk,
  encodeXiaomiV1ChunkedStart,
  encodeXiaomiV1Single,
  NativeXiaomiLink,
  parseXiaomiV1Packet,
  XIAOMI_V1_CHUNK_END_ACK,
  XIAOMI_V1_CHUNK_START_ACK,
  XIAOMI_V1_PROFILES,
  XIAOMI_V2_PROFILE,
} from "./xiaomi-link";
import { XiaomiBleHistoryTransport } from "./xiaomi-session";

const bytes = (value: Uint8Array) => Array.from(value);

function innerFileChunk(body: Uint8Array): Uint8Array {
  const file = new Uint8Array(body.length + 4);
  file.set(body);
  new DataView(file.buffer).setUint32(body.length, crc32(body), true);
  const chunk = new Uint8Array(file.length + 4);
  chunk[0] = 1;
  chunk[2] = 1;
  chunk.set(file, 4);
  return chunk;
}

function dailyDetailsFile(id: XiaomiActivityFileId, steps: number[]): Uint8Array {
  const body = new Uint8Array(13 + steps.length * 2);
  body.set(encodeXiaomiActivityFileId(id));
  body.set([0x90, 0, 0, 0, 0], 8);
  steps.forEach((step, i) => {
    body[13 + i * 2] = step & 0xff;
    body[14 + i * 2] = step >>> 8;
  });
  const file = new Uint8Array(body.length + 4);
  file.set(body);
  new DataView(file.buffer).setUint32(body.length, crc32(body), true);
  return file;
}

function innerActivityChunk(index: number, total: number, bytes: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(bytes.length + 4);
  chunk[0] = total & 0xff;
  chunk[1] = total >>> 8;
  chunk[2] = index & 0xff;
  chunk[3] = index >>> 8;
  chunk.set(bytes, 4);
  return chunk;
}

function fakeCrypto() {
  let decryptCalls = 0;
  return Object.assign(
    {
      randomBytes: (size) => new Uint8Array(size).fill(0x31),
      hmacSha256: (key, data) => {
        // Stable test-only digest; production uses the native HMAC primitive.
        let state = 0x811c9dc5;
        for (const byte of [...key, ...data]) state = Math.imul(state ^ byte, 0x01000193);
        return Uint8Array.from({ length: 32 }, (_, i) => (state >>> ((i % 4) * 8)) ^ i);
      },
      aesCcmEncrypt: (_key, _nonce, plaintext) => plaintext,
      aesCcmDecrypt: (_key, _nonce, ciphertext) => {
        decryptCalls += 1;
        return ciphertext;
      },
      aesCtrCrypt: (_key, _iv, data) => data,
    } satisfies XiaomiAuthCrypto,
    { getDecryptCalls: () => decryptCalls },
  );
}

type Notify = (error: unknown, value: Characteristic | null) => void;
function peripheral(mtu = 23) {
  const subscribers = new Map<string, Notify>();
  const sent: Array<{ characteristic: string; packet: Uint8Array }> = [];
  let onWrite: ((uuid: string, packet: Uint8Array) => void) | undefined;
  const encode = (raw: Uint8Array) => btoa(String.fromCharCode(...raw));
  const device = {
    mtu,
    monitorCharacteristicForService: (_service: string, uuid: string, cb: Notify) => {
      subscribers.set(uuid, cb);
      return { remove: () => subscribers.delete(uuid) } as unknown as Subscription;
    },
    writeCharacteristicWithResponseForService: async (
      _service: string,
      uuid: string,
      value: string,
    ) => {
      const packet = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
      sent.push({ characteristic: uuid, packet });
      onWrite?.(uuid, packet);
      return {} as Characteristic;
    },
    writeCharacteristicWithoutResponseForService: async () => ({}) as Characteristic,
  } as unknown as Device;
  return {
    device,
    sent,
    setWriter: (handler: typeof onWrite) => (onWrite = handler),
    notify: (uuid: string, raw: Uint8Array) =>
      subscribers.get(uuid)?.(null, { value: encode(raw) } as Characteristic),
  };
}

function harness(profileIndex: number, mtu = 23) {
  const profile = XIAOMI_V1_PROFILES[profileIndex]!;
  const radio = peripheral(mtu);
  const link = new NativeXiaomiLink(radio.device, profile);
  const crypto = fakeCrypto();
  const session = new XiaomiBleHistoryTransport(link, profile, {
    authKey: new Uint8Array(16).fill(7),
    userId: "test-account",
    crypto,
    sessionTimeoutMs: 60,
  });

  let commandBuffer: Uint8Array[] = [];
  let commandCount = 0;
  let encryptedCommands = false;
  let activityAcks: Uint8Array[] = [];
  let authMode: "clear" | "encrypted" | null = null;
  const observedCommands: XiaomiCommand[] = [];
  const notify = (command: XiaomiCommand, encrypted = false) => {
    radio.notify(
      profile.commandReadUuid,
      encodeXiaomiV1Single(encodeCommand(command), { encrypted }),
    );
  };
  radio.setWriter((uuid, raw) => {
    if (uuid === profile.activityDataUuid) {
      activityAcks.push(raw);
      return;
    }
    if (uuid !== profile.commandWriteUuid) return;
    const packet = parseXiaomiV1Packet(raw);
    if (packet.kind === "chunk_start") {
      commandCount = packet.count;
      commandBuffer = [];
      encryptedCommands = packet.encrypted;
      radio.notify(profile.commandWriteUuid, XIAOMI_V1_CHUNK_START_ACK);
      return;
    }
    if (packet.kind === "chunk") {
      commandBuffer[packet.index - 1] = packet.payload;
      if (commandBuffer.filter(Boolean).length !== commandCount) return;
      radio.notify(profile.commandWriteUuid, XIAOMI_V1_CHUNK_END_ACK);
      const full = Uint8Array.from(commandBuffer.flatMap(bytes));
      const offset = encryptedCommands ? 2 : 0;
      const command = decodeCommand(full.slice(offset));
      observedCommands.push(command);
      if (command.type === 1 && command.subtype === 5) {
        authMode = "clear";
        notify({ type: 1, subtype: 5, auth: { status: 1 } });
      } else if (command.type === 1 && command.subtype === 26 && command.auth?.appVerify) {
        authMode = "encrypted";
        const watchNonce = new Uint8Array(16).fill(0x42);
        const phoneNonce = command.auth.appVerify.nonce;
        const derived = computeXiaomiAuthStep3Hmac(
          crypto,
          new Uint8Array(16).fill(7),
          phoneNonce,
          watchNonce,
        );
        const hmac = crypto.hmacSha256(
          derived.slice(0, 16),
          Uint8Array.from([...watchNonce, ...phoneNonce]),
        );
        notify({ type: 1, subtype: 26, auth: { deviceVerify: { nonce: watchNonce, hmac } } });
      } else if (command.type === 1 && command.subtype === 27) {
        notify({ type: 1, subtype: 27, auth: { status: 1 } });
      }
      return;
    }
    if (packet.kind === "single") radio.notify(profile.commandWriteUuid, Uint8Array.of(0, 0, 3, 0));
  });
  return {
    profile,
    radio,
    session,
    crypto,
    observedCommands,
    getAuthMode: () => authMode,
    getActivityAcks: () => activityAcks,
  };
}

test("plaintext V1 executes upstream CMD_SEND_USERID handshake without encrypted auth", async () => {
  const h = harness(1);
  await h.session.start(new AbortController().signal);
  expect(h.getAuthMode()).toBe("clear");
  expect(h.observedCommands[0]).toMatchObject({
    type: 1,
    subtype: 5,
    auth: { userId: "test-account" },
  });
  expect(h.radio.sent.some(({ packet }) => packet[2] === 0 && packet[3] === 0)).toBe(true);
  expect(h.radio.sent.every(({ packet }) => !(packet[2] === 2 && packet[3] === 1))).toBe(true);
  await h.session.close();
});

test("encrypted V1 performs nonce/HMAC/app-confirm handshake", async () => {
  const h = harness(0);
  await h.session.start(new AbortController().signal);
  expect(h.getAuthMode()).toBe("encrypted");
  await h.session.close();
});

test("V1 activity framed chunks are ACKed and delivered reassembled", async () => {
  const h = harness(1);
  await h.session.start(new AbortController().signal);
  const pending = h.session.nextActivityFile(new AbortController().signal);
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1ChunkedStart(false, 2));
  const fileChunk = innerFileChunk(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(0, fileChunk.slice(0, 8)));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(1, fileChunk.slice(8)));
  expect(await pending).toEqual(fileChunk.slice(4));
  expect(h.getActivityAcks().map(bytes)).toEqual([
    bytes(XIAOMI_V1_CHUNK_START_ACK),
    bytes(XIAOMI_V1_CHUNK_END_ACK),
  ]);
  await h.session.close();
});

test("encrypted V1 activity is decrypted after chunk reassembly and ACK", async () => {
  const h = harness(0);
  await h.session.start(new AbortController().signal);
  const pending = h.session.nextActivityFile(new AbortController().signal);
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1ChunkedStart(true, 2));
  const fileChunk = innerFileChunk(Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0, 1, 2));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(0, fileChunk.slice(0, 8)));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(1, fileChunk.slice(8)));
  expect(await pending).toEqual(fileChunk.slice(4));
  expect(h.crypto.getDecryptCalls()).toBe(1);
  expect(h.getActivityAcks().map(bytes)).toEqual([
    bytes(XIAOMI_V1_CHUNK_START_ACK),
    bytes(XIAOMI_V1_CHUNK_END_ACK),
  ]);
  await h.session.close();
});

test("NativeXiaomiLink reassembles upstream inner daily-details chunks across outer V1 framing", async () => {
  const h = harness(1);
  const id: XiaomiActivityFileId = {
    timestamp: 1_700_000_000,
    timezone: 8,
    type: XIAOMI_ACTIVITY_TYPE,
    subtype: XIAOMI_ACTIVITY_DAILY,
    detailType: XIAOMI_DETAIL_DETAILS,
    version: 3,
  };
  const file = dailyDetailsFile(id, [42, 7, 19, 3]);
  const firstInner = innerActivityChunk(1, 2, file.slice(0, 12));
  const secondInner = innerActivityChunk(2, 2, file.slice(12));
  await h.session.start(new AbortController().signal);

  // The upstream inner header is uint16-le total then uint16-le 1-based index.
  // Inner chunk 1 arrives as one outer characteristic packet; chunk 2 is split
  // across two outer characteristic packets (the V1 transport framing).
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1ChunkedStart(false, 1));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(0, firstInner));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1ChunkedStart(false, 2));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(0, secondInner.slice(0, 8)));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(1, secondInner.slice(8)));

  const bytesFromTransport = await h.session.nextActivityFile(new AbortController().signal);
  expect(bytesFromTransport).toEqual(file);
  expect(parseXiaomiDailyDetails(bytesFromTransport, id).minutes).toEqual([
    { timestamp: id.timestamp * 1000, steps: 42 },
    { timestamp: id.timestamp * 1000 + 60_000, steps: 7 },
    { timestamp: id.timestamp * 1000 + 120_000, steps: 19 },
    { timestamp: id.timestamp * 1000 + 180_000, steps: 3 },
  ]);
  await h.session.close();
});

test("completed activity files queue until a waiter and invalid CRC is rejected before handoff", async () => {
  const h = harness(1);
  const id: XiaomiActivityFileId = {
    timestamp: 1_700_000_000,
    timezone: 8,
    type: XIAOMI_ACTIVITY_TYPE,
    subtype: XIAOMI_ACTIVITY_DAILY,
    detailType: XIAOMI_DETAIL_DETAILS,
    version: 3,
  };
  const file = dailyDetailsFile(id, [11, 12]);
  await h.session.start(new AbortController().signal);
  const inner = innerActivityChunk(1, 1, file);
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1ChunkedStart(false, 1));
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1Chunk(0, inner));
  expect(await h.session.nextActivityFile(new AbortController().signal)).toEqual(file);

  const corrupted = file.slice();
  corrupted[corrupted.length - 1] ^= 0xff;
  const pending = h.session.nextActivityFile(new AbortController().signal);
  h.radio.notify(h.profile.activityDataUuid!, encodeXiaomiV1ChunkedStart(false, 1));
  h.radio.notify(
    h.profile.activityDataUuid!,
    encodeXiaomiV1Chunk(0, innerActivityChunk(1, 1, corrupted)),
  );
  await expect(pending).rejects.toThrow("XIAOMI_ACTIVITY_CRC");
  await h.session.close();
});

test("outbound command uses MTU-bounded chunks and waits for peer ACK", async () => {
  const h = harness(1, 23);
  await h.session.start(new AbortController().signal);
  const before = h.radio.sent.length;
  const pending = h.session.sendCommand({
    type: 2,
    subtype: 3,
    system: { deviceInfo: { serialNumber: "x".repeat(80), firmware: "f", model: "m" } },
  });
  await pending;
  const writes = h.radio.sent
    .slice(before)
    .filter(({ characteristic }) => characteristic === h.profile.commandWriteUuid);
  expect(writes.length).toBeGreaterThan(2);
  expect(writes.every(({ packet }) => packet.length <= 20)).toBe(true);
  expect(writes[0]!.packet).toEqual(encodeXiaomiV1ChunkedStart(false, writes.length - 1));
  await h.session.close();
});

test("chunked V1 writes advance only on command_write ACK notifications", async () => {
  const h = harness(1, 23);
  await h.session.start(new AbortController().signal);
  let sentChunks = 0;
  let expectedChunks = 0;
  let markStartObserved!: () => void;
  let markChunkObserved!: () => void;
  const startObserved = new Promise<void>((resolve) => {
    markStartObserved = resolve;
  });
  const chunkObserved = new Promise<void>((resolve) => {
    markChunkObserved = resolve;
  });
  h.radio.setWriter((uuid, raw) => {
    if (uuid !== h.profile.commandWriteUuid) return;
    const packet = parseXiaomiV1Packet(raw);
    if (packet.kind === "chunk_start") {
      expectedChunks = packet.count;
      markStartObserved();
      h.radio.notify(h.profile.commandReadUuid, XIAOMI_V1_CHUNK_START_ACK);
    } else if (packet.kind === "chunk") {
      sentChunks += 1;
      if (sentChunks === expectedChunks) markChunkObserved();
    }
  });

  const before = h.radio.sent.length;
  const sending = h.session.sendCommand({ type: 2, subtype: 3 });
  await startObserved;
  const initialWrites = h.radio.sent
    .slice(before)
    .filter(({ characteristic }) => characteristic === h.profile.commandWriteUuid);
  expect(initialWrites).toHaveLength(1);
  expect(parseXiaomiV1Packet(initialWrites[0]!.packet).kind).toBe("chunk_start");

  h.radio.notify(h.profile.commandWriteUuid, XIAOMI_V1_CHUNK_START_ACK);
  await chunkObserved;
  expect(sentChunks).toBeGreaterThan(0);
  h.radio.notify(h.profile.commandWriteUuid, XIAOMI_V1_CHUNK_END_ACK);
  await sending;
  await h.session.close();
});

test("negative chunk ACK and missing ACK timeout reject pending send", async () => {
  const nack = harness(1);
  await nack.session.start(new AbortController().signal);
  nack.radio.setWriter((uuid, raw) => {
    if (uuid === nack.profile.commandWriteUuid && parseXiaomiV1Packet(raw).kind === "chunk_start") {
      nack.radio.notify(nack.profile.commandWriteUuid, Uint8Array.of(0, 0, 1, 2));
    }
  });
  await expect(nack.session.sendCommand({ type: 2 })).rejects.toThrow("XIAOMI_CHUNK_NACK");
  await nack.session.close();

  const timeout = harness(1);
  await timeout.session.start(new AbortController().signal);
  timeout.radio.setWriter(() => undefined);
  await expect(timeout.session.sendCommand({ type: 2 })).rejects.toThrow("XIAOMI_ACK_TIMEOUT");
  await timeout.session.close();
});

test("malformed and truncated activity frames fail the pending activity read", async () => {
  const h = harness(1);
  await h.session.start(new AbortController().signal);
  const pending = h.session.nextActivityFile(new AbortController().signal);
  h.radio.notify(h.profile.activityDataUuid!, Uint8Array.of(0));
  await expect(pending).rejects.toThrow("XIAOMI_V1_TRUNCATED");
  await h.session.close();
});

test("activity read cancellation and start cancellation reject", async () => {
  const h = harness(1);
  await h.session.start(new AbortController().signal);
  const controller = new AbortController();
  const pending = h.session.nextActivityFile(controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("CANCELLED");
  await h.session.close();

  const starting = harness(1);
  starting.radio.setWriter(() => undefined);
  const startAbort = new AbortController();
  const startPromise = starting.session.start(startAbort.signal);
  startAbort.abort();
  await expect(startPromise).rejects.toThrow("CANCELLED");
  await starting.session.close();
});

test("session start and close settle when a native write only stops on cancellation", async () => {
  const cancelled: Array<() => void> = [];
  let nativeStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    nativeStarted = resolve;
  });
  const device = {
    mtu: 23,
    monitorCharacteristicForService: () => ({ remove() {} }) as Subscription,
    writeCharacteristicWithResponseForService: async () => {
      nativeStarted();
      return new Promise<Characteristic>((_resolve, reject) => {
        cancelled.push(() => reject(new Error("cancelled by native manager")));
      });
    },
    writeCharacteristicWithoutResponseForService: async () => ({}) as Characteristic,
  } as unknown as Device;
  const link = new NativeXiaomiLink(device, XIAOMI_V2_PROFILE, {
    cancelTransaction: () => cancelled.shift()?.(),
  });
  const session = new XiaomiBleHistoryTransport(link, XIAOMI_V2_PROFILE, {
    authKey: new Uint8Array(16),
    crypto: fakeCrypto(),
    sessionTimeoutMs: 30,
  });
  const controller = new AbortController();
  const starting = session.start(controller.signal);
  await started;
  controller.abort();
  await expect(starting).rejects.toThrow("CANCELLED");
  await session.close();
});
