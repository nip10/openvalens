import { expect, test } from "bun:test";

import type { BtClassicAdapter, RfcommLink } from "../../../modules/bt-classic";
import {
  encodeZeppSppFrame,
  ZEPP_SPP_CMD,
  ZEPP_SPP_SERVICE_UUID,
  ZeppSppDeframer,
  type ZeppSppFrame,
} from "../protocol/zepp-spp";
import { openZeppSppLink } from "./zepp-spp";

const CHUNK_WRITE = "00000016-0000-3512-2118-0009af100700";
const CHUNK_READ = "00000017-0000-3512-2118-0009af100700";
const ACTIVITY_CONTROL = "00000004-0000-3512-2118-0009af100700";
const ACTIVITY_DATA = "00000005-0000-3512-2118-0009af100700";

function channelsRet(entries: [string, number][], version = 1): Uint8Array {
  const parts: number[] = [version, entries.length & 0xff, entries.length >> 8];
  for (const [uuid, channel] of entries)
    parts.push(...new TextEncoder().encode(uuid), 0, channel & 0xff, channel >> 8);
  return Uint8Array.from(parts);
}

const DEFAULT_CHANNELS: [string, number][] = [
  [CHUNK_WRITE, 0x10],
  [CHUNK_READ, 0x11],
  [ACTIVITY_CONTROL, 0x12],
  [ACTIVITY_DATA, 0x13],
];

/** A scripted watch on the far end of an RFCOMM socket. */
function fakeWatch(
  options: {
    channels?: Uint8Array;
    ackStatus?: number;
    ackNonce?: number;
    mtu?: number;
    silent?: boolean;
    openError?: string;
    openDelay?: Promise<void>;
  } = {},
) {
  const sent: ZeppSppFrame[] = [];
  const parser = new ZeppSppDeframer();
  let onBytes: ((bytes: Uint8Array) => void) | undefined;
  let onClosed: ((reason: string) => void) | undefined;
  let seq = 0x5a;
  let closes = 0;
  const opens: unknown[] = [];
  const deliver = (cmd: number, payload: Uint8Array) =>
    onBytes?.(encodeZeppSppFrame(cmd, seq++ & 0xff, payload));
  const socket: RfcommLink = {
    socketId: "rfcomm-1",
    subscribe(bytes, closed) {
      onBytes = bytes;
      onClosed = closed;
      return () => {
        onBytes = undefined;
        onClosed = undefined;
      };
    },
    async write(bytes) {
      for (const frame of parser.push(bytes)) {
        sent.push(frame);
        if (options.silent) continue;
        // Reply on a later tick, as a real socket would.
        queueMicrotask(() => {
          if (frame.cmd === ZEPP_SPP_CMD.CHANNELS_GET)
            deliver(ZEPP_SPP_CMD.CHANNELS_RET, options.channels ?? channelsRet(DEFAULT_CHANNELS));
          if (frame.cmd === ZEPP_SPP_CMD.SESSION_START) {
            const nonce = options.ackNonce ?? frame.payload;
            const mtu = options.mtu ?? 247;
            deliver(
              ZEPP_SPP_CMD.SESSION_START_ACK,
              Uint8Array.of(
                ...(nonce instanceof Uint8Array
                  ? nonce
                  : [nonce & 0xff, (nonce >> 8) & 0xff, (nonce >> 16) & 0xff, nonce >>> 24]),
                options.ackStatus ?? 1,
                7,
                mtu & 0xff,
                mtu >> 8,
                8,
                7,
                1,
              ),
            );
          }
        });
      }
    },
    async close() {
      closes += 1;
    },
  };
  const btClassic: BtClassicAdapter = {
    isSupported: () => true,
    listBonded: async () => [],
    discover: async () => undefined,
    openRfcomm: async (args) => {
      opens.push(args);
      await options.openDelay;
      if (options.openError) throw new Error(options.openError);
      return socket;
    },
  };
  return {
    btClassic,
    sent,
    opens,
    deliver,
    closes: () => closes,
    remoteClose: () => onClosed?.("remote"),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("handshake: CHANNELS_GET, SESSION_START with the nonce, then the session MTU", async () => {
  const watch = fakeWatch({ mtu: 247 });
  const link = await openZeppSppLink({
    btClassic: watch.btClassic,
    address: "AA:BB:CC:DD:EE:01",
    signal: new AbortController().signal,
    nonce: () => 0x12345678,
  });
  expect(watch.opens).toEqual([
    {
      address: "AA:BB:CC:DD:EE:01",
      uuid: ZEPP_SPP_SERVICE_UUID,
      secure: true,
      timeoutMs: 15_000,
    },
  ]);
  expect(watch.sent.map((frame) => [frame.cmd, frame.seq, Array.from(frame.payload)])).toEqual([
    [ZEPP_SPP_CMD.CHANNELS_GET, 0, []],
    [ZEPP_SPP_CMD.SESSION_START, 1, [0x78, 0x56, 0x34, 0x12]],
  ]);
  // ZeppOsSupport.setMtu(247); the encoder subtracts the ATT header.
  expect(link.maxWriteBytes).toBe(244);
  await link.close();
  expect(watch.closes()).toBe(1);
});

test("an MTU below 23 is ignored and a large one is capped for the chunk encoder", async () => {
  for (const [mtu, expected] of [
    [20, 20],
    [32768, 509],
  ] as const) {
    const watch = fakeWatch({ mtu });
    const link = await openZeppSppLink({
      btClassic: watch.btClassic,
      address: "AA:BB:CC:DD:EE:01",
      signal: new AbortController().signal,
    });
    expect(link.maxWriteBytes).toBe(expected);
    await link.close();
  }
});

test("characteristic writes and notifications ride their mapped channels", async () => {
  const watch = fakeWatch();
  const link = await openZeppSppLink({
    btClassic: watch.btClassic,
    address: "AA:BB:CC:DD:EE:01",
    signal: new AbortController().signal,
    nonce: () => 1,
  });
  const signal = new AbortController().signal;
  await link.write("chunk_write", Uint8Array.of(3, 0, 1), signal);
  await link.write("chunk_read", Uint8Array.of(4, 0), signal);
  await link.write("activity_control", Uint8Array.of(1), signal);
  // session 7, channel u16 LE, requestAck 0, value — seq continues from the handshake.
  expect(
    watch.sent.slice(2).map((frame) => [frame.cmd, frame.seq, Array.from(frame.payload)]),
  ).toEqual([
    [ZEPP_SPP_CMD.CHANNEL_DATA, 2, [7, 0x10, 0, 0, 3, 0, 1]],
    [ZEPP_SPP_CMD.CHANNEL_DATA, 3, [7, 0x11, 0, 0, 4, 0]],
    [ZEPP_SPP_CMD.CHANNEL_DATA, 4, [7, 0x12, 0, 0, 1]],
  ]);

  const chunks: number[][] = [];
  const activity: number[][] = [];
  link.subscribe(
    "chunk_read",
    (bytes) => chunks.push(Array.from(bytes)),
    () => undefined,
  );
  link.subscribe(
    "activity_data",
    (bytes) => activity.push(Array.from(bytes)),
    () => undefined,
  );
  watch.deliver(ZEPP_SPP_CMD.CHANNEL_DATA, Uint8Array.of(7, 0x11, 0, 0, 0xaa));
  watch.deliver(ZEPP_SPP_CMD.CHANNEL_DATA, Uint8Array.of(7, 0x13, 0, 0, 0xbb));
  // Wrong session and unmapped channel are dropped.
  watch.deliver(ZEPP_SPP_CMD.CHANNEL_DATA, Uint8Array.of(9, 0x11, 0, 0, 0xcc));
  watch.deliver(ZEPP_SPP_CMD.CHANNEL_DATA, Uint8Array.of(7, 0x99, 0, 1, 0xdd));
  expect(chunks).toEqual([[0xaa]]);
  expect(activity).toEqual([[0xbb]]);
  await link.close();
});

test("data that asks for an ack gets CHANNEL_ACK with its own sequence number; pings get pongs", async () => {
  const watch = fakeWatch();
  const link = await openZeppSppLink({
    btClassic: watch.btClassic,
    address: "AA:BB:CC:DD:EE:01",
    signal: new AbortController().signal,
  });
  link.subscribe(
    "chunk_read",
    () => undefined,
    () => undefined,
  );
  // The watch's next frame carries seq 0x5c (0x5a and 0x5b went to the handshake).
  watch.deliver(ZEPP_SPP_CMD.CHANNEL_DATA, Uint8Array.of(7, 0x11, 0, 1, 0xaa));
  watch.deliver(ZEPP_SPP_CMD.PING, Uint8Array.of(7, 0, 0, 0));
  watch.deliver(ZEPP_SPP_CMD.PING, Uint8Array.of(3, 0, 0, 0));
  await tick();
  expect(watch.sent.slice(2).map((frame) => [frame.cmd, Array.from(frame.payload)])).toEqual([
    [ZEPP_SPP_CMD.CHANNEL_ACK, [7, 0x5c, 1, 0]],
    [ZEPP_SPP_CMD.PONG, [7, 1, 0, 0]],
  ]);
  await link.close();
});

test("the watch ending our session or dropping the socket fails every subscriber once", async () => {
  for (const end of ["session", "socket"] as const) {
    const watch = fakeWatch();
    const link = await openZeppSppLink({
      btClassic: watch.btClassic,
      address: "AA:BB:CC:DD:EE:01",
      signal: new AbortController().signal,
    });
    let failures = 0;
    link.subscribe(
      "chunk_read",
      () => undefined,
      () => (failures += 1),
    );
    link.subscribe(
      "activity_data",
      () => undefined,
      () => (failures += 1),
    );
    if (end === "session") watch.deliver(ZEPP_SPP_CMD.SESSION_END, Uint8Array.of(7, 3));
    else watch.remoteClose();
    watch.remoteClose();
    expect(failures).toBe(2);
    await expect(
      link.write("chunk_write", Uint8Array.of(1), new AbortController().signal),
    ).rejects.toThrow("ZEPP_SPP_CLOSED");
    await link.close();
  }
});

test("handshake failures reject with a code and close the socket", async () => {
  const cases: [Parameters<typeof fakeWatch>[0], string][] = [
    [{ channels: channelsRet(DEFAULT_CHANNELS, 2) }, "ZEPP_SPP_UNSUPPORTED_VERSION"],
    [{ channels: channelsRet([[CHUNK_WRITE, 1]]) }, "ZEPP_SPP_CHANNELS_MISSING"],
    // Upstream ignores a bad nonce or status; the handshake then times out.
    [{ ackNonce: 0xdeadbeef }, "ZEPP_SPP_HANDSHAKE_TIMEOUT"],
    [{ ackStatus: 2 }, "ZEPP_SPP_HANDSHAKE_TIMEOUT"],
    [{ silent: true }, "ZEPP_SPP_HANDSHAKE_TIMEOUT"],
  ];
  for (const [options, code] of cases) {
    const watch = fakeWatch(options);
    await expect(
      openZeppSppLink({
        btClassic: watch.btClassic,
        address: "AA:BB:CC:DD:EE:01",
        signal: new AbortController().signal,
        handshakeTimeoutMs: 20,
      }),
    ).rejects.toThrow(code);
    expect(watch.closes()).toBe(1);
  }
  const refused = fakeWatch({ openError: "BT_CLASSIC_CONNECT_FAILED" });
  await expect(
    openZeppSppLink({
      btClassic: refused.btClassic,
      address: "AA:BB:CC:DD:EE:01",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("BT_CLASSIC_CONNECT_FAILED");
});

test("an abort during connect settles at once and closes the socket that arrives late", async () => {
  let release!: () => void;
  const watch = fakeWatch({ openDelay: new Promise<void>((resolve) => (release = resolve)) });
  const abort = new AbortController();
  const opening = openZeppSppLink({
    btClassic: watch.btClassic,
    address: "AA:BB:CC:DD:EE:01",
    signal: abort.signal,
  });
  abort.abort();
  await expect(opening).rejects.toThrow("CANCELLED");
  release();
  await tick();
  expect(watch.closes()).toBe(1);
});

test("an abort during the handshake rejects CANCELLED", async () => {
  const watch = fakeWatch({ silent: true });
  const abort = new AbortController();
  const opening = openZeppSppLink({
    btClassic: watch.btClassic,
    address: "AA:BB:CC:DD:EE:01",
    signal: abort.signal,
  });
  await tick();
  abort.abort();
  await expect(opening).rejects.toThrow("CANCELLED");
  expect(watch.closes()).toBe(1);
});
