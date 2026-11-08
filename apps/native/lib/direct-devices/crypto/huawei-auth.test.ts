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
  createHuaweiSecretKey,
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
