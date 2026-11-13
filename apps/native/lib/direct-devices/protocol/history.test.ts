import { describe, expect, test } from "bun:test";
import type { HelioHistoryOptions, HelioLink } from "./types";
import { runHelioStepsHistory } from "./history";

function fixtureLink(raw: Uint8Array, completion = Uint8Array.of(0x10, 2, 1)) {
  let listener: ((bytes: Uint8Array) => void) | undefined;
  let served = false;
  const calls: number[][] = [];
  const link: HelioLink = {
    maxWriteBytes: 20,
    subscribe: (_characteristic, cb) => {
      listener = cb;
      return () => {
        listener = undefined;
      };
    },
    write: async () => {},
  };
  const channel = {
    services: new Map([[0x004b, false]]),
    close: async () => {},
    request: async (_endpoint: number, payload: Uint8Array) => {
      calls.push([...payload]);
      if (payload[0] === 1 && payload[1] === 1) {
        const date = Uint8Array.of(0xea, 0x07, 11, 5, 12, 0, 0, 0);
        const response = new Uint8Array(15);
        response[0] = 0x10;
        response[1] = 1;
        response[2] = 1;
        new DataView(response.buffer).setUint32(3, served ? 0 : raw.length, true);
        response.set(date, 7);
        return response;
      }
      if (payload.length === 1 && payload[0] === 2) {
        served = true;
        let counter = 0;
        for (let i = 0; i < raw.length; i += 7) {
          listener?.(Uint8Array.of(counter, ...raw.slice(i, i + 7)));
          counter = (counter + 1) & 255;
        }
        return completion;
      }
      if (payload[0] === 3 && payload[1] === 9) return Uint8Array.of(0x10, 3, 1);
      return Uint8Array.of(0x10, 1, 1);
    },
  };
  return { link, channel, calls };
}
const options = (
  onPage: HelioHistoryOptions["onPage"],
  signal = new AbortController().signal,
): HelioHistoryOptions => ({
  authKey: new Uint8Array(16),
  since: { version: 1, nextMinuteUtc: "2026-11-05T11:59:00.000Z", offsetQuarterHours: 0 },
  signal,
  onPage,
  onPhase: () => {},
});

describe("Helio history exchange", () => {
  test("awaits durable page before retaining ACK and advances exact minute cursor", async () => {
    const raw = Uint8Array.of(1, 2, 255, 0, 0, 0, 0, 0),
      f = fixtureLink(raw),
      events: string[] = [];
    const result = await runHelioStepsHistory(
      f.link,
      options(async (page) => {
        events.push("persist");
        expect(page.minutes[0]?.count).toBe(255);
        expect(page.nextCursor.nextMinuteUtc).toBe("2026-11-05T12:01:00.000Z");
      }),
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-05T13:00:00Z"),
      },
    );
    expect(result).toEqual({ pages: 1, minutes: 1, complete: true });
    expect(events).toEqual(["persist"]);
    expect(f.calls).toContainEqual([3, 9]);
    expect(f.calls.some((c) => c[0] === 3 && c[1] === 1)).toBe(false);
    expect(f.calls.some((c) => c.length === 1 && c[0] === 2)).toBe(true);
  });
  test("a durable-persistence failure only ever keep-ACKs (never 03 01) and still closes", async () => {
    const f = fixtureLink(Uint8Array.of(0, 0, 4, 0, 0, 0, 0, 0));
    let closed = false;
    f.channel.close = async () => {
      closed = true;
    };
    await expect(
      runHelioStepsHistory(
        f.link,
        options(async () => {
          throw new Error("storage failed");
        }),
        {
          openChannel: async () => f.channel as never,
          now: () => Date.parse("2026-11-05T13:00:00Z"),
        },
      ),
    ).rejects.toThrow("storage failed");
    // Upstream answers failed processing with 03 09 (keep); there is no
    // watch-side pointer, so the next sync re-requests the same minutes.
    expect(f.calls.filter((c) => c[0] === 3)).toEqual([[3, 9]]);
    expect(closed).toBe(true);
  });
  test("accepts no-data response only after retaining ACK without publishing a cursor", async () => {
    const f = fixtureLink(new Uint8Array()),
      result = await runHelioStepsHistory(
        f.link,
        options(async () => {
          throw new Error("unexpected page");
        }),
        {
          openChannel: async () => f.channel as never,
          now: () => Date.parse("2026-11-05T13:00:00Z"),
        },
      );
    expect(result).toEqual({ pages: 0, minutes: 0, complete: true });
    expect(f.calls).toContainEqual([3, 9]);
    expect(f.calls.some((c) => c.length === 1 && c[0] === 2)).toBe(false);
  });
  test("counter wraps 255 to 0 for a long bounded response", async () => {
    const raw = new Uint8Array(8 * 230);
    raw.fill(1);
    const f = fixtureLink(raw),
      result = await runHelioStepsHistory(
        f.link,
        options(async () => {}),
        {
          openChannel: async () => f.channel as never,
          now: () => Date.parse("2026-11-05T16:00:00Z"),
          limits: { maxMinutes: 300 },
        },
      );
    expect(result.minutes).toBe(230);
    expect(result.complete).toBe(true);
  });
  test("accepts a mismatching seven-byte activity CRC like upstream, and still keeps the data", async () => {
    // Upstream overrides validChecksum for activity (FetchActivityOperation:135-140);
    // enforcing it would stall a watch whose CRC never matches.
    const f = fixtureLink(
      Uint8Array.of(0, 0, 1, 0, 0, 0, 0, 0),
      Uint8Array.of(0x10, 2, 1, 0, 0, 0, 0),
    );
    const pages: unknown[] = [];
    await runHelioStepsHistory(
      f.link,
      options(async (page) => {
        pages.push(page);
      }),
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-05T13:00:00Z"),
      },
    );
    expect(pages).toHaveLength(1);
    expect(f.calls).toContainEqual([3, 9]);
    expect(f.calls.some((c) => c[0] === 3 && c[1] === 1)).toBe(false);
  });
  test("stopping at the minute limit still sends the keep ACK for the transfer received", async () => {
    const f = fixtureLink(new Uint8Array(8 * 5));
    const result = await runHelioStepsHistory(
      f.link,
      options(async () => {}),
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-05T13:00:00Z"),
        limits: { maxMinutes: 2 },
      },
    );
    expect(result.complete).toBe(false);
    const fetchIndex = f.calls.findIndex((c) => c.length === 1 && c[0] === 2);
    expect(f.calls.slice(fetchIndex + 1)).toContainEqual([3, 9]);
  });
  test("watches without endpoint 0x004b use plain activity control on characteristic 0004", async () => {
    const raw = Uint8Array.of(0, 0, 7, 70, 0, 0, 0, 0, 0, 0, 3, 71, 0, 0, 0, 0);
    const listeners = new Map<string, (bytes: Uint8Array) => void>();
    const controlWrites: number[][] = [];
    let served = false;
    const reply = (bytes: Uint8Array) =>
      queueMicrotask(() => listeners.get("activity_control")?.(bytes));
    const link: HelioLink = {
      maxWriteBytes: 20,
      subscribe: (characteristic, cb) => {
        listeners.set(characteristic, cb);
        return () => listeners.delete(characteristic);
      },
      write: async (characteristic, payload) => {
        if (characteristic !== "activity_control") return;
        controlWrites.push([...payload]);
        if (payload[0] === 1 && payload[1] === 1) {
          const response = new Uint8Array(16); // trailing byte tolerated
          response.set([0x10, 1, 1]);
          new DataView(response.buffer).setUint32(3, served ? 0 : raw.length, true);
          response.set(Uint8Array.of(0xea, 0x07, 11, 5, 12, 0, 0, 0), 7);
          reply(response);
        } else if (payload.length === 1 && payload[0] === 2) {
          served = true;
          listeners.get("activity_data")?.(Uint8Array.of(0, ...raw.slice(0, 7)));
          listeners.get("activity_data")?.(Uint8Array.of(1, ...raw.slice(7)));
          reply(Uint8Array.of(0x10, 2, 1));
        } else if (payload[0] === 3) reply(Uint8Array.of(0x10, 3, 1));
      },
    };
    const channel = {
      services: new Map<number, boolean>(),
      close: async () => {},
      request: async () => {
        throw new Error("the encrypted endpoint must not be used");
      },
    };
    const pages: { minutes: readonly { count: number; heartRate?: number }[] }[] = [];
    await runHelioStepsHistory(
      link,
      options(async (page) => {
        pages.push(page);
      }),
      { openChannel: async () => channel as never, now: () => Date.parse("2026-11-05T13:00:00Z") },
    );
    expect(pages[0]!.minutes.map((minute) => [minute.count, minute.heartRate])).toEqual([
      [7, 70],
      [3, 71],
    ]);
    expect(controlWrites.filter((c) => c[0] === 3)).toEqual([
      [3, 9],
      [3, 9],
    ]);
  });
  test("reports a page limit as incomplete, never as a complete history", async () => {
    const f = fixtureLink(new Uint8Array(8 * 3));
    const result = await runHelioStepsHistory(
      f.link,
      options(async () => {}),
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-05T13:00:00Z"),
        limits: { maxPages: 1 },
      },
    );
    expect(result).toEqual({ pages: 1, minutes: 3, complete: false });
  });
});

describe("Helio history paging", () => {
  test("a multi-day transfer is committed in bounded pages before one keep ACK", async () => {
    const f = fixtureLink(new Uint8Array(8 * 9_000));
    const pages: number[] = [];
    const result = await runHelioStepsHistory(
      f.link,
      {
        ...options(async (page) => {
          pages.push(page.minutes.length);
        }),
        since: { version: 1, nextMinuteUtc: "2026-11-05T12:00:00.000Z", offsetQuarterHours: 0 },
      },
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-20T00:00:00Z"),
      },
    );
    expect(pages).toEqual([4_000, 4_000, 1_000]);
    expect(result.minutes).toBe(9_000);
    expect(f.calls.filter((c) => c[0] === 3)).toEqual([
      [3, 9],
      [3, 9],
    ]);
  });
  test("a transfer larger than the minute budget commits what fits and advances", async () => {
    const f = fixtureLink(new Uint8Array(8 * 6_000));
    const committed: string[] = [];
    const result = await runHelioStepsHistory(
      f.link,
      {
        ...options(async (page) => {
          committed.push(page.nextCursor.nextMinuteUtc);
        }),
        since: { version: 1, nextMinuteUtc: "2026-11-05T12:00:00.000Z", offsetQuarterHours: 0 },
      },
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-20T00:00:00Z"),
        limits: { maxMinutes: 5_000 },
      },
    );
    expect(result).toMatchObject({ minutes: 5_000, complete: false });
    // 4,000 + 1,000 minutes committed: the next sync resumes after them.
    expect(committed).toEqual(["2026-11-08T06:40:00.000Z", "2026-11-08T23:20:00.000Z"]);
    expect(f.calls.filter((c) => c[0] === 3)).toEqual([[3, 9]]);
  });
});

describe("Zepp OS sleep rounds", () => {
  const MIDNIGHT = Date.UTC(2026, 10, 5) / 1000;
  function sleepRecord(reportTime: number) {
    const bytes = new Uint8Array(594);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, reportTime, true);
    view.setUint32(4, MIDNIGHT, true);
    bytes[0x54] = 1;
    view.setUint16(0x56, 1380, true);
    view.setUint16(0x58, 1439, true);
    bytes[0x5a] = 5;
    return bytes;
  }
  function sleepFixture(records: Uint8Array, completionCrc: "ok" | "bad" | "none" = "ok") {
    let listener: ((bytes: Uint8Array) => void) | undefined;
    const calls: number[][] = [];
    let sleepServed = false;
    let pendingType = 0;
    const link: HelioLink = {
      maxWriteBytes: 20,
      subscribe: (_characteristic, cb) => {
        listener = cb;
        return () => {
          listener = undefined;
        };
      },
      write: async () => {},
    };
    const crc = (data: Uint8Array) => {
      let value = 0xffffffff;
      for (const byte of data) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit += 1)
          value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
      }
      return (value ^ 0xffffffff) >>> 0;
    };
    const channel = {
      services: new Map([[0x004b, false]]),
      close: async () => {},
      request: async (_endpoint: number, payload: Uint8Array) => {
        calls.push([...payload]);
        if (payload[0] === 1) {
          pendingType = payload[1]!;
          const length = pendingType === 0x48 && !sleepServed ? records.length : 0;
          const response = new Uint8Array(15);
          response.set([0x10, 1, 1]);
          new DataView(response.buffer).setUint32(3, length, true);
          response.set(Uint8Array.of(0xea, 0x07, 11, 5, 12, 0, 0, 0), 7);
          return response;
        }
        if (payload.length === 1 && payload[0] === 2) {
          sleepServed = true;
          let counter = 0;
          for (let i = 0; i < records.length; i += 200) {
            listener?.(Uint8Array.of(counter, ...records.slice(i, i + 200)));
            counter = (counter + 1) & 255;
          }
          if (completionCrc === "none") return Uint8Array.of(0x10, 2, 1);
          const value = completionCrc === "ok" ? crc(records) : crc(records) ^ 1;
          return Uint8Array.of(
            0x10,
            2,
            1,
            value & 255,
            (value >>> 8) & 255,
            (value >>> 16) & 255,
            value >>> 24,
          );
        }
        return Uint8Array.of(0x10, 3, 1);
      },
    };
    return { link, channel, calls };
  }
  const sleepSince = {
    version: 1 as const,
    nextMinuteUtc: "2026-11-01T00:00:00.000Z",
    offsetQuarterHours: 0,
  };

  test("sleep sessions are fetched after activity with their own cursor, keep-ACK only", async () => {
    const report = MIDNIGHT + 8 * 3600 + 30;
    const f = sleepFixture(sleepRecord(report));
    const pages: {
      sessions: readonly { midnight: number }[];
      nextCursor: { nextMinuteUtc: string };
    }[] = [];
    const result = await runHelioStepsHistory(
      f.link,
      {
        ...options(async () => {}),
        sleep: { since: sleepSince, onPage: async (page) => void pages.push(page) },
      },
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-05T13:00:00Z"),
      },
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]!.sessions.map((session) => session.midnight)).toEqual([MIDNIGHT]);
    // since = last report time + 1 minute (upstream ARFO).
    expect(pages[0]!.nextCursor.nextMinuteUtc).toBe(
      new Date((Math.floor(report / 60) + 1) * 60_000).toISOString(),
    );
    expect(result.sleep).toMatchObject({ pages: 1, sessions: 1, errorCode: null });
    expect(f.calls.filter((c) => c[0] === 1).map((c) => c[1])).toEqual([0x01, 0x48, 0x48]);
    expect(f.calls.filter((c) => c[0] === 3).every((c) => c[1] === 9)).toBe(true);
  });

  test("a sleep CRC mismatch keeps the data on the watch and is reported, not thrown", async () => {
    const f = sleepFixture(sleepRecord(MIDNIGHT + 8 * 3600), "bad");
    let committed = 0;
    const result = await runHelioStepsHistory(
      f.link,
      {
        ...options(async () => {}),
        sleep: { since: sleepSince, onPage: async () => void committed++ },
      },
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-05T13:00:00Z"),
      },
    );
    expect(committed).toBe(0);
    expect(result.sleep).toMatchObject({ errorCode: "HISTORY_INTEGRITY_ERROR" });
    expect(f.calls.filter((c) => c[0] === 3)).toEqual([
      [3, 9],
      [3, 9],
    ]);
  });

  test("no sleep option means no sleep fetch (other families and no-score models)", async () => {
    const f = sleepFixture(sleepRecord(MIDNIGHT));
    const result = await runHelioStepsHistory(
      f.link,
      options(async () => {}),
      {
        openChannel: async () => f.channel as never,
        now: () => Date.parse("2026-11-05T13:00:00Z"),
      },
    );
    expect(result.sleep).toBeUndefined();
    expect(f.calls.some((c) => c[0] === 1 && c[1] === 0x48)).toBe(false);
  });
});
