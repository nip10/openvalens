/*  Copyright (C) 2023-2026 Andreas Shimokawa, José Rebelo, Yoran Vulker

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
 * Xiaomi protobuf auth handshake.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/xiaomi/XiaomiAuthService.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/xiaomi/XiaomiAuthService.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * The scheme is Xiaomi-specific but built only from standard primitives:
 * - HMAC-SHA256 key derivation (`computeAuthStep3Hmac`).
 * - AES-128-CCM with a 32-bit tag for V1 command payloads.
 * - AES-128-CTR for V2 command payloads (key and IV are both the encryption
 *   key, matching upstream).
 *
 * No primitive is implemented here. A crypto provider supplies HMAC, CCM and
 * CTR; the native provider lazily loads `react-native-quick-crypto`, and tests
 * inject Node's `crypto`. Randomness is CSPRNG-only (`randomBytes`).
 */

import { encodeCommand, encodeCompanionDevice, type XiaomiCommand } from "../protocol/xiaomi-proto";

export type XiaomiAuthCrypto = {
  randomBytes(size: number): Uint8Array;
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  /** AES-128-CCM, 32-bit authentication tag, no AAD. Returns ciphertext || tag. */
  aesCcmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array;
  /** AES-128-CCM, 32-bit authentication tag, no AAD. Accepts ciphertext || tag. */
  aesCcmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array;
  /** AES-128-CTR. */
  aesCtrCrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array;
};

export type XiaomiSessionKeys = {
  decryptionKey: Uint8Array;
  encryptionKey: Uint8Array;
  decryptionNonce: Uint8Array;
  encryptionNonce: Uint8Array;
};

/** Transport seam for the two-step handshake. */
export type XiaomiAuthTransport = {
  send(command: XiaomiCommand): Promise<void>;
  receive(signal: AbortSignal): Promise<XiaomiCommand>;
};

export type XiaomiAuthNonce = {
  command: XiaomiCommand;
  phoneNonce: Uint8Array;
};

export type XiaomiWatchNonceResult = {
  command: XiaomiCommand;
  keys: XiaomiSessionKeys;
  encryptedDeviceInfo: Uint8Array;
};

const MIWEAR_AUTH = Uint8Array.from("miwear-auth", (char) => char.charCodeAt(0));

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Upstream `computeAuthStep3Hmac`: 64 bytes of HMAC-SHA256 output. */
export function computeXiaomiAuthStep3Hmac(
  crypto: XiaomiAuthCrypto,
  secretKey: Uint8Array,
  phoneNonce: Uint8Array,
  watchNonce: Uint8Array,
): Uint8Array {
  if (secretKey.length !== 16) throw new Error("AUTH_SECRET_KEY_LENGTH");
  if (phoneNonce.length !== 16 || watchNonce.length !== 16) throw new Error("AUTH_NONCE_LENGTH");

  const hmacKey = crypto.hmacSha256(concatBytes(phoneNonce, watchNonce), secretKey);
  const output = new Uint8Array(64);
  let previous: Uint8Array = new Uint8Array(0);
  let written = 0;
  for (let counter = 1; written < output.length; counter += 1) {
    const digest = crypto.hmacSha256(
      hmacKey,
      concatBytes(previous, MIWEAR_AUTH, Uint8Array.of(counter & 0xff)),
    );
    const take = Math.min(digest.length, output.length - written);
    output.set(digest.subarray(0, take), written);
    written += take;
    previous = digest;
  }
  hmacKey.fill(0);
  return output;
}

/** Builds the first handshake command (`type 1, subtype 26`, app nonce). */
export function buildXiaomiAuthNonceCommand(options: {
  crypto: XiaomiAuthCrypto;
  deviceId?: string;
  phoneNonce?: Uint8Array;
}): XiaomiAuthNonce {
  const phoneNonce = options.phoneNonce ?? options.crypto.randomBytes(16);
  if (phoneNonce.length !== 16) throw new Error("AUTH_NONCE_LENGTH");
  const command: XiaomiCommand = {
    type: 1,
    subtype: 26,
    auth: {
      appVerify: {
        nonce: phoneNonce,
        ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      },
    },
  };
  return { command, phoneNonce };
}

/**
 * Handles the watch nonce (`type 1, subtype 26` response) and builds the app
 * confirmation (`type 1, subtype 27`). Throws `AUTH_HMAC_MISMATCH` when the
 * watch's HMAC does not verify.
 */
export function handleXiaomiWatchNonce(options: {
  crypto: XiaomiAuthCrypto;
  secretKey: Uint8Array;
  phoneNonce: Uint8Array;
  watchNonce: Uint8Array;
  watchHmac: Uint8Array;
  phoneApiLevel: number;
  phoneName: string;
  region: string;
}): XiaomiWatchNonceResult {
  const step2 = computeXiaomiAuthStep3Hmac(
    options.crypto,
    options.secretKey,
    options.phoneNonce,
    options.watchNonce,
  );
  const decryptionKey = step2.slice(0, 16);
  const encryptionKey = step2.slice(16, 32);
  const decryptionNonce = step2.slice(32, 36);
  const encryptionNonce = step2.slice(36, 40);

  const expected = options.crypto.hmacSha256(
    decryptionKey,
    concatBytes(options.watchNonce, options.phoneNonce),
  );
  if (!equalConstantTime(expected, options.watchHmac)) {
    throw new Error("AUTH_HMAC_MISMATCH");
  }

  const encryptedNonces = options.crypto.hmacSha256(
    encryptionKey,
    concatBytes(options.phoneNonce, options.watchNonce),
  );
  const deviceInfo = encodeCompanionDevice({
    unknown1: 0,
    phoneApiLevel: options.phoneApiLevel,
    phoneName: options.phoneName,
    unknown3: 224,
    region: options.region,
  });
  const encryptedDeviceInfo = xiaomiCcmEncrypt(
    options.crypto,
    encryptionKey,
    encryptionNonce,
    0,
    deviceInfo,
  );

  return {
    command: {
      type: 1,
      subtype: 27,
      auth: { appConfirm: { encryptedNonces, encryptedDeviceInfo } },
    },
    keys: { decryptionKey, encryptionKey, decryptionNonce, encryptionNonce },
    encryptedDeviceInfo,
  };
}

/**
 * Runs the two-step encrypted handshake over a transport seam: send the app
 * nonce, receive the watch nonce, verify it, send the app confirmation, and
 * wait for the auth success response. History transfer is a later milestone.
 */
export async function runXiaomiAuthHandshake(
  transport: XiaomiAuthTransport,
  options: {
    crypto: XiaomiAuthCrypto;
    secretKey: Uint8Array;
    deviceId?: string;
    phoneApiLevel: number;
    phoneName: string;
    region: string;
    signal: AbortSignal;
    phoneNonce?: Uint8Array;
  },
): Promise<XiaomiSessionKeys> {
  const abort = () => {
    if (options.signal.aborted) throw new Error("CANCELLED");
  };
  abort();
  const nonce = buildXiaomiAuthNonceCommand({
    crypto: options.crypto,
    deviceId: options.deviceId,
    phoneNonce: options.phoneNonce,
  });
  await transport.send(nonce.command);
  abort();

  const watchNonceCommand = await transport.receive(options.signal);
  if (
    watchNonceCommand.type !== 1 ||
    watchNonceCommand.subtype !== 26 ||
    !watchNonceCommand.auth?.deviceVerify
  ) {
    throw new Error("AUTH_WATCH_NONCE");
  }
  const result = handleXiaomiWatchNonce({
    crypto: options.crypto,
    secretKey: options.secretKey,
    phoneNonce: nonce.phoneNonce,
    watchNonce: watchNonceCommand.auth.deviceVerify.nonce,
    watchHmac: watchNonceCommand.auth.deviceVerify.hmac,
    phoneApiLevel: options.phoneApiLevel,
    phoneName: options.phoneName,
    region: options.region,
  });
  await transport.send(result.command);
  abort();

  const confirmation = await transport.receive(options.signal);
  if (confirmation.type !== 1 || (confirmation.subtype !== 27 && confirmation.auth?.status !== 1)) {
    throw new Error("AUTH_REJECTED");
  }
  return result.keys;
}

/** V1 packet nonce: 4-byte base nonce, 4 zero bytes, 4-byte little-endian index. */
export function xiaomiPacketNonce(baseNonce: Uint8Array, index: number): Uint8Array {
  if (baseNonce.length !== 4) throw new Error("AUTH_PACKET_NONCE_LENGTH");
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new Error("AUTH_PACKET_INDEX");
  }
  const nonce = new Uint8Array(12);
  nonce.set(baseNonce, 0);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, 0, true);
  view.setUint32(8, index, true);
  return nonce;
}

export function xiaomiCcmEncrypt(
  crypto: XiaomiAuthCrypto,
  key: Uint8Array,
  baseNonce: Uint8Array,
  index: number,
  plaintext: Uint8Array,
): Uint8Array {
  return crypto.aesCcmEncrypt(key, xiaomiPacketNonce(baseNonce, index), plaintext);
}

export function xiaomiCcmDecrypt(
  crypto: XiaomiAuthCrypto,
  key: Uint8Array,
  baseNonce: Uint8Array,
  index: number,
  ciphertext: Uint8Array,
): Uint8Array {
  return crypto.aesCcmDecrypt(key, xiaomiPacketNonce(baseNonce, index), ciphertext);
}

/** V2 uses AES-128-CTR with the encryption key as both key and IV. */
export function xiaomiCtrCrypt(
  crypto: XiaomiAuthCrypto,
  key: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  return crypto.aesCtrCrypt(key, key, data);
}

/** Encodes a command for the wire. */
export function encodeXiaomiCommand(command: XiaomiCommand): Uint8Array {
  return encodeCommand(command);
}

function equalConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

/**
 * Native crypto provider. Loaded lazily so importing this module never loads a
 * native module.
 */
export async function loadXiaomiCrypto(): Promise<XiaomiAuthCrypto> {
  const native = (await import("react-native-quick-crypto")) as unknown as {
    randomBytes(size: number): Uint8Array;
    createHmac(
      algorithm: string,
      key: Uint8Array,
    ): {
      update(data: Uint8Array): void;
      digest(): Uint8Array;
    };
    createCipheriv(
      algorithm: string,
      key: Uint8Array,
      iv: Uint8Array | null,
      options?: { authTagLength?: number },
    ): {
      setAAD(aad: Uint8Array, options?: { plaintextLength?: number }): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
      getAuthTag(): Uint8Array;
    };
    createDecipheriv(
      algorithm: string,
      key: Uint8Array,
      iv: Uint8Array | null,
      options?: { authTagLength?: number },
    ): {
      setAAD(aad: Uint8Array, options?: { plaintextLength?: number }): void;
      setAuthTag(tag: Uint8Array): void;
      update(data: Uint8Array): Uint8Array;
      final(): Uint8Array;
    };
  };

  return {
    randomBytes: (size) => native.randomBytes(size),
    hmacSha256(key, data) {
      const hmac = native.createHmac("sha256", key);
      hmac.update(data);
      return new Uint8Array(hmac.digest());
    },
    aesCcmEncrypt(key, nonce, plaintext) {
      const cipher = native.createCipheriv("aes-128-ccm", key, nonce, { authTagLength: 4 });
      cipher.setAAD(new Uint8Array(0), { plaintextLength: plaintext.length });
      const body = concatBytes(cipher.update(plaintext), cipher.final());
      return concatBytes(body, cipher.getAuthTag());
    },
    aesCcmDecrypt(key, nonce, ciphertext) {
      if (ciphertext.length < 4) throw new Error("AUTH_CCM_TRUNCATED");
      const tag = ciphertext.slice(-4);
      const body = ciphertext.slice(0, -4);
      const decipher = native.createDecipheriv("aes-128-ccm", key, nonce, { authTagLength: 4 });
      decipher.setAAD(new Uint8Array(0), { plaintextLength: body.length });
      decipher.setAuthTag(tag);
      return concatBytes(decipher.update(body), decipher.final());
    },
    aesCtrCrypt(key, iv, data) {
      const cipher = native.createCipheriv("aes-128-ctr", key, iv);
      return concatBytes(cipher.update(data), cipher.final());
    },
  };
}
