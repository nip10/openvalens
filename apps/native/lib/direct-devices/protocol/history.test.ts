import { describe, expect, test } from "bun:test";
import type { HelioHistoryOptions, HelioLink } from "./types";
import { runHelioStepsHistory } from "./history";

function fixtureLink(raw: Uint8Array, completion = Uint8Array.of(0x10, 2, 1)) {
  let listener: ((bytes: Uint8Array) => void) | undefined;
  let served = false;
  const calls: number[][] = [];
  const link: HelioLink = {
    maxWriteBytes: 20,
    subscribe: (_characteristic, cb) => { listener = cb; return () => { listener = undefined; }; },
    write: async () => {},
  };
  const channel = {
    services: new Map([[0x004b, false]]), close: async () => {},
    request: async (_endpoint: number, payload: Uint8Array) => {
      calls.push([...payload]);
      if (payload[0] === 1 && payload[1] === 1) {
        const date = Uint8Array.of(0xea, 0x07, 11, 5, 12, 0, 0, 0);
        const response = new Uint8Array(15); response[0] = 0x10; response[1] = 1; response[2] = 1;
        new DataView(response.buffer).setUint32(3, served ? 0 : raw.length, true); response.set(date, 7); return response;
      }
      if (payload.length === 1 && payload[0] === 2) {
        served = true;
        let counter = 0;
        for (let i = 0; i < raw.length; i += 7) { listener?.(Uint8Array.of(counter, ...raw.slice(i, i + 7))); counter = (counter + 1) & 255; }
        return completion;
      }
      if (payload[0] === 3 && payload[1] === 9) return Uint8Array.of(0x10, 3, 1);
      return Uint8Array.of(0x10, 1, 1);
    },
  };
  return { link, channel, calls };
}
const options = (onPage: HelioHistoryOptions["onPage"], signal = new AbortController().signal): HelioHistoryOptions => ({
  authKey: new Uint8Array(16), since: { version: 1, nextMinuteUtc: "2026-11-05T11:59:00.000Z", offsetQuarterHours: 0 },
  signal, onPage, onPhase: () => {},
});

describe("Helio history exchange", () => {
  test("awaits durable page before retaining ACK and advances exact minute cursor", async () => {
    const raw = Uint8Array.of(1, 2, 255, 0, 0, 0, 0, 0), f = fixtureLink(raw), events: string[] = [];
    const result = await runHelioStepsHistory(f.link, options(async page => {
      events.push("persist"); expect(page.minutes[0]?.count).toBe(255);
      expect(page.nextCursor.nextMinuteUtc).toBe("2026-11-05T12:01:00.000Z");
    }), { openChannel: async () => f.channel as never, now: () => Date.parse("2026-11-05T13:00:00Z") });
    expect(result).toEqual({ pages: 1, minutes: 1, complete: true });
    expect(events).toEqual(["persist"]); expect(f.calls).toContainEqual([3, 9]);
    expect(f.calls.some(c => c[0] === 3 && c[1] === 1)).toBe(false);
    expect(f.calls.some(c => c.length === 1 && c[0] === 2)).toBe(true);
  });
  test("does not ACK when durable persistence fails and still closes/unsubscribes", async () => {
    const f = fixtureLink(Uint8Array.of(0, 0, 4, 0, 0, 0, 0, 0)); let closed = false;
    f.channel.close = async () => { closed = true; };
    await expect(runHelioStepsHistory(f.link, options(async () => { throw new Error("storage failed"); }), {
      openChannel: async () => f.channel as never, now: () => Date.parse("2026-11-05T13:00:00Z"),
    })).rejects.toThrow("storage failed");
    expect(f.calls.some(c => c[0] === 3)).toBe(false); expect(closed).toBe(true);
  });
  test("accepts no-data response only after retaining ACK without publishing a cursor", async () => {
    const f = fixtureLink(new Uint8Array()), result = await runHelioStepsHistory(f.link, options(async () => { throw new Error("unexpected page"); }), {
      openChannel: async () => f.channel as never, now: () => Date.parse("2026-11-05T13:00:00Z"),
    });
    expect(result).toEqual({ pages: 0, minutes: 0, complete: true });
    expect(f.calls).toContainEqual([3, 9]); expect(f.calls.some(c => c.length === 1 && c[0] === 2)).toBe(false);
  });
  test("counter wraps 255 to 0 for a long bounded response", async () => {
    const raw = new Uint8Array(8 * 230); raw.fill(1);
    const f = fixtureLink(raw), result = await runHelioStepsHistory(f.link, options(async () => {}), {
      openChannel: async () => f.channel as never, now: () => Date.parse("2026-11-05T16:00:00Z"), limits: { maxMinutes: 300 },
    });
    expect(result.minutes).toBe(230); expect(result.complete).toBe(true);
  });
  test("validates optional completion CRC when the source sends its seven-byte form", async () => {
    const f = fixtureLink(Uint8Array.of(0, 0, 1, 0, 0, 0, 0, 0), Uint8Array.of(0x10, 2, 1, 0, 0, 0, 0));
    await expect(runHelioStepsHistory(f.link, options(async () => {}), {
      openChannel: async () => f.channel as never, now: () => Date.parse("2026-11-05T13:00:00Z"),
    })).rejects.toThrow("HISTORY_INTEGRITY_ERROR");
    expect(f.calls.some(c => c[0] === 3)).toBe(false);
  });
  test("reports a page limit as incomplete, never as a complete history", async () => {
    const f = fixtureLink(new Uint8Array(8 * 3));
    const result = await runHelioStepsHistory(f.link, options(async () => {}), {
      openChannel: async () => f.channel as never, now: () => Date.parse("2026-11-05T13:00:00Z"), limits: { maxPages: 1 },
    });
    expect(result).toEqual({ pages: 1, minutes: 3, complete: false });
  });
});
