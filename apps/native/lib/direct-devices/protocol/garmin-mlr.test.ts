/**
 * Tests for the Garmin MLR header codec and reliability layer.
 *
 * Vectors are computed from `MlrCommunicator.java:318-331` and the recorded
 * registration bytes in the Gadgetbridge protocol docs, as tabulated in
 * `docs/research/notes/Garmin MLR transport/garmin-mlr-transport.md` §3-4
 * (Gadgetbridge revision 8976702fc3d00e6008c91fe994668cb4027f7bc2). None is a
 * hardware capture. AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { expect, test } from "bun:test";

import { buildGarminMlRegisterService, parseGarminMlMessage } from "./garmin";
import {
  GARMIN_MLR_ACK_TIMEOUT_MS,
  GARMIN_MLR_INITIAL_RTO_MS,
  GARMIN_MLR_MAX_QUEUED_FRAGMENTS,
  GARMIN_MLR_MAX_RTO_MS,
  GarminMlrChannel,
  decodeGarminMlrHeader,
  encodeGarminMlrPacket,
  garminMlrRouteHandle,
  isGarminMlrRoutableHandle,
} from "./garmin-mlr";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
const bytes = (text: string): Uint8Array =>
  Uint8Array.from(text.split(" ").map((part) => Number.parseInt(part, 16)));

/** Deterministic timers: tasks run in due order when time advances. */
class FakeTimers {
  now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + ms, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  get pending(): number {
    return this.tasks.size;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, task] of this.tasks) {
        if (task.at <= end && task.at < nextAt) {
          nextAt = task.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const task = this.tasks.get(nextId)!;
      this.tasks.delete(nextId);
      this.now = task.at;
      task.callback();
    }
    this.now = end;
  }
}

const HANDLE = 0x86;

function channel(maxPacketSize = 20) {
  const timers = new FakeTimers();
  const sent: Uint8Array[] = [];
  const received: Uint8Array[] = [];
  const acked: [number, boolean][] = [];
  const mlr = new GarminMlrChannel({
    handle: HANDLE,
    maxPacketSize,
    timers,
    sendPacket: (packet) => sent.push(packet),
    onData: (data) => received.push(data),
    onAcked: (count, all) => acked.push([count, all]),
  });
  /** A packet from the watch on our handle. */
  const peer = (reqNum: number, seqNum: number, data?: Uint8Array) =>
    mlr.receive(encodeGarminMlrPacket(HANDLE, reqNum, seqNum, data));
  const headers = () => sent.map((packet) => decodeGarminMlrHeader(packet[0]!, packet[1]!));
  return { mlr, timers, sent, received, acked, peer, headers };
}

// ---------------------------------------------------------------------------
// Header codec
// ---------------------------------------------------------------------------

test("header vectors match MlrCommunicator.createPacket", () => {
  const vectors: [number, number, number, string, string][] = [
    [0x86, 0, 0, "00", "e0 00 00"],
    [0x86, 5, 0, "", "e1 40"],
    [0x86, 3, 7, "aa", "e0 c7 aa"],
    [0x86, 63, 63, "aa", "ef ff aa"],
    [0x81, 0, 1, "00 05", "90 01 00 05"],
    [0x81, 17, 0, "", "94 40"],
    [0x80, 0, 0, "", "80 00"],
    [0x87, 63, 0, "", "ff c0"],
    [0x87, 0, 63, "01", "f0 3f 01"],
  ];
  for (const [handle, reqNum, seqNum, data, expected] of vectors) {
    const packet = encodeGarminMlrPacket(handle, reqNum, seqNum, data ? bytes(data) : undefined);
    expect(hex(packet)).toBe(expected);
    expect(decodeGarminMlrHeader(packet[0]!, packet[1]!)).toEqual({
      mlr: true,
      handle: handle & 0x07,
      reqNum,
      seqNum,
    });
    expect(garminMlrRouteHandle(packet[0]!)).toBe(handle);
  }
  expect(() => encodeGarminMlrPacket(0x86, 64, 0)).toThrow("GARMIN_MLR_REQ_NUM");
  expect(() => encodeGarminMlrPacket(0x86, 0, -1)).toThrow("GARMIN_MLR_SEQ_NUM");
  expect(decodeGarminMlrHeader(0x05, 0x00).mlr).toBe(false);
});

test("only 0x80..0x87 can carry MLR traffic", () => {
  for (let handle = 0x80; handle <= 0x87; handle += 1) {
    expect(isGarminMlrRoutableHandle(handle)).toBe(true);
  }
  for (const handle of [0x00, 0x04, 0x05, 0x68, 0x88, 0xa5, 0xff]) {
    expect(isGarminMlrRoutableHandle(handle)).toBe(false);
  }
});

test("registration vectors: MLR request, recorded MLR and ML grants, ALREADY_IN_USE", () => {
  expect(hex(buildGarminMlRegisterService(1, true))).toBe("00 00 02 00 00 00 00 00 00 00 01 00 02");
  expect(hex(buildGarminMlRegisterService(1))).toBe("00 00 02 00 00 00 00 00 00 00 01 00 00");
  // Docs' recorded MLR grant, client id rewritten from 1 to 2.
  expect(parseGarminMlMessage(bytes("00 01 02 00 00 00 00 00 00 00 01 00 00 86 01 00"))).toEqual({
    requestType: 1,
    service: 1,
    status: 0,
    handle: 0x86,
    reliable: 1,
  });
  for (const handle of [0x01, 0x2e, 0x68]) {
    const grant = bytes(`00 01 02 00 00 00 00 00 00 00 01 00 00 ${handle.toString(16)} 00`);
    expect(parseGarminMlMessage(grant)).toMatchObject({ status: 0, handle, reliable: 0 });
  }
  expect(parseGarminMlMessage(bytes("00 01 02 00 00 00 00 00 00 00 01 00 03 12 28"))).toMatchObject(
    {
      status: 3,
    },
  );
  // The docs' own client id 1 is not ours, so upstream drops it.
  expect(parseGarminMlMessage(bytes("00 01 01 00 00 00 00 00 00 00 01 00 00 86 01 00"))).toBe(null);
});

// ---------------------------------------------------------------------------
// Receive side
// ---------------------------------------------------------------------------

test("four in-order packets are acknowledged by the 20 ms timer", () => {
  const c = channel();
  for (let seq = 0; seq < 4; seq += 1) c.peer(0, seq, Uint8Array.of(seq));
  expect(c.received.map((data) => data[0])).toEqual([0, 1, 2, 3]);
  expect(c.sent).toEqual([]);
  c.timers.advance(GARMIN_MLR_ACK_TIMEOUT_MS - 1);
  expect(c.sent).toEqual([]);
  c.timers.advance(1);
  expect(c.sent.map(hex)).toEqual(["e1 00"]); // reqNum 4, seqNum 0
  expect(c.timers.pending).toBe(0);
});

test("the fifth unacknowledged packet is acknowledged at once", () => {
  const c = channel();
  for (let seq = 0; seq < 5; seq += 1) c.peer(0, seq, Uint8Array.of(seq));
  expect(c.sent.map(hex)).toEqual(["e1 40"]); // reqNum 5
  expect(c.timers.pending).toBe(0);
  c.timers.advance(1_000);
  expect(c.sent).toHaveLength(1);
});

test("an out-of-order packet is dropped and the expected ACK goes out at once", () => {
  const c = channel();
  c.peer(0, 0, Uint8Array.of(0xa0));
  c.peer(0, 2, Uint8Array.of(0xa2));
  expect(c.received.map(hex)).toEqual(["a0"]);
  expect(c.headers()).toEqual([{ mlr: true, handle: 6, reqNum: 1, seqNum: 0 }]);
  // The retransmitted packet is then accepted.
  c.peer(0, 1, Uint8Array.of(0xa1));
  expect(c.received.map(hex)).toEqual(["a0", "a1"]);
});

test("receive sequence numbers wrap from 63 to 0", () => {
  const c = channel();
  for (let index = 0; index < 70; index += 1) c.peer(0, index % 64, Uint8Array.of(index));
  expect(c.received).toHaveLength(70);
  c.timers.advance(GARMIN_MLR_ACK_TIMEOUT_MS);
  expect(c.headers().at(-1)!.reqNum).toBe(70 % 64);
});

test("packets for another handle, without the MLR flag or too short are ignored", () => {
  const c = channel();
  c.mlr.receive(encodeGarminMlrPacket(0x81, 0, 0, Uint8Array.of(1)));
  c.mlr.receive(Uint8Array.of(0x06, 0x00, 1));
  c.mlr.receive(Uint8Array.of(0xe0));
  expect(c.received).toEqual([]);
  expect(c.sent).toEqual([]);
});

// ---------------------------------------------------------------------------
// Send side
// ---------------------------------------------------------------------------

test("messages are fragmented at maxPacketSize - 2 with a piggybacked ACK", () => {
  const c = channel(6);
  c.peer(0, 0, Uint8Array.of(9)); // nextRcvSeq = 1
  c.mlr.send(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9));
  expect(c.sent.map(hex)).toEqual(["e0 40 01 02 03 04", "e0 41 05 06 07 08", "e0 42 09"]);
  // A piggybacked ACK does not cancel the delayed ACK (`Mlr:302-307`).
  c.timers.advance(GARMIN_MLR_ACK_TIMEOUT_MS);
  expect(hex(c.sent.at(-1)!)).toBe("e0 40");
});

test("the window holds 32 packets; a cumulative ACK of 10 releases 10 more", () => {
  const c = channel(3); // one data byte per packet
  c.mlr.send(new Uint8Array(50).fill(7));
  expect(c.sent).toHaveLength(32);
  expect(c.mlr.unacked).toBe(32);
  expect(c.mlr.queued).toBe(18);
  c.peer(10, 0); // ACK-only
  expect(c.sent).toHaveLength(42);
  expect(
    c
      .headers()
      .slice(32)
      .map((header) => header.seqNum),
  ).toEqual([32, 33, 34, 35, 36, 37, 38, 39, 40, 41]);
  expect(c.acked).toEqual([[10, false]]);
  expect(c.mlr.window).toBe(32);
});

test("a piggybacked ACK on incoming data releases the window", () => {
  const c = channel(3);
  c.mlr.send(new Uint8Array(33).fill(1));
  expect(c.sent).toHaveLength(32);
  c.peer(1, 0, Uint8Array.of(0x55));
  expect(c.received.map(hex)).toEqual(["55"]);
  expect(c.sent).toHaveLength(33);
  // The new data packet carries reqNum 1 for the packet just received.
  expect(c.headers()[32]).toEqual({ mlr: true, handle: 6, reqNum: 1, seqNum: 32 });
});

test("send sequence numbers wrap and every ACK is applied modulo 64", () => {
  const c = channel(3);
  c.mlr.send(new Uint8Array(60).fill(2));
  c.peer(32, 0);
  c.peer(60 % 64, 0);
  expect(c.mlr.unacked).toBe(0);
  c.mlr.send(new Uint8Array(10).fill(3));
  expect(
    c
      .headers()
      .slice(60)
      .map((header) => header.seqNum),
  ).toEqual([60, 61, 62, 63, 0, 1, 2, 3, 4, 5]);
  c.peer(6, 0);
  expect(c.mlr.unacked).toBe(0);
  expect(c.acked.at(-1)).toEqual([10, true]);
  expect(c.timers.pending).toBe(0);
});

// ---------------------------------------------------------------------------
// Retransmission
// ---------------------------------------------------------------------------

test("no ACK in 1 s resends every unacknowledged packet with its original reqNum", () => {
  const c = channel(3);
  c.peer(0, 0, Uint8Array.of(1));
  c.peer(0, 1, Uint8Array.of(2)); // nextRcvSeq = 2
  c.timers.advance(GARMIN_MLR_ACK_TIMEOUT_MS); // flush the delayed ACK
  const firstSend = c.sent.length;
  c.mlr.send(Uint8Array.of(0xa, 0xb, 0xc));
  c.peer(0, 2, Uint8Array.of(3)); // nextRcvSeq moves on to 3
  c.timers.advance(GARMIN_MLR_ACK_TIMEOUT_MS);
  const beforeTimeout = c.sent.length;
  c.timers.advance(GARMIN_MLR_INITIAL_RTO_MS);
  const resent = c.sent.slice(beforeTimeout).map(hex);
  // Same seqNums 0..2, same reqNum 2 as first sent, not the current 3.
  expect(resent).toEqual(["e0 80 0a", "e0 81 0b", "e0 82 0c"]);
  expect(c.sent.slice(firstSend, firstSend + 3).map(hex)).toEqual(resent);
  expect(c.mlr.rto).toBe(2_000);
  expect(c.mlr.window).toBe(16);
});

test("repeated timeouts back off to 20 s and a window of 1; an ACK recovers", () => {
  const c = channel(3);
  c.mlr.send(Uint8Array.of(1));
  const expected: [number, number][] = [
    [1_000, 16],
    [2_000, 8],
    [4_000, 4],
    [8_000, 2],
    [16_000, 1],
    [20_000, 1],
    [20_000, 1],
  ];
  let rto = GARMIN_MLR_INITIAL_RTO_MS;
  let sent = c.sent.length;
  for (const [wait, window] of expected) {
    expect(c.mlr.rto).toBe(rto);
    c.timers.advance(wait - 1);
    expect(c.sent.length).toBe(sent);
    c.timers.advance(1);
    expect(c.sent.length).toBe(sent + 1);
    sent = c.sent.length;
    expect(c.mlr.window).toBe(window);
    rto = Math.min(rto * 2, GARMIN_MLR_MAX_RTO_MS);
  }
  expect(c.mlr.rto).toBe(GARMIN_MLR_MAX_RTO_MS);
  c.peer(1, 0);
  expect(c.mlr.rto).toBe(GARMIN_MLR_INITIAL_RTO_MS);
  expect(c.mlr.window).toBe(2); // 1 + numAcked
  expect(c.timers.pending).toBe(0);
});

test("the window grows by numAcked after a backoff, capped at 32", () => {
  const c = channel(3);
  c.mlr.send(new Uint8Array(40).fill(1));
  c.timers.advance(1_000); // window 16, all 32 resent
  expect(c.mlr.window).toBe(16);
  c.peer(8, 0);
  expect(c.mlr.window).toBe(24);
  // 24 unacked of a 24 window: nothing more goes out yet.
  expect(c.mlr.unacked).toBe(24);
  c.peer(20, 0);
  expect(c.mlr.window).toBe(32);
  expect(c.mlr.unacked).toBe(20);
});

test("an ACK beyond what is outstanding is ignored", () => {
  const c = channel(3);
  c.mlr.send(Uint8Array.of(1, 2));
  c.peer(5, 0);
  expect(c.mlr.unacked).toBe(2);
  expect(c.acked).toEqual([]);
  c.peer(2, 0);
  expect(c.mlr.unacked).toBe(0);
});

// ---------------------------------------------------------------------------
// Lifecycle and bounds
// ---------------------------------------------------------------------------

test("close() cancels both timers, drops the queue and ignores later packets", () => {
  const c = channel(3);
  c.mlr.send(new Uint8Array(40).fill(1));
  c.peer(0, 0, Uint8Array.of(1)); // arms the ACK timer
  expect(c.timers.pending).toBe(2);
  c.mlr.close();
  expect(c.timers.pending).toBe(0);
  expect(c.mlr.queued).toBe(0);
  const sent = c.sent.length;
  c.timers.advance(60_000);
  c.peer(0, 1, Uint8Array.of(2));
  expect(c.sent.length).toBe(sent);
  expect(c.received).toHaveLength(1);
  expect(() => c.mlr.send(Uint8Array.of(1))).toThrow("GARMIN_MLR_CLOSED");
});

test("the outgoing queue is bounded", () => {
  const c = channel(3);
  c.mlr.send(new Uint8Array(32)); // fills the window
  c.mlr.send(new Uint8Array(GARMIN_MLR_MAX_QUEUED_FRAGMENTS));
  expect(() => c.mlr.send(Uint8Array.of(1))).toThrow("GARMIN_MLR_QUEUE_FULL");
  expect(c.mlr.queued).toBe(GARMIN_MLR_MAX_QUEUED_FRAGMENTS);
});

test("a send that calls straight back into receive keeps the state consistent", () => {
  const timers = new FakeTimers();
  let mlr: GarminMlrChannel;
  const sent: Uint8Array[] = [];
  mlr = new GarminMlrChannel({
    handle: HANDLE,
    maxPacketSize: 3,
    timers,
    sendPacket: (packet) => {
      sent.push(packet);
      const header = decodeGarminMlrHeader(packet[0]!, packet[1]!);
      // The peer acknowledges each data packet synchronously.
      if (packet.length > 2)
        mlr.receive(encodeGarminMlrPacket(HANDLE, (header.seqNum + 1) % 64, 0));
    },
    onData: () => undefined,
  });
  mlr.send(new Uint8Array(100).fill(1));
  expect(sent).toHaveLength(100);
  expect(mlr.unacked).toBe(0);
  expect(mlr.queued).toBe(0);
  expect(timers.pending).toBe(0);
});

test("a channel needs room for at least one data byte", () => {
  const options = {
    handle: HANDLE,
    timers: new FakeTimers(),
    sendPacket: () => undefined,
    onData: () => undefined,
  };
  expect(() => new GarminMlrChannel({ ...options, maxPacketSize: 2 })).toThrow("GARMIN_WRITE_SIZE");
  expect(() => new GarminMlrChannel({ ...options, maxPacketSize: 3 })).not.toThrow();
});
