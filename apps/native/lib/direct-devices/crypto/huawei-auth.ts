/*  Copyright (C) 2024-2026 Damien Gaignon, Martin.JM

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * Huawei/Honor auth primitives.
 *
 * Upstream:
 * - `devices/huawei/HuaweiCrypto.java`
 * - `service/devices/huawei/HuaweiSupportProvider.java`
 * - `service/devices/huawei/requests/GetAuthRequest.java`,
 *   `GetHiChainRequest.java`, `GetHiChainPakeRequest.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * IMPORTANT: Huawei auth is **automatic / bonding-based**, not a user-entered
 * 16-byte key like Huami/Xiaomi. The device secret is derived from the device
 * MAC address plus fixed upstream constants (`createSecretKey`). Full HiChain
 * asks the user to confirm on the watch once; HiChainLite (except
 * `authVersion` 2) keys its digest with a PIN the phone reads from the watch
 * (0x01/0x2C), so the user types nothing. This module holds the deterministic
 * primitives; `transport/huawei.ts` drives the exchanges.
 */

export type HuaweiCryptoProvider = {
  randomBytes(size: number): Uint8Array;
  sha256(data: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  /** Native PBKDF2-HMAC-SHA256 when available; `pbkdf2HmacSha256` falls back to HMAC rounds. */
  pbkdf2Sha256?(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    length: number,
  ): Uint8Array;
};

export const HUAWEI_SECRET_KEY_1_V1 = Uint8Array.of(
  0x6f,
  0x75,
  0x6a,
  0x79,
  0x6d,
  0x77,
  0x71,
  0x34,
  0x63,
  0x6c,
  0x76,
  0x39,
  0x33,
  0x37,
  0x38,
  0x79,
);
export const HUAWEI_SECRET_KEY_2_V1 = Uint8Array.of(
  0x62,
  0x31,
  0x30,
  0x6a,
  0x67,
  0x66,
  0x64,
  0x39,
  0x79,
  0x37,
  0x76,
  0x73,
  0x75,
  0x64,
  0x61,
  0x39,
);
export const HUAWEI_SECRET_KEY_1_V23 = Uint8Array.of(
  0x55,
  0x53,
  0x86,
  0xfc,
  0x63,
  0x20,
  0x07,
  0xaa,
  0x86,
  0x49,
  0x35,
  0x22,
  0xb8,
  0x6a,
  0xe2,
  0x5c,
);
export const HUAWEI_SECRET_KEY_2_V23 = Uint8Array.of(
  0x33,
  0x07,
  0x9b,
  0xc5,
  0x7a,
  0x88,
  0x6d,
  0x3c,
  0xf5,
  0x61,
  0x37,
  0x09,
  0x6f,
  0x22,
  0x80,
  0x00,
);

export const HUAWEI_DIGEST_SECRET_V1 = Uint8Array.of(
  0x70,
  0xfb,
  0x6c,
  0x24,
  0x03,
  0x5f,
  0xdb,
  0x55,
  0x2f,
  0x38,
  0x89,
  0x8a,
  0xee,
  0xde,
  0x3f,
  0x69,
);
export const HUAWEI_DIGEST_SECRET_V2 = Uint8Array.of(
  0x93,
  0xac,
  0xde,
  0xf7,
  0x6a,
  0xcb,
  0x09,
  0x85,
  0x7d,
  0xbf,
  0xe5,
  0x26,
  0x1a,
  0xab,
  0xcd,
  0x78,
);
export const HUAWEI_DIGEST_SECRET_V3 = Uint8Array.of(
  0x9c,
  0x27,
  0x63,
  0xa9,
  0xcc,
  0xe1,
  0x34,
  0x76,
  0x6d,
  0xe3,
  0xff,
  0x61,
  0x18,
  0x20,
  0x05,
  0x53,
);

export const HUAWEI_MESSAGE_RESPONSE = Uint8Array.of(0x01, 0x10);
export const HUAWEI_MESSAGE_CHALLENGE = Uint8Array.of(0x01, 0x00);
export const HUAWEI_MESSAGE_CHALLENGE_V4 = Uint8Array.of(0x04, 0x00);

export function concatHuaweiBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function utf8(value: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

/**
 * Upstream `HuaweiCrypto.createSecretKey(macAddress)`: device MAC + fixed
 * constants, SHA-256, no user key. `authVersion === 1` uses the v1 constants;
 * every other version uses the v2/v3 constants.
 */
export function createHuaweiSecretKey(
  macAddress: string,
  authVersion: number,
  crypto: HuaweiCryptoProvider,
): Uint8Array {
  const secret1 = authVersion === 1 ? HUAWEI_SECRET_KEY_1_V1 : HUAWEI_SECRET_KEY_1_V23;
  const secret2 = authVersion === 1 ? HUAWEI_SECRET_KEY_2_V1 : HUAWEI_SECRET_KEY_2_V23;
  const macKey = utf8(macAddress.replace(/:/g, "") + "0000");
  if (macKey.length < 16) throw new Error("HUAWEI_MAC_LENGTH");

  const mixed = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    mixed[index] = (((secret1[index]! << 4) ^ secret2[index]!) & 0xff) >>> 0;
  }
  const mixedHash = crypto.sha256(mixed);
  const finalMixed = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    finalMixed[index] = ((mixedHash[index]! >> 6) ^ macKey[index]!) & 0xff;
  }
  return crypto.sha256(finalMixed).slice(0, 16);
}

/** `HuaweiCrypto.getDigestSecret`: the constant key for `authVersion`. */
export function huaweiDigestSecret(authVersion: number): Uint8Array {
  if (authVersion === 1 || authVersion === 4) return HUAWEI_DIGEST_SECRET_V1;
  if (authVersion === 2) return HUAWEI_DIGEST_SECRET_V2;
  return HUAWEI_DIGEST_SECRET_V3;
}

/**
 * Upstream `HuaweiCrypto.computeDigest`: 64-byte challenge/response.
 * `message` is 2 bytes (`MESSAGE_CHALLENGE` or `MESSAGE_RESPONSE`).
 */
export function computeHuaweiDigest(
  message: Uint8Array,
  nonce: Uint8Array,
  authVersion: number,
  crypto: HuaweiCryptoProvider,
): Uint8Array {
  const secret = huaweiDigestSecret(authVersion);
  const messageToDigest = concatHuaweiBytes(secret, message);
  const step1 = crypto.hmacSha256(messageToDigest, nonce);
  return concatHuaweiBytes(crypto.hmacSha256(step1, nonce), step1);
}

/**
 * Upstream `HuaweiCrypto.computeDigestHiChainLite` (HiChainLite when
 * `authVersion != 2`): the watch's PIN keys the digest. The digest secret for
 * `authVersion` is XORed with `SHA256(UTF-8(uppercase hex of the PIN))`, the
 * 2-byte message is appended, and step 1 is HMAC-SHA256 over the nonce or,
 * when `authAlgo == 1`, PBKDF2-HMAC-SHA256 (1000 iterations, 256 bits) with
 * the uppercase hex of that 18-byte key as the password and the uppercase hex
 * of the nonce as the salt. Returns `HMAC(step1, nonce) ‖ step1` (64 bytes).
 */
export function computeHuaweiHiChainLiteDigest(args: {
  message: Uint8Array;
  pinCode: Uint8Array;
  nonce: Uint8Array;
  authVersion: number;
  authAlgo: number;
  crypto: HuaweiCryptoProvider;
}): Uint8Array {
  const { crypto, nonce } = args;
  const hashKey = crypto.sha256(utf8(hexUpper(args.pinCode)));
  const secret = Uint8Array.from(huaweiDigestSecret(args.authVersion));
  for (let index = 0; index < secret.length; index += 1) secret[index]! ^= hashKey[index]!;
  const messageToDigest = concatHuaweiBytes(secret, args.message);
  const step1 =
    args.authAlgo === 0x01
      ? pbkdf2HmacSha256(crypto, utf8(hexUpper(messageToDigest)), utf8(hexUpper(nonce)), 1000, 32)
      : crypto.hmacSha256(messageToDigest, nonce);
  return concatHuaweiBytes(crypto.hmacSha256(step1, nonce), step1);
}

/**
 * RFC 8018 PBKDF2 with HMAC-SHA256 on the provider's HMAC (upstream
 * `CryptoUtils.pbkdf2Sha256`, Java `PBKDF2WithHmacSHA256`). Upstream's
 * password and salt are ASCII hex strings, so their encoding is not in question.
 */
export function pbkdf2HmacSha256(
  crypto: HuaweiCryptoProvider,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
): Uint8Array {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("HUAWEI_PBKDF2_ITERATIONS");
  if (!Number.isInteger(length) || length < 1 || length > 255 * 32)
    throw new Error("HUAWEI_PBKDF2_LENGTH");
  if (crypto.pbkdf2Sha256)
    return Uint8Array.from(crypto.pbkdf2Sha256(password, salt, iterations, length));
  const out = new Uint8Array(length);
  for (let block = 1, offset = 0; offset < length; block += 1) {
    let u = crypto.hmacSha256(password, concatHuaweiBytes(salt, Uint8Array.of(0, 0, 0, block)));
    const sum = Uint8Array.from(u);
    for (let round = 1; round < iterations; round += 1) {
      u = crypto.hmacSha256(password, u);
      for (let at = 0; at < sum.length; at += 1) sum[at]! ^= u[at]!;
    }
    out.set(sum.subarray(0, Math.min(sum.length, length - offset)), offset);
    offset += sum.length;
  }
  return out;
}

function hexUpper(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out.toUpperCase();
}

/** Native provider; loaded lazily so importing this module has no native side effects. */
export async function loadHuaweiCrypto(): Promise<HuaweiCryptoProvider> {
  const native = (await import("react-native-quick-crypto")) as unknown as {
    randomBytes(size: number): Uint8Array;
    createHash(algorithm: string): { update(data: Uint8Array): void; digest(): Uint8Array };
    createHmac(
      algorithm: string,
      key: Uint8Array,
    ): { update(data: Uint8Array): void; digest(): Uint8Array };
    pbkdf2Sync(
      password: Uint8Array,
      salt: Uint8Array,
      iterations: number,
      keylen: number,
      digest: string,
    ): Uint8Array;
  };
  return {
    randomBytes: (size) => native.randomBytes(size),
    pbkdf2Sha256: (password, salt, iterations, length) =>
      new Uint8Array(native.pbkdf2Sync(password, salt, iterations, length, "sha256")),
    sha256(data) {
      const hash = native.createHash("sha256");
      hash.update(data);
      return new Uint8Array(hash.digest());
    },
    hmacSha256(key, data) {
      const hmac = native.createHmac("sha256", key);
      hmac.update(data);
      return new Uint8Array(hmac.digest());
    },
  };
}

/**
 * RFC 5869 HKDF-SHA256 on the provider's HMAC (upstream `CryptoUtils.hkdfSha256`):
 * `PRK = HMAC(salt, ikm)`, `T(i) = HMAC(PRK, T(i-1) ‖ info ‖ i)`.
 */
export function hkdfSha256(
  crypto: HuaweiCryptoProvider,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 255 * 32)
    throw new Error("HUAWEI_HKDF_LENGTH");
  const prk = crypto.hmacSha256(salt, ikm);
  const out = new Uint8Array(length);
  let previous = new Uint8Array(0);
  for (let block = 1, offset = 0; offset < length; block += 1) {
    previous = Uint8Array.from(
      crypto.hmacSha256(prk, concatHuaweiBytes(previous, info, Uint8Array.of(block))),
    );
    out.set(previous.subarray(0, Math.min(previous.length, length - offset)), offset);
    offset += previous.length;
  }
  return out;
}
