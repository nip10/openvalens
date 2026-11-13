import {
  directDeviceRefusalReason,
  listDirectDevicesOutput,
  registerDirectDeviceOutput,
  type DirectDeviceBindingSummary,
  type IngestDirectDeviceBatchInput,
} from "@openvalens/api/contracts/direct-device";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import {
  canonicalServerUrl,
  createCurrentDirectDeviceTicket,
  isAuthorityTicketCurrent,
  subscribeDirectDeviceAuthorityInvalidation,
  type AuthorityTicket,
} from "../authority";
import type { HelioSetupController } from "../setup/types";
import type { DirectDeviceIdentity } from "@openvalens/api/contracts/direct-device";
import {
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_ENVELOPES,
  MAX_REQUEST_BYTES,
  type DirectDeviceStore,
} from "../persistence/store";
import { drainDirectDeviceOutbox } from "../upload";
import { projectPebbleCapture } from "./pebble-capture";
import { projectFossilFiles } from "./fossil-capture";
import { parseFossilActivityFile, parseFossilAuthKey } from "../protocol/fossil-hr";
import type { PebbleIdentity, PebbleSessionOutcome } from "../pebble-types";
import type {
  HelioCursor,
  HelioStepsPage,
  ZeppSleepFallbackResult,
  ZeppSleepPage,
} from "../protocol/types";
import { zeppOsSupportsSleepSessions } from "../models/zepp-os";
import type { BleGattSample } from "../protocol/ble-gatt";
import {
  weightMeasurementExternalRecordId,
  type WeightMeasurementSample,
} from "../protocol/ble-scale";
import type { DirectDeviceLiveSample } from "../setup/types";
import type { DirectDeviceFamily, DirectDeviceHistorySample } from "../setup/types";
import type {
  DirectDeviceConfirmationTarget,
  HelioSyncContext,
  HelioSyncController,
  HelioSyncSnapshot,
} from "./types";

type DirectClient = {
  directDevice: {
    listDirectDevices(input: unknown): Promise<unknown>;
    registerDirectDevice(input: unknown): Promise<unknown>;
    ingestDirectDeviceBatch(input: unknown): Promise<unknown>;
  };
};

type OperationFetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

type Dependencies = {
  store: DirectDeviceStore;
  setup: HelioSetupController;
  captureCookie(): Promise<string>;
  fetch?: OperationFetch;
  makeClient?(url: string, cookie: string, signal?: AbortSignal): DirectClient;
  uuid?(): string;
  now?(): number;
  onApplied?(): Promise<void>;
  /** Mutable sink wired to the setup controller's live GATT/scale notifications. */
  liveCapture?: { handler: ((sample: DirectDeviceLiveSample) => void) | null };
  /** Mutable sink wired to the setup controller's ring history-sync records. */
  historyCapture?: { handler: ((sample: DirectDeviceHistorySample) => void) | null };
};

const emptySnapshot: HelioSyncSnapshot = Object.freeze({
  phase: "idle",
  bindings: Object.freeze([]),
  selectedBindingId: null,
  nearbyDevices: Object.freeze([]),
  connectedDeviceId: null,
  connectedModelId: null,
  connectedFamily: null,
  connectionGeneration: 0,
  capabilities: Object.freeze({ stepsHistory: false, liveCapture: false, historySync: false }),
  bluetooth: "unknown",
  errorCode: null,
  capturedMinutes: 0,
  pendingEnvelopes: 0,
  blockedIdentityEnvelopes: 0,
  acceptedEnvelopes: 0,
  queuedEnvelopes: 0,
  publication: null,
  isBusy: false,
  canSync: false,
});

/** Headroom under the store's byte limits for the envelope around the upserts. */
const HISTORY_REQUEST_BYTES = MAX_REQUEST_BYTES - 50_000;
const HISTORY_CAPTURE_BYTES = MAX_CAPTURE_BYTES - 100_000;
const HISTORY_UPSERTS_PER_BATCH = 1000;

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Splits upserts into batches within the contract's count and the store's request size. */
export function splitHistoryUpserts(upserts: readonly unknown[]): unknown[][] {
  const batches: unknown[][] = [];
  let current: unknown[] = [];
  let bytes = 0;
  for (const upsert of upserts) {
    const size = jsonBytes(upsert) + 1;
    if (
      current.length > 0 &&
      (current.length >= HISTORY_UPSERTS_PER_BATCH || bytes + size > HISTORY_REQUEST_BYTES)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(upsert);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Packs envelopes into captures within the store's envelope count and byte limits. */
export function packHistoryEnvelopes<T>(envelopes: readonly T[]): T[][] {
  const captures: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const envelope of envelopes) {
    const size = jsonBytes(envelope);
    if (
      current.length > 0 &&
      (current.length >= MAX_CAPTURE_ENVELOPES || bytes + size > HISTORY_CAPTURE_BYTES)
    ) {
      captures.push(current);
      current = [];
      bytes = 0;
    }
    current.push(envelope);
    bytes += size;
  }
  if (current.length) captures.push(current);
  return captures;
}

/** Record types of the exact-minute families (legacy Huami, Huawei, Garmin). */
type HuamiHistoryRecordType =
  | "steps"
  | "sleep_session"
  | "heart_rate"
  | "hrv_rmssd"
  | "resting_heart_rate"
  | "workout"
  | "oxygen_saturation"
  | "respiratory_rate";

export function immutableClient(
  serverUrl: string,
  cookie: string,
  fetcher: OperationFetch,
  signal?: AbortSignal,
): DirectClient {
  const baseUrl = `${canonicalServerUrl(serverUrl).replace(/\/$/, "")}/rpc`;
  const link = new RPCLink({
    url: baseUrl,
    headers: { Cookie: cookie },
    fetch: immutableOperationFetch(fetcher, signal),
  });
  return createORPCClient(link) as unknown as DirectClient;
}

/** Fetch policy bound to one operation's captured auth and abort authority. */
export function immutableOperationFetch(
  fetcher: OperationFetch,
  signal?: AbortSignal,
): OperationFetch {
  return (request, init) =>
    fetcher(request, {
      ...init,
      signal: init?.signal ?? signal,
      credentials: "omit",
      redirect: "error",
    });
}

function parseCursor(value: string | null): HelioCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as HelioCursor;
    if (
      parsed.version !== 1 ||
      !Number.isInteger(parsed.offsetQuarterHours) ||
      !Number.isFinite(Date.parse(parsed.nextMinuteUtc))
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function cursorString(cursor: HelioCursor): string {
  return JSON.stringify(cursor);
}

function validCursor(value: unknown): HelioCursor | null {
  const cursor = value as HelioCursor | null;
  return cursor &&
    cursor.version === 1 &&
    Number.isInteger(cursor.offsetQuarterHours) &&
    Number.isFinite(Date.parse(cursor.nextMinuteUtc))
    ? cursor
    : null;
}

/**
 * The binding checkpoint: a v1 activity cursor, or (once Zepp OS sleep has
 * synced) a v2 `{ activity, sleep }` pair. v1 keeps parsing, so existing
 * bindings continue from where they were.
 */
/**
 * Recently published Zepp OS sleep sessions: `[startSec, endSec, idSec]`. A
 * re-report that overlaps one reuses its id (`idSec`), so the server upsert
 * replaces it instead of adding a second night. Kept small: the checkpoint is
 * capped at 1024 characters.
 */
export type ZeppSleepMemory = readonly (readonly [number, number, number])[];
const SLEEP_MEMORY_SIZE = 8;

export function parseCheckpoint(value: string | null): {
  activity: HelioCursor | null;
  sleep: HelioCursor | null;
  nights: ZeppSleepMemory;
  /** Zepp OS sleep fallback: start of a night still open at the last sync. */
  pending: string | null;
} {
  if (!value) return { activity: null, sleep: null, nights: [], pending: null };
  try {
    const parsed = JSON.parse(value) as {
      version?: number;
      activity?: unknown;
      sleep?: unknown;
      nights?: unknown;
    };
    if (parsed.version === 2) {
      const nights = Array.isArray(parsed.nights)
        ? (parsed.nights as unknown[]).filter(
            (entry): entry is [number, number, number] =>
              Array.isArray(entry) &&
              entry.length === 3 &&
              entry.every((part) => Number.isSafeInteger(part)) &&
              (entry[1] as number) > (entry[0] as number),
          )
        : [];
      const rawPending = (parsed as { pending?: unknown }).pending;
      const pending =
        typeof rawPending === "string" && Number.isFinite(Date.parse(rawPending))
          ? rawPending
          : null;
      return {
        activity: validCursor(parsed.activity),
        sleep: validCursor(parsed.sleep),
        nights,
        pending,
      };
    }
  } catch {
    return { activity: null, sleep: null, nights: [], pending: null };
  }
  return { activity: parseCursor(value), sleep: null, nights: [], pending: null };
}

/** v1 while there is no sleep cursor (unchanged format for every other family). */
export function checkpointString(
  activity: HelioCursor,
  sleep: HelioCursor | null,
  nights: ZeppSleepMemory = [],
  pending: string | null = null,
): string {
  return sleep || pending
    ? JSON.stringify({ version: 2, activity, sleep, nights, ...(pending ? { pending } : {}) })
    : cursorString(activity);
}

/**
 * Gives each session a stable record id, or `null` to hold it. A session that
 * overlaps exactly one remembered session is a revision and reuses its id. A
 * session overlapping several (a merge) is held, because the direct-device
 * contract cannot delete the other records, so publishing it would count
 * those minutes twice. A session that ends before the oldest remembered one
 * while the memory is full may revise a forgotten night, so it is held too.
 * Otherwise it gets a fresh id from its own start, never one already in use.
 */
export function assignZeppSleepIds(
  sessions: ZeppSleepPage["sessions"],
  memory: ZeppSleepMemory,
): { ids: (number | null)[]; memory: ZeppSleepMemory; held: number } {
  const entries = memory.map((entry) => [...entry] as [number, number, number]);
  const memoryFull = entries.length >= SLEEP_MEMORY_SIZE;
  const oldestEnd = entries.length ? Math.min(...entries.map((entry) => entry[1])) : null;
  let held = 0;
  const ids = sessions.map((session) => {
    const start = Math.floor(Date.parse(session.startTime) / 1000);
    const end = Math.floor(Date.parse(session.endTime) / 1000);
    const overlapping = entries.filter((entry) => entry[0] < end && start < entry[1]);
    if (overlapping.length > 1) {
      held += 1;
      return null;
    }
    if (overlapping.length === 1) {
      const kept = overlapping[0]!;
      kept[0] = start;
      kept[1] = end;
      return kept[2];
    }
    if (memoryFull && oldestEnd !== null && end <= oldestEnd) {
      held += 1;
      return null;
    }
    let id = start;
    while (entries.some((entry) => entry[2] === id)) id += 1;
    entries.push([start, end, id]);
    return id;
  });
  entries.sort((left, right) => left[1] - right[1]);
  return { ids, memory: entries.slice(-SLEEP_MEMORY_SIZE), held };
}

function pageCaptureId(deviceId: string, before: HelioCursor, after: HelioCursor): string {
  // The source cursor coordinate, not phone time/page number, identifies a logical page.
  return `dd-v2:${deviceId}:${before.nextMinuteUtc}:${before.offsetQuarterHours}:${after.nextMinuteUtc}:${after.offsetQuarterHours}`;
}

/** Zepp OS sleep sessions → sleep_session envelopes, one id per night (re-reports upsert it). */
export function zeppSleepRequests(
  deviceId: string,
  deviceIdentity: DirectDeviceIdentity,
  expectedContext: { userId: string; organizationId: string },
  allSessions: ZeppSleepPage["sessions"],
  allIds: readonly (number | null)[],
): IngestDirectDeviceBatchInput[] {
  const requests: IngestDirectDeviceBatchInput[] = [];
  // Held sessions (null id) are not published.
  const sessions = allSessions.filter((_, index) => allIds[index] !== null);
  const ids = allIds.filter((id): id is number => id !== null);
  // ≤ 50 sessions per envelope keeps each request well under the size limit.
  for (let offset = 0; offset < sessions.length; offset += 50)
    requests.push({
      expectedContext,
      batch: {
        schemaVersion: 1,
        deviceId,
        deviceIdentity,
        provider: "direct_device",
        recordType: "sleep_session",
        mode: "backfill",
        upserts: sessions.slice(offset, offset + 50).map((session, index) => ({
          type: "sleep_session" as const,
          externalRecordId: `dd-zepp:${deviceId}:sleep:${ids[offset + index]}`,
          sourceApp: null,
          startTime: session.startTime,
          endTime: session.endTime,
          ...(session.stages.length
            ? { stages: session.stages.map((stage) => ({ ...stage })) }
            : {}),
        })),
        deletions: [],
        clientTimezone: "UTC",
      },
    } as IngestDirectDeviceBatchInput);
  return requests;
}

/** Exported for tests: page minutes → steps (and Zepp OS heart-rate) envelopes. */
export function pageRequests(
  deviceId: string,
  deviceIdentity: DirectDeviceIdentity,
  expectedContext: { userId: string; organizationId: string },
  minutes: HelioStepsPage["minutes"],
  clientTimezone: string,
): IngestDirectDeviceBatchInput[] {
  const requests: IngestDirectDeviceBatchInput[] = [];
  for (let start = 0; start < minutes.length; start += 1000) {
    const records = minutes.slice(start, start + 1000).map((minute) => ({
      type: "steps" as const,
      externalRecordId: minute.externalRecordId,
      sourceApp: null,
      startTime: minute.startTime,
      endTime: minute.endTime,
      count: minute.count,
    }));
    if (!records.length) continue;
    requests.push({
      expectedContext,
      batch: {
        schemaVersion: 1,
        deviceId,
        deviceIdentity,
        provider: "direct_device",
        recordType: "steps",
        mode: "backfill",
        upserts: records,
        deletions: [],
        clientTimezone,
      },
    });
  }
  // Zepp OS minutes also carry heart rate (byte 3); other families leave it unset.
  if (deviceIdentity.family === "zepp_os") {
    const heartRate = minutes
      .filter((minute) => minute.heartRate !== undefined)
      .map((minute) => ({
        type: "heart_rate" as const,
        externalRecordId: `hr-minute:${minute.startTime}`,
        sourceApp: null,
        startTime: minute.startTime,
        endTime: new Date(Date.parse(minute.startTime) + 1000).toISOString(),
        samples: [{ time: minute.startTime, bpm: minute.heartRate! }],
      }));
    for (let start = 0; start < heartRate.length; start += 1000)
      requests.push({
        expectedContext,
        batch: {
          schemaVersion: 1,
          deviceId,
          deviceIdentity,
          provider: "direct_device",
          recordType: "heart_rate",
          mode: "backfill",
          upserts: heartRate.slice(start, start + 1000),
          deletions: [],
          clientTimezone,
        },
      });
  }
  return requests;
}

/** Creates a foreground, account-fenced sync facade. Construction grants no authority and starts no radio. */
export function createHelioSyncController(context: HelioSyncContext): HelioSyncController {
  // Keep native-only modules lazy so injected SQLite/facade tests can run in Bun.
  const { getDirectDeviceStore } =
    require("../persistence/sqlite") as typeof import("../persistence/sqlite");
  const { createHelioSetupController } =
    require("../setup/controller") as typeof import("../setup/controller");
  const { authSessionStorage } =
    require("../../auth-session-storage") as typeof import("../../auth-session-storage");
  const liveCapture: { handler: ((sample: DirectDeviceLiveSample) => void) | null } = {
    handler: null,
  };
  const historyCapture: { handler: ((sample: DirectDeviceHistorySample) => void) | null } = {
    handler: null,
  };
  return createController(context, {
    store: getDirectDeviceStore(),
    setup: createHelioSetupController({
      onLiveSample: (sample) => liveCapture.handler?.(sample),
      onHistorySample: (sample) => historyCapture.handler?.(sample),
    }),
    captureCookie: () => authSessionStorage.captureVerifiedSessionCookie(),
    liveCapture,
    historyCapture,
  });
}

/** Injection seam for real SQLite + network/lifecycle tests; not exported from the app barrel. */
export function createHelioSyncControllerWithDependencies(
  context: HelioSyncContext,
  deps: Dependencies,
): HelioSyncController {
  return createController(context, deps);
}

function createController(contextInput: HelioSyncContext, deps: Dependencies): HelioSyncController {
  const context = Object.freeze({
    serverUrl: canonicalServerUrl(contextInput.serverUrl),
    userId: contextInput.userId,
    organizationId: contextInput.organizationId,
    sessionId: contextInput.sessionId,
  });
  const listeners = new Set<() => void>();
  let snapshot = emptySnapshot;
  let disposed = false;
  let generation = 0;
  let activeAbort: AbortController | null = null;
  let activeConfirmationAbort: AbortController | null = null;
  let connectionGeneration = 0;
  let lastObservedConnectedDeviceId = deps.setup.getSnapshot().connectedDeviceId;
  let selectedBindingId: string | null = null;
  let draftBindingId: string | null = null;
  let draftIdentity: DirectDeviceIdentity | null = null;
  let bindingsById = new Map<string, DirectDeviceBindingSummary>();
  let setupUnsubscribe: (() => void) | null = null;
  const apiFactory =
    deps.makeClient ??
    ((url, cookie, signal) => immutableClient(url, cookie, deps.fetch ?? fetch, signal));
  const publish = (patch: Partial<HelioSyncSnapshot>) => {
    snapshot = Object.freeze({
      ...snapshot,
      ...patch,
      bindings: patch.bindings ?? snapshot.bindings,
      nearbyDevices: patch.nearbyDevices ?? snapshot.nearbyDevices,
    });
    for (const listener of listeners) listener();
  };
  const fresh = () => {
    const ticket = createCurrentDirectDeviceTicket();
    if (
      !isAuthorityTicketCurrent(ticket) ||
      ticket.sessionIdentity !== context.sessionId ||
      ticket.scope.serverUrl !== context.serverUrl ||
      ticket.scope.userId !== context.userId ||
      ticket.scope.organizationId !== context.organizationId
    )
      throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
    return ticket;
  };
  const captureClient = async (ticket: AuthorityTicket, signal?: AbortSignal) => {
    if (!isAuthorityTicketCurrent(ticket)) throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
    const cookie = await deps.captureCookie();
    if (!isAuthorityTicketCurrent(ticket) || signal?.aborted)
      throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
    return apiFactory(context.serverUrl, cookie, signal);
  };
  const current = (token: number) => !disposed && token === generation;

  // Live GATT capture. Samples are buffered per binding and committed as
  // short backfill batches: the shared contract has no live mode yet.
  let liveBuffer: { deviceId: string; samples: DirectDeviceLiveSample[] } | null = null;
  let liveFlush: Promise<void> = Promise.resolve();
  let liveFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let liveCaptureSequence = 0;

  const clearLiveFlushTimer = () => {
    if (liveFlushTimer) clearTimeout(liveFlushTimer);
    liveFlushTimer = null;
  };

  const liveRecords = (
    deviceId: string,
    modelId: string,
    samples: readonly DirectDeviceLiveSample[],
  ): {
    recordType: "heart_rate" | "body_temperature" | "blood_pressure" | "weight_measurement";
    upserts: unknown[];
  }[] => {
    const heartRate = samples.filter(
      (sample): sample is Extract<BleGattSample, { type: "heart_rate" }> =>
        sample.type === "heart_rate",
    );
    const temperatures = samples.filter(
      (sample): sample is Extract<BleGattSample, { type: "body_temperature" }> =>
        sample.type === "body_temperature",
    );
    const pressures = samples.filter(
      (sample): sample is Extract<BleGattSample, { type: "blood_pressure" }> =>
        sample.type === "blood_pressure",
    );
    const weights = samples.filter(
      (sample): sample is WeightMeasurementSample => sample.type === "weight_measurement",
    );
    const groups: {
      recordType: "heart_rate" | "body_temperature" | "blood_pressure" | "weight_measurement";
      upserts: unknown[];
    }[] = [];
    if (heartRate.length) {
      const startTime = heartRate[0]!.time;
      const endTime = new Date(
        Math.max(Date.parse(heartRate[heartRate.length - 1]!.time), Date.parse(startTime) + 1000),
      ).toISOString();
      groups.push({
        recordType: "heart_rate",
        upserts: [
          {
            type: "heart_rate",
            externalRecordId: `dd-live:${deviceId}:hr:${startTime}`,
            sourceApp: null,
            startTime,
            endTime,
            samples: heartRate.map((sample) => ({ time: sample.time, bpm: sample.bpm })),
          },
        ],
      });
    }
    const temperatureRecords = temperatures
      .filter((sample) => sample.celsius >= 25 && sample.celsius <= 45)
      .map((sample, index) => ({
        type: "body_temperature",
        externalRecordId: `dd-live:${deviceId}:temp:${sample.time}:${index}`,
        sourceApp: null,
        startTime: sample.time,
        endTime: new Date(Date.parse(sample.time) + 1000).toISOString(),
        celsius: sample.celsius,
      }));
    if (temperatureRecords.length)
      groups.push({ recordType: "body_temperature", upserts: temperatureRecords });
    const pressureRecords = pressures
      .filter(
        (sample) =>
          sample.systolic >= 50 &&
          sample.systolic <= 300 &&
          sample.diastolic >= 20 &&
          sample.diastolic < sample.systolic,
      )
      .map((sample, index) => ({
        type: "blood_pressure",
        externalRecordId: `dd-live:${deviceId}:bp:${sample.time}:${index}`,
        sourceApp: null,
        startTime: sample.time,
        endTime: new Date(Date.parse(sample.time) + 1000).toISOString(),
        systolic: sample.systolic,
        diastolic: sample.diastolic,
        ...(sample.meanArterialPressure >= 20 && sample.meanArterialPressure <= 250
          ? { meanArterialPressure: sample.meanArterialPressure }
          : {}),
        ...(sample.pulseRate !== null && sample.pulseRate >= 20 && sample.pulseRate <= 250
          ? { pulseRate: Math.round(sample.pulseRate) }
          : {}),
      }));
    if (pressureRecords.length)
      groups.push({ recordType: "blood_pressure", upserts: pressureRecords });
    const weightRecords = weights
      .filter((sample) => sample.weightKg >= 2 && sample.weightKg <= 500)
      .map((sample) => {
        // The contract accepts impedance only in the body-composition range.
        const impedanceOhm =
          sample.impedanceOhm !== null && sample.impedanceOhm >= 200 && sample.impedanceOhm <= 1200
            ? sample.impedanceOhm
            : null;
        return {
          type: "weight_measurement" as const,
          externalRecordId: weightMeasurementExternalRecordId(modelId, {
            time: sample.time,
            weightKg: sample.weightKg,
            impedanceOhm,
          }),
          sourceApp: null,
          startTime: sample.time,
          weightKg: sample.weightKg,
          ...(impedanceOhm !== null ? { impedanceOhm } : {}),
        };
      });
    if (weightRecords.length)
      groups.push({ recordType: "weight_measurement", upserts: weightRecords });
    return groups;
  };

  const flushLiveSamples = async () => {
    clearLiveFlushTimer();
    const buffer = liveBuffer;
    liveBuffer = null;
    if (!buffer || buffer.samples.length === 0 || disposed) return;
    try {
      const ticket = fresh();
      const binding = deps.store.getBinding(ticket, buffer.deviceId);
      if (!binding?.providerConnectionId || !binding.family || !binding.modelId) return;
      const identity = {
        family: binding.family,
        modelId: binding.modelId,
      } as DirectDeviceIdentity;
      const groups = liveRecords(buffer.deviceId, binding.modelId, buffer.samples);
      if (!groups.length) return;
      const starts = buffer.samples.map((sample) => Date.parse(sample.time));
      const startTime = new Date(Math.min(...starts)).toISOString();
      const endTime = new Date(Math.max(...starts) + 1000).toISOString();
      const captureId = `dd-live:${buffer.deviceId}:${startTime}:${++liveCaptureSequence}`;
      const envelopes: IngestDirectDeviceBatchInput[] = groups.map((group) => ({
        expectedContext: { userId: context.userId, organizationId: context.organizationId },
        batch: {
          schemaVersion: 1,
          deviceId: buffer.deviceId,
          deviceIdentity: identity,
          provider: "direct_device",
          recordType: group.recordType,
          // No live mode exists in the contract; a live window is uploaded as
          // a short backfill batch.
          mode: "backfill",
          upserts: group.upserts,
          deletions: [],
          clientTimezone: "UTC",
        },
      })) as IngestDirectDeviceBatchInput[];
      deps.store.commitCapture(ticket, {
        deviceId: buffer.deviceId,
        deviceIdentity: identity,
        captureId,
        expectedPreviousCheckpoint: binding.captureCheckpoint,
        nextCheckpoint: `live:${endTime}`,
        envelopes,
      });
      publish({ pendingEnvelopes: deps.store.countUnaccepted(ticket.scope) });
    } catch {
      // Best effort: a stale authority or checkpoint conflict drops this
      // window rather than interrupting the live connection.
    }
  };

  const queueLiveFlush = () => {
    liveFlush = liveFlush.then(flushLiveSamples).catch(() => undefined);
  };

  const scheduleLiveFlush = () => {
    if (liveFlushTimer) return;
    liveFlushTimer = setTimeout(() => {
      liveFlushTimer = null;
      queueLiveFlush();
    }, 5000);
  };

  const handleLiveSample = (sample: DirectDeviceLiveSample) => {
    if (disposed) return;
    const state = deps.setup.getSnapshot();
    if (
      state.phase !== "connected" ||
      (state.connectedFamily !== "ble_gatt" && state.connectedFamily !== "ble_scale")
    )
      return;
    const bindingId = selectedBindingId;
    if (!bindingId) return;
    const binding = bindingsById.get(bindingId);
    if (
      !binding ||
      binding.family !== state.connectedFamily ||
      binding.modelId !== state.connectedModelId
    )
      return;
    if (!liveBuffer || liveBuffer.deviceId !== bindingId)
      liveBuffer = { deviceId: bindingId, samples: [] };
    const buffer = liveBuffer;
    buffer.samples.push(sample);
    if (buffer.samples.length >= 10) queueLiveFlush();
    else scheduleLiveFlush();
  };
  if (deps.liveCapture) deps.liveCapture.handler = handleLiveSample;

  // Ring and Bangle.js history sync. These families push stored history on
  // connection instead of capturing live; records are buffered per binding and
  // committed as backfill batches through the same outbox as live capture.
  let historyBuffer: {
    deviceId: string;
    family: DirectDeviceFamily;
    samples: DirectDeviceHistorySample[];
  } | null = null;
  let historyFlush: Promise<void> = Promise.resolve();
  let historyFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let historyCaptureSequence = 0;

  const clearHistoryFlushTimer = () => {
    if (historyFlushTimer) clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
  };

  /** External-record and checkpoint namespace for a history-sync family. */
  const historyPrefix = (family: DirectDeviceFamily): string =>
    family === "bangle_js"
      ? "bangle"
      : family === "gloryfit"
        ? "gloryfit"
        : family === "huami_legacy"
          ? "huami"
          : family === "garmin"
            ? "garmin"
            : family === "huawei"
              ? "huawei"
              : family === "moyoung"
                ? "moyoung"
                : family === "fitpro"
                  ? "fitpro"
                  : family === "casio"
                    ? "casio"
                    : family === "pebble"
                      ? "pebble"
                      : "ring";

  /**
   * Legacy Huami, Garmin and Huawei BLE sync emit exact-minute `steps`
   * records (the frozen contract for those families), not arbitrary
   * `steps_interval` buckets.
   */
  const huamiHistoryRecords = (
    deviceId: string,
    prefix: string,
    samples: readonly DirectDeviceHistorySample[],
  ): { recordType: HuamiHistoryRecordType; upserts: unknown[] }[] => {
    const steps = samples.filter(
      (sample): sample is Extract<DirectDeviceHistorySample, { type: "steps" }> =>
        sample.type === "steps",
    );
    const sleep = samples.filter(
      (sample): sample is Extract<DirectDeviceHistorySample, { type: "sleep_session" }> =>
        sample.type === "sleep_session",
    );
    const heartRate = samples.filter(
      (sample): sample is Extract<DirectDeviceHistorySample, { type: "heart_rate" }> =>
        sample.type === "heart_rate",
    );
    const groups: { recordType: HuamiHistoryRecordType; upserts: unknown[] }[] = [];
    if (steps.length)
      groups.push({
        recordType: "steps",
        upserts: steps.map((sample) => ({
          type: "steps",
          externalRecordId: `dd-${prefix}:${deviceId}:steps:${sample.startTime}`,
          sourceApp: null,
          startTime: sample.startTime,
          endTime: sample.endTime,
          count: sample.count,
        })),
      });
    if (sleep.length)
      groups.push({
        recordType: "sleep_session",
        upserts: sleep.map((sample) => ({
          type: "sleep_session",
          externalRecordId: `dd-${prefix}:${deviceId}:sleep:${sample.startTime}`,
          sourceApp: null,
          startTime: sample.startTime,
          endTime: sample.endTime,
          ...(sample.stages?.length ? { stages: sample.stages } : {}),
        })),
      });
    if (heartRate.length) {
      // One record per UTC hour, keyed by the hour: a re-read reading lands
      // under the same record id and dedupes, and no record can exceed the
      // contract's 5000 readings however long the backlog.
      const byHour = new Map<string, typeof heartRate>();
      for (const sample of heartRate) {
        const hour = new Date(sample.time).toISOString().slice(0, 13);
        const bucket = byHour.get(hour) ?? [];
        bucket.push(sample);
        byHour.set(hour, bucket);
      }
      groups.push({
        recordType: "heart_rate",
        upserts: [...byHour]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([hour, bucket]) => {
            const startTime = `${hour}:00:00.000Z`;
            const samples = [
              ...new Map(bucket.map((sample) => [sample.time, sample])).values(),
            ].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
            return {
              type: "heart_rate",
              externalRecordId: `dd-${prefix}:${deviceId}:hr:${hour}`,
              sourceApp: null,
              startTime,
              endTime: new Date(Date.parse(startTime) + 3_600_000).toISOString(),
              samples: samples.map((sample) => ({ time: sample.time, bpm: sample.bpm })),
            };
          }),
      });
    }
    // Garmin only. Ids come from the watch's own timestamps, so a re-read
    // file republishes the same records.
    const pointRecord = (
      sample: { time: string },
      type: "hrv_rmssd" | "resting_heart_rate",
      tag: string,
      value: Record<string, number>,
    ) => ({
      type,
      externalRecordId: `dd-${prefix}:${deviceId}:${tag}:${sample.time}`,
      sourceApp: null,
      startTime: sample.time,
      endTime: new Date(Date.parse(sample.time) + 1000).toISOString(),
      ...value,
    });
    const unique = <T extends { time: string }>(items: readonly T[]) => [
      ...new Map(items.map((item) => [item.time, item])).values(),
    ];
    const hrv = unique(
      samples.filter(
        (sample): sample is Extract<DirectDeviceHistorySample, { type: "hrv_rmssd" }> =>
          sample.type === "hrv_rmssd",
      ),
    );
    if (hrv.length)
      groups.push({
        recordType: "hrv_rmssd",
        upserts: hrv.map((sample) =>
          pointRecord(sample, "hrv_rmssd", "hrv", { rmssdMs: sample.rmssdMs }),
        ),
      });
    // Resting heart rate is a daily value: readers average a UTC day's
    // samples, so publish the day's latest sample under a per-day id, with its
    // time as the revision. A later sync's newer value supersedes it.
    const restingByDay = new Map<
      string,
      Extract<DirectDeviceHistorySample, { type: "resting_heart_rate" }>
    >();
    for (const sample of samples) {
      if (sample.type !== "resting_heart_rate") continue;
      const day = sample.time.slice(0, 10);
      const kept = restingByDay.get(day);
      if (!kept || Date.parse(sample.time) > Date.parse(kept.time)) restingByDay.set(day, sample);
    }
    if (restingByDay.size)
      groups.push({
        recordType: "resting_heart_rate",
        upserts: [...restingByDay].map(([day, sample]) => ({
          type: "resting_heart_rate",
          externalRecordId: `dd-${prefix}:${deviceId}:rhr:${day}`,
          sourceApp: null,
          startTime: `${day}T00:00:00.000Z`,
          endTime: new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString(),
          bpm: sample.bpm,
          lastModifiedAt: sample.time,
        })),
      });
    // SpO₂ and respiration ship like heart rate, but one record per UTC hour
    // keyed by that hour: a re-read reading always lands under the same record
    // id, so the server's (record id, time, value) key dedupes it.
    const readings = <T extends { time: string }>(
      items: readonly T[],
      recordType: "oxygen_saturation" | "respiratory_rate",
      tag: string,
      value: (item: T) => Record<string, number>,
    ) => {
      const byHour = new Map<string, T[]>();
      for (const item of unique(items)) {
        const hour = item.time.slice(0, 13);
        const bucket = byHour.get(hour) ?? [];
        bucket.push(item);
        byHour.set(hour, bucket);
      }
      if (!byHour.size) return;
      const hours = [...byHour]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([hour, bucket]) => {
          const startTime = `${hour}:00:00.000Z`;
          return {
            type: recordType,
            externalRecordId: `dd-${prefix}:${deviceId}:${tag}:${hour}`,
            sourceApp: null,
            startTime,
            endTime: new Date(Date.parse(startTime) + 3_600_000).toISOString(),
            samples: bucket
              .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
              .map((item) => ({ time: item.time, ...value(item) })),
          };
        });
      groups.push({ recordType, upserts: hours });
    };
    readings(
      samples.filter(
        (sample): sample is Extract<DirectDeviceHistorySample, { type: "oxygen_saturation" }> =>
          sample.type === "oxygen_saturation",
      ),
      "oxygen_saturation",
      "spo2",
      (item) => ({ percent: item.percent }),
    );
    readings(
      samples.filter(
        (sample): sample is Extract<DirectDeviceHistorySample, { type: "respiratory_rate" }> =>
          sample.type === "respiratory_rate",
      ),
      "respiratory_rate",
      "resp",
      (item) => ({ breathsPerMinute: item.breathsPerMinute }),
    );
    const workouts = [
      ...new Map(
        samples
          .filter(
            (sample): sample is Extract<DirectDeviceHistorySample, { type: "workout" }> =>
              sample.type === "workout",
          )
          .map((sample) => [sample.startTime, sample] as const),
      ).values(),
    ];
    if (workouts.length)
      groups.push({
        recordType: "workout",
        upserts: workouts.map((sample) => ({
          type: "workout",
          externalRecordId: `dd-${prefix}:${deviceId}:workout:${sample.startTime}`,
          sourceApp: null,
          startTime: sample.startTime,
          endTime: sample.endTime,
          activity: sample.activity,
          title: sample.title,
        })),
      });
    return groups;
  };

  const historyRecords = (
    deviceId: string,
    prefix: string,
    samples: readonly DirectDeviceHistorySample[],
    family: DirectDeviceFamily,
  ): {
    recordType: HuamiHistoryRecordType | "steps_interval";
    upserts: unknown[];
  }[] => {
    if (family === "huami_legacy" || family === "huawei" || family === "garmin")
      return huamiHistoryRecords(deviceId, prefix, samples);
    const steps = samples.filter(
      (sample): sample is Extract<DirectDeviceHistorySample, { type: "steps_interval" }> =>
        sample.type === "steps_interval",
    );
    const sleep = samples.filter(
      (sample): sample is Extract<DirectDeviceHistorySample, { type: "sleep_session" }> =>
        sample.type === "sleep_session",
    );
    const heartRate = samples.filter(
      (sample): sample is Extract<DirectDeviceHistorySample, { type: "heart_rate" }> =>
        sample.type === "heart_rate",
    );
    const groups: {
      recordType: "steps_interval" | "sleep_session" | "heart_rate";
      upserts: unknown[];
    }[] = [];
    if (steps.length)
      groups.push({
        recordType: "steps_interval",
        upserts: steps.map((sample) => ({
          type: "steps_interval",
          externalRecordId: `dd-${prefix}:${deviceId}:steps:${sample.startTime}`,
          sourceApp: null,
          startTime: sample.startTime,
          endTime: sample.endTime,
          count: sample.count,
        })),
      });
    if (sleep.length)
      groups.push({
        recordType: "sleep_session",
        upserts: sleep.map((sample) => ({
          type: "sleep_session",
          externalRecordId: `dd-${prefix}:${deviceId}:sleep:${sample.startTime}`,
          sourceApp: null,
          startTime: sample.startTime,
          endTime: sample.endTime,
          ...(sample.stages?.length ? { stages: sample.stages } : {}),
        })),
      });
    if (heartRate.length) {
      const sorted = [...heartRate].sort(
        (left, right) => Date.parse(left.time) - Date.parse(right.time),
      );
      const times = sorted.map((sample) => Date.parse(sample.time));
      const startTime = new Date(Math.min(...times)).toISOString();
      const endTime = new Date(Math.max(...times) + 1000).toISOString();
      groups.push({
        recordType: "heart_rate",
        upserts: [
          {
            type: "heart_rate",
            externalRecordId: `dd-${prefix}:${deviceId}:hr:${startTime}`,
            sourceApp: null,
            startTime,
            endTime,
            samples: sorted.map((sample) => ({ time: sample.time, bpm: sample.bpm })),
          },
        ],
      });
    }
    return groups;
  };

  const flushHistorySamples = async () => {
    clearHistoryFlushTimer();
    const buffer = historyBuffer;
    historyBuffer = null;
    if (!buffer || buffer.samples.length === 0 || disposed) return;
    try {
      const ticket = fresh();
      const binding = deps.store.getBinding(ticket, buffer.deviceId);
      if (!binding?.providerConnectionId || !binding.family || !binding.modelId) return;
      const identity = {
        family: binding.family,
        modelId: binding.modelId,
      } as DirectDeviceIdentity;
      const groups = historyRecords(
        buffer.deviceId,
        historyPrefix(buffer.family),
        buffer.samples,
        buffer.family,
      );
      if (!groups.length) return;
      const starts = buffer.samples.map((sample) =>
        Date.parse("time" in sample ? sample.time : sample.startTime),
      );
      const startTime = new Date(Math.min(...starts)).toISOString();
      const endTime = new Date(Math.max(...starts) + 1000).toISOString();
      const prefix = historyPrefix(buffer.family);
      const captureId = `dd-${prefix}:${buffer.deviceId}:${startTime}:${++historyCaptureSequence}`;
      const envelope = (recordType: string, upserts: unknown[]) =>
        ({
          expectedContext: { userId: context.userId, organizationId: context.organizationId },
          batch: {
            schemaVersion: 1,
            deviceId: buffer.deviceId,
            deviceIdentity: identity,
            provider: "direct_device",
            recordType,
            mode: "backfill",
            upserts,
            deletions: [],
            clientTimezone: "UTC",
          },
        }) as IngestDirectDeviceBatchInput;
      // A whole watch file arrives in one buffer (the transport emits a
      // file's records synchronously), so split to the contract and store
      // limits instead of letting one oversized capture be refused and lost.
      const envelopes = groups.flatMap((group) =>
        splitHistoryUpserts(group.upserts).map((upserts) => envelope(group.recordType, upserts)),
      );
      const captures = packHistoryEnvelopes(envelopes);
      const nextCheckpoint = `${prefix}:${endTime}`;
      let expectedPreviousCheckpoint = binding.captureCheckpoint;
      for (const [part, partEnvelopes] of captures.entries()) {
        deps.store.commitCapture(ticket, {
          deviceId: buffer.deviceId,
          deviceIdentity: identity,
          captureId: captures.length === 1 ? captureId : `${captureId}:${part + 1}`,
          expectedPreviousCheckpoint,
          nextCheckpoint,
          envelopes: partEnvelopes,
        });
        expectedPreviousCheckpoint = nextCheckpoint;
      }
      publish({ pendingEnvelopes: deps.store.countUnaccepted(ticket.scope) });
    } catch {
      // Best effort: a stale authority or checkpoint conflict drops this
      // window rather than interrupting the history session.
    }
  };

  const queueHistoryFlush = () => {
    historyFlush = historyFlush.then(flushHistorySamples).catch(() => undefined);
  };

  const scheduleHistoryFlush = () => {
    if (historyFlushTimer) return;
    historyFlushTimer = setTimeout(() => {
      historyFlushTimer = null;
      queueHistoryFlush();
    }, 5000);
  };

  const handleHistorySample = (sample: DirectDeviceHistorySample) => {
    if (disposed) return;
    const state = deps.setup.getSnapshot();
    if (
      state.phase !== "connected" ||
      (state.connectedFamily !== "colmi_ring" &&
        state.connectedFamily !== "bangle_js" &&
        state.connectedFamily !== "gloryfit" &&
        state.connectedFamily !== "moyoung" &&
        state.connectedFamily !== "fitpro" &&
        state.connectedFamily !== "huami_legacy" &&
        state.connectedFamily !== "garmin" &&
        state.connectedFamily !== "huawei" &&
        state.connectedFamily !== "casio")
    )
      // Pebble is deliberately absent: its history must reach the durable
      // inbox (and be ACKed to the watch) only through the Pebble capture path.
      return;
    const bindingId = selectedBindingId;
    if (!bindingId) return;
    const binding = bindingsById.get(bindingId);
    if (
      !binding ||
      binding.family !== state.connectedFamily ||
      binding.modelId !== state.connectedModelId
    )
      return;
    if (!historyBuffer || historyBuffer.deviceId !== bindingId)
      historyBuffer = { deviceId: bindingId, family: state.connectedFamily, samples: [] };
    const buffer = historyBuffer;
    buffer.samples.push(sample);
    if (buffer.samples.length >= 50) queueHistoryFlush();
    else scheduleHistoryFlush();
  };
  if (deps.historyCapture) deps.historyCapture.handler = handleHistorySample;

  /**
   * Projects durably captured Pebble inbox items into outbox envelopes until
   * drained. Never throws: projection is local, and a failure must not stop
   * the upload of envelopes that already exist.
   */
  const projectDurableInbox = (
    ticket: AuthorityTicket,
    onlyDeviceId?: string,
  ): { sleepHeld: number; unreadableItems: number; errorCode: string | null } => {
    let sleepHeld = 0;
    let unreadableItems = 0;
    let errorCode: string | null = null;
    let bindings: ReturnType<DirectDeviceStore["listBindings"]> = [];
    try {
      bindings = deps.store.listBindings(ticket);
    } catch (error) {
      return { sleepHeld, unreadableItems, errorCode: safeError(error) };
    }
    for (const binding of bindings) {
      if (
        binding.family === "fossil_hr" &&
        binding.modelId &&
        binding.providerConnectionId !== null &&
        (!onlyDeviceId || binding.deviceId === onlyDeviceId)
      ) {
        try {
          unreadableItems += projectFossilFiles({
            store: deps.store,
            ticket,
            deviceId: binding.deviceId,
            identity: { family: "fossil_hr", modelId: binding.modelId } as DirectDeviceIdentity,
          }).unreadableFiles;
        } catch (error) {
          errorCode ??= safeError(error);
        }
        continue;
      }
      if (
        binding.family !== "pebble" ||
        !binding.modelId ||
        !binding.pebbleNativeId ||
        binding.providerConnectionId === null ||
        (onlyDeviceId && binding.deviceId !== onlyDeviceId)
      )
        continue;
      let bindingHeld = 0;
      try {
        for (let round = 0; round < 100_000; round += 1) {
          const projected = projectPebbleCapture({
            store: deps.store,
            ticket,
            deviceId: binding.deviceId,
            identity: { family: "pebble", modelId: binding.modelId } as PebbleIdentity,
          });
          // Held groups are recomputed each round; the last count is current.
          bindingHeld = projected.sleepHeld;
          unreadableItems += projected.unreadableItems;
          if (projected.activityItems < 16) break;
        }
      } catch (error) {
        errorCode ??= safeError(error);
      }
      sleepHeld += bindingHeld;
    }
    return { sleepHeld, unreadableItems, errorCode };
  };

  const bumpConnectionGeneration = () => {
    connectionGeneration += 1;
    activeConfirmationAbort?.abort();
    activeConfirmationAbort = null;
    publish({ connectionGeneration });
  };
  const confirmationTargetMatches = (expected: DirectDeviceConfirmationTarget) => {
    const state = deps.setup.getSnapshot();
    return (
      state.phase === "connected" &&
      state.connectedDeviceId === expected.connectedDeviceId &&
      state.connectedFamily === expected.family &&
      state.connectedModelId === expected.modelId &&
      connectionGeneration === expected.connectionGeneration
    );
  };
  const syncSetupSnapshot = () => {
    const state = deps.setup.getSnapshot();
    if (
      lastObservedConnectedDeviceId !== null &&
      state.connectedDeviceId !== lastObservedConnectedDeviceId
    ) {
      bumpConnectionGeneration();
      // Commit whatever ring history arrived before the connection dropped.
      queueHistoryFlush();
    }
    lastObservedConnectedDeviceId = state.connectedDeviceId;
    const connected = state.phase === "connected";
    const selected = selectedBindingId ? bindingsById.get(selectedBindingId) : null;
    const compatible =
      !!selected &&
      selected.providerConnectionId !== null &&
      selected.family === state.connectedFamily &&
      selected.modelId === state.connectedModelId;
    publish({
      nearbyDevices: state.devices,
      connectedDeviceId: state.connectedDeviceId,
      connectedModelId: state.connectedModelId ?? null,
      connectedFamily: state.connectedFamily ?? null,
      connectionGeneration,
      capabilities: state.capabilities,
      bluetooth: state.bluetooth,
      phase:
        state.phase === "scanning"
          ? "scanning"
          : state.phase === "connecting"
            ? "connecting"
            : connected
              ? "connected"
              : snapshot.phase,
      errorCode: state.errorCode,
      pairingPrompt: state.pairingPrompt ?? null,
      canSync: connected && state.capabilities.stepsHistory && compatible && !snapshot.isBusy,
    });
  };
  setupUnsubscribe = deps.setup.subscribe(syncSetupSnapshot);
  const authorityUnsubscribe = subscribeDirectDeviceAuthorityInvalidation(() => {
    ++generation;
    bumpConnectionGeneration();
    activeAbort?.abort();
    activeAbort = null;
    // Setup owns radio cancellation and settles history before releasing its lease.
    void Promise.allSettled([deps.setup.disconnect(), deps.setup.stopScan()]);
    if (!disposed) publish({ phase: "cancelled", isBusy: false, canSync: false });
  });

  const controller: HelioSyncController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refreshBindings() {
      if (disposed) return;
      const token = generation;
      publish({ phase: "loading_bindings", isBusy: true, errorCode: null });
      try {
        const ticket = fresh();
        const api = await captureClient(ticket);
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        const result = listDirectDevicesOutput.parse(
          await api.directDevice.listDirectDevices({
            expectedContext: { userId: context.userId, organizationId: context.organizationId },
          }),
        );
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        bindingsById = new Map(result.devices.map((device) => [device.deviceId, device]));
        let owned = deps.store.listBindings(ticket);
        for (const remote of result.devices) {
          if (
            (remote.family === null) !== (remote.modelId === null) ||
            (remote.family === null) !== (remote.displayName === null)
          )
            throw new Error("IDENTITY_MISMATCH");
          const identity =
            remote.family && remote.modelId
              ? { family: remote.family, modelId: remote.modelId }
              : undefined;
          let local = owned.find((binding) => binding.deviceId === remote.deviceId);
          if (!local) {
            deps.store.createBinding(ticket, remote.deviceId, identity);
            local = deps.store.getBinding(ticket, remote.deviceId) ?? undefined;
          }
          if (!local) throw new Error("DIRECT_DEVICE_BINDING_MATERIALIZATION_FAILED");
          if (identity && !local.family && !local.modelId) {
            deps.store.adoptBindingIdentity(ticket, remote.deviceId, {
              family: identity.family,
              modelId: identity.modelId,
            });
          } else if (
            identity &&
            (local.family !== identity.family || local.modelId !== identity.modelId)
          ) {
            throw new Error("IDENTITY_MISMATCH");
          } else if (!identity && (local.family !== null || local.modelId !== null)) {
            throw new Error("IDENTITY_MISMATCH");
          }
          if (local.providerConnectionId === null)
            deps.store.markRegistered(ticket, remote.deviceId, remote.providerConnectionId);
          else if (local.providerConnectionId !== remote.providerConnectionId)
            throw new Error("DIRECT_DEVICE_REGISTRATION_IMMUTABLE");
        }
        // Recover Pebble data an interrupted sync left unprojected, so the
        // pending count (and the retry button) reflects it.
        projectDurableInbox(ticket);
        owned = deps.store.listBindings(ticket);
        const selected =
          selectedBindingId && bindingsById.has(selectedBindingId)
            ? selectedBindingId
            : (owned.find((b) => b.providerConnectionId !== null && bindingsById.has(b.deviceId))
                ?.deviceId ?? null);
        selectedBindingId = selected;
        const selectedSummary = selected ? (bindingsById.get(selected) ?? null) : null;
        publish({
          bindings: Object.freeze(result.devices),
          selectedBindingId: selected,
          publication: selectedSummary?.publication ?? null,
          phase: "idle",
          isBusy: false,
          canSync:
            snapshot.connectedDeviceId !== null &&
            snapshot.capabilities.stepsHistory &&
            !!selectedSummary?.providerConnectionId &&
            selectedSummary.family === snapshot.connectedFamily &&
            selectedSummary.modelId === snapshot.connectedModelId,
          blockedIdentityEnvelopes: deps.store.countBlockedIdentityEnvelopes(ticket),
          pendingEnvelopes: deps.store.countUnaccepted(ticket.scope),
        });
      } catch (error) {
        if (current(token)) publish({ phase: "error", isBusy: false, errorCode: safeError(error) });
      }
    },
    async createBinding() {
      if (disposed || snapshot.isBusy) return;
      const setup = deps.setup.getSnapshot();
      if (setup.phase !== "connected" || !setup.connectedFamily || !setup.connectedModelId) return;
      const identity: DirectDeviceIdentity = {
        // The shared identity union is extended with "casio" by the parallel
        // lane; the cast keeps this file type-checking before that lands.
        family: setup.connectedFamily as DirectDeviceIdentity["family"],
        modelId: setup.connectedModelId,
      };
      const token = generation;
      publish({ isBusy: true, phase: "loading_bindings", errorCode: null });
      try {
        const ticket = fresh();
        // Generate once, durably record before registration, and retain the UUID if registration is retried.
        if (!draftBindingId || JSON.stringify(draftIdentity) !== JSON.stringify(identity)) {
          draftBindingId =
            deps.store
              .listBindings(ticket)
              .find(
                (binding) =>
                  binding.providerConnectionId === null &&
                  binding.family === identity.family &&
                  binding.modelId === identity.modelId,
              )?.deviceId ?? (deps.uuid ?? (() => globalThis.crypto.randomUUID()))();
          draftIdentity = identity;
        }
        const deviceId = draftBindingId;
        deps.store.createBinding(ticket, deviceId, identity);
        const api = await captureClient(ticket);
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        const registered = registerDirectDeviceOutput.parse(
          await api.directDevice.registerDirectDevice({
            deviceId,
            family: identity.family,
            modelId: identity.modelId,
            expectedContext: { userId: context.userId, organizationId: context.organizationId },
          }),
        );
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        deps.store.markRegistered(ticket, deviceId, registered.providerConnectionId);
        await controller.refreshBindings();
        if (!bindingsById.has(deviceId)) return;
        draftBindingId = null;
        draftIdentity = null;
        selectedBindingId = deviceId;
        publish({ selectedBindingId: deviceId, isBusy: false });
        syncSetupSnapshot();
      } catch (error) {
        if (current(token)) publish({ phase: "error", isBusy: false, errorCode: safeError(error) });
      }
    },
    async confirmBindingIdentity(deviceId, expected) {
      if (disposed || snapshot.isBusy || !bindingsById.has(deviceId)) return;
      const target = Object.freeze({
        connectedDeviceId: expected.connectedDeviceId,
        family: expected.family,
        modelId: expected.modelId,
        connectionGeneration: expected.connectionGeneration,
      });
      if (!confirmationTargetMatches(target)) {
        publish({ errorCode: "CONFIRMATION_STALE" });
        return;
      }
      const identity: DirectDeviceIdentity = {
        family: target.family as DirectDeviceIdentity["family"],
        modelId: target.modelId,
      };
      const token = ++generation;
      const abort = new AbortController();
      activeConfirmationAbort = abort;
      publish({ isBusy: true, phase: "loading_bindings", errorCode: null });
      try {
        const ticket = fresh();
        const api = await captureClient(ticket, abort.signal);
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        if (abort.signal.aborted || !confirmationTargetMatches(target))
          throw new Error("CONFIRMATION_STALE");
        const registered = registerDirectDeviceOutput.parse(
          await api.directDevice.registerDirectDevice({
            deviceId,
            family: identity.family,
            modelId: identity.modelId,
            confirmLegacyIdentity: true,
            expectedContext: { userId: context.userId, organizationId: context.organizationId },
          }),
        );
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        if (abort.signal.aborted || !confirmationTargetMatches(target))
          throw new Error("CONFIRMATION_STALE");
        deps.store.adoptBindingIdentity(ticket, deviceId, identity);
        deps.store.markRegistered(ticket, deviceId, registered.providerConnectionId);
        publish({ blockedIdentityEnvelopes: deps.store.countBlockedIdentityEnvelopes(ticket) });
        await controller.refreshBindings();
      } catch (error) {
        if (current(token))
          publish({
            phase: abort.signal.aborted ? "cancelled" : "error",
            isBusy: false,
            errorCode: safeError(error),
          });
      } finally {
        if (activeConfirmationAbort === abort) activeConfirmationAbort = null;
      }
    },
    selectBinding(deviceId) {
      if (disposed || snapshot.isBusy || !bindingsById.has(deviceId)) return;
      selectedBindingId = deviceId;
      publish({
        selectedBindingId: deviceId,
        publication: bindingsById.get(deviceId)?.publication ?? null,
        canSync:
          snapshot.connectedDeviceId !== null &&
          snapshot.capabilities.stepsHistory &&
          !!bindingsById.get(deviceId)?.providerConnectionId &&
          bindingsById.get(deviceId)?.family === snapshot.connectedFamily &&
          bindingsById.get(deviceId)?.modelId === snapshot.connectedModelId,
      });
    },
    async startScan() {
      if (!disposed) {
        await deps.setup.startScan();
        syncSetupSnapshot();
      }
    },
    async stopScan() {
      if (!disposed) {
        await deps.setup.stopScan();
        syncSetupSnapshot();
      }
    },
    async connect(nativeId) {
      if (disposed || snapshot.isBusy) return;
      bumpConnectionGeneration();
      await deps.setup.connect(nativeId);
      syncSetupSnapshot();
    },
    async syncSteps(authKeyHex) {
      if (
        disposed ||
        snapshot.isBusy ||
        !snapshot.connectedDeviceId ||
        !selectedBindingId ||
        !snapshot.canSync
      )
        return;
      // Huawei auth is automatic (MAC-derived key); only the key-entry
      // families require a user-supplied 16-byte key here.
      // Pebble pairs through the OS bond; it has no app-level key either.
      // Fossil keys are parsed the upstream way (spaces and every "0x" removed).
      const isFossil = snapshot.connectedFamily === "fossil_hr";
      const fossilKey = isFossil ? parseFossilAuthKey(authKeyHex) : null;
      if (isFossil && !fossilKey) {
        publish({ phase: "error", errorCode: "INVALID_AUTH_KEY" });
        return;
      }
      const requiresKey =
        !isFossil && snapshot.connectedFamily !== "huawei" && snapshot.connectedFamily !== "pebble";
      if (requiresKey && !/^((0x)?[0-9a-fA-F]{32})$/.test(authKeyHex)) {
        publish({ phase: "error", errorCode: "INVALID_AUTH_KEY" });
        return;
      }
      const authKey = new Uint8Array(16);
      if (requiresKey) {
        const hex = authKeyHex.replace(/^0x/i, "");
        for (let i = 0; i < 16; i++) authKey[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      const token = ++generation;
      const syncDeviceId = selectedBindingId;
      const syncIdentity: DirectDeviceIdentity = {
        family: snapshot.connectedFamily! as DirectDeviceIdentity["family"],
        modelId: snapshot.connectedModelId!,
      };
      const abort = new AbortController();
      activeAbort = abort;
      publish({ phase: "connected", isBusy: true, errorCode: null });
      try {
        const ticket = fresh();
        const binding = deps.store.getBinding(ticket, syncDeviceId);
        if (!binding?.providerConnectionId) throw new Error("DIRECT_DEVICE_BINDING_REQUIRED");
        if (binding.family !== syncIdentity.family || binding.modelId !== syncIdentity.modelId)
          throw new Error("IDENTITY_MISMATCH");
        const api = await captureClient(ticket, abort.signal);
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        // Protocol historyStart only accepts exact UTC-minute cursors; floor the default.
        const defaultStart =
          Math.floor(((deps.now ?? Date.now)() - 24 * 60 * 60 * 1000) / 60000) * 60000;
        const stored = parseCheckpoint(binding.captureCheckpoint);
        const since = stored.activity ?? {
          version: 1 as const,
          nextMinuteUtc: new Date(defaultStart).toISOString(),
          offsetQuarterHours: 0,
        };
        // Zepp OS sleep sessions keep their own cursor; a first sync looks back
        // a week, since a night is reported after waking.
        const syncsSleep =
          syncIdentity.family === "zepp_os" && zeppOsSupportsSleepSessions(syncIdentity.modelId);
        let sleepCursor: HelioCursor | null = stored.sleep;
        let sleepMemory: ZeppSleepMemory = stored.nights;
        let sleepPending: string | null = stored.pending;
        const syncsSleepFallback =
          syncIdentity.family === "zepp_os" && !zeppOsSupportsSleepSessions(syncIdentity.modelId);
        const sleepSince: HelioCursor = stored.sleep ?? {
          version: 1,
          nextMinuteUtc: new Date(
            Math.floor(((deps.now ?? Date.now)() - 7 * 24 * 60 * 60 * 1000) / 60000) * 60000,
          ).toISOString(),
          offsetQuarterHours: 0,
        };
        let activityCursor: HelioCursor = since;
        let historyNotice: string | null = null;
        // Each committed page advances the CAS checkpoint and the next page's source cursor.
        let checkpoint = binding.captureCheckpoint;
        let cursorSince = since;
        let captured = 0;
        let inboxNotice: string | null = null;
        let inboxResult: { complete: boolean; hardFailure: boolean } | null = null;
        if (syncIdentity.family === "fossil_hr" && fossilKey) {
          const peer = deps.setup.getFossilPeer();
          if (!peer || peer.model.id !== syncIdentity.modelId)
            throw new Error("FOSSIL_PEER_MISMATCH");
          // One physical watch feeds one active binding (as for Pebble).
          if (
            deps.store
              .listBindings(ticket)
              .some(
                (other) =>
                  other.deviceId !== syncDeviceId &&
                  other.pebbleNativeId === peer.nativeId &&
                  bindingsById.has(other.deviceId),
              )
          )
            throw new Error("FOSSIL_NATIVE_ID_IN_USE");
          publish({ phase: "capturing", isBusy: true });
          const download = await deps.setup.fossilDownload({
            key: fossilKey,
            signal: abort.signal,
          });
          if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
          let notice: string | null = null;
          if (download.status === "file") {
            // 1. Durable: committed before the watch may delete anything.
            deps.store.storeFossilFile(ticket, {
              deviceId: syncDeviceId,
              identity: syncIdentity,
              nativeId: peer.nativeId,
              data: download.data,
              crc: download.crc,
            });
            // 2. Delete only a file that parses (upstream keeps unparseable
            //    files on the watch), and only the exact handle fetched.
            let parses = true;
            try {
              parseFossilActivityFile(download.data);
            } catch {
              parses = false;
            }
            if (!parses) notice = "FOSSIL_FILE_UNREADABLE";
            else if (
              !(await deps.setup
                .fossilDelete({ handle: download.handle, signal: abort.signal })
                .catch(() => false))
            )
              // Safe: the data is stored; the watch serves the same file again.
              notice = "FOSSIL_DELETE_FAILED";
          }
          // 3. Project everything stored, including files from earlier syncs.
          const projection = projectDurableInbox(ticket, syncDeviceId);
          inboxNotice =
            notice ??
            projection.errorCode ??
            (projection.unreadableItems ? "FOSSIL_FILE_UNREADABLE" : null);
          inboxResult = { complete: true, hardFailure: !notice && !!projection.errorCode };
        } else if (syncIdentity.family === "pebble") {
          const peer = deps.setup.getPebblePeer();
          if (
            !peer ||
            peer.identity.family !== syncIdentity.family ||
            peer.identity.modelId !== syncIdentity.modelId
          )
            throw new Error("PEBBLE_PEER_MISMATCH");
          // One physical watch feeds one active binding, so its history does
          // not split across two server connections. Only bindings the server
          // still lists count: a revoked one must not lock the watch out.
          if (
            deps.store
              .listBindings(ticket)
              .some(
                (other) =>
                  other.deviceId !== syncDeviceId &&
                  other.pebbleNativeId === peer.nativeId &&
                  bindingsById.has(other.deviceId),
              )
          )
            throw new Error("PEBBLE_NATIVE_ID_IN_USE");
          // Associates this physical watch with the binding once; a different
          // watch of the same model is refused (PEBBLE_NATIVE_ID_IMMUTABLE).
          deps.store.attachPebblePeripheral(ticket, syncDeviceId, peer.identity, peer.nativeId);
          publish({ phase: "capturing", isBusy: true });
          const target = {
            deviceId: syncDeviceId,
            identity: peer.identity,
            nativeId: peer.nativeId,
          };
          const outcome = await deps.setup.capturePebble({
            signal: abort.signal,
            // Each packet is ACKed to the watch only after this resolves.
            sink: async (packet) => {
              if (!current(token) || !isAuthorityTicketCurrent(ticket) || abort.signal.aborted)
                throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
              return deps.store.appendPebblePacket(ticket, target, packet);
            },
          });
          // Whatever the outcome (even a cancel or a superseded sync), packets
          // already ACKed may be gone from the watch: project them now. This
          // is local, needs only current authority, and never throws.
          const projection = isAuthorityTicketCurrent(ticket)
            ? projectDurableInbox(ticket, syncDeviceId)
            : null;
          if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
          if (outcome.status === "cancelled") throw new Error("CANCELLED");
          const notice = pebbleOutcomeNotice(outcome, projection?.sleepHeld ?? 0);
          // A projection failure must not hide the capture result, nor stop
          // the upload of what was already projected.
          inboxNotice =
            notice.code ??
            projection?.errorCode ??
            (projection?.unreadableItems ? "PEBBLE_UNREADABLE_SKIPPED" : null);
          inboxResult = {
            complete: outcome.status === "idle",
            hardFailure: notice.hardFailure || (!notice.code && !!projection?.errorCode),
          };
        }
        const result =
          inboxResult ??
          (await deps.setup.fetchSteps({
            authKey,
            since,
            signal: abort.signal,
            onPhase(phase) {
              if (current(token)) publish({ phase, isBusy: true });
            },
            async onPage(page) {
              if (!current(token) || !isAuthorityTicketCurrent(ticket) || abort.signal.aborted)
                throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
              publish({ phase: "capturing", isBusy: true });
              const envelopes = pageRequests(
                syncDeviceId,
                syncIdentity,
                { userId: context.userId, organizationId: context.organizationId },
                page.minutes,
                "UTC",
              );
              // Empty pages do not advance durable state. Protocol must not deliver unfinished minutes.
              if (!envelopes.length) return;
              const captureId = pageCaptureId(syncDeviceId, cursorSince, page.nextCursor);
              deps.store.commitCapture(ticket, {
                deviceId: syncDeviceId,
                deviceIdentity: syncIdentity,
                captureId,
                expectedPreviousCheckpoint: checkpoint,
                nextCheckpoint: checkpointString(
                  page.nextCursor,
                  sleepCursor,
                  sleepMemory,
                  sleepPending,
                ),
                envelopes,
              });
              checkpoint = checkpointString(
                page.nextCursor,
                sleepCursor,
                sleepMemory,
                sleepPending,
              );
              cursorSince = page.nextCursor;
              activityCursor = page.nextCursor;
              captured += page.minutes.length;
            },
            ...(syncsSleep
              ? {
                  sleep: {
                    since: sleepSince,
                    async onPage(page: ZeppSleepPage) {
                      if (
                        !current(token) ||
                        !isAuthorityTicketCurrent(ticket) ||
                        abort.signal.aborted
                      )
                        throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
                      const before = sleepCursor ?? sleepSince;
                      const assigned = assignZeppSleepIds(page.sessions, sleepMemory);
                      const next = checkpointString(
                        activityCursor,
                        page.nextCursor,
                        assigned.memory,
                        sleepPending,
                      );
                      const envelopes = zeppSleepRequests(
                        syncDeviceId,
                        syncIdentity,
                        { userId: context.userId, organizationId: context.organizationId },
                        page.sessions,
                        assigned.ids,
                      );
                      // A page whose records had no stages commits nothing
                      // and leaves the durable cursor (the next sync re-reads
                      // those records, harmlessly).
                      if (!envelopes.length) return;
                      deps.store.commitCapture(ticket, {
                        deviceId: syncDeviceId,
                        deviceIdentity: syncIdentity,
                        captureId: `dd-sleep:${syncDeviceId}:${before.nextMinuteUtc}:${page.nextCursor.nextMinuteUtc}`,
                        expectedPreviousCheckpoint: checkpoint,
                        nextCheckpoint: next,
                        envelopes,
                      });
                      checkpoint = next;
                      sleepCursor = page.nextCursor;
                      sleepMemory = assigned.memory;
                    },
                  },
                }
              : {}),
            ...(syncsSleepFallback
              ? {
                  sleepFallback: {
                    pendingStart: stored.pending,
                    async onResult(result: ZeppSleepFallbackResult) {
                      if (
                        !current(token) ||
                        !isAuthorityTicketCurrent(ticket) ||
                        abort.signal.aborted
                      )
                        throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
                      const next = checkpointString(
                        activityCursor,
                        sleepCursor,
                        sleepMemory,
                        result.openStart,
                      );
                      // Segmented sessions are deterministic: the same minutes
                      // always give the same start, so the start is the id.
                      const envelopes = zeppSleepRequests(
                        syncDeviceId,
                        syncIdentity,
                        { userId: context.userId, organizationId: context.organizationId },
                        result.sessions.map((session) => ({
                          ...session,
                          reportTime: 0,
                          midnight: 0,
                        })),
                        result.sessions.map((session) =>
                          Math.floor(Date.parse(session.startTime) / 1000),
                        ),
                      );
                      if (envelopes.length)
                        deps.store.commitCapture(ticket, {
                          deviceId: syncDeviceId,
                          deviceIdentity: syncIdentity,
                          captureId: `dd-sleep-fb:${syncDeviceId}:${activityCursor.nextMinuteUtc}:${result.sessions[0]!.startTime}:${result.sessions.at(-1)!.endTime}`,
                          expectedPreviousCheckpoint: checkpoint,
                          nextCheckpoint: next,
                          envelopes,
                        });
                      else if (next !== checkpoint)
                        deps.store.advanceCheckpoint(ticket, {
                          deviceId: syncDeviceId,
                          deviceIdentity: syncIdentity,
                          expectedPreviousCheckpoint: checkpoint,
                          nextCheckpoint: next,
                        });
                      checkpoint = next;
                      sleepPending = result.openStart;
                    },
                  },
                }
              : {}),
          }));
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        // Steps are committed; a failed sleep fetch is a notice, not an error.
        if ("sleep" in result && result.sleep?.errorCode) historyNotice = "ZEPP_SLEEP_SYNC_FAILED";
        // Legacy Huami history arrives through the buffered history sink during
        // the transfer; commit it before draining the outbox.
        queueHistoryFlush();
        await historyFlush;
        authKey.fill(0);
        publish({
          capturedMinutes: captured,
          phase: "uploading",
          pendingEnvelopes: deps.store.countUnaccepted(ticket.scope),
          blockedIdentityEnvelopes: deps.store.countBlockedIdentityEnvelopes(ticket),
          isBusy: true,
        });
        const summary = await drainDirectDeviceOutbox(ticket, {
          store: deps.store,
          send: (request) => api.directDevice.ingestDirectDeviceBatch(request) as Promise<any>,
        });
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        const pending = deps.store.countUnaccepted(ticket.scope);
        const queued = summary.queued;
        publish({
          // A Pebble capture ends the link, so it never returns to "connected".
          phase: inboxResult
            ? inboxResult.hardFailure
              ? "error"
              : "processing"
            : result.complete
              ? "processing"
              : "connected",
          ...(inboxResult ? { errorCode: inboxNotice } : {}),
          pendingEnvelopes: pending,
          blockedIdentityEnvelopes: deps.store.countBlockedIdentityEnvelopes(ticket),
          acceptedEnvelopes: Math.max(0, snapshot.acceptedEnvelopes + summary.sent),
          queuedEnvelopes: queued,
          isBusy: false,
        });
        if (summary.applied > 0) await deps.onApplied?.();
        await controller.refreshBindings();
        if (historyNotice && current(token)) publish({ errorCode: historyNotice });
        // refreshBindings resets phase/errorCode; the Pebble result outlives it.
        if (inboxResult && current(token) && (inboxResult.hardFailure || inboxNotice))
          publish({
            phase: inboxResult.hardFailure ? "error" : snapshot.phase,
            errorCode: inboxNotice,
          });
      } catch (error) {
        if (current(token))
          publish({
            phase: abort.signal.aborted ? "cancelled" : "error",
            isBusy: false,
            errorCode: safeError(error),
          });
      } finally {
        authKey.fill(0);
        fossilKey?.fill(0);
        if (activeAbort === abort) activeAbort = null;
      }
    },
    async retryUpload() {
      if (disposed || snapshot.isBusy) return;
      const token = ++generation;
      const abort = new AbortController();
      activeAbort = abort;
      publish({ phase: "uploading", isBusy: true, errorCode: null });
      try {
        const ticket = fresh();
        // Pebble data left in the inbox by an interrupted sync is projected
        // here too, so it can be uploaded without reconnecting the watch.
        projectDurableInbox(ticket);
        const api = await captureClient(ticket, abort.signal);
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        const summary = await drainDirectDeviceOutbox(ticket, {
          store: deps.store,
          send: (request) => api.directDevice.ingestDirectDeviceBatch(request) as Promise<any>,
        });
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
        publish({
          pendingEnvelopes: deps.store.countUnaccepted(ticket.scope),
          blockedIdentityEnvelopes: deps.store.countBlockedIdentityEnvelopes(ticket),
          acceptedEnvelopes: snapshot.acceptedEnvelopes + summary.sent,
          queuedEnvelopes: summary.queued,
          phase: summary.queued ? "processing" : "connected",
          isBusy: false,
        });
        if (summary.applied) await deps.onApplied?.();
        await controller.refreshBindings();
      } catch (error) {
        if (current(token)) publish({ phase: "error", isBusy: false, errorCode: safeError(error) });
      } finally {
        if (activeAbort === abort) activeAbort = null;
      }
    },
    async cancel() {
      clearLiveFlushTimer();
      queueLiveFlush();
      clearHistoryFlushTimer();
      queueHistoryFlush();
      ++generation;
      bumpConnectionGeneration();
      activeAbort?.abort();
      activeAbort = null;
      await Promise.allSettled([deps.setup.disconnect(), deps.setup.stopScan()]);
      if (!disposed) publish({ phase: "cancelled", isBusy: false, canSync: false });
    },
    async dispose() {
      if (disposed) return;
      clearLiveFlushTimer();
      clearHistoryFlushTimer();
      bumpConnectionGeneration();
      disposed = true;
      ++generation;
      activeAbort?.abort();
      activeAbort = null;
      setupUnsubscribe?.();
      setupUnsubscribe = null;
      authorityUnsubscribe();
      await deps.setup.dispose();
      listeners.clear();
    },
  };
  return controller;
}

/**
 * What the user should be told after a Pebble capture. Durable data was
 * uploaded either way; only `hardFailure` turns the sync into an error.
 */
export function pebbleOutcomeNotice(
  outcome: PebbleSessionOutcome,
  sleepHeld: number,
): { code: string | null; hardFailure: boolean } {
  if (outcome.status === "idle") {
    if (outcome.rejectedPackets > 0) return { code: "PEBBLE_SYNC_INCOMPLETE", hardFailure: false };
    if (sleepHeld > 0) return { code: "PEBBLE_SLEEP_RECONCILIATION_REQUIRED", hardFailure: false };
    return { code: null, hardFailure: false };
  }
  if (outcome.status === "cancelled") return { code: "CANCELLED", hardFailure: true };
  // The watch did not open any health session: nothing was waiting.
  if (outcome.code === "PEBBLE_CAPTURE_TIMEOUT")
    return { code: "PEBBLE_NO_DATA_OFFERED", hardFailure: false };
  if (outcome.code === "PEBBLE_CAPTURE_STALLED" && (outcome.receivedPackets ?? 0) > 0)
    return { code: "PEBBLE_SYNC_INCOMPLETE", hardFailure: false };
  return {
    code: /^[A-Z0-9_]{1,64}$/.test(outcome.code) ? outcome.code : "PEBBLE_CAPTURE_FAILED",
    hardFailure: true,
  };
}

function safeError(error: unknown): string {
  if (error && typeof error === "object") {
    const shaped = error as { code?: unknown; data?: { reason?: unknown }; message?: unknown };
    if (shaped.data?.reason && directDeviceRefusalReason.safeParse(shaped.data.reason).success)
      return String(shaped.data.reason);
    if (typeof shaped.code === "string" && /^[A-Z0-9_]{1,64}$/.test(shaped.code))
      return shaped.code;
    if (typeof shaped.message === "string" && /^[A-Z0-9_]{1,64}$/.test(shaped.message))
      return shaped.message;
  }
  return "DIRECT_DEVICE_SYNC_FAILED";
}
