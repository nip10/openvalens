/**
 * Codec tests for the Huawei/Honor BLE protocol.
 *
 * Vectors are derived from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2 (`HuaweiPacket.java`,
 * `HuaweiTLV.java`, `HuaweiCrypto.java`, `FitnessData.java`,
 * `util/CheckSums.java`). AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import type { HuaweiCryptoProvider } from "../crypto/huawei-auth";
import {
  HUAWEI_CRYPTO_TAGS,
  HUAWEI_DEFAULT_SLICE_SIZE,
  HUAWEI_ENCRYPTION_COUNTER_MAX,
  HUAWEI_SLEEP_DEEP,
  HUAWEI_SLEEP_LIGHT,
  HuaweiPacketReassembler,
  buildHuaweiAuthRequest,
  buildHuaweiBondParamsRequest,
  buildHuaweiBondRequest,
  buildHuaweiDeviceStatusRequest,
  buildHuaweiFitnessTotalsRequest,
  buildHuaweiLinkParamsRequest,
  buildHuaweiMessageCountRequest,
  buildHuaweiMessageDataRequest,
  buildHuaweiSecurityNegotiationRequest,
  computeHuaweiAuthDigest,
  createHuaweiDeviceSecretKey,
  createHuaweiInitializationVector,
  decodeHuaweiPacket,
  HuaweiStreamDeframer,
  decodeHuaweiTlv,
  decryptHuaweiResponse,
  encodeHuaweiPacket,
  encodeHuaweiTlv,
  encodeHuaweiVarint,
  encryptHuaweiBondingKey,
  generateHuaweiLocalSecretKey,
  getOrCreateHuaweiLocalSecretKey,
  createMemoryHuaweiSecretKeyStore,
  huaweiCrc16,
  huaweiStepMinuteToRecords,
  huaweiUsesGcm,
  parseHuaweiAuthResponse,
  parseHuaweiBondParamsResponse,
  parseHuaweiDeviceStatusResponse,
  parseHuaweiFitnessTotalsResponse,
  parseHuaweiLinkParamsResponse,
  parseHuaweiMessageCountResponse,
  parseHuaweiSecurityNegotiationResponse,
  parseHuaweiSleepDataResponse,
  parseHuaweiStepDataResponse,
  parseHuaweiStepFeatures,
  segmentHuaweiSleepSessions,
  unwrapEncryptedHuaweiTlv,
  wrapEncryptedHuaweiTlv,
  type HuaweiAesProvider,
} from "./huawei";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const fromHex = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));

function nodeCrypto(): HuaweiCryptoProvider {
  const native = require("node:crypto") as typeof import("node:crypto");
  return {
    randomBytes: (size) => Uint8Array.from(native.randomBytes(size)),
    sha256: (data) => Uint8Array.from(native.createHash("sha256").update(data).digest()),
    hmacSha256: (key, data) =>
      Uint8Array.from(native.createHmac("sha256", key).update(data).digest()),
  };
}

function nodeAes(): HuaweiAesProvider {
  const native = require("node:crypto") as typeof import("node:crypto");
  return {
    encryptCbc(key, data, iv) {
      const cipher = native.createCipheriv("aes-128-cbc", key, iv);
      return Uint8Array.from(Buffer.concat([cipher.update(data), cipher.final()]));
    },
    decryptCbc(key, data, iv) {
      const decipher = native.createDecipheriv("aes-128-cbc", key, iv);
      return Uint8Array.from(Buffer.concat([decipher.update(data), decipher.final()]));
    },
    encryptGcm(key, data, iv) {
      const cipher = native.createCipheriv("aes-128-gcm", key, iv);
      const body = Buffer.concat([cipher.update(data), cipher.final()]);
      return Uint8Array.from(Buffer.concat([body, cipher.getAuthTag()]));
    },
    decryptGcm(key, data, iv) {
      const decipher = native.createDecipheriv("aes-128-gcm", key, iv);
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Uint8Array.from(
        Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]),
      );
    },
  };
}

const KEY = fromHex("000102030405060708090a0b0c0d0e0f");
const NONCE = fromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");

// ---------------------------------------------------------------------------
// TLV
// ---------------------------------------------------------------------------

test("TLV round-trips tags, varint lengths and values", () => {
  const encoded = encodeHuaweiTlv([
    { tag: 0x01, value: Uint8Array.of(1, 2) },
    { tag: 0x7c, value: Uint8Array.of(3) },
    { tag: 0x81, value: new Uint8Array(0) },
  ]);
  expect(hex(encoded)).toBe("010201027c01038100");
  expect(decodeHuaweiTlv(encoded)).toEqual([
    { tag: 0x01, value: Uint8Array.of(1, 2) },
    { tag: 0x7c, value: Uint8Array.of(3) },
    { tag: 0x81, value: new Uint8Array(0) },
  ]);
});

test("varints use the upstream 7-bit big-endian groups", () => {
  expect(hex(encodeHuaweiVarint(0))).toBe("00");
  expect(hex(encodeHuaweiVarint(127))).toBe("7f");
  expect(hex(encodeHuaweiVarint(128))).toBe("8100");
  expect(hex(encodeHuaweiVarint(16384))).toBe("818000");
});

test("malformed TLV is rejected", () => {
  expect(() => decodeHuaweiTlv(Uint8Array.of(1, 5, 0))).toThrow("HUAWEI_TLV_TRUNCATED");
});

// ---------------------------------------------------------------------------
// Framing and CRC16
// ---------------------------------------------------------------------------

test("CRC16 matches the upstream CheckSums vectors", () => {
  const digits = Uint8Array.from("123456789", (character) => character.charCodeAt(0));
  expect(huaweiCrc16(digits, 0xffff)).toBe(0x29b1);
  expect(huaweiCrc16(digits, 0x0000)).toBe(0x31c3);
});

test("an unsliced packet round-trips with CRC16", () => {
  const [frame] = encodeHuaweiPacket({
    serviceId: 0x01,
    commandId: 0x02,
    tlv: Uint8Array.of(3, 1, 4),
  });
  expect(frame![0]).toBe(0x5a);
  expect(frame![3]).toBe(0);
  expect(huaweiCrc16(frame!.subarray(0, frame!.length - 2))).toBe(
    (frame![frame!.length - 2]! << 8) | frame![frame!.length - 1]!,
  );
  const decoded = decodeHuaweiPacket(frame!);
  expect(decoded.sliced).toBe(false);
  expect(new HuaweiPacketReassembler().accept(decoded)).toEqual({
    serviceId: 0x01,
    commandId: 0x02,
    tlv: [{ tag: 3, value: Uint8Array.of(4) }],
  });
});

test("a large packet is sliced and reassembled in order", () => {
  const tlv = encodeHuaweiTlv([{ tag: 7, value: new Uint8Array(40).fill(7) }]);
  const frames = encodeHuaweiPacket({ serviceId: 1, commandId: 2, tlv, sliceSize: 20 });
  expect(frames.length).toBeGreaterThan(2);
  expect(frames[0]![3]).toBe(1);
  expect(frames[frames.length - 1]![3]).toBe(3);
  expect(frames.slice(1, -1).every((frame) => frame[3] === 2)).toBe(true);

  const reassembler = new HuaweiPacketReassembler();
  let parsed = null;
  for (const frame of frames) parsed = reassembler.accept(decodeHuaweiPacket(frame));
  expect(parsed).toEqual({
    serviceId: 1,
    commandId: 2,
    tlv: [{ tag: 7, value: new Uint8Array(40).fill(7) }],
  });
});

test("a two-packet slice sequence ends with slice 3", () => {
  const tlv = encodeHuaweiTlv([{ tag: 7, value: new Uint8Array(4).fill(7) }]);
  const frames = encodeHuaweiPacket({ serviceId: 1, commandId: 2, tlv, sliceSize: 12 });
  expect(frames.map((frame) => frame[3])).toEqual([1, 3]);
});

test("malformed packets are rejected", () => {
  const [frame] = encodeHuaweiPacket({
    serviceId: 1,
    commandId: 2,
    tlv: Uint8Array.of(3, 1, 4),
  });
  const corrupted = frame!.slice();
  corrupted[corrupted.length - 3] ^= 0xff;
  expect(() => decodeHuaweiPacket(corrupted)).toThrow("HUAWEI_PACKET_CRC");
  expect(() => decodeHuaweiPacket(frame!.slice(0, 5))).toThrow("HUAWEI_PACKET_TRUNCATED");
  const badMagic = frame!.slice();
  badMagic[0] = 0;
  expect(() => decodeHuaweiPacket(badMagic)).toThrow("HUAWEI_MAGIC");
});

// ---------------------------------------------------------------------------
// AES layer
// ---------------------------------------------------------------------------

test("the IV is 12 random bytes plus the incremented counter", () => {
  const random = fromHex("aabbccddeeff001122334455");
  const first = createHuaweiInitializationVector(0, random);
  expect(hex(first.iv)).toBe("aabbccddeeff00112233445500000001");
  expect(first.counter).toBe(1);
  const second = createHuaweiInitializationVector(0x01020304, random);
  expect(hex(second.iv)).toBe("aabbccddeeff00112233445501020305");
  const wrapped = createHuaweiInitializationVector(HUAWEI_ENCRYPTION_COUNTER_MAX, random);
  expect(hex(wrapped.iv)).toBe("aabbccddeeff00112233445500000001");
});

test("AES-CBC-PKCS7 and AES-GCM round-trip with the IV scheme", () => {
  const aes = nodeAes();
  const { iv } = createHuaweiInitializationVector(7, fromHex("00112233445566778899aabb"));
  const plain = Uint8Array.from("huawei transaction", (character) => character.charCodeAt(0));
  const cbc = aes.encryptCbc(KEY, plain, iv);
  expect(cbc.length % 16).toBe(0);
  expect(aes.decryptCbc(KEY, cbc, iv)).toEqual(plain);
  const gcm = aes.encryptGcm(KEY, plain, iv);
  expect(gcm.length).toBe(plain.length + 16);
  expect(aes.decryptGcm(KEY, gcm, iv)).toEqual(plain);
});

test("the encrypted TLV wrapper round-trips through the session decryptor", () => {
  const aes = nodeAes();
  const { iv } = createHuaweiInitializationVector(0, fromHex("00112233445566778899aabb"));
  const inner = encodeHuaweiTlv([{ tag: 0x01, value: Uint8Array.of(9, 9) }]);
  const wrapped = wrapEncryptedHuaweiTlv(inner, KEY, iv, false, aes);
  const tlv = decodeHuaweiTlv(wrapped);
  expect(tlv.map((field) => field.tag)).toEqual([
    HUAWEI_CRYPTO_TAGS.encryption,
    HUAWEI_CRYPTO_TAGS.initVector,
    HUAWEI_CRYPTO_TAGS.cipherText,
  ]);
  expect(unwrapEncryptedHuaweiTlv(tlv, KEY, false, aes)).toEqual(inner);

  const packet = decryptHuaweiResponse(
    { serviceId: 7, commandId: 0x0b, tlv },
    { secretKey: KEY, aes, useGcm: false },
  );
  expect(packet.tlv).toEqual([{ tag: 0x01, value: Uint8Array.of(9, 9) }]);
});

test("GCM is selected by encryptMethod 1 or deviceSupportType 4", () => {
  expect(huaweiUsesGcm(0x00, 0x00)).toBe(false);
  expect(huaweiUsesGcm(0x01, 0x00)).toBe(true);
  expect(huaweiUsesGcm(0x00, 0x04)).toBe(true);
});

// ---------------------------------------------------------------------------
// Secret key and digests
// ---------------------------------------------------------------------------

test("createSecretKey matches the upstream MAC derivation", () => {
  const crypto = nodeCrypto();
  expect(hex(createHuaweiDeviceSecretKey("AA:BB:CC:DD:EE:FF", 1, crypto))).toBe(
    "14df9feb9752983c711b5bbb63ed8bab",
  );
  expect(hex(createHuaweiDeviceSecretKey("AA:BB:CC:DD:EE:FF", 3, crypto))).toBe(
    "2d4105e1e5c1ba3502c89311ffa1e997",
  );
});

test("the local secret key is generated once and persisted", () => {
  const store = createMemoryHuaweiSecretKeyStore();
  const first = getOrCreateHuaweiLocalSecretKey(store, "device-1", KEY);
  expect(first).toEqual(KEY);
  expect(getOrCreateHuaweiLocalSecretKey(store, "device-1", NONCE)).toEqual(KEY);
  expect(store.get("device-1")).toEqual(KEY);
  expect(generateHuaweiLocalSecretKey(NONCE)).toHaveLength(16);
});

test("normal-mode digests match the upstream double-HMAC vectors", () => {
  const crypto = nodeCrypto();
  const challenge = computeHuaweiAuthDigest({
    message: Uint8Array.of(0x01, 0x00),
    nonce: NONCE,
    authMode: 0,
    authVersion: 3,
    secretKey: null,
    crypto,
  });
  expect(hex(challenge)).toBe(
    "8484b58ea63fce8fb96d56ec37c5c867fec742a7f9cf8b6d1a9daa13c73d741f" +
      "48afdb707376f058a1ce2a2616388dbe57acc6472582144a8ce16d4a3c628f63",
  );
  const response = computeHuaweiAuthDigest({
    message: Uint8Array.of(0x01, 0x10),
    nonce: NONCE,
    authMode: 0,
    authVersion: 3,
    secretKey: null,
    crypto,
  });
  expect(hex(response.slice(0, 0x20))).toBe(
    "c285024de924cc875b5bdebc31fb1a9059532e8f42c81966c8e5f58267f2b8ea",
  );
});

test("HiChainLite authVersion 2 digests use HMAC(secretKey || message)", () => {
  const crypto = nodeCrypto();
  const digest = computeHuaweiAuthDigest({
    message: Uint8Array.of(0x01, 0x00),
    nonce: NONCE,
    authMode: 0x02,
    authVersion: 0x02,
    secretKey: KEY,
    crypto,
  });
  expect(hex(digest)).toBe(
    "7fe3ffcbddc52c793807548e45a1076bc234cb53dea72f03b65d405812b28ef4" +
      "000102030405060708090a0b0c0d0e0f01000000000000000000000000000000",
  );
  expect(() =>
    computeHuaweiAuthDigest({
      message: Uint8Array.of(0x01, 0x00),
      nonce: NONCE,
      authMode: 0x02,
      authVersion: 0x03,
      secretKey: KEY,
      crypto,
    }),
  ).toThrow("HUAWEI_HICHAIN_PIN_FAILED");
});

test("computeHuaweiAuthDigest keys HiChainLite below auth version 2 with the watch PIN", () => {
  // Known answers computed independently with Node crypto from
  // `HuaweiCrypto.computeDigestHiChainLite`; nonce = 10..1F ‖ 20..2F.
  const crypto = nodeCrypto();
  const nonce = Uint8Array.from({ length: 32 }, (_, index) =>
    index < 16 ? 0x10 + index : 0x20 + index - 16,
  );
  const digest = (authAlgo: number, message: Uint8Array) =>
    hex(
      computeHuaweiAuthDigest({
        message,
        nonce,
        authMode: 0x02,
        authVersion: 0x03,
        secretKey: KEY,
        pinCode: new TextEncoder().encode("12345678"),
        authAlgo,
        crypto,
      }),
    ).toUpperCase();
  expect(digest(0, Uint8Array.of(0x01, 0x00))).toBe(
    "FC939DDF4DC8B1562A23B14C903B27ED4C9F038CF5AB88FC4FE58DD454726A1A" +
      "5F905B987AF7814A7FBBE22D71121AF9C0E19B6A4BC27DEF747B63D977B30831",
  );
  expect(digest(1, Uint8Array.of(0x01, 0x10))).toBe(
    "6503EE5E093FE95AAE5B28C7485C5C6548761A6395D2807BAA63A699367CF04F" +
      "74CDD7F64A843A70F8A60D6E31BDED4D6A70557F49EC8DA9F94D4AEA0ED784C6",
  );
});

// ---------------------------------------------------------------------------
// Auth frames
// ---------------------------------------------------------------------------

test("link params request and response match the upstream TLV layout", () => {
  expect(hex(buildHuaweiLinkParamsRequest())).toBe("0100020003000400");
  expect(hex(buildHuaweiLinkParamsRequest(true))).toBe("01000200030004000600");

  const nonceField = Uint8Array.of(0x00, 0x03, ...NONCE.slice(0, 16));
  const response = parseHuaweiLinkParamsResponse(
    decodeHuaweiTlv(
      encodeHuaweiTlv([
        { tag: 0x01, value: Uint8Array.of(0x02) },
        { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
        { tag: 0x03, value: Uint8Array.of(0x02, 0x00) },
        { tag: 0x05, value: nonceField },
        { tag: 0x07, value: Uint8Array.of(0x00) },
        { tag: 0x08, value: Uint8Array.of(0x00) },
        { tag: 0x09, value: Uint8Array.of(0x01) },
        { tag: 0x0c, value: Uint8Array.of(0x01) },
      ]),
    ),
  );
  expect(response).toMatchObject({
    protocolVersion: 2,
    sliceSize: 0xf4,
    mtu: 0x0200,
    authVersion: 3,
    deviceSupportType: 0,
    bondState: 1,
    encryptMethod: 1,
  });
  expect(response.serverNonce).toEqual(NONCE.slice(0, 16));
});

test("device status, auth and bond frames match the upstream layout", () => {
  expect(hex(buildHuaweiDeviceStatusRequest(true))).toBe("0100");
  expect(hex(buildHuaweiDeviceStatusRequest(false))).toBe("020100");
  expect(
    parseHuaweiDeviceStatusResponse(
      decodeHuaweiTlv(encodeHuaweiTlv([{ tag: 0x01, value: Uint8Array.of(0x02) }])),
    ),
  ).toBe(2);

  const challenge = new Uint8Array(32).fill(0x11);
  const clientNonce = new Uint8Array(16).fill(0x22);
  const auth = decodeHuaweiTlv(
    buildHuaweiAuthRequest({
      authVersion: 3,
      challenge,
      clientNonce,
      authMode: 0,
      authAlgo: 0,
    }),
  );
  expect(auth[0]).toEqual({ tag: 0x01, value: challenge });
  expect(auth[1]!.tag).toBe(0x02);
  expect(hex(auth[1]!.value)).toBe("0003" + "22".repeat(16));
  expect(auth).toHaveLength(2);

  const hichainLite = decodeHuaweiTlv(
    buildHuaweiAuthRequest({
      authVersion: 2,
      challenge,
      clientNonce,
      authMode: 2,
      authAlgo: 1,
    }),
  );
  expect(hichainLite[2]).toEqual({ tag: 0x03, value: Uint8Array.of(1) });

  expect(
    parseHuaweiAuthResponse(decodeHuaweiTlv(encodeHuaweiTlv([{ tag: 0x01, value: challenge }]))),
  ).toEqual(challenge);

  const bondParams = decodeHuaweiTlv(
    buildHuaweiBondParamsRequest({
      clientSerial: Uint8Array.from("AABBCC", (character) => character.charCodeAt(0)),
      macAddress: Uint8Array.from("AA:BB:CC:DD:EE:FF", (character) => character.charCodeAt(0)),
    }),
  );
  expect(bondParams.map((field) => field.tag)).toEqual([0x01, 0x03, 0x04, 0x05, 0x07, 0x09]);
  expect(bondParams[2]!.value).toEqual(Uint8Array.of(0x02));

  const bond = decodeHuaweiTlv(
    buildHuaweiBondRequest({
      clientSerial: Uint8Array.of(0x41),
      encryptedKey: Uint8Array.of(1, 2),
      iv: new Uint8Array(16),
    }),
  );
  expect(bond.map((field) => field.tag)).toEqual([0x01, 0x03, 0x05, 0x06, 0x07]);
  expect(bond[1]!.value).toEqual(Uint8Array.of(0x00));
});

test("bond params parse the status and encryption counter", () => {
  const parsed = parseHuaweiBondParamsResponse(
    decodeHuaweiTlv(
      encodeHuaweiTlv([
        { tag: 0x01, value: Uint8Array.of(0x01) },
        { tag: 0x09, value: Uint8Array.of(0x01, 0x02, 0x03, 0x04) },
      ]),
    ),
  );
  expect(parsed).toEqual({ status: 1, encryptionCounter: 0x01020304 });
});

test("bonding-key encryption uses GCM only for encryptMethod 1", () => {
  const aes = nodeAes();
  const { iv } = createHuaweiInitializationVector(0, fromHex("00112233445566778899aabb"));
  const cbc = encryptHuaweiBondingKey(0x00, KEY, KEY, iv, aes);
  expect(cbc.length % 16).toBe(0);
  expect(aes.decryptCbc(KEY, cbc, iv)).toEqual(KEY);
  const gcm = encryptHuaweiBondingKey(0x01, KEY, KEY, iv, aes);
  expect(gcm.length).toBe(KEY.length + 16);
  expect(aes.decryptGcm(KEY, gcm, iv)).toEqual(KEY);
});

test("security negotiation frames parse authType and the response nonce", () => {
  const request = decodeHuaweiTlv(
    buildHuaweiSecurityNegotiationRequest({
      authMode: 2,
      deviceUuid: Uint8Array.of(0x41, 0x42),
      phoneModel: "OpenValens",
      encryptMethod: 1,
    }),
  );
  expect(request.map((field) => field.tag)).toEqual([0x01, 0x02, 0x05, 0x03, 0x04, 0x0d]);

  expect(
    parseHuaweiSecurityNegotiationResponse(
      decodeHuaweiTlv(
        encodeHuaweiTlv([
          { tag: 0x01, value: Uint8Array.of(0x01) },
          { tag: 0x02, value: Uint8Array.of(0x02) },
          { tag: 0x03, value: NONCE.slice(0, 16) },
        ]),
      ),
    ),
  ).toEqual({ authType: 2, honorPairType: 2, responseNonce: NONCE.slice(0, 16) });
  expect(
    parseHuaweiSecurityNegotiationResponse(
      decodeHuaweiTlv(encodeHuaweiTlv([{ tag: 0x01, value: Uint8Array.of(0x01) }])),
    ).authType,
  ).toBe(0x0186a0);
});

// ---------------------------------------------------------------------------
// Sync frames
// ---------------------------------------------------------------------------

test("sync request frames match the upstream TLV layout", () => {
  expect(hex(buildHuaweiMessageCountRequest(0x01020304, 0x05060708))).toBe(
    "8100030401020304040405060708",
  );
  expect(hex(buildHuaweiMessageDataRequest(2))).toBe("810402020002");
  expect(hex(buildHuaweiFitnessTotalsRequest())).toBe("0100");
});

test("message count and fitness totals parse their containers", () => {
  const count = parseHuaweiMessageCountResponse(
    decodeHuaweiTlv(
      encodeHuaweiTlv([
        { tag: 0x81, value: encodeHuaweiTlv([{ tag: 0x02, value: Uint8Array.of(0x00, 0x03) }]) },
      ]),
    ),
  );
  expect(count).toBe(3);

  const totals = parseHuaweiFitnessTotalsResponse(
    decodeHuaweiTlv(
      encodeHuaweiTlv([
        {
          tag: 0x81,
          value: encodeHuaweiTlv([
            {
              tag: 0x83,
              value: encodeHuaweiTlv([
                { tag: 0x05, value: Uint8Array.of(0, 0, 0x04, 0xd2) },
                { tag: 0x06, value: Uint8Array.of(0x00, 0x64) },
                { tag: 0x07, value: Uint8Array.of(0, 0, 0x0a, 0x8c) },
              ]),
            },
          ]),
        },
      ]),
    ),
  );
  expect(totals).toEqual({ totalSteps: 1234, totalCalories: 100, totalDistance: 2700 });
});

test("the step feature bitmap selects 1- and 2-byte values", () => {
  expect(parseHuaweiStepFeatures(Uint8Array.of(0x02, 0x01, 0x2c))).toMatchObject({
    steps: 300,
    calories: -1,
    distance: -1,
    heartRate: -1,
  });
  expect(parseHuaweiStepFeatures(Uint8Array.of(0x42, 0x01, 0x2c, 0x48))).toMatchObject({
    steps: 300,
    heartRate: 72,
  });
  expect(
    parseHuaweiStepFeatures(
      Uint8Array.of(0xce, 0x03, 0x01, 0x2c, 0x00, 0x64, 0x00, 0x0a, 0x48, 0x61, 0x3c),
    ),
  ).toMatchObject({
    steps: 300,
    calories: 100,
    distance: 10,
    heartRate: 72,
    spo2: 0x61,
    restingHeartRate: 0x3c,
  });
  expect(() => parseHuaweiStepFeatures(Uint8Array.of(0x02, 0x01))).toThrow(
    "HUAWEI_STEP_DATA_SHORT",
  );
});

test("step data expands minute offsets from the base timestamp", () => {
  const base = 1769934600; // 2026-02-01T08:30:00Z
  const container = encodeHuaweiTlv([
    { tag: 0x02, value: Uint8Array.of(0x00, 0x00) },
    { tag: 0x03, value: Uint8Array.of(0x69, 0x7f, 0x0f, 0x08) },
    {
      tag: 0x84,
      value: encodeHuaweiTlv([
        { tag: 0x05, value: Uint8Array.of(0x00) },
        { tag: 0x06, value: Uint8Array.of(0x42, 0x01, 0x2c, 0x48) },
      ]),
    },
    {
      tag: 0x84,
      value: encodeHuaweiTlv([
        { tag: 0x05, value: Uint8Array.of(0x02) },
        { tag: 0x06, value: Uint8Array.of(0x02, 0x00, 0x0a) },
      ]),
    },
  ]);
  const parsed = parseHuaweiStepDataResponse(
    decodeHuaweiTlv(encodeHuaweiTlv([{ tag: 0x81, value: container }])),
  );
  expect(parsed.number).toBe(0);
  expect(parsed.timestamp).toBe(base * 1000);
  expect(parsed.minutes).toHaveLength(2);
  expect(parsed.minutes[0]).toMatchObject({ timestamp: base * 1000, steps: 300, heartRate: 72 });
  expect(parsed.minutes[1]).toMatchObject({
    timestamp: (base + 120) * 1000,
    steps: 10,
    heartRate: null,
  });
});

test("sleep data parses type and the 6-byte timestamp", () => {
  const start = 1769986800; // 2026-02-01T23:00:00Z
  const timestamp = Uint8Array.of(0x69, 0x7f, 0xda, 0xf0, 0x00, 0x1e);
  const parsed = parseHuaweiSleepDataResponse(
    decodeHuaweiTlv(
      encodeHuaweiTlv([
        {
          tag: 0x81,
          value: encodeHuaweiTlv([
            { tag: 0x02, value: Uint8Array.of(0x00, 0x00) },
            {
              tag: 0x83,
              value: encodeHuaweiTlv([
                { tag: 0x04, value: Uint8Array.of(HUAWEI_SLEEP_LIGHT) },
                { tag: 0x05, value: timestamp },
              ]),
            },
            {
              tag: 0x83,
              value: encodeHuaweiTlv([
                { tag: 0x04, value: Uint8Array.of(HUAWEI_SLEEP_DEEP) },
                {
                  tag: 0x05,
                  value: Uint8Array.of(0x69, 0x7f, 0xe1, 0xf8, 0x00, 0x1e),
                },
              ]),
            },
          ]),
        },
      ]),
    ),
  );
  expect(parsed.number).toBe(0);
  expect(parsed.records).toHaveLength(2);
  expect(parsed.records[0]).toEqual({
    type: HUAWEI_SLEEP_LIGHT,
    startTime: start * 1000,
    endTime: (start + 30 * 60) * 1000,
  });
  expect(parsed.records[1]!.startTime).toBe((start + 30 * 60) * 1000);
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

test("a step minute becomes an exact-minute steps record plus heart rate", () => {
  const minute = {
    timestamp: 1769934600 * 1000,
    steps: 42,
    calories: 3,
    distance: 30,
    heartRate: 72,
    spo2: 97,
    restingHeartRate: 60,
  };
  expect(huaweiStepMinuteToRecords(minute)).toEqual([
    {
      type: "steps",
      startTime: "2026-02-01T08:30:00.000Z",
      endTime: "2026-02-01T08:31:00.000Z",
      count: 42,
    },
    { type: "heart_rate", time: "2026-02-01T08:30:00.000Z", bpm: 72 },
  ]);
  expect(huaweiStepMinuteToRecords({ ...minute, heartRate: null, steps: -1 })).toEqual([
    {
      type: "steps",
      startTime: "2026-02-01T08:30:00.000Z",
      endTime: "2026-02-01T08:31:00.000Z",
      count: 0,
    },
  ]);
});

test("sleep records expand to contiguous light/deep sessions with the 5-minute floor", () => {
  const start = Date.parse("2026-02-01T23:00:00Z");
  const records = [
    { type: HUAWEI_SLEEP_LIGHT, startTime: start, endTime: start + 30 * 60_000 },
    {
      type: HUAWEI_SLEEP_DEEP,
      startTime: start + 30 * 60_000,
      endTime: start + 90 * 60_000,
    },
  ];
  const sessions = segmentHuaweiSleepSessions(records);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    type: "sleep_session",
    startTime: "2026-02-01T23:00:00.000Z",
    endTime: "2026-02-02T00:30:00.000Z",
  });
  expect(sessions[0]!.stages).toEqual([
    {
      stage: "light",
      startTime: "2026-02-01T23:00:00.000Z",
      endTime: "2026-02-01T23:30:00.000Z",
    },
    {
      stage: "deep",
      startTime: "2026-02-01T23:30:00.000Z",
      endTime: "2026-02-02T00:30:00.000Z",
    },
  ]);
});

test("sleep sessions shorter than five minutes are dropped and long gaps split", () => {
  const start = Date.parse("2026-02-01T23:00:00Z");
  expect(
    segmentHuaweiSleepSessions([
      { type: HUAWEI_SLEEP_LIGHT, startTime: start, endTime: start + 3 * 60_000 },
    ]),
  ).toEqual([]);
  const split = segmentHuaweiSleepSessions([
    { type: HUAWEI_SLEEP_LIGHT, startTime: start, endTime: start + 20 * 60_000 },
    {
      type: HUAWEI_SLEEP_DEEP,
      startTime: start + 120 * 60_000,
      endTime: start + 140 * 60_000,
    },
  ]);
  expect(split).toHaveLength(2);
});

test("the default slice size is the upstream 0xF4", () => {
  expect(HUAWEI_DEFAULT_SLICE_SIZE).toBe(0xf4);
});

test("the stream deframer reassembles split and concatenated frames, sliced or not", () => {
  const whole = encodeHuaweiPacket({ serviceId: 1, commandId: 2, tlv: Uint8Array.of(3, 1, 4) });
  const sliced = encodeHuaweiPacket({
    serviceId: 1,
    commandId: 2,
    tlv: Uint8Array.from({ length: 40 }, (_, index) => index),
    sliceSize: 20,
  });
  expect(sliced.length).toBeGreaterThan(1);
  const frames = [...whole, ...sliced];
  const stream = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
  let offset = 0;
  for (const frame of frames) {
    stream.set(frame, offset);
    offset += frame.length;
  }
  // Every split point: the frames come out whole and in order.
  for (const step of [1, 2, 3, 7, stream.length]) {
    const deframer = new HuaweiStreamDeframer();
    const out: Uint8Array[] = [];
    for (let at = 0; at < stream.length; at += step)
      out.push(...deframer.push(stream.subarray(at, at + step)));
    expect(out.map((frame) => Array.from(frame))).toEqual(frames.map((frame) => Array.from(frame)));
    for (const frame of out) expect(() => decodeHuaweiPacket(frame)).not.toThrow();
  }
});

test("the stream deframer skips garbage to the next frame start without losing frames", () => {
  const [frame] = encodeHuaweiPacket({ serviceId: 1, commandId: 2, tlv: Uint8Array.of(3, 1, 4) });
  const deframer = new HuaweiStreamDeframer();
  // A whole frame, then garbage, then a frame split across two chunks.
  const chunk = new Uint8Array([...frame!, 0x00, 0x01, 0x02, ...frame!.subarray(0, 4)]);
  expect(deframer.push(chunk).map((out) => Array.from(out))).toEqual([Array.from(frame!)]);
  expect(deframer.discardedBytes).toBe(3);
  expect(deframer.push(frame!.subarray(4)).map((out) => Array.from(out))).toEqual([
    Array.from(frame!),
  ]);
  expect(deframer.push(Uint8Array.of(0x11, 0x22))).toEqual([]);
  expect(deframer.discardedBytes).toBe(5);
});
