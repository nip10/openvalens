/**
 * Tests for the Xiaomi daily-summary/steps history runner.
 *
 * The transport is a scripted request/response mock, mirroring the upstream
 * `XiaomiHealthService` file-id flow. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { crc32 } from "./chunked";
import {
  encodeXiaomiActivityFileId,
  XIAOMI_ACTIVITY_DAILY,
  XIAOMI_ACTIVITY_TYPE,
  XIAOMI_DETAIL_DETAILS,
  XIAOMI_DETAIL_SUMMARY,
  type XiaomiActivityFileId,
} from "./xiaomi-activity";
import {
  runXiaomiStepsHistory,
  type XiaomiHistoryTransport,
  type XiaomiStepsHistoryOptions,
} from "./xiaomi-history";
import type { XiaomiCommand } from "./xiaomi-proto";
import type { HelioCursor, HelioStepsPage } from "./types";

function withCrc(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  const checksum = crc32(body);
  out[body.length] = checksum & 0xff;
  out[body.length + 1] = (checksum >>> 8) & 0xff;
  out[body.length + 2] = (checksum >>> 16) & 0xff;
  out[body.length + 3] = (checksum >>> 24) & 0xff;
  return out;
}

function fileId(overrides: Partial<XiaomiActivityFileId> = {}): XiaomiActivityFileId {
  return {
    timestamp: 1_700_000_000,
    timezone: 8,
    type: XIAOMI_ACTIVITY_TYPE,
    subtype: XIAOMI_ACTIVITY_DAILY,
    detailType: XIAOMI_DETAIL_DETAILS,
    version: 3,
    ...overrides,
  };
}

function detailsFile(id: XiaomiActivityFileId, steps: number[]): Uint8Array {
  const header = Uint8Array.of(0x90, 0, 0, 0, 0);
  const body = new Uint8Array(7 + 1 + header.length + steps.length * 2);
  body.set(encodeXiaomiActivityFileId(id), 0);
  body[7] = 0;
  body.set(header, 8);
  let offset = 8 + header.length;
  for (const value of steps) {
    body[offset] = value & 0xff;
    body[offset + 1] = (value >>> 8) & 0xff;
    offset += 2;
  }
  return withCrc(body);
}

function summaryFile(id: XiaomiActivityFileId, steps: number): Uint8Array {
  const header = Uint8Array.of(0x80, 0, 0, 0);
  const body = new Uint8Array(7 + 1 + header.length + 4 + 53);
  body.set(encodeXiaomiActivityFileId(id), 0);
  body[7] = 0;
  body.set(header, 8);
  new DataView(body.buffer, 12, 4).setUint32(0, steps, true);
  return withCrc(body);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

class ScriptedTransport implements XiaomiHistoryTransport {
  readonly sent: XiaomiCommand[] = [];
  readonly commands: XiaomiCommand[] = [];
  readonly files: Uint8Array[] = [];
  started = false;
  closed = false;

  constructor(
    private readonly todayIds: Uint8Array,
    private readonly pastIds: Uint8Array,
    private readonly fileQueue: Uint8Array[],
  ) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async sendCommand(command: XiaomiCommand): Promise<void> {
    this.sent.push(command);
    if (command.subtype === 1) {
      this.commands.push({
        type: 8,
        subtype: 1,
        health: { activityRequestFileIds: this.todayIds },
      });
    } else if (command.subtype === 2) {
      this.commands.push({
        type: 8,
        subtype: 2,
        health: { activityRequestFileIds: this.pastIds },
      });
    } else if (command.subtype === 3) {
      const file = this.fileQueue.shift();
      if (!file) throw new Error("TEST_NO_FILE");
      this.files.push(file);
    }
  }

  async nextCommand(): Promise<XiaomiCommand> {
    const command = this.commands.shift();
    if (!command) throw new Error("TEST_NO_COMMAND");
    return command;
  }

  async nextActivityFile(): Promise<Uint8Array> {
    const file = this.files.shift();
    if (!file) throw new Error("TEST_NO_FILE");
    return file;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

const since = (timestamp: number): HelioCursor => ({
  version: 1,
  nextMinuteUtc: new Date(timestamp).toISOString(),
  offsetQuarterHours: 0,
});

function options(cursor: HelioCursor, pages: HelioStepsPage[]): XiaomiStepsHistoryOptions {
  return {
    authKey: new Uint8Array(16),
    since: cursor,
    signal: new AbortController().signal,
    onPhase: () => undefined,
    async onPage(page) {
      pages.push(page);
    },
  };
}

test("fetches today and past file ids and emits minute pages", async () => {
  const day1 = fileId({ timestamp: 1_700_000_000 });
  const day2 = fileId({ timestamp: 1_700_086_400 });
  const transport = new ScriptedTransport(
    encodeXiaomiActivityFileId(day1),
    encodeXiaomiActivityFileId(day2),
    [detailsFile(day1, [10, 20]), detailsFile(day2, [30])],
  );
  const pages: HelioStepsPage[] = [];

  const result = await runXiaomiStepsHistory(
    transport,
    options(since(day1.timestamp * 1000), pages),
  );

  expect(transport.started).toBe(true);
  expect(transport.closed).toBe(true);
  expect(result).toEqual({ pages: 2, minutes: 3, complete: true, granularity: "minute" });
  expect(pages).toHaveLength(2);
  expect(pages[0]!.minutes.map((minute) => minute.count)).toEqual([10, 20]);
  expect(pages[1]!.minutes.map((minute) => minute.count)).toEqual([30]);
  expect(pages[0]!.nextCursor.nextMinuteUtc).toBe(
    new Date(day1.timestamp * 1000 + 120_000).toISOString(),
  );
  expect(transport.sent.map((command) => command.subtype)).toEqual([1, 2, 3, 5, 3, 5]);
});

test("an empty window produces no pages", async () => {
  const transport = new ScriptedTransport(new Uint8Array(0), new Uint8Array(0), []);
  const pages: HelioStepsPage[] = [];

  const result = await runXiaomiStepsHistory(transport, options(since(0), pages));

  expect(result).toEqual({ pages: 0, minutes: 0, complete: true, granularity: "none" });
  expect(pages).toHaveLength(0);
});

test("a day with only a summary file falls back to a daily record", async () => {
  const day = fileId({ timestamp: 1_700_000_000, detailType: XIAOMI_DETAIL_SUMMARY, version: 5 });
  const transport = new ScriptedTransport(encodeXiaomiActivityFileId(day), new Uint8Array(0), [
    summaryFile(day, 1234),
  ]);
  const pages: HelioStepsPage[] = [];

  const result = await runXiaomiStepsHistory(
    transport,
    options(since(day.timestamp * 1000), pages),
  );

  expect(result).toEqual({ pages: 1, minutes: 1, complete: true, granularity: "daily" });
  expect(pages[0]!.minutes).toEqual([
    {
      externalRecordId: `xiaomi:${day.timestamp}:daily`,
      startTime: new Date(day.timestamp * 1000).toISOString(),
      endTime: new Date(day.timestamp * 1000 + 86_400_000).toISOString(),
      count: 1234,
    },
  ]);
});

test("the since cursor filters earlier minutes", async () => {
  const day = fileId({ timestamp: 1_700_000_000 });
  const transport = new ScriptedTransport(encodeXiaomiActivityFileId(day), new Uint8Array(0), [
    detailsFile(day, [10, 20]),
  ]);
  const pages: HelioStepsPage[] = [];

  const result = await runXiaomiStepsHistory(
    transport,
    options(since(day.timestamp * 1000 + 60_000), pages),
  );

  expect(result.minutes).toBe(1);
  expect(pages[0]!.minutes.map((minute) => minute.count)).toEqual([20]);
});

test("malformed file id lists are rejected", async () => {
  const transport = new ScriptedTransport(Uint8Array.of(1, 2, 3), new Uint8Array(0), []);

  await expect(runXiaomiStepsHistory(transport, options(since(0), []))).rejects.toThrow(
    "XIAOMI_FILE_ID_LENGTH",
  );
});

test("a corrupted activity file is rejected", async () => {
  const day = fileId({ timestamp: 1_700_000_000 });
  const file = detailsFile(day, [10]);
  file[file.length - 5] ^= 0xff;
  const transport = new ScriptedTransport(encodeXiaomiActivityFileId(day), new Uint8Array(0), [
    file,
  ]);

  await expect(runXiaomiStepsHistory(transport, options(since(0), []))).rejects.toThrow(
    "XIAOMI_ACTIVITY_CRC",
  );
});

test("page bounds stop after the configured number of pages", async () => {
  const day1 = fileId({ timestamp: 1_700_000_000 });
  const day2 = fileId({ timestamp: 1_700_086_400 });
  const transport = new ScriptedTransport(
    concat(encodeXiaomiActivityFileId(day1), encodeXiaomiActivityFileId(day2)),
    new Uint8Array(0),
    [detailsFile(day1, [10]), detailsFile(day2, [20])],
  );
  const pages: HelioStepsPage[] = [];

  const result = await runXiaomiStepsHistory(transport, options(since(0), pages), {
    limits: { maxPages: 1 },
  });

  expect(result.pages).toBe(1);
  expect(result.complete).toBe(false);
  expect(pages).toHaveLength(1);
});
