/**
 * Tests for the Fossil Hybrid HR codecs. AGPL-3.0-or-later (same as upstream).
 */

import { expect, test } from "bun:test";
import * as nodeCrypto from "node:crypto";

import {
  FossilEncryptedDownload,
  FossilPlainDownload,
  answerFossilChallenge,
  crc32,
  encodeFossilActivityLookup,
  encodeFossilFileDelete,
  encodeFossilFileGet,
  encodeFossilVerifyStart,
  fossilFileIv,
  fossilHandleFromLookupPayload,
  fossilIncrementIv,
  nodeStyleFossilCrypto,
  parseFossilActivityFile,
  parseFossilAuthKey,
  parseFossilDeleteResult,
  parseFossilGetStart,
  parseFossilLookupStart,
  parseFossilTransferCrc,
  parseFossilVerifyResult,
} from "./fossil-hr";

const crypto = nodeStyleFossilCrypto(nodeCrypto as never);
const KEY = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

test("the key parser strips spaces and every 0x like upstream, and refuses an all-zero key", () => {
  expect(parseFossilAuthKey("0102030405060708090a0b0c0d0e0f10")).toEqual(KEY);
  expect(parseFossilAuthKey("0x01 0x02 03 04 0506 0708 090a 0b0c 0d0e 0f10")).toEqual(KEY);
  expect(parseFossilAuthKey("0x0102030405060708090A0B0C0D0E0F10")).toEqual(KEY);
  expect(parseFossilAuthKey("0102")).toBeNull();
  expect(parseFossilAuthKey("zz02030405060708090a0b0c0d0e0f10")).toBeNull();
  expect(parseFossilAuthKey("00000000000000000000000000000000")).toBeNull();
});

test("authentication answers the watch challenge with the swapped, re-encrypted block", () => {
  const phoneRandom = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  expect(encodeFossilVerifyStart(phoneRandom)).toEqual(
    Uint8Array.of(0x02, 0x01, 0x01, 1, 2, 3, 4, 5, 6, 7, 8),
  );
  // Watch side: encrypts watchRandom || phoneRandom with the shared key.
  const watchRandom = Uint8Array.of(9, 10, 11, 12, 13, 14, 15, 16);
  const challenge = crypto.aesEcbEncrypt(KEY, Uint8Array.from([...watchRandom, ...phoneRandom]));
  const notification = Uint8Array.from([0x03, 0x01, 0x00, 0x00, ...challenge]);
  const answer = answerFossilChallenge(crypto, KEY, notification);
  expect(answer.watchRandom).toEqual(watchRandom);
  expect(Array.from(answer.reply.slice(0, 3))).toEqual([0x02, 0x02, 0x01]);
  // The watch can check the reply: decrypt and expect phoneRandom || watchRandom.
  expect(crypto.aesEcbDecrypt(KEY, answer.reply.slice(3))).toEqual(
    Uint8Array.from([...phoneRandom, ...watchRandom]),
  );
  expect(() => answerFossilChallenge(crypto, KEY, notification.slice(0, 10))).toThrow(
    "FOSSIL_AUTH_CHALLENGE_INVALID",
  );
  expect(parseFossilVerifyResult(Uint8Array.of(0x03, 0x02, 0x00))).toBe(true);
  expect(parseFossilVerifyResult(Uint8Array.of(0x03, 0x02, 0x05))).toBe(false);
  expect(parseFossilVerifyResult(Uint8Array.of(0x03, 0x01, 0x00))).toBeNull();
});

test("file frames match the upstream byte layouts", () => {
  const handle = { minor: 0x07, major: 0x01 };
  expect(Array.from(encodeFossilActivityLookup())).toEqual([0x02, 0xff, 0x01]);
  expect(Array.from(encodeFossilFileGet(handle))).toEqual([
    0x01, 0x07, 0x01, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff,
  ]);
  expect(Array.from(encodeFossilFileDelete(handle))).toEqual([0x0b, 0x07, 0x01]);
  expect(parseFossilDeleteResult(Uint8Array.of(0x8b, 0x07, 0x01, 0x00), handle)).toBe(true);
  expect(parseFossilDeleteResult(Uint8Array.of(0x8b, 0x08, 0x01, 0x00), handle)).toBe(false);
  expect(parseFossilDeleteResult(Uint8Array.of(0x8b, 0x07, 0x01, 0x00, 0x00), handle)).toBeNull();
  expect(parseFossilLookupStart(Uint8Array.of(0x82, 0xff, 0x01, 0x00, 0x10, 0, 0, 0))).toEqual({
    status: 0,
    size: 16,
  });
  expect(
    parseFossilGetStart(Uint8Array.of(0x81, 0x07, 0x01, 0x00, 0x34, 0x12, 0, 0), handle),
  ).toEqual({ status: 0, fileSize: 0x1234 });
  expect(() =>
    parseFossilGetStart(Uint8Array.of(0x81, 0x09, 0x01, 0x00, 0, 0, 0, 0), handle),
  ).toThrow("FOSSIL_FILE_HANDLE_MISMATCH");
  expect(
    parseFossilTransferCrc(Uint8Array.of(0x88, 0x07, 0x01, 0, 0, 0, 0, 0, 0x26, 0x39, 0xf4, 0xcb)),
  ).toBe(0xcbf43926);
  expect(fossilHandleFromLookupPayload(Uint8Array.of(0x07, 0x01, 0xaa))).toEqual(handle);
});

test("CRC32 is the standard IEEE / zlib CRC", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});

test("the file IV places the randoms like upstream; the packet increment wraps at 32 bits", () => {
  const iv = fossilFileIv(
    Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
    Uint8Array.of(9, 10, 11, 12, 13, 14, 15, 16),
  );
  expect(Array.from(iv)).toEqual([0, 0, 1, 2, 3, 4, 5, 7, 0, 9, 10, 11, 12, 13, 14, 15]);
  const nearWrap = new Uint8Array(16);
  nearWrap.set([0xaa, 0xff, 0xff, 0xff, 0xfe], 11);
  const wrapped = fossilIncrementIv(nearWrap, 3);
  expect(Array.from(wrapped.slice(11))).toEqual([0xaa, 0x00, 0x00, 0x00, 0x01]);
});

/** Simulates the watch: one CTR stream, each packet starting `summand` blocks later. */
function encryptedPackets(file: Uint8Array, packetLength: number, baseIv: Uint8Array) {
  const payloadSize = packetLength - 1;
  const count = Math.ceil(file.length / payloadSize);
  const summand = Math.ceil(packetLength / 16);
  return Array.from({ length: count }, (_, index) => {
    const payload = file.slice(index * payloadSize, (index + 1) * payloadSize);
    const marker = (index & 0x7f) | (index === count - 1 ? 0x80 : 0);
    const plain = Uint8Array.from([marker, ...payload]);
    return crypto.aesCtr(KEY, fossilIncrementIv(baseIv, summand * index), plain);
  });
}

for (const packetLength of [509, 244, 182, 20]) {
  test(`an encrypted download reassembles and verifies at ${packetLength}-byte packets`, () => {
    const file = Uint8Array.from({ length: 2_000 }, (_, index) => (index * 7) & 0xff);
    const iv = fossilFileIv(crypto.randomBytes(8), crypto.randomBytes(8));
    const download = new FossilEncryptedDownload(crypto, KEY, iv, file.length);
    const packets = encryptedPackets(file, packetLength, iv);
    packets.forEach((packet, index) => {
      expect(download.push(packet)).toBe(index === packets.length - 1);
    });
    expect(download.result(crc32(file))).toEqual(file);
  });
}

test("a corrupted or truncated download never yields data", () => {
  const file = Uint8Array.from({ length: 1_000 }, (_, index) => index & 0xff);
  const iv = fossilFileIv(crypto.randomBytes(8), crypto.randomBytes(8));
  const packets = encryptedPackets(file, 182, iv);
  const truncated = new FossilEncryptedDownload(crypto, KEY, iv, file.length);
  for (const packet of packets.slice(0, -1)) truncated.push(packet);
  expect(() => truncated.result(crc32(file))).toThrow("FOSSIL_FILE_INCOMPLETE");
  const corrupt = new FossilEncryptedDownload(crypto, KEY, iv, file.length);
  for (const packet of packets) corrupt.push(packet);
  expect(() => corrupt.result(crc32(file) ^ 1)).toThrow("FOSSIL_FILE_CRC_MISMATCH");
  const oversized = new FossilEncryptedDownload(crypto, KEY, iv, 100);
  expect(() => {
    for (const packet of packets) oversized.push(packet);
  }).toThrow("FOSSIL_FILE_OVERFLOW");
});

test("the plain lookup payload reassembles until the final marker and checks its CRC", () => {
  const download = new FossilPlainDownload();
  expect(download.push(Uint8Array.of(0x00, 0x07, 0x01))).toBe(false);
  expect(download.push(Uint8Array.of(0x81, 0xaa))).toBe(true);
  const payload = Uint8Array.of(0x07, 0x01, 0xaa);
  expect(download.result(crc32(payload))).toEqual(payload);
  expect(() => download.push(Uint8Array.of(0x00))).toThrow("FOSSIL_FILE_PACKET_AFTER_FINAL");
});

const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const le32 = (value: number) => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

function header(timestamp: number): number[] {
  const bytes = Array.from({ length: 52 }, () => 0);
  bytes.splice(2, 2, ...le16(22));
  bytes.splice(8, 4, ...le32(timestamp));
  return bytes;
}

test("the HR variant parses resyncs, 8-byte and 6-byte minute records, skips and the trailer", () => {
  const start = 1_700_000_000;
  const resync = 1_700_003_600;
  const file = Uint8Array.from([
    ...header(start),
    // CE wear=wearing(0x08) quality=5 (0xa0) → E2 04 resync, then a 4-byte sample.
    0xce,
    0xa8,
    0xe2,
    0x04,
    ...le32(resync),
    ...le16(60),
    ...le16(0),
    0x08,
    0x00,
    72,
    0x45,
    // CE, f1/f2 discarded, then an 8-byte record's sample: 12 steps, HR 80.
    0xce,
    0x08,
    0x11,
    0x22,
    0x0c,
    0x00,
    80,
    0x02,
    // CE 6-byte record (next byte two ahead is a valid flag): 6 steps, HR 0.
    0xce,
    0x00,
    0x06,
    0x00,
    0,
    0x01,
    // Skips: CB x, C2 x x x, DD + 20, then a 6-byte record left unfinished.
    0xcb,
    0x80,
    0xc2,
    1,
    2,
    3,
    0xdd,
    ...Array.from({ length: 20 }, () => 0x55),
    // Trailer (never parsed).
    0xde,
    0xad,
    0xbe,
    0xef,
  ]);
  const parsed = parseFossilActivityFile(file);
  expect(parsed.variant).toBe("hr");
  expect(parsed.samples).toEqual([
    {
      timestamp: resync,
      steps: 8,
      heartRate: 72,
      heartRateQuality: 5,
      calories: 5,
      active: true,
      wear: "wearing",
    },
    {
      timestamp: resync + 60,
      steps: 12,
      heartRate: 80,
      heartRateQuality: 0,
      calories: 2,
      active: false,
      wear: "wearing",
    },
    {
      timestamp: resync + 120,
      steps: 6,
      heartRate: 0,
      heartRateQuality: 0,
      calories: 1,
      active: false,
      wear: "not_wearing",
    },
  ]);
});

test("the step-only variant reads fixed records from offset 44 and stops at a non-FF byte", () => {
  const timestamp = 1_700_000_040;
  const bytes = header(0);
  bytes.splice(32, 10, 0xe2, 0x04, ...le32(timestamp), ...le16(0), ...le16(0));
  bytes.splice(44, 8, 0x0a, 0x00, 0xff, 0x43, 0x03, 0x00, 0xff, 0x01);
  const file = Uint8Array.from([
    ...bytes,
    // Offset 52 is not an HR-stream starter, so this is the step-only variant.
    0x10,
    0x00,
    0xff,
    0x00,
    0x02,
    0x00,
    0x00,
    0x00, // byte 2 is not 0xFF: parsing stops here
    0x04,
    0x00,
    0xff,
    0x00,
  ]);
  const parsed = parseFossilActivityFile(file);
  expect(parsed.variant).toBe("steps_only");
  expect(
    parsed.samples.map((sample) => [
      sample.timestamp,
      sample.steps,
      sample.calories,
      sample.active,
    ]),
  ).toEqual([
    [timestamp, 10, 3, true],
    [timestamp + 60, 2, 1, false],
    [timestamp + 120, 16, 0, false],
  ]);
});

test("a wrong version or a truncated record makes parsing fail (the file must not be deleted)", () => {
  const wrongVersion = Uint8Array.from([
    ...header(1_700_000_000),
    0xce,
    0x08,
    0x11,
    0x22,
    0,
    0,
    0,
    0,
  ]);
  wrongVersion[2] = 21;
  expect(() => parseFossilActivityFile(wrongVersion)).toThrow("FOSSIL_ACTIVITY_VERSION");
  // DD needs 20 bytes; only 6 follow.
  const truncated = Uint8Array.from([...header(1_700_000_000), 0xdd, 1, 2, 3, 4, 5, 6]);
  expect(() => parseFossilActivityFile(truncated)).toThrow("FOSSIL_ACTIVITY_TRUNCATED");
  expect(() => parseFossilActivityFile(new Uint8Array(20))).toThrow("FOSSIL_ACTIVITY_TRUNCATED");
});

test("a workout block with a too-short duration or type attribute fails like upstream", () => {
  const attribute = (id: number, size: number) => [
    id,
    size,
    ...Array.from({ length: size }, () => 0),
  ];
  const block = (durationSize: number, typeSize: number) =>
    Uint8Array.from([
      ...header(1_700_000_000),
      0xe0,
      ...attribute(2, durationSize),
      ...attribute(9, typeSize),
      ...Array.from({ length: 12 }, (_, index) => attribute(20 + index, 1)).flat(),
      0xde,
      0xad,
      0xbe,
      0xef,
    ]);
  expect(() => parseFossilActivityFile(block(4, 1))).not.toThrow();
  expect(() => parseFossilActivityFile(block(2, 1))).toThrow("FOSSIL_ACTIVITY_TRUNCATED");
  expect(() => parseFossilActivityFile(block(4, 0))).toThrow("FOSSIL_ACTIVITY_TRUNCATED");
});
