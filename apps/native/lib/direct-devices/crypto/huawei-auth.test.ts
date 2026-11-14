/**
 * Tests for the Huawei/Honor auth primitives.
 *
 * Huawei auth is automatic/bonding-based: the device secret is derived from
 * the MAC address and fixed upstream constants. These vectors pin that
 * deterministic derivation. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";
import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  computeHuaweiDigest,
  computeHuaweiHiChainLiteDigest,
  createHuaweiSecretKey,
  pbkdf2HmacSha256,
  HUAWEI_MESSAGE_CHALLENGE,
  HUAWEI_MESSAGE_RESPONSE,
  type HuaweiCryptoProvider,
} from "./huawei-auth";

const nodeCrypto: HuaweiCryptoProvider = {
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
  sha256: (data) => new Uint8Array(createHash("sha256").update(data).digest()),
  hmacSha256: (key, data) => new Uint8Array(createHmac("sha256", key).update(data).digest()),
};

const toHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

test("createHuaweiSecretKey matches the upstream MAC derivation", () => {
  expect(toHex(createHuaweiSecretKey("AA:BB:CC:DD:EE:FF", 1, nodeCrypto))).toBe(
    "14df9feb9752983c711b5bbb63ed8bab",
  );
  expect(toHex(createHuaweiSecretKey("AA:BB:CC:DD:EE:FF", 2, nodeCrypto))).toBe(
    "2d4105e1e5c1ba3502c89311ffa1e997",
  );
  expect(toHex(createHuaweiSecretKey("AA:BB:CC:DD:EE:FF", 3, nodeCrypto))).toBe(
    "2d4105e1e5c1ba3502c89311ffa1e997",
  );
});

test("computeHuaweiDigest matches the upstream challenge vectors", () => {
  const nonce = Uint8Array.from("000102030405060708090a0b0c0d0e0f".match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );

  expect(toHex(computeHuaweiDigest(HUAWEI_MESSAGE_CHALLENGE, nonce, 1, nodeCrypto))).toBe(
    "721f376ffad659c5abc1272958986539d1ac3a811c496514dcbd2d65a9092c7b" +
      "bdbeadc6b04a81bb21bb638ab57be3bbfd09301df79f1d462093bc4a82fb04ca",
  );
  expect(toHex(computeHuaweiDigest(HUAWEI_MESSAGE_CHALLENGE, nonce, 2, nodeCrypto))).toBe(
    "46e43fe3bbfdb6d48fd3775e94e6eb508b689c984f6d496deb30d7ac2e475e6d" +
      "c180f4c0ab2a5169c980fd8a5a3fe390db46ab2ecb93c9fe41e10afccb38c89c",
  );
  expect(toHex(computeHuaweiDigest(HUAWEI_MESSAGE_CHALLENGE, nonce, 3, nodeCrypto))).toBe(
    "112414861d1415caa6808be225747289b6d0bfec571828642313ff66a46af7b8" +
      "7de1399c84fb0c3ed85c76aa5fa5d69e7d32966a0ccc744d6e941206d96eb9f7",
  );
  expect(toHex(computeHuaweiDigest(HUAWEI_MESSAGE_CHALLENGE, nonce, 4, nodeCrypto))).toBe(
    "721f376ffad659c5abc1272958986539d1ac3a811c496514dcbd2d65a9092c7b" +
      "bdbeadc6b04a81bb21bb638ab57be3bbfd09301df79f1d462093bc4a82fb04ca",
  );
});

test("computeHuaweiDigest response vector is deterministic", () => {
  const nonce = Uint8Array.from("000102030405060708090a0b0c0d0e0f".match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );

  expect(toHex(computeHuaweiDigest(HUAWEI_MESSAGE_RESPONSE, nonce, 3, nodeCrypto))).toBe(
    "cb32aebff6616548392a6bbeb86f43cd44035454d2c11a33ace9b6c2c78978f9" +
      "0f2ca0c6d56e4d50ec0ba10134c2066b8df97e4f975ceaa1a6272e4392565b97",
  );
});

test("pbkdf2HmacSha256 matches Node's PBKDF2-HMAC-SHA256, including a partial second block", () => {
  const text = (value: string) => new TextEncoder().encode(value);
  expect(toHex(pbkdf2HmacSha256(nodeCrypto, text("password"), text("salt"), 2, 32))).toBe(
    "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
  );
  expect(toHex(pbkdf2HmacSha256(nodeCrypto, text("password"), text("salt"), 1000, 40))).toBe(
    "632c2812e46d4604102ba7618e9d6d7d2f8128f6266b4a03264d2a0460b7dcb388b3b1131f741bcb",
  );
});

test("computeHuaweiHiChainLiteDigest matches the upstream PIN digest for both auth algorithms", () => {
  // Known answers computed independently with Node crypto (createHmac and
  // pbkdf2Sync) from `HuaweiCrypto.computeDigestHiChainLite`, PIN "12345678",
  // nonce = 10..1F ‖ 20..2F.
  const nonce = Uint8Array.from({ length: 32 }, (_, index) =>
    index < 16 ? 0x10 + index : 0x20 + index - 16,
  );
  const digest = (authVersion: number, authAlgo: number, message: Uint8Array) =>
    toHex(
      computeHuaweiHiChainLiteDigest({
        message,
        pinCode: new TextEncoder().encode("12345678"),
        nonce,
        authVersion,
        authAlgo,
        crypto: nodeCrypto,
      }),
    ).toUpperCase();
  expect(digest(1, 0, HUAWEI_MESSAGE_CHALLENGE)).toBe(
    "7FE04D8B265762B7A24A45A75901117C18DAD93FB4636DF17B822DE157478FE6" +
      "E97A8C864E726A802BEBBA4D88EF3CAC303BAC24A257C139289EB48605CCF14D",
  );
  expect(digest(1, 1, HUAWEI_MESSAGE_RESPONSE)).toBe(
    "AF18492579C0963187C4BB62F945AFDCC7B723841EFCD47B6B09EFBC539D6B66" +
      "087DA26E78891398C09C3B76825AD605BE2641409086A193860191F4912E99DB",
  );
  expect(digest(3, 0, HUAWEI_MESSAGE_RESPONSE)).toBe(
    "76C635FA3908A19AD70EA3FBA0DBA9B57FC9FDEC7185FE23E36B606B2C9E45CF" +
      "81CDFD12511E6B6BB307578C562ACB85684E22912C0BF607D45439DCC2F81D27",
  );
  expect(digest(3, 1, HUAWEI_MESSAGE_CHALLENGE)).toBe(
    "CA0E0574EF892F96497A814DBB01C717F3188062E106517B74154DBDAA18BB43" +
      "1CD6012916AA3B62C76B846A4F4EB1FD22B0827DAA18AD9FAAFCE67B1CFF3C28",
  );
});
