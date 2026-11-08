/**
 * Tests for the Xiaomi auth handshake and crypto wrappers.
 *
 * The HMAC key-derivation vector is fixed from the upstream algorithm
 * (`XiaomiAuthService.computeAuthStep3Hmac`). AES-CCM/CTR are standard
 * primitives supplied by Node's crypto in these tests. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";

import {
  buildXiaomiAuthNonceCommand,
  computeXiaomiAuthStep3Hmac,
  handleXiaomiWatchNonce,
  runXiaomiAuthHandshake,
  xiaomiCcmDecrypt,
  xiaomiCcmEncrypt,
  xiaomiCtrCrypt,
  xiaomiPacketNonce,
  type XiaomiAuthCrypto,
} from "./xiaomi-auth";
import {
  decodeCommand,
  decodeCompanionDevice,
  encodeCommand,
  type XiaomiCommand,
} from "../protocol/xiaomi-proto";

const nodeCrypto: XiaomiAuthCrypto = {
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
  hmacSha256: (key, data) => new Uint8Array(createHmac("sha256", key).update(data).digest()),
  aesCcmEncrypt: (key, nonce, plaintext) => ccmEncrypt(key, nonce, plaintext),
  aesCcmDecrypt: (key, nonce, ciphertext) => ccmDecrypt(key, nonce, ciphertext),
  aesCtrCrypt: (key, iv, data) => {
    const cipher = createCipheriv("aes-128-ctr", key, iv);
    return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
  },
};

// Bun's node:crypto does not expose AES-CCM. This test-only adapter composes
// CCM (RFC 3610, 32-bit tag, 12-byte nonce, no AAD) from AES-ECB, which Bun
// does support. Production uses the platform crypto provider's CCM.
const CCM_TAG_BYTES = 4;
const CCM_LENGTH_BYTES = 3;

function aesEcbBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([cipher.update(block), cipher.final()]));
}

function ccmCounterBlock(nonce: Uint8Array, counter: number): Uint8Array {
  const block = new Uint8Array(16);
  block[0] = CCM_LENGTH_BYTES - 1;
  block.set(nonce, 1);
  let value = counter;
  for (let index = 0; index < CCM_LENGTH_BYTES; index += 1) {
    block[15 - index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return block;
}

function ccmMac(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const b0 = new Uint8Array(16);
  b0[0] = (((CCM_TAG_BYTES - 2) / 2) << 3) | (CCM_LENGTH_BYTES - 1);
  b0.set(nonce, 1);
  let length = plaintext.length;
  for (let index = 0; index < CCM_LENGTH_BYTES; index += 1) {
    b0[15 - index] = length & 0xff;
    length = Math.floor(length / 256);
  }
  let mac = aesEcbBlock(key, b0);
  for (let offset = 0; offset < plaintext.length; offset += 16) {
    const block = new Uint8Array(16);
    block.set(plaintext.subarray(offset, offset + 16));
    for (let index = 0; index < 16; index += 1) block[index] ^= mac[index]!;
    mac = aesEcbBlock(key, block);
  }
  return mac;
}

function ccmCrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let offset = 0, counter = 1; offset < data.length; offset += 16, counter += 1) {
    const stream = aesEcbBlock(key, ccmCounterBlock(nonce, counter));
    for (let index = 0; index < 16 && offset + index < data.length; index += 1) {
      out[offset + index] = data[offset + index]! ^ stream[index]!;
    }
  }
  return out;
}

function ccmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const mac = ccmMac(key, nonce, plaintext);
  const s0 = aesEcbBlock(key, ccmCounterBlock(nonce, 0));
  const out = new Uint8Array(plaintext.length + CCM_TAG_BYTES);
  out.set(ccmCrypt(key, nonce, plaintext), 0);
  for (let index = 0; index < CCM_TAG_BYTES; index += 1) {
    out[plaintext.length + index] = mac[index]! ^ s0[index]!;
  }
  return out;
}

function ccmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (ciphertext.length < CCM_TAG_BYTES) throw new Error("AUTH_CCM_TRUNCATED");
  const body = ciphertext.slice(0, -CCM_TAG_BYTES);
  const tag = ciphertext.slice(-CCM_TAG_BYTES);
  const plaintext = ccmCrypt(key, nonce, body);
  const mac = ccmMac(key, nonce, plaintext);
  const s0 = aesEcbBlock(key, ccmCounterBlock(nonce, 0));
  for (let index = 0; index < CCM_TAG_BYTES; index += 1) {
    if ((mac[index]! ^ s0[index]!) !== tag[index]!) throw new Error("AUTH_CCM_TAG");
  }
  return plaintext;
}

const hex = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const toHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

const secretKey = Uint8Array.from({ length: 16 }, (_, index) => index);
const phoneNonce = Uint8Array.from({ length: 16 }, (_, index) => 0x10 + index);
const watchNonce = Uint8Array.from({ length: 16 }, (_, index) => 0x20 + index);
const watchHmac = hex("17aa8eecac21d9d71cba6ea653d126d77abc2f4d0357f1cce01d433d40e42235");

test("computeXiaomiAuthStep3Hmac matches the upstream derivation", () => {
  const result = computeXiaomiAuthStep3Hmac(nodeCrypto, secretKey, phoneNonce, watchNonce);

  expect(toHex(result)).toBe(
    "d738074e6570abb50d001db70f497a37923e295e02aecb7619a8e1b9f574c988" +
      "8676d22523869a15ee4340ac1bab5e35044aed283e7cace9aad41acb59fe75eb",
  );
});

test("buildXiaomiAuthNonceCommand encodes type 1 subtype 26", () => {
  const { command, phoneNonce: generated } = buildXiaomiAuthNonceCommand({
    crypto: nodeCrypto,
    deviceId: "device-1",
    phoneNonce,
  });

  expect(generated).toEqual(phoneNonce);
  const decoded = decodeCommand(encodeForTest(command));
  expect(decoded.type).toBe(1);
  expect(decoded.subtype).toBe(26);
  expect(decoded.auth?.appVerify?.nonce).toEqual(phoneNonce);
  expect(decoded.auth?.appVerify?.deviceId).toBe("device-1");
});

test("handleXiaomiWatchNonce derives keys and builds the app confirmation", () => {
  const result = handleXiaomiWatchNonce({
    crypto: nodeCrypto,
    secretKey,
    phoneNonce,
    watchNonce,
    watchHmac,
    phoneApiLevel: 34,
    phoneName: "Pixel",
    region: "US",
  });

  expect(toHex(result.keys.decryptionKey)).toBe("d738074e6570abb50d001db70f497a37");
  expect(toHex(result.keys.encryptionKey)).toBe("923e295e02aecb7619a8e1b9f574c988");
  expect(toHex(result.keys.decryptionNonce)).toBe("8676d225");
  expect(toHex(result.keys.encryptionNonce)).toBe("23869a15");

  const decoded = decodeCommand(encodeForTest(result.command));
  expect(decoded.type).toBe(1);
  expect(decoded.subtype).toBe(27);
  expect(toHex(decoded.auth?.appConfirm?.encryptedNonces ?? new Uint8Array())).toBe(
    "7e6e4d786282c1af4441b2ed315da93c8ae2c820a72df584d62315d73913a9dc",
  );

  const plaintext = xiaomiCcmDecrypt(
    nodeCrypto,
    result.keys.encryptionKey,
    result.keys.encryptionNonce,
    0,
    decoded.auth?.appConfirm?.encryptedDeviceInfo ?? new Uint8Array(),
  );
  expect(decodeCompanionDevice(plaintext)).toEqual({
    unknown1: 0,
    phoneApiLevel: 34,
    phoneName: "Pixel",
    unknown3: 224,
    region: "US",
  });
});

test("a wrong watch HMAC is rejected", () => {
  const wrong = watchHmac.slice();
  wrong[0] ^= 0xff;

  expect(() =>
    handleXiaomiWatchNonce({
      crypto: nodeCrypto,
      secretKey,
      phoneNonce,
      watchNonce,
      watchHmac: wrong,
      phoneApiLevel: 34,
      phoneName: "Pixel",
      region: "US",
    }),
  ).toThrow("AUTH_HMAC_MISMATCH");
});

test("runXiaomiAuthHandshake runs both steps over a transport", async () => {
  const sent: XiaomiCommand[] = [];
  let received = 0;
  const transport = {
    async send(command: XiaomiCommand) {
      sent.push(command);
    },
    async receive() {
      received += 1;
      if (received === 1) {
        return {
          type: 1,
          subtype: 26,
          auth: { deviceVerify: { nonce: watchNonce, hmac: watchHmac } },
        } satisfies XiaomiCommand;
      }
      return { type: 1, subtype: 27, auth: { status: 1 } } satisfies XiaomiCommand;
    },
  };

  const keys = await runXiaomiAuthHandshake(transport, {
    crypto: nodeCrypto,
    secretKey,
    phoneNonce,
    phoneApiLevel: 34,
    phoneName: "Pixel",
    region: "US",
    signal: new AbortController().signal,
  });

  expect(sent).toHaveLength(2);
  expect(sent[0]?.subtype).toBe(26);
  expect(sent[1]?.subtype).toBe(27);
  expect(toHex(keys.decryptionKey)).toBe("d738074e6570abb50d001db70f497a37");
});

test("runXiaomiAuthHandshake rejects a failed auth response", async () => {
  const transport = {
    async send() {},
    async receive() {
      return {
        type: 1,
        subtype: 26,
        auth: { deviceVerify: { nonce: watchNonce, hmac: watchHmac } },
      };
    },
  };

  await expect(
    runXiaomiAuthHandshake(transport, {
      crypto: nodeCrypto,
      secretKey,
      phoneNonce,
      phoneApiLevel: 34,
      phoneName: "Pixel",
      region: "US",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("AUTH_REJECTED");
});

test("packet nonces use the upstream 4-byte base + zero + index layout", () => {
  expect(toHex(xiaomiPacketNonce(Uint8Array.of(1, 2, 3, 4), 0x01020304))).toBe(
    "010203040000000004030201",
  );
});

test("AES-CCM and AES-CTR wrappers round-trip", () => {
  const key = hex("000102030405060708090a0b0c0d0e0f");
  const nonce = hex("10111213");
  const plaintext = Uint8Array.from("hello xiaomi", (char) => char.charCodeAt(0));

  const ccm = xiaomiCcmEncrypt(nodeCrypto, key, nonce, 1, plaintext);
  expect(xiaomiCcmDecrypt(nodeCrypto, key, nonce, 1, ccm)).toEqual(plaintext);

  const ctr = xiaomiCtrCrypt(nodeCrypto, key, plaintext);
  expect(xiaomiCtrCrypt(nodeCrypto, key, ctr)).toEqual(plaintext);
});

// The auth module only exposes the command object; encode it with the codec.
function encodeForTest(command: XiaomiCommand): Uint8Array {
  return encodeCommand(command);
}
