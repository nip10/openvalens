/**
 * End-to-end tests for the Huawei/Honor BLE session.
 *
 * Derived from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import type { HuaweiLink } from "./huawei-link";
import { nodeHuaweiAes, nodeHuaweiCrypto } from "../crypto/huawei-node-crypto.test-helpers";
import { expect, test } from "bun:test";
import type { BleError, Characteristic } from "react-native-ble-plx";

import {
  concatHuaweiBytes,
  huaweiDigestSecret,
  type HuaweiCryptoProvider,
} from "../crypto/huawei-auth";
import {
  huaweiHexUpper,
  huaweiHiChainPacketKey,
  huaweiHiChainPinKey,
  huaweiHiChainPsk,
  huaweiHiChainReturnCodeMac,
  huaweiHiChainSessionKey,
  huaweiUnhex,
} from "../protocol/huawei-hichain";
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
  createMemoryHuaweiHiChainStore,
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

const nodeCrypto = nodeHuaweiCrypto;
const nodeAes = nodeHuaweiAes;

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
  /** The transaction key; HiChain switches it to the packet key mid-session. */
  key?: () => Uint8Array;
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
          options.key?.() ?? KEY,
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
        ? decodeHuaweiTlv(
            unwrapEncryptedHuaweiTlv(parsed.tlv, options.key?.() ?? KEY, false, options.aes),
          )
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

// ---------------------------------------------------------------------------
// HiChain: a synthesized watch running the other side of the ISO exchange
// ---------------------------------------------------------------------------

const HICHAIN_LINK_PARAMS: HuaweiTlv = [
  { tag: 0x01, value: Uint8Array.of(0x02) },
  { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
  { tag: 0x05, value: Uint8Array.of(0x00, 0x03, ...SERVER_NONCE) },
  { tag: 0x07, value: Uint8Array.of(0x01) },
  { tag: 0x0c, value: Uint8Array.of(0x00) },
];

/** The watch side: a PIN, its own auth id, and the token it hands out on a bind. */
function hichainWatch(options: { silentConfirm?: boolean } = {}) {
  const crypto = nodeCrypto();
  const aes = nodeAes();
  const pin = new TextEncoder().encode("13572468");
  const watchId = new TextEncoder().encode("WATCH-AUTH-ID-0001");
  const issuedToken = crypto.randomBytes(32);
  const prompts: string[] = [];
  const commands: number[] = [];
  let packetKey: Uint8Array | null = null;
  let state: {
    psk: Uint8Array;
    randSelf: Uint8Array;
    randPeer: Uint8Array;
    phoneId: Uint8Array;
    sessionKey?: Uint8Array;
  } | null = null;
  const reply = (tlv: HuaweiTlv): ResponseSpec => ({
    serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
    commandId: 0x28,
    tlv,
    encrypt: false,
  });
  const json = (payload: Record<string, unknown>) =>
    reply([
      { tag: 0x04, value: Uint8Array.of(0) },
      { tag: 0x01, value: new TextEncoder().encode(JSON.stringify({ payload })) },
    ]);
  const respond = (packet: HuaweiParsedPacket): ResponseSpec | null => {
    if (packet.serviceId !== HUAWEI_DEVICE_CONFIG_SERVICE) return syncResponder(packet);
    commands.push(packet.commandId);
    if (packet.commandId === HUAWEI_DEVICE_STATUS_COMMAND)
      return {
        serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
        commandId: HUAWEI_DEVICE_STATUS_COMMAND,
        tlv: [{ tag: 0x01, value: Uint8Array.of(0x01) }],
        encrypt: false,
      };
    if (packet.commandId === HUAWEI_SECURITY_NEGOTIATION_COMMAND)
      return {
        serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
        commandId: HUAWEI_SECURITY_NEGOTIATION_COMMAND,
        tlv: [{ tag: 0x01, value: Uint8Array.of(0x01) }],
        encrypt: false,
      };
    if (packet.commandId === 0x2c) {
      const iv = crypto.randomBytes(16);
      return {
        serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
        commandId: 0x2c,
        tlv: [
          { tag: 0x01, value: aes.encryptCbc(huaweiDigestSecret(3), pin, iv) },
          { tag: 0x02, value: iv },
        ],
        encrypt: false,
      };
    }
    if (packet.commandId !== 0x28) return null;
    const request = JSON.parse(
      new TextDecoder().decode(packet.tlv.find((field) => field.tag === 0x01)!.value),
    ) as { message: number; payload: Record<string, string | number> };
    const op = packet.tlv.find((field) => field.tag === 0x02)!.value[0]!;
    const step = request.message & 0x0f;
    const payload = request.payload;
    if (step === 1) {
      // The bind's step 1 is held until the user taps Confirm.
      if (op === 1 && options.silentConfirm) return null;
      if (op === 1) prompts.push("confirmed");
      const key = op === 1 ? huaweiHiChainPinKey(crypto, pin) : issuedToken;
      const randSelf = huaweiUnhex(payload.isoSalt as string);
      const phoneId = huaweiUnhex(payload.peerAuthId as string);
      const randPeer = crypto.randomBytes(16);
      const psk = huaweiHiChainPsk(crypto, key, huaweiUnhex(payload.seed as string));
      state = { psk, randSelf, randPeer, phoneId };
      // The watch's token is the phone's "peer token" with roles mirrored.
      const token = crypto.hmacSha256(psk, concatHuaweiBytes(randPeer, randSelf, phoneId, watchId));
      return json({
        isoSalt: huaweiHexUpper(randPeer),
        peerAuthId: huaweiHexUpper(watchId),
        peerUserType: 0,
        token: huaweiHexUpper(token),
      });
    }
    const current = state!;
    if (step === 2) {
      const expected = crypto.hmacSha256(
        current.psk,
        concatHuaweiBytes(current.randSelf, current.randPeer, watchId, current.phoneId),
      );
      if (huaweiHexUpper(expected) !== payload.token) return json({ errorCode: 7 });
      current.sessionKey = huaweiHiChainSessionKey(
        crypto,
        current.psk,
        current.randSelf,
        current.randPeer,
      );
      return json({
        returnCodeMac: huaweiHexUpper(huaweiHiChainReturnCodeMac(crypto, current.psk)),
      });
    }
    if (step === 3 && op === 1) {
      const challenge = aes.decryptGcm(
        current.sessionKey!,
        huaweiUnhex(payload.encData as string),
        huaweiUnhex(payload.nonce as string),
        new TextEncoder().encode("hichain_iso_exchange"),
      );
      const nonce = crypto.randomBytes(12);
      return json({
        nonce: huaweiHexUpper(nonce),
        encAuthToken: huaweiHexUpper(
          aes.encryptGcm(current.sessionKey!, issuedToken, nonce, challenge),
        ),
      });
    }
    // Final step: verify the result MAC, then switch to the packet key after op 2.
    aes.decryptGcm(
      current.sessionKey!,
      huaweiUnhex(payload.encResult as string),
      huaweiUnhex(payload.nonce as string),
      new TextEncoder().encode("hichain_iso_result"),
    );
    if (op === 2)
      packetKey = huaweiHiChainPacketKey(
        crypto,
        current.sessionKey!,
        current.randSelf,
        current.randPeer,
      );
    return reply([{ tag: 0x04, value: Uint8Array.of(1) }]);
  };
  const fake = fakeDevice({
    crypto,
    aes,
    linkParams: HICHAIN_LINK_PARAMS,
    key: () => packetKey ?? KEY,
    respond,
  });
  return { fake, prompts, commands, issuedToken, packetKey: () => packetKey };
}

test("a HiChain watch binds once with its PIN, then syncs over the AES-256 packet key", async () => {
  const watch = hichainWatch();
  const store = createMemoryHuaweiHiChainStore();
  const asked: string[] = [];
  const records: Array<{ type: string }> = [];
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      onAuthPrompt: (prompt) => asked.push(prompt),
      onRecord: (record) => records.push(record),
    }),
  );
  session.start();
  await session.whenDone();
  expect(asked).toEqual(["confirm_on_watch"]);
  expect(watch.prompts).toEqual(["confirmed"]);
  expect(watch.commands.filter((command) => command === 0x2c)).toHaveLength(1);
  expect(huaweiHexUpper(store.getAuthToken("device-1")!)).toBe(huaweiHexUpper(watch.issuedToken));
  expect(watch.packetKey()?.length).toBe(32);
  // The sync ran encrypted with the packet key (the fake decrypts with it).
  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  expect(watch.fake.encryptedRequests.filter(Boolean).length).toBeGreaterThanOrEqual(5);
  await session.close();

  // Reconnect: the stored token authenticates; no PIN, no prompt.
  const reconnect = hichainWatchWithToken(watch.issuedToken);
  const second = createHuaweiSession(
    sessionOptions(reconnect.fake.device, {
      hichainStore: store,
      onAuthPrompt: (prompt) => asked.push(prompt),
    }),
  );
  second.start();
  await second.whenDone();
  expect(asked).toEqual(["confirm_on_watch"]);
  expect(reconnect.commands).not.toContain(0x2c);
  await second.close();
});

/** A watch that already issued `token` to this phone. */
function hichainWatchWithToken(token: Uint8Array) {
  const watch = hichainWatch();
  watch.issuedToken.set(token);
  return watch;
}

test("a stale HiChain token asks for a re-pair and is forgotten", async () => {
  const store = createMemoryHuaweiHiChainStore();
  store.setAndroidId("device-1", "000102030405060708090A0B0C0D0E0F");
  store.setAuthToken("device-1", new Uint8Array(32).fill(7));
  const watch = hichainWatch();
  const session = createHuaweiSession(sessionOptions(watch.fake.device, { hichainStore: store }));
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_HICHAIN_REBIND_REQUIRED");
  expect(store.getAuthToken("device-1")).toBeNull();
  // The id survives: the watch's group entry is keyed by it.
  expect(store.getAndroidId("device-1")).toBe("000102030405060708090A0B0C0D0E0F");
});

test("a bind the user never confirms times out with a typed error", async () => {
  const watch = hichainWatch({ silentConfirm: true });
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: createMemoryHuaweiHiChainStore(),
      // The 30 s confirm window, shortened for the test.
      timers: {
        setTimeout: (callback, ms) => setTimeout(callback, ms >= 30_000 ? 20 : ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_HICHAIN_CONFIRM_TIMEOUT");
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

test("a type-4 watch negotiating HiChainLite keeps auth mode 4 and takes the Lite auth path", async () => {
  const crypto = nodeCrypto();
  const seen: { command: number; tlv: HuaweiTlv }[] = [];
  const fake = fakeDevice({
    crypto,
    aes: nodeAes(),
    linkParams: [
      { tag: 0x01, value: Uint8Array.of(0x02) },
      { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
      { tag: 0x05, value: Uint8Array.of(0x00, 0x02, ...SERVER_NONCE) },
      { tag: 0x07, value: Uint8Array.of(0x04) },
    ],
    respond: (packet) => {
      if (packet.serviceId === HUAWEI_DEVICE_CONFIG_SERVICE)
        seen.push({ command: packet.commandId, tlv: packet.tlv });
      return packet.commandId === HUAWEI_SECURITY_NEGOTIATION_COMMAND
        ? {
            serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
            commandId: HUAWEI_SECURITY_NEGOTIATION_COMMAND,
            // No tag 0x01: authType 1 (HiChainLite).
            tlv: [{ tag: 0x02, value: Uint8Array.of(0x01) }],
            encrypt: false,
          }
        : null;
    },
  });
  const session = createHuaweiSession(
    sessionOptions(fake.device, { hichainStore: createMemoryHuaweiHiChainStore() }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow();
  const negotiation = seen.find((entry) => entry.command === HUAWEI_SECURITY_NEGOTIATION_COMMAND)!;
  expect(Array.from(negotiation.tlv.find((field) => field.tag === 0x01)!.value)).toEqual([0x04]);
  expect(negotiation.tlv.some((field) => field.tag === 0x06)).toBe(true);
  expect(negotiation.tlv.some((field) => field.tag === 0x07)).toBe(true);
  // The Lite auth request follows; HiChain (PIN 0x2C, exchange 0x28) never starts.
  expect(seen.map((entry) => entry.command)).toContain(HUAWEI_AUTH_COMMAND);
  expect(seen.some((entry) => entry.command === 0x2c || entry.command === 0x28)).toBe(false);
  await session.close();
});
