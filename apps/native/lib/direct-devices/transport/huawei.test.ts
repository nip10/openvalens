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
  createHuaweiDeviceSecretKey,
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
  huaweiPakeBasePoint,
  huaweiPakeBindPin,
  huaweiPakeHashToCurve,
  huaweiPakeIdentityInfo,
  huaweiPakeIdentityPublicKey,
  huaweiPakeOpen,
  huaweiPakePasswordKey,
  huaweiPakeProof,
  huaweiPakeSeal,
  huaweiPakeSessionKeys,
  huaweiPakeSign,
  huaweiPakeStsPin,
  huaweiPakeStsPsk,
  huaweiPakeVerify,
  huaweiPakeX25519,
  parseHuaweiPakePeerIdentity,
} from "../protocol/huawei-pake";
import {
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
  /** Sends the reply this much later (a slow watch). */
  delayMs?: number;
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
      if (response) {
        const send = () =>
          emit(response.serviceId, response.commandId, response.tlv, response.encrypt ?? true);
        if (response.delayMs) setTimeout(send, response.delayMs);
        else send();
      }
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
function hichainWatch(
  options: {
    silentConfirm?: boolean;
    /** Ignores this many authenticate (op 2) step-1 requests. */
    silentAuthAttempts?: number;
    /** Ignores every authenticate until a bind completes (a factory reset). */
    forgotten?: boolean;
    /** Delays the reply to the nth authenticate step 1 (1-based) by this many ms. */
    authDelayMs?: (attempt: number) => number | undefined;
    /** Delays every step-2 reply. */
    stepTwoDelayMs?: number;
  } = {},
) {
  let authRequests = 0;
  let forgotten = options.forgotten ?? false;
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
      if (op === 2) {
        authRequests += 1;
        if (forgotten || authRequests <= (options.silentAuthAttempts ?? 0)) return null;
      }
      const key = op === 1 ? huaweiHiChainPinKey(crypto, pin) : issuedToken;
      const randSelf = huaweiUnhex(payload.isoSalt as string);
      const phoneId = huaweiUnhex(payload.peerAuthId as string);
      const randPeer = crypto.randomBytes(16);
      const psk = huaweiHiChainPsk(crypto, key, huaweiUnhex(payload.seed as string));
      state = { psk, randSelf, randPeer, phoneId };
      // The watch's token is the phone's "peer token" with roles mirrored.
      const token = crypto.hmacSha256(psk, concatHuaweiBytes(randPeer, randSelf, phoneId, watchId));
      const stepOne = json({
        isoSalt: huaweiHexUpper(randPeer),
        peerAuthId: huaweiHexUpper(watchId),
        peerUserType: 0,
        token: huaweiHexUpper(token),
      });
      return op === 2 ? { ...stepOne, delayMs: options.authDelayMs?.(authRequests) } : stepOne;
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
      return {
        ...json({
          returnCodeMac: huaweiHexUpper(huaweiHiChainReturnCodeMac(crypto, current.psk)),
        }),
        delayMs: options.stepTwoDelayMs,
      };
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
    if (op === 1) forgotten = false;
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
  return {
    fake,
    prompts,
    commands,
    issuedToken,
    packetKey: () => packetKey,
    authRequests: () => authRequests,
  };
}

/** Scales the 10 s (and 20 s) authenticate and 30 s confirm windows down 500x for tests. */
const fastHiChainTimers = {
  setTimeout: (callback: () => void, ms: number) =>
    setTimeout(callback, ms >= 10_000 ? ms / 500 : ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function storeWithToken(token: Uint8Array) {
  const store = createMemoryHuaweiHiChainStore();
  store.setAndroidId("device-1", "000102030405060708090A0B0C0D0E0F");
  store.setAuthToken("device-1", token);
  return store;
}

test("a watch that misses one authenticate is retried, with no prompt and no re-bind", async () => {
  const watch = hichainWatch({ silentAuthAttempts: 1 });
  const store = storeWithToken(watch.issuedToken);
  const asked: string[] = [];
  const records: Array<{ type: string }> = [];
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      timers: fastHiChainTimers,
      onAuthPrompt: (prompt) => asked.push(prompt),
      onRecord: (record) => records.push(record),
    }),
  );
  session.start();
  await session.whenDone();
  expect(watch.authRequests()).toBe(2);
  expect(asked).toEqual([]);
  expect(watch.commands).not.toContain(0x2c);
  expect(huaweiHexUpper(store.getAuthToken("device-1")!)).toBe(huaweiHexUpper(watch.issuedToken));
  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  await session.close();
});

test("a late answer to the abandoned authenticate is skipped, even mid-retry", async () => {
  // Attempt 1's step 1 arrives after its watchdog, while attempt 2 waits for step 2.
  const watch = hichainWatch({
    authDelayMs: (attempt) => (attempt === 1 ? 30 : undefined),
    stepTwoDelayMs: 60,
  });
  const store = storeWithToken(watch.issuedToken);
  const records: Array<{ type: string }> = [];
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      timers: fastHiChainTimers,
      onAuthPrompt: () => undefined,
      onRecord: (record) => records.push(record),
    }),
  );
  session.start();
  await session.whenDone();
  expect(watch.authRequests()).toBe(2);
  expect(watch.commands).not.toContain(0x2c);
  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  await session.close();
});

test("a reset watch that ignores the stored token is re-bound in the same sync", async () => {
  const watch = hichainWatch({ forgotten: true });
  const store = storeWithToken(new Uint8Array(32).fill(7));
  const asked: string[] = [];
  const records: Array<{ type: string }> = [];
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      timers: fastHiChainTimers,
      onAuthPrompt: (prompt) => asked.push(prompt),
      onRecord: (record) => records.push(record),
    }),
  );
  session.start();
  await session.whenDone();
  // Two silent authenticates, then PIN + bind (one prompt) + authenticate.
  expect(watch.authRequests()).toBe(3);
  expect(asked).toEqual(["confirm_on_watch"]);
  expect(watch.commands.filter((command) => command === 0x2c)).toHaveLength(1);
  expect(huaweiHexUpper(store.getAuthToken("device-1")!)).toBe(huaweiHexUpper(watch.issuedToken));
  expect(store.getAndroidId("device-1")).toBe("000102030405060708090A0B0C0D0E0F");
  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  await session.close();
});

test("a late answer that lands while the retry waits for its own step 1 is skipped", async () => {
  // Watchdogs (scaled): attempt 1 20 ms, attempt 2 40 ms. Reply 1 at 30 ms, reply 2 at 35 ms.
  const watch = hichainWatch({ authDelayMs: (attempt) => (attempt === 1 ? 30 : 15) });
  const store = storeWithToken(watch.issuedToken);
  const records: Array<{ type: string }> = [];
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      timers: fastHiChainTimers,
      onAuthPrompt: () => undefined,
      onRecord: (record) => records.push(record),
    }),
  );
  session.start();
  await session.whenDone();
  expect(watch.authRequests()).toBe(2);
  expect(watch.commands).not.toContain(0x2c);
  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  await session.close();
});

test("a slow watch whose late answer proves the token is not re-bound", async () => {
  // Reply 1 lands during attempt 2; reply 2 comes after attempt 2's watchdog.
  const watch = hichainWatch({ authDelayMs: (attempt) => (attempt === 1 ? 25 : 200) });
  const store = storeWithToken(watch.issuedToken);
  const asked: string[] = [];
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      timers: fastHiChainTimers,
      onAuthPrompt: (prompt) => asked.push(prompt),
    }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_HICHAIN_AUTH_TIMEOUT");
  expect(asked).toEqual([]);
  expect(watch.commands).not.toContain(0x2c);
  expect(huaweiHexUpper(store.getAuthToken("device-1")!)).toBe(huaweiHexUpper(watch.issuedToken));
});

test("a reset watch whose re-bind is not confirmed keeps the old token", async () => {
  const watch = hichainWatch({ forgotten: true, silentConfirm: true });
  const token = new Uint8Array(32).fill(7);
  const store = storeWithToken(token);
  const asked: string[] = [];
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      timers: fastHiChainTimers,
      onAuthPrompt: (prompt) => asked.push(prompt),
    }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_HICHAIN_CONFIRM_TIMEOUT");
  expect(asked).toEqual(["confirm_on_watch"]);
  expect(store.getAuthToken("device-1")).toEqual(token);
});

test("closing the session during the authenticate retries stops all writes", async () => {
  const watch = hichainWatch({ forgotten: true });
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: storeWithToken(new Uint8Array(32).fill(7)),
      timers: fastHiChainTimers,
      onAuthPrompt: () => undefined,
    }),
  );
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(watch.authRequests()).toBe(2);
  await session.close();
  const written = watch.fake.writes.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(watch.fake.writes.length).toBe(written);
  expect(watch.commands).not.toContain(0x2c);
  await session.whenDone();
});

test("without a prompt handler a silent watch fails typed and keeps its token", async () => {
  const watch = hichainWatch({ forgotten: true });
  const token = new Uint8Array(32).fill(7);
  const store = storeWithToken(token);
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, { hichainStore: store, timers: fastHiChainTimers }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_HICHAIN_AUTH_TIMEOUT");
  expect(watch.authRequests()).toBe(2);
  expect(watch.commands).not.toContain(0x2c);
  expect(store.getAuthToken("device-1")).toEqual(token);
});

test("a silent watch that also ignores the PIN request keeps its token", async () => {
  const watch = hichainWatch({ forgotten: true });
  const token = new Uint8Array(32).fill(7);
  const store = storeWithToken(token);
  const session = createHuaweiSession(
    sessionOptions(watch.fake.device, {
      hichainStore: store,
      timers: fastHiChainTimers,
      watchdogMs: 30,
      onAuthPrompt: () => undefined,
      // Drop the PIN reply: the watch is out of reach, not reset.
      device: {
        ...watch.fake.device,
        writeCharacteristicWithResponseForService: async (service, characteristic, value) => {
          const bytes = Uint8Array.from(Buffer.from(value, "base64"));
          if (bytes[4] === HUAWEI_DEVICE_CONFIG_SERVICE && bytes[5] === 0x2c)
            return {} as Characteristic;
          return watch.fake.device.writeCharacteristicWithResponseForService(
            service,
            characteristic,
            value,
          );
        },
      },
    }),
  );
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_REQUEST_TIMEOUT");
  expect(store.getAuthToken("device-1")).toEqual(token);
});

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

/**
 * A HiChainLite watch below auth version 2: it hands out its PIN (encrypted
 * under the v3 digest secret), checks our PIN-keyed digest, and learns the
 * transaction key from the bond, wrapped under the digest's first key.
 */
function hichainLitePinWatch(options: {
  authAlgo: number;
  checkedPin?: string;
  authVersion?: number;
}) {
  const authVersion = options.authVersion ?? 3;
  const crypto = nodeCrypto();
  const aes = nodeAes();
  const pin = new TextEncoder().encode("24681357");
  const commands: number[] = [];
  let bondedKey: Uint8Array | null = null;
  let lastChallenge: Uint8Array | null = null;
  const plain = (commandId: number, tlv: HuaweiTlv): ResponseSpec => ({
    serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
    commandId,
    tlv,
    encrypt: false,
  });
  const fake = fakeDevice({
    crypto,
    aes,
    linkParams: [
      { tag: 0x01, value: Uint8Array.of(0x02) },
      { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
      { tag: 0x05, value: Uint8Array.of(0x00, authVersion, ...SERVER_NONCE) },
      { tag: 0x07, value: Uint8Array.of(0x02) },
      { tag: 0x08, value: Uint8Array.of(options.authAlgo) },
    ],
    respond: (packet) => {
      if (packet.serviceId !== HUAWEI_DEVICE_CONFIG_SERVICE) return syncResponder(packet);
      commands.push(packet.commandId);
      if (packet.commandId === HUAWEI_SECURITY_NEGOTIATION_COMMAND)
        return plain(packet.commandId, [
          { tag: 0x01, value: Uint8Array.of(0x01) },
          { tag: 0x02, value: Uint8Array.of(0x01) },
        ]);
      if (packet.commandId === 0x2c) {
        const iv = crypto.randomBytes(16);
        return plain(0x2c, [
          { tag: 0x01, value: aes.encryptCbc(huaweiDigestSecret(authVersion), pin, iv) },
          { tag: 0x02, value: iv },
        ]);
      }
      if (packet.commandId === HUAWEI_AUTH_COMMAND) {
        const field = (tag: number) => packet.tlv.find((entry) => entry.tag === tag)!.value;
        const nonce = concatHuaweiBytes(SERVER_NONCE, field(0x02).slice(2, 18));
        const watchPin = new TextEncoder().encode(options.checkedPin ?? "24681357");
        const digest = (message: Uint8Array) =>
          computeHuaweiAuthDigest({
            message,
            nonce,
            authMode: 0x02,
            authVersion,
            secretKey: null,
            pinCode: watchPin,
            authAlgo: options.authAlgo,
            crypto,
          });
        const challenge = digest(Uint8Array.of(0x01, 0x00));
        if (hex(field(0x01)) !== hex(challenge.slice(0, 0x20))) return plain(0x13, []);
        if (field(0x03)[0] !== options.authAlgo) return plain(0x13, []);
        lastChallenge = challenge;
        return plain(0x13, [
          { tag: 0x01, value: digest(Uint8Array.of(0x01, 0x10)).slice(0, 0x20) },
        ]);
      }
      if (packet.commandId === HUAWEI_BOND_PARAMS_COMMAND)
        return plain(packet.commandId, [
          { tag: 0x01, value: Uint8Array.of(0x01) },
          { tag: 0x09, value: uint32(0) },
        ]);
      if (packet.commandId === HUAWEI_BOND_COMMAND) {
        // The first key is digest[0x20..0x30] of the challenge, as the phone computed it.
        const field = (tag: number) => packet.tlv.find((entry) => entry.tag === tag)!.value;
        const firstKey = lastChallenge!.slice(0x20, 0x30);
        bondedKey = aes.decryptCbc(firstKey, field(0x06), field(0x07));
        return plain(packet.commandId, []);
      }
      return null;
    },
  });
  return { fake, commands, bondedKey: () => bondedKey };
}

for (const [authVersion, authAlgo] of [
  [3, 0],
  [3, 1],
  [1, 1],
  [4, 0],
] as const) {
  test(`a HiChainLite watch with auth version ${authVersion} authenticates with its PIN (authAlgo ${authAlgo})`, async () => {
    const watch = hichainLitePinWatch({ authAlgo, authVersion });
    const records: Array<{ type: string }> = [];
    const session = createHuaweiSession(
      sessionOptions(watch.fake.device, {
        hichainStore: createMemoryHuaweiHiChainStore(),
        onRecord: (record) => records.push(record),
      }),
    );
    session.start();
    await session.whenDone();
    // PIN before auth; HiChainLite always bonds, even when bond params say status 1.
    expect(watch.commands.slice(0, 6)).toEqual([
      HUAWEI_DEVICE_STATUS_COMMAND,
      HUAWEI_SECURITY_NEGOTIATION_COMMAND,
      0x2c,
      HUAWEI_AUTH_COMMAND,
      HUAWEI_BOND_PARAMS_COMMAND,
      HUAWEI_BOND_COMMAND,
    ]);
    expect(hex(watch.bondedKey()!)).toBe(hex(KEY));
    expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
    await session.close();
  });
}

test("a HiChainLite watch whose PIN does not match fails authentication", async () => {
  const watch = hichainLitePinWatch({ authAlgo: 1, checkedPin: "00000000" });
  const session = createHuaweiSession(sessionOptions(watch.fake.device));
  session.start();
  await expect(session.whenDone()).rejects.toThrow("HUAWEI_AUTH_FAILED");
  expect(watch.commands).not.toContain(HUAWEI_BOND_COMMAND);
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

for (const status of [0, 1]) {
  test(`a type-4 watch on HiChainLite bonds like normal mode (bond params status ${status})`, async () => {
    // Auth mode 4: `GetAuthRequest` keys nothing with the PIN, so the digest is
    // normal mode; `GetBondRequest` wraps the key under the MAC-derived key, and
    // `GetBondParamsRequest` stops on status 1.
    const crypto = nodeCrypto();
    const aes = nodeAes();
    const commands: number[] = [];
    let bonded: Uint8Array | null = null;
    const plain = (commandId: number, tlv: HuaweiTlv): ResponseSpec => ({
      serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
      commandId,
      tlv,
      encrypt: false,
    });
    const fake = fakeDevice({
      crypto,
      aes,
      linkParams: [
        { tag: 0x01, value: Uint8Array.of(0x02) },
        { tag: 0x02, value: Uint8Array.of(0x00, 0xf4) },
        { tag: 0x05, value: Uint8Array.of(0x00, 0x02, ...SERVER_NONCE) },
        { tag: 0x07, value: Uint8Array.of(0x04) },
      ],
      respond: (packet) => {
        if (packet.serviceId !== HUAWEI_DEVICE_CONFIG_SERVICE) return null;
        commands.push(packet.commandId);
        const field = (tag: number) => packet.tlv.find((entry) => entry.tag === tag)?.value;
        if (packet.commandId === HUAWEI_SECURITY_NEGOTIATION_COMMAND)
          return plain(packet.commandId, [{ tag: 0x02, value: Uint8Array.of(0x01) }]);
        if (packet.commandId === HUAWEI_AUTH_COMMAND) {
          const nonce = concatHuaweiBytes(SERVER_NONCE, field(0x02)!.slice(2, 18));
          const digest = (message: Uint8Array) =>
            computeHuaweiAuthDigest({
              message,
              nonce,
              authMode: 0,
              authVersion: 2,
              secretKey: null,
              crypto,
            }).slice(0, 0x20);
          if (hex(field(0x01)!) !== hex(digest(Uint8Array.of(0x01, 0x00))))
            return plain(packet.commandId, []);
          // Tag 0x03 (authAlgo) only goes with auth mode 2.
          if (field(0x03)) return plain(packet.commandId, []);
          return plain(packet.commandId, [
            { tag: 0x01, value: digest(HUAWEI_DIGEST_MESSAGE_RESPONSE) },
          ]);
        }
        if (packet.commandId === HUAWEI_BOND_PARAMS_COMMAND)
          return plain(packet.commandId, [
            { tag: 0x01, value: Uint8Array.of(status) },
            { tag: 0x09, value: uint32(0) },
          ]);
        if (packet.commandId === HUAWEI_BOND_COMMAND) {
          bonded = aes.decryptCbc(
            createHuaweiDeviceSecretKey("AA:BB:CC:DD:EE:FF", 2, crypto),
            field(0x06)!,
            field(0x07)!,
          );
          return plain(packet.commandId, []);
        }
        return null;
      },
    });
    const session = createHuaweiSession(
      sessionOptions(fake.device, { hichainStore: createMemoryHuaweiHiChainStore() }),
    );
    session.start();
    // The fake cannot speak the type-4 GCM sync; only the auth chain matters here.
    await session.whenDone().catch(() => undefined);
    expect(commands).toContain(HUAWEI_BOND_PARAMS_COMMAND);
    expect(commands).not.toContain(0x2c);
    if (status === 1) expect(commands).not.toContain(HUAWEI_BOND_COMMAND);
    else expect(hex(bonded!)).toBe(hex(KEY));
    await session.close();
  });
}

// ---------------------------------------------------------------------------
// Honor PAKE/STS: a synthesized Honor Watch 5 (MBB framing on 0x01/0x28)
// ---------------------------------------------------------------------------

/**
 * The watch side of the PSK-SPEKE bind and STS reconnect, with its own random
 * keys. It trusts a phone identity learned at bind until `forget()`.
 */
function honorWatch(options: { supportType?: number } = {}) {
  const crypto = nodeCrypto();
  const aes = nodeAes();
  const seed = crypto.randomBytes(32);
  const authId = new TextEncoder().encode("HONOR-WATCH-0005");
  const negotiations: HuaweiTlv[] = [];
  const kinds: string[] = [];
  let trusted: Uint8Array | null = null;
  let state: {
    pin?: string;
    dhPrivate?: Uint8Array;
    salt?: Uint8Array;
    challenge?: Uint8Array;
    private?: Uint8Array;
    sessionKey?: Uint8Array;
    kcfKey?: Uint8Array;
    peerChallenge?: Uint8Array;
  } = {};
  const out = (tlv: HuaweiTlv): ResponseSpec => ({
    serviceId: HUAWEI_DEVICE_CONFIG_SERVICE,
    commandId: 0x28,
    tlv,
    encrypt: false,
  });
  const json = (message: number, payload: Record<string, unknown>) =>
    out([
      { tag: 0x01, value: Uint8Array.of(0x02) },
      { tag: 0x02, value: new TextEncoder().encode(JSON.stringify({ message, payload })) },
    ]);
  /** The SPEKE server side: our epk from the PIN's base, then keys from the phone's epk. */
  const spekeStart = (pin: string) => {
    state.pin = pin;
    state.salt = crypto.randomBytes(16);
    state.challenge = crypto.randomBytes(16);
    state.private = crypto.randomBytes(32);
    const base = huaweiPakeHashToCurve(huaweiPakePasswordKey(crypto, pin, state.salt));
    return {
      challenge: huaweiHexUpper(state.challenge),
      salt: huaweiHexUpper(state.salt),
      epk: huaweiHexUpper(huaweiPakeX25519(state.private, base)),
    };
  };
  const spekeConfirm = (payload: Record<string, string>) => {
    const peerChallenge = huaweiUnhex(payload.challenge!);
    const shared = huaweiPakeX25519(state.private!, huaweiUnhex(payload.epk!));
    const { sessionKey, kcfKey } = huaweiPakeSessionKeys(crypto, shared, state.salt!);
    const expected = huaweiPakeProof(crypto, kcfKey, peerChallenge, state.challenge!);
    if (huaweiHexUpper(expected) !== payload.kcfData) return null;
    Object.assign(state, { sessionKey, kcfKey, peerChallenge });
    return huaweiHexUpper(huaweiPakeProof(crypto, kcfKey, state.challenge!, peerChallenge));
  };
  const respond = (packet: HuaweiParsedPacket): ResponseSpec | null => {
    if (packet.serviceId !== HUAWEI_DEVICE_CONFIG_SERVICE) {
      // These models send their transactions in the clear.
      const sync = syncResponder(packet);
      return sync ? { ...sync, encrypt: false } : null;
    }
    if (packet.commandId === HUAWEI_DEVICE_STATUS_COMMAND)
      return { ...out([{ tag: 0x01, value: Uint8Array.of(0x01) }]), commandId: packet.commandId };
    if (packet.commandId === HUAWEI_SECURITY_NEGOTIATION_COMMAND) {
      negotiations.push(packet.tlv);
      const asked = packet.tlv.find((field) => field.tag === 0x02)!.value[0]!;
      // Grants a reconnect only to a phone it still trusts.
      const pairType = asked === 2 && trusted ? 2 : 1;
      return {
        ...out([{ tag: 0x02, value: Uint8Array.of(pairType) }]),
        commandId: packet.commandId,
      };
    }
    if (packet.commandId !== 0x28) return null;
    const dataType = packet.tlv.find((field) => field.tag === 0x01)!.value[0]!;
    const data = packet.tlv.find((field) => field.tag === 0x02)!.value;
    if (dataType === 0x01) {
      kinds.push("dh");
      state = { dhPrivate: crypto.randomBytes(32) };
      state.pin = huaweiPakeBindPin(huaweiPakeX25519(state.dhPrivate!, data));
      return out([
        { tag: 0x01, value: Uint8Array.of(0x01) },
        { tag: 0x02, value: huaweiPakeX25519(state.dhPrivate!, huaweiPakeBasePoint()) },
      ]);
    }
    const request = JSON.parse(new TextDecoder().decode(data)) as {
      message: number;
      payload: Record<string, string>;
    };
    kinds.push(String(request.message));
    const payload = request.payload;
    if (request.message === 1) return json(32769, spekeStart(state.pin!));
    if (request.message === 2) {
      const proof = spekeConfirm(payload);
      return proof ? json(32770, { kcfData: proof }) : json(32770, { errorCode: 1 });
    }
    if (request.message === 3) {
      const opened = huaweiPakeOpen(
        aes,
        state.sessionKey!,
        new TextEncoder().encode("hichain_exchange_request"),
        huaweiUnhex(payload.exAuthInfo!),
      );
      const phone = parseHuaweiPakePeerIdentity(opened);
      const signed = concatHuaweiBytes(state.peerChallenge!, state.challenge!, phone.info);
      if (!huaweiPakeVerify(crypto, signed, phone.signature, phone.authPk))
        return json(32771, { errorCode: 2 });
      trusted = phone.authPk;
      const info = huaweiPakeIdentityInfo(authId, huaweiPakeIdentityPublicKey(seed));
      const signature = huaweiPakeSign(
        crypto,
        seed,
        concatHuaweiBytes(state.challenge!, state.peerChallenge!, info),
      );
      const sealed = huaweiPakeSeal(
        aes,
        state.sessionKey!,
        crypto.randomBytes(12),
        new TextEncoder().encode("hichain_exchange_response"),
        concatHuaweiBytes(info, signature),
      );
      return json(32771, { exAuthInfo: huaweiHexUpper(sealed) });
    }
    if (request.message === 17) {
      if (!trusted) return json(32785, { errorCode: 0x2001 });
      const nonce = crypto.randomBytes(32);
      const pin = huaweiPakeStsPin(crypto, huaweiPakeStsPsk(seed, trusted), nonce);
      return json(32785, { ...spekeStart(pin), nonce: huaweiHexUpper(nonce) });
    }
    if (request.message === 18) {
      const proof = spekeConfirm(payload);
      return proof ? json(32786, { kcfData: proof }) : json(32786, { errorCode: 3 });
    }
    return null;
  };
  const linkParams = HICHAIN_LINK_PARAMS.map((field) =>
    field.tag === 0x07 ? { tag: 0x07, value: Uint8Array.of(options.supportType ?? 0x01) } : field,
  );
  const fake = fakeDevice({ crypto, aes, linkParams, respond });
  return {
    fake,
    negotiations,
    kinds,
    authId,
    publicKey: huaweiPakeIdentityPublicKey(seed),
    forget: () => void (trusted = null),
  };
}

function honorOptions(
  watch: ReturnType<typeof honorWatch>,
  store: ReturnType<typeof createMemoryHuaweiHiChainStore>,
  records: Array<{ type: string }> = [],
) {
  return brOptions(watch.fake, {
    honorPake: true,
    transactionsCrypted: false,
    hichainStore: store,
    onRecord: (record) => records.push(record),
  });
}

test("an Honor PAKE watch binds without user input, then reconnects with STS, syncing in the clear", async () => {
  const watch = honorWatch();
  const store = createMemoryHuaweiHiChainStore();
  const records: Array<{ type: string }> = [];
  const first = createHuaweiSession(honorOptions(watch, store, records));
  first.start();
  await first.whenDone();
  // The MBB request: authMode, pairType 1 (nothing known yet), our authId.
  expect(watch.negotiations[0]!.map((field) => field.tag)).toEqual([0x01, 0x02, 0x03]);
  expect(Array.from(watch.negotiations[0]![1]!.value)).toEqual([1]);
  expect(watch.kinds).toEqual(["dh", "1", "2", "3"]);
  expect(store.getPakePeer("device-1")).toEqual({ authId: watch.authId, authPk: watch.publicKey });
  expect(store.getPakeSeed("device-1")?.length).toBe(32);
  expect(records.map((record) => record.type)).toEqual(["steps", "heart_rate", "sleep_session"]);
  expect(watch.fake.encryptedRequests.every((encrypted) => !encrypted)).toBe(true);
  await first.close();

  const second = createHuaweiSession(honorOptions(watch, store));
  second.start();
  await second.whenDone();
  expect(Array.from(watch.negotiations[1]![1]!.value)).toEqual([2]);
  expect(watch.kinds.slice(4)).toEqual(["17", "18"]);
  await second.close();
});

test("an Honor watch that stopped trusting us is re-bound on the same sync", async () => {
  const watch = honorWatch();
  const store = createMemoryHuaweiHiChainStore();
  const first = createHuaweiSession(honorOptions(watch, store));
  first.start();
  await first.whenDone();
  await first.close();
  watch.forget();
  // We ask for a reconnect; the watch answers pairType 1, so a fresh bind runs.
  const second = createHuaweiSession(honorOptions(watch, store));
  second.start();
  await second.whenDone();
  expect(Array.from(watch.negotiations[1]![1]!.value)).toEqual([2]);
  expect(watch.kinds.slice(4)).toEqual(["dh", "1", "2", "3"]);
  await second.close();
});

test("a failed STS reconnect forgets the watch identity and asks for a re-bind", async () => {
  const watch = honorWatch();
  const store = createMemoryHuaweiHiChainStore();
  const first = createHuaweiSession(honorOptions(watch, store));
  first.start();
  await first.whenDone();
  await first.close();
  const seed = store.getPakeSeed("device-1");
  // A stale stored key: our STS PIN no longer matches the watch's.
  store.setPakePeer("device-1", {
    authId: watch.authId,
    authPk: huaweiPakeIdentityPublicKey(new Uint8Array(32).fill(5)),
  });
  const oldId = store.getAndroidId("device-1");
  const second = createHuaweiSession(honorOptions(watch, store));
  second.start();
  await expect(second.whenDone()).rejects.toThrow("HUAWEI_PAKE_REBIND_REQUIRED");
  expect(store.getPakePeer("device-1")).toBeNull();
  expect(store.getPakeSeed("device-1")).toEqual(seed);
  // A new authId, so a watch that still trusts the old one cannot steer us back into STS.
  const newId = store.getAndroidId("device-1");
  expect(newId).toMatch(/^[0-9A-F]{32}$/);
  expect(newId).not.toBe(oldId);
  // The next sync binds again, with no user input, under the new id.
  const third = createHuaweiSession(honorOptions(watch, store));
  third.start();
  await third.whenDone();
  expect(Array.from(watch.negotiations[2]![1]!.value)).toEqual([1]);
  expect(new TextDecoder().decode(watch.negotiations[2]![2]!.value)).toBe(newId!);
  await third.close();
});

test("a stored watch identity without our seed is dropped before negotiating", async () => {
  const watch = honorWatch();
  const store = createMemoryHuaweiHiChainStore();
  store.setPakePeer("device-1", { authId: watch.authId, authPk: watch.publicKey });
  const session = createHuaweiSession(honorOptions(watch, store));
  session.start();
  await session.whenDone();
  // No seed means no STS: we ask for a first pair and bind.
  expect(Array.from(watch.negotiations[0]![1]!.value)).toEqual([1]);
  expect(watch.kinds).toEqual(["dh", "1", "2", "3"]);
  await session.close();
});

test("a type-4 Honor watch negotiates PAKE with auth mode 4", async () => {
  const watch = honorWatch({ supportType: 0x04 });
  const session = createHuaweiSession(honorOptions(watch, createMemoryHuaweiHiChainStore()));
  session.start();
  await session.whenDone();
  expect(Array.from(watch.negotiations[0]![0]!.value)).toEqual([0x04]);
  await session.close();
});

test("an Honor PAKE model reporting support type 0 still runs normal mode", async () => {
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
  const session = createHuaweiSession(brOptions(fake, { honorPake: true }));
  session.start();
  await session.whenDone();
  expect(commands).toContain(HUAWEI_AUTH_COMMAND);
  expect(commands).not.toContain(HUAWEI_SECURITY_NEGOTIATION_COMMAND);
  expect(commands).not.toContain(0x28);
  await session.close();
});
