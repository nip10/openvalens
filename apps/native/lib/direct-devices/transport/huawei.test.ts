/**
 * End-to-end tests for the Huawei/Honor BLE session.
 *
 * Derived from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import type { HuaweiLink } from "./huawei-link";
import { expect, test } from "bun:test";
import type { BleError, Characteristic } from "react-native-ble-plx";

import type { HuaweiCryptoProvider } from "../crypto/huawei-auth";
import {
  HUAWEI_AUTH_COMMAND,
  HUAWEI_BOND_COMMAND,
  HUAWEI_BOND_PARAMS_COMMAND,
  HUAWEI_DEVICE_CONFIG_SERVICE,
  HUAWEI_DEVICE_STATUS_COMMAND,
  HUAWEI_DIGEST_MESSAGE_RESPONSE,
  HUAWEI_FITNESS_SERVICE,
  HUAWEI_FITNESS_TOTALS_COMMAND,
  HUAWEI_LINK_PARAMS_COMMAND,
  HUAWEI_SECURITY_NEGOTIATION_COMMAND,
  HUAWEI_SERVICE_UUID,
  HUAWEI_SLEEP_DATA_COMMAND,
  HUAWEI_SLEEP_DATA_COUNT_COMMAND,
  HUAWEI_SLEEP_LIGHT,
  HUAWEI_STEP_DATA_COMMAND,
  HUAWEI_STEP_DATA_COUNT_COMMAND,
  HUAWEI_WRITE_UUID,
  HuaweiPacketReassembler,
  computeHuaweiAuthDigest,
  decodeHuaweiPacket,
  decodeHuaweiTlv,
  encodeHuaweiPacket,
  encodeHuaweiTlv,
  unwrapEncryptedHuaweiTlv,
  wrapEncryptedHuaweiTlv,
  type HuaweiAesProvider,
  type HuaweiParsedPacket,
  type HuaweiTlv,
} from "../protocol/huawei";
import {
  HuaweiUnsupportedAuthError,
  createHuaweiSession,
  createMemoryHuaweiSyncStateStore,
  type HuaweiSessionOptions,
} from "./huawei";

const KEY = Uint8Array.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);
const SERVER_NONCE = Uint8Array.from([
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
]);
const BASE = 1769934600; // 2026-02-01T08:30:00Z

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

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

type ResponseSpec = Readonly<{
  serviceId: number;
  commandId: number;
  tlv: HuaweiTlv;
  encrypt?: boolean;
}>;

type FakeOptions = Readonly<{
  crypto: HuaweiCryptoProvider;
  aes: HuaweiAesProvider;
  /** Overrides the link-params response TLV. */
  linkParams?: HuaweiTlv;
  respond: (packet: HuaweiParsedPacket, encrypted: boolean) => ResponseSpec | null;
}>;

function fakeDevice(options: FakeOptions) {
  const monitors = new Map<
    string,
    (error: BleError | null, value: Characteristic | null) => void
  >();
  const writes: Uint8Array[] = [];
  const encryptedRequests: boolean[] = [];
  const reassembler = new HuaweiPacketReassembler();

  const emit = (serviceId: number, commandId: number, tlv: HuaweiTlv, encrypt: boolean) => {
    const body = encrypt
      ? wrapEncryptedHuaweiTlv(
          encodeHuaweiTlv(tlv),
          KEY,
          Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 9),
          false,
          options.aes,
        )
      : encodeHuaweiTlv(tlv);
    for (const frame of encodeHuaweiPacket({ serviceId, commandId, tlv: body })) {
      const callback = monitors.get(`${HUAWEI_SERVICE_UUID}|0000fe02-0000-1000-8000-00805f9b34fb`);
      queueMicrotask(() =>
        callback?.(null, { value: Buffer.from(frame).toString("base64") } as Characteristic),
      );
    }
  };

  const device = {
    monitorCharacteristicForService: (
      service: string,
      characteristic: string,
      callback: (error: BleError | null, value: Characteristic | null) => void,
    ) => {
      const key = `${service}|${characteristic}`;
      monitors.set(key, callback);
      return {
        remove() {
          monitors.delete(key);
        },
      };
    },
    writeCharacteristicWithResponseForService: async (
      _service: string,
      _characteristic: string,
      value: string,
    ) => {
      const bytes = Uint8Array.from(Buffer.from(value, "base64"));
      writes.push(bytes);
      const parsed = reassembler.accept(decodeHuaweiPacket(bytes));
      if (!parsed) return {} as Characteristic;
      const encrypted = parsed.tlv.some((field) => field.tag === 0x7c);
      encryptedRequests.push(encrypted);
      const tlv = encrypted
        ? decodeHuaweiTlv(unwrapEncryptedHuaweiTlv(parsed.tlv, KEY, false, options.aes))
        : parsed.tlv;
      const packet = { ...parsed, tlv };
      if (
        packet.serviceId === HUAWEI_DEVICE_CONFIG_SERVICE &&
        packet.commandId === HUAWEI_LINK_PARAMS_COMMAND
      ) {
        emit(
          HUAWEI_DEVICE_CONFIG_SERVICE,
          HUAWEI_LINK_PARAMS_COMMAND,
          options.linkParams ?? defaultLinkParams(),
          false,
        );
        return {} as Characteristic;
      }
      const response = options.respond(packet, encrypted);
      if (response)
        emit(response.serviceId, response.commandId, response.tlv, response.encrypt ?? true);
      return {} as Characteristic;
    },
  };
  return { device, writes, encryptedRequests };
}

function defaultLinkParams(): HuaweiTlv {
  return [
    { tag: 0x01, value: Uint8Array.of(0x02) },
    { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
    { tag: 0x03, value: Uint8Array.of(0x02, 0x00) },
    { tag: 0x05, value: Uint8Array.of(0x00, 0x03, ...SERVER_NONCE) },
    { tag: 0x07, value: Uint8Array.of(0x00) },
    { tag: 0x08, value: Uint8Array.of(0x00) },
    { tag: 0x09, value: Uint8Array.of(0x00) },
    { tag: 0x0c, value: Uint8Array.of(0x00) },
  ];
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function container(tag: number, fields: HuaweiTlv): HuaweiTlv {
  return [{ tag, value: encodeHuaweiTlv(fields) }];
}

function authResponder(crypto: HuaweiCryptoProvider) {
  return (packet: HuaweiParsedPacket): ResponseSpec | null => {
    if (packet.serviceId !== HUAWEI_DEVICE_CONFIG_SERVICE) return null;
    if (packet.commandId === HUAWEI_DEVICE_STATUS_COMMAND) {
      return {
        serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
        commandId: HUAWEI_DEVICE_STATUS_COMMAND,
        tlv: [{ tag: 0x01, value: Uint8Array.of(0x01) }],
        encrypt: false,
      };
    }
    if (packet.commandId === HUAWEI_AUTH_COMMAND) {
      const clientNonce = packet.tlv.find((field) => field.tag === 0x02)!.value.slice(2, 18);
      const doubleNonce = new Uint8Array(32);
      doubleNonce.set(SERVER_NONCE, 0);
      doubleNonce.set(clientNonce, 16);
      const expected = computeHuaweiAuthDigest({
        message: HUAWEI_DIGEST_MESSAGE_RESPONSE,
        nonce: doubleNonce,
        authMode: 0,
        authVersion: 3,
        secretKey: KEY,
        crypto,
      }).slice(0, 0x20);
      return {
        serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
        commandId: HUAWEI_AUTH_COMMAND,
        tlv: [{ tag: 0x01, value: expected }],
        encrypt: false,
      };
    }
    if (packet.commandId === HUAWEI_BOND_PARAMS_COMMAND) {
      return {
        serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
        commandId: HUAWEI_BOND_PARAMS_COMMAND,
        tlv: [
          { tag: 0x01, value: Uint8Array.of(0x00) },
          { tag: 0x09, value: uint32(0) },
        ],
        encrypt: false,
      };
    }
    if (packet.commandId === HUAWEI_BOND_COMMAND) {
      return {
        serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
        commandId: HUAWEI_BOND_COMMAND,
        tlv: [],
        encrypt: false,
      };
    }
    return null;
  };
}

function syncResponder(packet: HuaweiParsedPacket): ResponseSpec | null {
  if (packet.serviceId !== HUAWEI_FITNESS_SERVICE) return null;
  if (packet.commandId === HUAWEI_SLEEP_DATA_COUNT_COMMAND)
    return {
      serviceId: HUAWEI_FITNESS_SERVICE,
      commandId: HUAWEI_SLEEP_DATA_COUNT_COMMAND,
      tlv: container(0x81, [{ tag: 0x02, value: Uint8Array.of(0x00, 0x01) }]),
    };
  if (packet.commandId === HUAWEI_STEP_DATA_COUNT_COMMAND)
    return {
      serviceId: HUAWEI_FITNESS_SERVICE,
      commandId: HUAWEI_STEP_DATA_COUNT_COMMAND,
      tlv: container(0x81, [{ tag: 0x02, value: Uint8Array.of(0x00, 0x01) }]),
    };
  if (packet.commandId === HUAWEI_FITNESS_TOTALS_COMMAND)
    return {
      serviceId: HUAWEI_FITNESS_SERVICE,
      commandId: HUAWEI_FITNESS_TOTALS_COMMAND,
      tlv: container(0x81, []),
    };
  if (packet.commandId === HUAWEI_SLEEP_DATA_COMMAND)
    return {
      serviceId: HUAWEI_FITNESS_SERVICE,
      commandId: HUAWEI_SLEEP_DATA_COMMAND,
      tlv: container(0x81, [
        { tag: 0x02, value: Uint8Array.of(0x00, 0x00) },
        {
          tag: 0x83,
          value: encodeHuaweiTlv([
            { tag: 0x04, value: Uint8Array.of(HUAWEI_SLEEP_LIGHT) },
            { tag: 0x05, value: Uint8Array.of(0x69, 0x7f, 0xda, 0xf0, 0x00, 0x0a) },
          ]),
        },
      ]),
    };
  if (packet.commandId === HUAWEI_STEP_DATA_COMMAND)
    return {
      serviceId: HUAWEI_FITNESS_SERVICE,
      commandId: HUAWEI_STEP_DATA_COMMAND,
      tlv: container(0x81, [
        { tag: 0x02, value: Uint8Array.of(0x00, 0x00) },
        { tag: 0x03, value: uint32(BASE) },
        {
          tag: 0x84,
          value: encodeHuaweiTlv([
            { tag: 0x05, value: Uint8Array.of(0x00) },
            { tag: 0x06, value: Uint8Array.of(0x42, 0x01, 0x2c, 0x48) },
          ]),
        },
      ]),
    };
  return null;
}

function sessionOptions(
  device: ReturnType<typeof fakeDevice>["device"],
  extra: Partial<HuaweiSessionOptions> = {},
): HuaweiSessionOptions {
  const crypto = nodeCrypto();
  const store = {
    get: () => KEY,
    set: () => undefined,
  };
  return {
    device,
    deviceId: "device-1",
    profile: {
      serviceUuid: HUAWEI_SERVICE_UUID,
      readUuid: "0000fe02-0000-1000-8000-00805f9b34fb",
      writeUuid: HUAWEI_WRITE_UUID,
      vendor: "huawei",
    },
    macAddress: "AA:BB:CC:DD:EE:FF",
    crypto,
    aes: nodeAes(),
    secretKeyStore: store,
    now: () => new Date("2026-02-01T09:00:00.000Z"),
    initDelayMs: 0,
    watchdogMs: 1_000,
    statusWatchdogMs: 100,
    syncState: createMemoryHuaweiSyncStateStore(),
    onRecord: () => undefined,
    ...extra,
  };
}

test("the session authenticates and runs the full sync chain", async () => {
  const crypto = nodeCrypto();
  const auth = authResponder(crypto);
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    respond: (packet) => auth(packet) ?? syncResponder(packet),
  });
  const records: Array<{ type: string }> = [];
  const session = createHuaweiSession(
    sessionOptions(fake.device, { onRecord: (record) => records.push(record) }),
  );
  session.start();
  await session.whenDone();

  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  expect(records[0]).toMatchObject({
    type: "steps",
    startTime: "2026-02-01T08:30:00.000Z",
    count: 300,
  });
  expect(records[1]).toMatchObject({ type: "heart_rate", bpm: 72 });
  expect(records[2]).toMatchObject({
    type: "sleep_session",
    startTime: "2026-02-01T23:00:00.000Z",
    endTime: "2026-02-01T23:10:00.000Z",
  });

  // The sync requests are encrypted; the init/auth frames are not.
  expect(fake.encryptedRequests.filter(Boolean).length).toBeGreaterThanOrEqual(5);
  await session.close();
});

test("a HiChain device is refused with a typed error", async () => {
  const crypto = nodeCrypto();
  const linkParams: HuaweiTlv = [
    { tag: 0x01, value: Uint8Array.of(0x02) },
    { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
    { tag: 0x05, value: Uint8Array.of(0x00, 0x03, ...SERVER_NONCE) },
    { tag: 0x07, value: Uint8Array.of(0x01) },
  ];
  const fake = fakeDevice({ crypto, aes: nodeAes(), linkParams, respond: () => null });
  const session = createHuaweiSession(sessionOptions(fake.device));
  session.start();
  await expect(session.whenDone()).rejects.toBeInstanceOf(HuaweiUnsupportedAuthError);
  await session.close();
});

test("a HiChainLite device without authVersion 2 is refused (PIN code path)", async () => {
  const crypto = nodeCrypto();
  const linkParams: HuaweiTlv = [
    { tag: 0x01, value: Uint8Array.of(0x02) },
    { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
    { tag: 0x05, value: Uint8Array.of(0x00, 0x03, ...SERVER_NONCE) },
    { tag: 0x07, value: Uint8Array.of(0x02) },
  ];
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    linkParams,
    respond: (packet) =>
      packet.commandId === HUAWEI_SECURITY_NEGOTIATION_COMMAND
        ? {
            serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
            commandId: HUAWEI_SECURITY_NEGOTIATION_COMMAND,
            tlv: [
              { tag: 0x01, value: Uint8Array.of(0x01) },
              { tag: 0x02, value: Uint8Array.of(0x01) },
            ],
            encrypt: false,
          }
        : null,
  });
  const session = createHuaweiSession(sessionOptions(fake.device));
  session.start();
  const error = await session.whenDone().catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(HuaweiUnsupportedAuthError);
  expect((error as HuaweiUnsupportedAuthError).reason).toBe("hichain_lite_pincode");
  await session.close();
});

test("a missing response trips the watchdog", async () => {
  const crypto = nodeCrypto();
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    respond: () => null,
  });
  const session = createHuaweiSession(
    sessionOptions(fake.device, { watchdogMs: 50, statusWatchdogMs: 20 }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_REQUEST_TIMEOUT");
  await session.close();
});

test("the encrypted request payload is a valid TLV after decryption", async () => {
  const crypto = nodeCrypto();
  const auth = authResponder(crypto);
  let sawEncryptedStepRequest = false;
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    respond: (packet, encrypted) => {
      if (
        packet.commandId === HUAWEI_STEP_DATA_COUNT_COMMAND &&
        encrypted &&
        packet.tlv.some((field) => field.tag === 0x03)
      )
        sawEncryptedStepRequest = true;
      return auth(packet) ?? syncResponder(packet);
    },
  });
  const session = createHuaweiSession(sessionOptions(fake.device));
  session.start();
  await session.whenDone();
  expect(sawEncryptedStepRequest).toBe(true);
  expect(hex(KEY)).toBe("000102030405060708090a0b0c0d0e0f");
  await session.close();
});

// ---------------------------------------------------------------------------
// Bluetooth Classic (RFCOMM): the same fake watch behind a byte-stream link
// ---------------------------------------------------------------------------

/** Wraps the fake as a stream link that delivers every frame in `chunk`-byte pieces. */
function rfcommLink(device: ReturnType<typeof fakeDevice>["device"], chunk: number): HuaweiLink {
  return {
    maxWriteBytes: Number.POSITIVE_INFINITY,
    subscribe(onBytes) {
      const subscription = device.monitorCharacteristicForService(
        HUAWEI_SERVICE_UUID,
        "0000fe02-0000-1000-8000-00805f9b34fb",
        (_error, value) => {
          const bytes = Uint8Array.from(Buffer.from(value!.value!, "base64"));
          for (let at = 0; at < bytes.length; at += chunk) onBytes(bytes.subarray(at, at + chunk));
        },
      );
      return () => subscription.remove();
    },
    async write(bytes) {
      await device.writeCharacteristicWithResponseForService(
        HUAWEI_SERVICE_UUID,
        HUAWEI_WRITE_UUID,
        Buffer.from(bytes).toString("base64"),
      );
    },
    async close() {},
  };
}

function brOptions(
  fake: ReturnType<typeof fakeDevice>,
  extra: Partial<HuaweiSessionOptions> = {},
): HuaweiSessionOptions {
  const { device: _device, profile: _profile, ...rest } = sessionOptions(fake.device);
  return { ...rest, link: rfcommLink(fake.device, 3), transport: "br", ...extra };
}

test("over Bluetooth Classic the session reframes the stream and skips the normal-mode bond", async () => {
  const crypto = nodeCrypto();
  const auth = authResponder(crypto);
  const commands: number[] = [];
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    respond: (packet) => {
      if (packet.serviceId === HUAWEI_DEVICE_CONFIG_SERVICE) commands.push(packet.commandId);
      return auth(packet) ?? syncResponder(packet);
    },
  });
  const records: Array<{ type: string }> = [];
  const session = createHuaweiSession(
    brOptions(fake, { onRecord: (record) => records.push(record) }),
  );
  session.start();
  await session.whenDone();
  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  expect(commands).toContain(HUAWEI_DEVICE_STATUS_COMMAND);
  expect(commands).toContain(HUAWEI_AUTH_COMMAND);
  expect(commands).not.toContain(HUAWEI_BOND_PARAMS_COMMAND);
  expect(commands).not.toContain(HUAWEI_BOND_COMMAND);
  await session.close();
});

test("over Bluetooth Classic an unsupported device status fails typed instead of stalling", async () => {
  const crypto = nodeCrypto();
  const auth = authResponder(crypto);
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    respond: (packet) =>
      packet.serviceId === HUAWEI_DEVICE_CONFIG_SERVICE &&
      packet.commandId === HUAWEI_DEVICE_STATUS_COMMAND
        ? {
            serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
            commandId: HUAWEI_DEVICE_STATUS_COMMAND,
            tlv: [{ tag: 0x01, value: Uint8Array.of(0x05) }],
            encrypt: false,
          }
        : auth(packet),
  });
  const session = createHuaweiSession(brOptions(fake));
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_DEVICE_STATUS_UNSUPPORTED");
});

test("models whose transactions are not crypted send every request in the clear", async () => {
  const crypto = nodeCrypto();
  const auth = authResponder(crypto);
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    respond: (packet) => auth(packet) ?? syncResponder(packet),
  });
  const session = createHuaweiSession(brOptions(fake, { transactionsCrypted: false }));
  session.start();
  await session.whenDone();
  expect(fake.encryptedRequests.length).toBeGreaterThan(5);
  expect(fake.encryptedRequests.every((encrypted) => !encrypted)).toBe(true);
});
