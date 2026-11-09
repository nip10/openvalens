/*  Copyright (C) 2023-2026 José Rebelo, Yoran Vulker

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
 * Xiaomi daily-summary/steps history runner.
 *
 * Upstream:
 * - `service/devices/xiaomi/services/XiaomiHealthService.java`
 *   (`CMD_ACTIVITY_FETCH_TODAY` 1, `CMD_ACTIVITY_FETCH_PAST` 2,
 *   `CMD_ACTIVITY_FETCH_REQUEST` 3, `CMD_ACTIVITY_FETCH_ACK` 5, type 8)
 * - `service/devices/xiaomi/activity/XiaomiActivityFileFetcher.java`
 * - `service/devices/xiaomi/activity/XiaomiActivityFileId.java`
 * - `service/devices/xiaomi/activity/impl/DailyDetailsParser.java`
 * - `service/devices/xiaomi/activity/impl/DailySummaryParser.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/xiaomi/
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * The Xiaomi protocol is request/response over protobuf, not a cursor stream:
 * the phone asks for today's and past activity file ids, requests each file,
 * receives it on the activity channel, and ACKs it. This runner maps each
 * daily file to one Helio-shaped page so the existing capture/outbox pipeline
 * is reused unchanged.
 */

import type { HelioCursor, HelioHistoryResult, HelioStepsPage } from "./types";
import {
  decodeXiaomiActivityFileIds,
  encodeXiaomiActivityFileId,
  parseXiaomiDailyDetails,
  XIAOMI_ACTIVITY_DAILY,
  XIAOMI_ACTIVITY_TYPE,
  XIAOMI_DETAIL_DETAILS,
  XIAOMI_DETAIL_SUMMARY,
  type XiaomiActivityFileId,
} from "./xiaomi-activity";
import type { XiaomiCommand } from "./xiaomi-proto";

export type XiaomiHistoryTransport = {
  /** Runs the handshake/session setup. Authentication is the transport's job. */
  start?(signal: AbortSignal): Promise<void>;
  sendCommand(command: XiaomiCommand): Promise<void>;
  nextCommand(signal: AbortSignal): Promise<XiaomiCommand>;
  /** Returns one complete activity file (file id + padding + payload + CRC). */
  nextActivityFile(signal: AbortSignal): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type XiaomiStepsHistoryOptions = {
  /** 16-byte Xiaomi auth key, used by the transport's handshake. */
  authKey: Uint8Array;
  since: HelioCursor;
  signal: AbortSignal;
  onPage(page: HelioStepsPage): Promise<void>;
  onPhase(phase: "authenticating" | "discovering_services" | "fetching"): void;
};

export type XiaomiStepsHistoryResult = HelioHistoryResult &
  Readonly<{ granularity: "minute" | "daily" | "none" }>;

export type XiaomiHistoryLimits = Readonly<{
  maxFiles: number;
  maxPages: number;
  maxMinutes: number;
  maxMessageBytes: number;
  maxDurationMs: number;
}>;

const DEFAULT_LIMITS: XiaomiHistoryLimits = Object.freeze({
  maxFiles: 64,
  maxPages: 32,
  maxMinutes: 20_000,
  maxMessageBytes: 1_048_576,
  maxDurationMs: 120_000,
});

const XIAOMI_HEALTH_COMMAND = 8;
const CMD_FETCH_TODAY = 1;
const CMD_FETCH_PAST = 2;
const CMD_FETCH_REQUEST = 3;
const CMD_FETCH_ACK = 5;

function keyOf(fileId: XiaomiActivityFileId): string {
  return [
    fileId.timestamp,
    fileId.timezone,
    fileId.type,
    fileId.subtype,
    fileId.detailType,
    fileId.version,
  ].join(":");
}

function addFileIds(target: Map<string, XiaomiActivityFileId>, command: XiaomiCommand): void {
  const bytes = command.health?.activityRequestFileIds;
  if (!bytes || bytes.length === 0) return;
  for (const fileId of decodeXiaomiActivityFileIds(bytes)) {
    // Upstream skips the all-zero placeholder.
    if (fileId.timestamp === 0 && fileId.version === 0) continue;
    target.set(keyOf(fileId), fileId);
  }
}

async function waitForCommand(
  transport: XiaomiHistoryTransport,
  signal: AbortSignal,
  accept: (command: XiaomiCommand) => boolean,
): Promise<XiaomiCommand> {
  for (let attempts = 0; attempts < 16; attempts += 1) {
    if (signal.aborted) throw new Error("HISTORY_ABORTED");
    const command = await transport.nextCommand(signal);
    if (accept(command)) return command;
  }
  throw new Error("XIAOMI_HISTORY_UNEXPECTED_COMMAND");
}

type DayFiles = { details?: XiaomiActivityFileId; summary?: XiaomiActivityFileId };

/**
 * Fetches daily step history and emits Helio-shaped pages. Minute-level
 * `DailyDetails` files are the only supported source of minute history.
 * Daily summaries cannot safely be represented by the minute-page protocol.
 */
export async function runXiaomiStepsHistory(
  transport: XiaomiHistoryTransport,
  options: XiaomiStepsHistoryOptions,
  deps: { now?: () => number; limits?: Partial<XiaomiHistoryLimits> } = {},
): Promise<XiaomiStepsHistoryResult> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  if (
    !Number.isSafeInteger(limits.maxFiles) ||
    limits.maxFiles < 1 ||
    !Number.isSafeInteger(limits.maxPages) ||
    limits.maxPages < 1 ||
    !Number.isSafeInteger(limits.maxMinutes) ||
    limits.maxMinutes < 1 ||
    !Number.isSafeInteger(limits.maxMessageBytes) ||
    limits.maxMessageBytes < 12 ||
    !Number.isSafeInteger(limits.maxDurationMs) ||
    limits.maxDurationMs < 1
  ) {
    throw new Error("INVALID_HISTORY_LIMITS");
  }

  const started = now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.maxDurationMs);
  const signal = controller.signal;
  const checkAbort = () => {
    if (signal.aborted) throw new Error("HISTORY_ABORTED");
  };

  let pages = 0;
  let minutes = 0;
  let granularity: "minute" | "daily" | "none" = "none";

  try {
    checkAbort();
    options.onPhase("authenticating");
    await transport.start?.(signal);
    checkAbort();
    options.onPhase("fetching");

    const fileIds = new Map<string, XiaomiActivityFileId>();

    await transport.sendCommand({
      type: XIAOMI_HEALTH_COMMAND,
      subtype: CMD_FETCH_TODAY,
      health: { activitySyncRequestToday: { unknown1: 0 } },
    });
    addFileIds(
      fileIds,
      await waitForCommand(
        transport,
        signal,
        (command) =>
          command.type === XIAOMI_HEALTH_COMMAND &&
          command.subtype === CMD_FETCH_TODAY &&
          !!command.health?.activityRequestFileIds,
      ),
    );

    await transport.sendCommand({ type: XIAOMI_HEALTH_COMMAND, subtype: CMD_FETCH_PAST });
    addFileIds(
      fileIds,
      await waitForCommand(
        transport,
        signal,
        (command) =>
          command.type === XIAOMI_HEALTH_COMMAND &&
          command.subtype === CMD_FETCH_PAST &&
          !!command.health?.activityRequestFileIds,
      ),
    );

    const byDay = new Map<number, DayFiles>();
    for (const fileId of fileIds.values()) {
      if (fileId.type !== XIAOMI_ACTIVITY_TYPE || fileId.subtype !== XIAOMI_ACTIVITY_DAILY) {
        continue;
      }
      const day = byDay.get(fileId.timestamp) ?? {};
      if (fileId.detailType === XIAOMI_DETAIL_DETAILS) day.details = fileId;
      else if (fileId.detailType === XIAOMI_DETAIL_SUMMARY) day.summary = fileId;
      byDay.set(fileId.timestamp, day);
    }

    const sinceMs = Date.parse(options.since.nextMinuteUtc);
    if (!Number.isFinite(sinceMs)) throw new Error("INVALID_HISTORY_CURSOR");

    const allDays = [...byDay.entries()]
      .filter(
        ([timestamp, files]) =>
          (files.details || files.summary) && timestamp * 1000 + 86_400_000 > sinceMs,
      )
      .sort(([left], [right]) => left - right);
    // Consume the oldest bounded prefix so repeated runs can work through the
    // backlog without permanently skipping older files.
    const days = allDays.slice(0, limits.maxFiles);
    let complete = allDays.length <= limits.maxFiles;

    if (days.length === 0) {
      return { pages: 0, minutes: 0, complete: true, granularity: "none" };
    }

    for (const [, files] of days) {
      checkAbort();
      if (pages >= limits.maxPages || minutes >= limits.maxMinutes) {
        complete = false;
        break;
      }
      if (now() - started > limits.maxDurationMs) throw new Error("HISTORY_TIMEOUT");

      const fileId = files.details ?? files.summary;
      if (!fileId) continue;
      // A summary-only day is an unsupported coverage gap. Do not ACK it, or
      // advance the minute cursor past it; later details must remain replayable.
      if (!files.details && files.summary) {
        complete = false;
        break;
      }
      const fileIdBytes = encodeXiaomiActivityFileId(fileId);
      await transport.sendCommand({
        type: XIAOMI_HEALTH_COMMAND,
        subtype: CMD_FETCH_REQUEST,
        health: { activityRequestFileIds: fileIdBytes },
      });
      const bytes = await transport.nextActivityFile(signal);
      checkAbort();
      if (bytes.length > limits.maxMessageBytes) throw new Error("HISTORY_SIZE_LIMIT");

      let page: HelioStepsPage | null = null;
      if (files.details) {
        const parsed = parseXiaomiDailyDetails(bytes, files.details);
        const records = parsed.minutes
          .filter((minute) => minute.timestamp >= sinceMs)
          .map((minute) => ({
            externalRecordId: `xiaomi:${files.details!.timestamp}:${minute.timestamp}`,
            startTime: new Date(minute.timestamp).toISOString(),
            endTime: new Date(minute.timestamp + 60_000).toISOString(),
            count: minute.steps,
          }));
        if (records.length > 0) {
          if (records.length + minutes > limits.maxMinutes) {
            complete = false;
            break;
          }
          const last = records[records.length - 1]!;
          const nextCursor: HelioCursor = Object.freeze({
            version: 1,
            nextMinuteUtc: last.endTime,
            offsetQuarterHours: files.details.timezone,
          });
          if (Date.parse(nextCursor.nextMinuteUtc) <= sinceMs) {
            throw new Error("HISTORY_NONADVANCING_CURSOR");
          }
          page = Object.freeze({ minutes: Object.freeze(records), nextCursor });
          granularity = "minute";
          minutes += records.length;
        }
      }

      if (page) {
        checkAbort();
        await options.onPage(page);
        checkAbort();
        pages += 1;
      }

      // ACK after the page is committed, as upstream does after parsing.
      await transport.sendCommand({
        type: XIAOMI_HEALTH_COMMAND,
        subtype: CMD_FETCH_ACK,
        health: { activitySyncAckFileIds: fileIdBytes },
      });
      checkAbort();
    }

    return { pages, minutes, complete, granularity };
  } catch (error) {
    if (timedOut) throw new Error("HISTORY_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    await transport.close();
  }
}
