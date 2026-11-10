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
import type { DirectDeviceStore } from "../persistence/store";
import { drainDirectDeviceOutbox } from "../upload";
import type { HelioCursor, HelioStepsPage } from "../protocol/types";
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

function pageCaptureId(deviceId: string, before: HelioCursor, after: HelioCursor): string {
  // The source cursor coordinate, not phone time/page number, identifies a logical page.
  return `dd-v2:${deviceId}:${before.nextMinuteUtc}:${before.offsetQuarterHours}:${after.nextMinuteUtc}:${after.offsetQuarterHours}`;
}

function pageRequests(
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
    family === "bangle_js" ? "bangle" : "ring";

  const historyRecords = (
    deviceId: string,
    prefix: string,
    samples: readonly DirectDeviceHistorySample[],
  ): { recordType: "steps_interval" | "sleep_session" | "heart_rate"; upserts: unknown[] }[] => {
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
      const groups = historyRecords(buffer.deviceId, historyPrefix(buffer.family), buffer.samples);
      if (!groups.length) return;
      const starts = buffer.samples.map((sample) =>
        Date.parse(sample.type === "heart_rate" ? sample.time : sample.startTime),
      );
      const startTime = new Date(Math.min(...starts)).toISOString();
      const endTime = new Date(Math.max(...starts) + 1000).toISOString();
      const prefix = historyPrefix(buffer.family);
      const captureId = `dd-${prefix}:${buffer.deviceId}:${startTime}:${++historyCaptureSequence}`;
      const envelopes: IngestDirectDeviceBatchInput[] = groups.map((group) => ({
        expectedContext: { userId: context.userId, organizationId: context.organizationId },
        batch: {
          schemaVersion: 1,
          deviceId: buffer.deviceId,
          deviceIdentity: identity,
          provider: "direct_device",
          recordType: group.recordType,
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
        nextCheckpoint: `${prefix}:${endTime}`,
        envelopes,
      });
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
      (state.connectedFamily !== "colmi_ring" && state.connectedFamily !== "bangle_js")
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
    if (!historyBuffer || historyBuffer.deviceId !== bindingId)
      historyBuffer = { deviceId: bindingId, family: state.connectedFamily, samples: [] };
    const buffer = historyBuffer;
    buffer.samples.push(sample);
    if (buffer.samples.length >= 50) queueHistoryFlush();
    else scheduleHistoryFlush();
  };
  if (deps.historyCapture) deps.historyCapture.handler = handleHistorySample;

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
        family: setup.connectedFamily,
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
      const identity: DirectDeviceIdentity = { family: target.family, modelId: target.modelId };
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
      if (!/^((0x)?[0-9a-fA-F]{32})$/.test(authKeyHex)) {
        publish({ phase: "error", errorCode: "INVALID_AUTH_KEY" });
        return;
      }
      const authKey = new Uint8Array(16);
      const hex = authKeyHex.replace(/^0x/i, "");
      for (let i = 0; i < 16; i++) authKey[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      const token = ++generation;
      const syncDeviceId = selectedBindingId;
      const syncIdentity: DirectDeviceIdentity = {
        family: snapshot.connectedFamily!,
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
        const since = parseCursor(binding.captureCheckpoint) ?? {
          version: 1 as const,
          nextMinuteUtc: new Date(defaultStart).toISOString(),
          offsetQuarterHours: 0,
        };
        // Each committed page advances the CAS checkpoint and the next page's source cursor.
        let checkpoint = binding.captureCheckpoint;
        let cursorSince = since;
        let captured = 0;
        const result = await deps.setup.fetchSteps({
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
              nextCheckpoint: cursorString(page.nextCursor),
              envelopes,
            });
            checkpoint = cursorString(page.nextCursor);
            cursorSince = page.nextCursor;
            captured += page.minutes.length;
          },
        });
        if (!current(token) || !isAuthorityTicketCurrent(ticket)) return;
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
          phase: result.complete ? "processing" : "connected",
          pendingEnvelopes: pending,
          blockedIdentityEnvelopes: deps.store.countBlockedIdentityEnvelopes(ticket),
          acceptedEnvelopes: Math.max(0, snapshot.acceptedEnvelopes + summary.sent),
          queuedEnvelopes: queued,
          isBusy: false,
        });
        if (summary.applied > 0) await deps.onApplied?.();
        await controller.refreshBindings();
      } catch (error) {
        if (current(token))
          publish({
            phase: abort.signal.aborted ? "cancelled" : "error",
            isBusy: false,
            errorCode: safeError(error),
          });
      } finally {
        authKey.fill(0);
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
