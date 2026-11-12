import {
  directDeviceContext,
  directDeviceIdentity,
  ingestDirectDeviceBatchInput,
  ingestDirectDeviceBatchOutput,
  type IngestDirectDeviceBatchInput,
  type IngestDirectDeviceBatchOutput,
  type DirectDeviceIdentity,
} from "@openvalens/api/contracts/direct-device";

import {
  assertAuthorityTicket,
  canonicalDirectDeviceScope,
  directDeviceScopeKey,
  invalidateDirectDeviceAuthority,
  invalidateDirectDeviceScope,
  type AuthorityTicket,
  type DirectDeviceScope,
} from "../authority";
import { DIRECT_DEVICE_SCHEMA_SQL, DIRECT_DEVICE_SCHEMA_VERSION } from "./schema";
import {
  parseOverlaySessionData,
  parseSleepSessionData,
  parseStepsSessionData,
} from "../protocol/pebble";
import {
  isPebbleCaptureIdentity,
  type PebbleIdentity,
  type PebblePacket,
  type PebbleDurableReceipt,
} from "../pebble-types";

export type DirectDeviceErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "UNAUTHENTICATED"
  | "READ_ONLY"
  | "INVALID_INPUT"
  | "INVALID_RECEIPT"
  | "REVOKED"
  | "WRONG_OWNER"
  | "IDENTITY_REQUIRED"
  | "IDENTITY_MISMATCH"
  | "HISTORY_UNSUPPORTED";

export type OutboxRef = Readonly<{ deviceId: string; captureId: string; envelopeIndex: number }>;
export type DirectOutboxRow = Readonly<{
  seq: number;
  ref: OutboxRef;
  request: IngestDirectDeviceBatchInput;
  state: "pending" | "accepted" | "blocked";
  receipt: IngestDirectDeviceBatchOutput | null;
  lastErrorCode: DirectDeviceErrorCode | null;
  createdAt: number;
}>;
export type CaptureInput = Readonly<{
  deviceId: string;
  deviceIdentity: DirectDeviceIdentity;
  captureId: string;
  expectedPreviousCheckpoint: string | null;
  nextCheckpoint: string;
  envelopes: readonly IngestDirectDeviceBatchInput[];
}>;
export type DirectBinding = Readonly<{
  deviceId: string;
  providerConnectionId: number | null;
  captureCheckpoint: string | null;
  family: DirectDeviceIdentity["family"] | null;
  modelId: string | null;
  pebbleNativeId?: string | null;
}>;

export type PebbleProjectionKind = "activity" | "sleep";
export type PebbleProjectionManifestEntry = Readonly<{
  recordId: string;
  startTime: string;
  endTime: string;
  /** Hash of the last published content (sleep), so unchanged sessions are not resent. */
  contentHash?: string;
}>;
export type PebbleProjectionSnapshot = Readonly<{
  revision: number;
  throughSeq: number;
  manifest: readonly PebbleProjectionManifestEntry[];
}>;
export type PebbleProjectionInput = Readonly<{
  deviceId: string;
  identity: PebbleIdentity;
  kind: PebbleProjectionKind;
  expectedRevision: number;
  throughSeq: number;
  manifest: readonly PebbleProjectionManifestEntry[];
  envelopes: readonly IngestDirectDeviceBatchInput[];
  /** Settled sleep inputs (tags 83/84, seq <= throughSeq) to delete in this transaction. */
  compactSleepSeqs?: readonly number[];
}>;
export type PebbleInboxItem = Readonly<{
  seq: number;
  logTag: 81 | 83 | 84;
  itemType: number;
  itemSize: number;
  sessionTimestamp: number;
  rawHex: string;
}>;

export interface DirectDeviceStore {
  listBindings(ticket: AuthorityTicket): DirectBinding[];
  getBinding(ticket: AuthorityTicket, deviceId: string): DirectBinding | null;
  createBinding(ticket: AuthorityTicket, deviceId: string, identity?: DirectDeviceIdentity): void;
  adoptBindingIdentity(
    ticket: AuthorityTicket,
    deviceId: string,
    identity: DirectDeviceIdentity,
  ): void;
  markRegistered(ticket: AuthorityTicket, deviceId: string, providerConnectionId: number): void;
  commitCapture(ticket: AuthorityTicket, input: CaptureInput): void;
  attachPebblePeripheral(
    ticket: AuthorityTicket,
    deviceId: string,
    identity: PebbleIdentity,
    nativeId: string,
  ): void;
  appendPebblePacket(
    ticket: AuthorityTicket,
    target: { deviceId: string; identity: PebbleIdentity; nativeId: string },
    packet: PebblePacket,
  ): PebbleDurableReceipt;
  readPebbleItems(
    ticket: AuthorityTicket,
    deviceId: string,
    throughSeq?: number,
  ): readonly PebbleInboxItem[];
  readPebbleProjection(
    ticket: AuthorityTicket,
    deviceId: string,
    kind: PebbleProjectionKind,
  ): PebbleProjectionSnapshot;
  commitPebbleProjection(ticket: AuthorityTicket, input: PebbleProjectionInput): void;
  listPending(ticket: AuthorityTicket, limit: number): DirectOutboxRow[];
  recordServerReceipt(
    ticket: AuthorityTicket,
    ref: OutboxRef,
    receipt: IngestDirectDeviceBatchOutput,
  ): void;
  markBlocked(ticket: AuthorityTicket, ref: OutboxRef, errorCode: DirectDeviceErrorCode): void;
  countUnaccepted(scope?: DirectDeviceScope): number;
  countBlockedIdentityEnvelopes(ticket: AuthorityTicket): number;
  purgeScope(scope: DirectDeviceScope): void;
  purgeAll(): void;
}

export interface SyncSqliteDatabase {
  execSync(sql: string): void;
  runSync(sql: string, ...params: unknown[]): { changes: number };
  getFirstSync<T>(sql: string, ...params: unknown[]): T | null;
  getAllSync<T>(sql: string, ...params: unknown[]): T[];
  withTransactionSync(callback: () => void): void;
}

export const MAX_CAPTURE_ENVELOPES = 100;
export const MAX_REQUEST_BYTES = 1_000_000;
export const MAX_CAPTURE_BYTES = 4_000_000;
export const MAX_PEBBLE_RAW_BYTES = 8 * 1024 * 1024;
export const MAX_PEBBLE_ITEMS = 50_000;

export class DirectDeviceStorageError extends Error {
  constructor(message = "DIRECT_DEVICE_STORAGE_UNAVAILABLE") {
    super(message);
    this.name = "DirectDeviceStorageError";
  }
}

export class DirectDeviceConflictError extends Error {
  constructor(message = "DIRECT_DEVICE_CONFLICT") {
    super(message);
    this.name = "DirectDeviceConflictError";
  }
}

export class DirectDeviceAdmissionError extends Error {
  constructor(message = "DIRECT_DEVICE_ADMISSION_LIMIT") {
    super(message);
    this.name = "DirectDeviceAdmissionError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(item)}`];
      })
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function scopeKey(scope: DirectDeviceScope): string {
  return directDeviceScopeKey(canonicalDirectDeviceScope(scope));
}

function validateDeviceId(deviceId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId))
    throw new DirectDeviceConflictError("DIRECT_DEVICE_INVALID_ID");
}

function validateRequest(ticket: AuthorityTicket, deviceId: string, value: unknown): string {
  const request = ingestDirectDeviceBatchInput.parse(value);
  const expected = directDeviceContext.parse({
    userId: ticket.scope.userId,
    organizationId: ticket.scope.organizationId,
  });
  if (
    request.expectedContext.userId !== expected.userId ||
    request.expectedContext.organizationId !== expected.organizationId ||
    request.batch.deviceId !== deviceId
  )
    throw new DirectDeviceConflictError("DIRECT_DEVICE_REQUEST_SCOPE_MISMATCH");
  if (!request.batch.deviceIdentity) throw new DirectDeviceConflictError("IDENTITY_REQUIRED");
  const serialized = canonicalJson(request);
  if (utf8ByteLength(serialized) > MAX_REQUEST_BYTES)
    throw new DirectDeviceAdmissionError("DIRECT_DEVICE_REQUEST_TOO_LARGE");
  return serialized;
}

function parseErrorCode(value: string | null): DirectDeviceErrorCode | null {
  if (
    value === "NETWORK" ||
    value === "TIMEOUT" ||
    value === "UNAUTHENTICATED" ||
    value === "READ_ONLY" ||
    value === "INVALID_INPUT" ||
    value === "INVALID_RECEIPT" ||
    value === "REVOKED" ||
    value === "WRONG_OWNER" ||
    value === "IDENTITY_REQUIRED" ||
    value === "IDENTITY_MISMATCH" ||
    value === "HISTORY_UNSUPPORTED"
  )
    return value;
  if (value !== null) throw new DirectDeviceStorageError("DIRECT_DEVICE_CORRUPT_ERROR_CODE");
  return null;
}

type RawOutboxRow = {
  seq: number;
  scope: string;
  device_id: string;
  capture_id: string;
  envelope_index: number;
  request_json: string;
  state: string;
  receipt_json: string | null;
  last_error_code: string | null;
  created_at: number;
};

const repositoryIdentities = new WeakMap<DirectDeviceStore, object>();

export function directDeviceRepositoryIdentity(store: DirectDeviceStore): object {
  return repositoryIdentities.get(store) ?? store;
}

function toOutboxRow(row: RawOutboxRow, ticket: AuthorityTicket): DirectOutboxRow {
  try {
    if (row.state !== "pending" && row.state !== "accepted" && row.state !== "blocked")
      throw new Error("invalid state");
    const request = deepFreeze(ingestDirectDeviceBatchInput.parse(JSON.parse(row.request_json)));
    const receipt =
      row.receipt_json === null
        ? null
        : deepFreeze(ingestDirectDeviceBatchOutput.parse(JSON.parse(row.receipt_json)));
    if ((row.state === "accepted") !== (receipt !== null))
      throw new Error("receipt/state mismatch");
    if (
      request.batch.deviceId !== row.device_id ||
      row.scope !== ticket.scopeKey ||
      request.expectedContext.userId !== ticket.scope.userId ||
      request.expectedContext.organizationId !== ticket.scope.organizationId
    )
      throw new Error("scope/device mismatch");
    return Object.freeze({
      seq: row.seq,
      ref: Object.freeze({
        deviceId: row.device_id,
        captureId: row.capture_id,
        envelopeIndex: row.envelope_index,
      }),
      request,
      state: row.state,
      receipt,
      lastErrorCode: parseErrorCode(row.last_error_code),
      createdAt: row.created_at,
    });
  } catch {
    throw new DirectDeviceStorageError("DIRECT_DEVICE_CORRUPT_OUTBOX_ROW");
  }
}

function captureCheckpoint(input: CaptureInput): string {
  return canonicalJson({ previous: input.expectedPreviousCheckpoint, next: input.nextCheckpoint });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validatePebblePacket(packet: PebblePacket): readonly Uint8Array[] {
  if (
    !packet.uuid ||
    !Number.isSafeInteger(packet.sessionTimestamp) ||
    !Number.isInteger(packet.itemType) ||
    !Number.isInteger(packet.itemSize) ||
    packet.itemSize <= 0 ||
    packet.data.length === 0 ||
    packet.data.length % packet.itemSize !== 0
  )
    throw new DirectDeviceConflictError("PEBBLE_PACKET_INVALID");
  const valid =
    packet.logTag === 81
      ? parseStepsSessionData(packet.data, packet.itemSize)
      : packet.logTag === 83
        ? parseSleepSessionData(packet.data, packet.itemSize)
        : packet.logTag === 84
          ? parseOverlaySessionData(packet.data, packet.itemSize)
          : null;
  if (!valid) throw new DirectDeviceConflictError("PEBBLE_PACKET_INVALID");
  const items: Uint8Array[] = [];
  for (let offset = 0; offset < packet.data.length; offset += packet.itemSize)
    items.push(packet.data.slice(offset, offset + packet.itemSize));
  return items;
}

export function createSqliteDirectDeviceStore(
  db: SyncSqliteDatabase,
  now = Date.now,
): DirectDeviceStore {
  initializeDatabase(db);

  const requireTicketScope = (ticket: AuthorityTicket): string => {
    assertAuthorityTicket(ticket);
    return ticket.scopeKey;
  };

  // Transaction-local only: callers establish the enclosing atomic boundary.
  const insertCaptureInTransaction = (
    scope: string,
    deviceId: string,
    captureId: string,
    checkpointJson: string,
    requests: readonly string[],
  ): void => {
    db.runSync(
      `INSERT INTO direct_device_capture(scope, device_id, capture_id, checkpoint_json, envelope_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      scope,
      deviceId,
      captureId,
      checkpointJson,
      requests.length,
      now(),
    );
    requests.forEach((requestJson, envelopeIndex) =>
      db.runSync(
        `INSERT INTO direct_device_outbox(
          scope, device_id, capture_id, envelope_index, request_json, state, receipt_json, last_error_code, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
        scope,
        deviceId,
        captureId,
        envelopeIndex,
        requestJson,
        now(),
      ),
    );
  };

  const store: DirectDeviceStore = {
    listBindings(ticket) {
      const scope = requireTicketScope(ticket);
      return db
        .getAllSync<{
          device_id: string;
          provider_connection_id: number | null;
          capture_checkpoint: string | null;
          family: DirectBinding["family"];
          model_id: string | null;
          pebble_native_id: string | null;
        }>(
          `SELECT device_id, provider_connection_id, capture_checkpoint, family, model_id, pebble_native_id FROM direct_device_binding WHERE scope = ? ORDER BY device_id`,
          scope,
        )
        .map((row) =>
          Object.freeze({
            deviceId: row.device_id,
            providerConnectionId: row.provider_connection_id,
            captureCheckpoint: row.capture_checkpoint,
            family: row.family,
            modelId: row.model_id,
            pebbleNativeId: row.pebble_native_id,
          }),
        );
    },

    getBinding(ticket, deviceId) {
      validateDeviceId(deviceId);
      const scope = requireTicketScope(ticket);
      const row = db.getFirstSync<{
        device_id: string;
        provider_connection_id: number | null;
        capture_checkpoint: string | null;
        family: DirectBinding["family"];
        model_id: string | null;
        pebble_native_id: string | null;
      }>(
        `SELECT device_id, provider_connection_id, capture_checkpoint, family, model_id, pebble_native_id FROM direct_device_binding WHERE scope = ? AND device_id = ?`,
        scope,
        deviceId,
      );
      return row
        ? Object.freeze({
            deviceId: row.device_id,
            providerConnectionId: row.provider_connection_id,
            captureCheckpoint: row.capture_checkpoint,
            family: row.family,
            modelId: row.model_id,
            pebbleNativeId: row.pebble_native_id,
          })
        : null;
    },

    createBinding(ticket, deviceId, identityInput) {
      validateDeviceId(deviceId);
      const identity = identityInput ? directDeviceIdentity.parse(identityInput) : null;
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        db.runSync(
          `INSERT OR IGNORE INTO direct_device_binding(scope, device_id, provider_connection_id, capture_checkpoint, family, model_id)
           VALUES (?, ?, NULL, NULL, ?, ?)`,
          scope,
          deviceId,
          identity?.family ?? null,
          identity?.modelId ?? null,
        );
      });
    },

    adoptBindingIdentity(ticket, deviceId, identityInput) {
      validateDeviceId(deviceId);
      const identity = directDeviceIdentity.parse(identityInput);
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const binding = db.getFirstSync<{ family: string | null; model_id: string | null }>(
          "SELECT family, model_id FROM direct_device_binding WHERE scope = ? AND device_id = ?",
          scope,
          deviceId,
        );
        if (!binding) throw new DirectDeviceConflictError("DIRECT_DEVICE_BINDING_REQUIRED");
        if (binding.family !== null || binding.model_id !== null) {
          if (binding.family !== identity.family || binding.model_id !== identity.modelId)
            throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_IMMUTABLE");
          return;
        }
        db.runSync(
          `UPDATE direct_device_binding SET family = ?, model_id = ?, capture_checkpoint = NULL
           WHERE scope = ? AND device_id = ? AND family IS NULL AND model_id IS NULL`,
          identity.family,
          identity.modelId,
          scope,
          deviceId,
        );
        // Legacy bytes remain unchanged and quarantined; never stamp identity onto them.
        db.runSync(
          `UPDATE direct_device_outbox SET state = 'blocked', last_error_code = 'IDENTITY_REQUIRED'
           WHERE scope = ? AND device_id = ? AND state = 'pending'
             AND json_extract(request_json, '$.batch.deviceIdentity') IS NULL`,
          scope,
          deviceId,
        );
      });
    },

    markRegistered(ticket, deviceId, providerConnectionId) {
      validateDeviceId(deviceId);
      if (!Number.isSafeInteger(providerConnectionId) || providerConnectionId <= 0)
        throw new DirectDeviceConflictError("DIRECT_DEVICE_INVALID_CONNECTION_ID");
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const binding = db.getFirstSync<{ provider_connection_id: number | null }>(
          "SELECT provider_connection_id FROM direct_device_binding WHERE scope = ? AND device_id = ?",
          scope,
          deviceId,
        );
        if (!binding) throw new DirectDeviceConflictError("DIRECT_DEVICE_BINDING_REQUIRED");
        if (
          binding.provider_connection_id !== null &&
          binding.provider_connection_id !== providerConnectionId
        )
          throw new DirectDeviceConflictError("DIRECT_DEVICE_REGISTRATION_IMMUTABLE");
        db.runSync(
          "UPDATE direct_device_binding SET provider_connection_id = ? WHERE scope = ? AND device_id = ? AND provider_connection_id IS NULL",
          providerConnectionId,
          scope,
          deviceId,
        );
      });
    },

    commitCapture(ticket, input) {
      validateDeviceId(input.deviceId);
      // Pebble history must go through the durable inbox and projector.
      if (input.deviceIdentity?.family === "pebble")
        throw new DirectDeviceConflictError("PEBBLE_CAPTURE_REQUIRES_INBOX");
      if (
        !input.captureId ||
        input.captureId.length > 200 ||
        !input.nextCheckpoint ||
        input.nextCheckpoint.length > 1024
      )
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_CAPTURE_METADATA_INVALID");
      if (input.envelopes.length < 1 || input.envelopes.length > MAX_CAPTURE_ENVELOPES)
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_CAPTURE_ENVELOPE_LIMIT");
      const requests = input.envelopes.map((request) =>
        validateRequest(ticket, input.deviceId, request),
      );
      const captureIdentity = directDeviceIdentity.parse(input.deviceIdentity);
      if (
        input.envelopes.some(
          (request) =>
            request.batch.deviceIdentity?.family !== captureIdentity.family ||
            request.batch.deviceIdentity?.modelId !== captureIdentity.modelId,
        )
      )
        throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_MISMATCH");
      const byteCount = requests.reduce((total, request) => total + utf8ByteLength(request), 0);
      if (byteCount > MAX_CAPTURE_BYTES)
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_CAPTURE_TOO_LARGE");
      const checkpointJson = captureCheckpoint(input);
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const existing = db.getFirstSync<{ checkpoint_json: string; envelope_count: number }>(
          `SELECT checkpoint_json, envelope_count FROM direct_device_capture
           WHERE scope = ? AND device_id = ? AND capture_id = ?`,
          scope,
          input.deviceId,
          input.captureId,
        );
        if (existing) {
          if (
            existing.checkpoint_json !== checkpointJson ||
            existing.envelope_count !== requests.length
          )
            throw new DirectDeviceConflictError("DIRECT_DEVICE_CAPTURE_REPLAY_CONFLICT");
          const rows = db.getAllSync<{ envelope_index: number; request_json: string }>(
            `SELECT envelope_index, request_json FROM direct_device_outbox
             WHERE scope = ? AND device_id = ? AND capture_id = ? ORDER BY envelope_index`,
            scope,
            input.deviceId,
            input.captureId,
          );
          if (
            rows.length !== requests.length ||
            rows.some((row, index) => row.envelope_index !== index)
          )
            throw new DirectDeviceStorageError("DIRECT_DEVICE_CORRUPT_CAPTURE");
          if (rows.some((row, index) => row.request_json !== requests[index]))
            throw new DirectDeviceConflictError("DIRECT_DEVICE_CAPTURE_REPLAY_CONFLICT");
          return;
        }
        const binding = db.getFirstSync<{
          capture_checkpoint: string | null;
          family: string | null;
          model_id: string | null;
        }>(
          "SELECT capture_checkpoint, family, model_id FROM direct_device_binding WHERE scope = ? AND device_id = ?",
          scope,
          input.deviceId,
        );
        if (!binding) throw new DirectDeviceConflictError("DIRECT_DEVICE_BINDING_REQUIRED");
        if (
          binding.family !== captureIdentity.family ||
          binding.model_id !== captureIdentity.modelId
        )
          throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_MISMATCH");
        if (binding.capture_checkpoint !== input.expectedPreviousCheckpoint)
          throw new DirectDeviceConflictError("DIRECT_DEVICE_CHECKPOINT_CONFLICT");
        insertCaptureInTransaction(
          scope,
          input.deviceId,
          input.captureId,
          checkpointJson,
          requests,
        );
        const updated = db.runSync(
          `UPDATE direct_device_binding SET capture_checkpoint = ?
           WHERE scope = ? AND device_id = ? AND capture_checkpoint IS ?`,
          input.nextCheckpoint,
          scope,
          input.deviceId,
          input.expectedPreviousCheckpoint,
        );
        if (updated.changes !== 1)
          throw new DirectDeviceConflictError("DIRECT_DEVICE_CHECKPOINT_CONFLICT");
      });
    },

    attachPebblePeripheral(ticket, deviceId, identityInput, nativeId) {
      validateDeviceId(deviceId);
      if (!nativeId || nativeId.length > 512)
        throw new DirectDeviceConflictError("PEBBLE_NATIVE_ID_INVALID");
      const identity = directDeviceIdentity.parse(identityInput);
      if (!isPebbleCaptureIdentity(identity))
        throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_MISMATCH");
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const binding = db.getFirstSync<{
          provider_connection_id: number | null;
          family: string | null;
          model_id: string | null;
          pebble_native_id: string | null;
        }>(
          "SELECT provider_connection_id, family, model_id, pebble_native_id FROM direct_device_binding WHERE scope = ? AND device_id = ?",
          scope,
          deviceId,
        );
        if (!binding || binding.provider_connection_id === null)
          throw new DirectDeviceConflictError("DIRECT_DEVICE_BINDING_REQUIRED");
        if (binding.family !== identity.family || binding.model_id !== identity.modelId)
          throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_MISMATCH");
        if (binding.pebble_native_id !== null && binding.pebble_native_id !== nativeId)
          throw new DirectDeviceConflictError("PEBBLE_NATIVE_ID_IMMUTABLE");
        db.runSync(
          "UPDATE direct_device_binding SET pebble_native_id = ? WHERE scope = ? AND device_id = ? AND pebble_native_id IS NULL",
          nativeId,
          scope,
          deviceId,
        );
      });
    },

    appendPebblePacket(ticket, target, packet) {
      validateDeviceId(target.deviceId);
      const identity = directDeviceIdentity.parse(target.identity);
      if (!isPebbleCaptureIdentity(identity) || !target.nativeId)
        throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_MISMATCH");
      const items = validatePebblePacket(packet);
      const scope = requireTicketScope(ticket);
      const itemHex = items.map(bytesToHex);
      let insertedItems = 0;
      let throughSeq = 0;
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const binding = db.getFirstSync<{
          provider_connection_id: number | null;
          family: string | null;
          model_id: string | null;
          pebble_native_id: string | null;
        }>(
          "SELECT provider_connection_id, family, model_id, pebble_native_id FROM direct_device_binding WHERE scope = ? AND device_id = ?",
          scope,
          target.deviceId,
        );
        if (
          !binding ||
          binding.provider_connection_id === null ||
          binding.family !== identity.family ||
          binding.model_id !== identity.modelId ||
          binding.pebble_native_id !== target.nativeId
        )
          throw new DirectDeviceConflictError("PEBBLE_PEER_AUTHORITY_MISMATCH");
        const current = db.getFirstSync<{ items: number; bytes: number }>(
          "SELECT COUNT(*) AS items, COALESCE(SUM(length(raw_hex) / 2), 0) AS bytes FROM direct_device_pebble_item WHERE scope = ? AND device_id = ?",
          scope,
          target.deviceId,
        )!;
        const uniqueNew = [...new Set(itemHex)].filter(
          (rawHex) =>
            !db.getFirstSync<{ present: number }>(
              `SELECT 1 AS present FROM direct_device_pebble_item
             WHERE scope = ? AND device_id = ? AND log_tag = ? AND item_type = ? AND item_size = ? AND raw_hex = ?`,
              scope,
              target.deviceId,
              packet.logTag,
              packet.itemType,
              packet.itemSize,
              rawHex,
            ),
        );
        const additionalBytes = uniqueNew.reduce((total, hex) => total + hex.length / 2, 0);
        if (
          current.items + uniqueNew.length > MAX_PEBBLE_ITEMS ||
          current.bytes + additionalBytes > MAX_PEBBLE_RAW_BYTES
        )
          throw new DirectDeviceAdmissionError("PEBBLE_INBOX_FULL");
        for (const rawHex of itemHex) {
          const result = db.runSync(
            `INSERT OR IGNORE INTO direct_device_pebble_item
             (scope, device_id, log_tag, item_type, item_size, session_timestamp, raw_hex, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            scope,
            target.deviceId,
            packet.logTag,
            packet.itemType,
            packet.itemSize,
            packet.sessionTimestamp,
            rawHex,
            now(),
          );
          insertedItems += result.changes;
        }
        const max = db.getFirstSync<{ seq: number | null }>(
          "SELECT MAX(seq) AS seq FROM direct_device_pebble_item WHERE scope = ? AND device_id = ?",
          scope,
          target.deviceId,
        );
        throughSeq = max?.seq ?? 0;
      });
      return Object.freeze({ durable: true as const, insertedItems, throughSeq });
    },

    readPebbleItems(ticket, deviceId, throughSeq = Number.MAX_SAFE_INTEGER) {
      validateDeviceId(deviceId);
      const scope = requireTicketScope(ticket);
      return db
        .getAllSync<PebbleInboxItem>(
          `SELECT seq, log_tag AS logTag, item_type AS itemType, item_size AS itemSize,
                session_timestamp AS sessionTimestamp, raw_hex AS rawHex
         FROM direct_device_pebble_item WHERE scope = ? AND device_id = ? AND seq <= ? ORDER BY seq`,
          scope,
          deviceId,
          throughSeq,
        )
        .map((row) => Object.freeze({ ...row, logTag: row.logTag as 81 | 83 | 84 }));
    },

    readPebbleProjection(ticket, deviceId, kind) {
      validateDeviceId(deviceId);
      const scope = requireTicketScope(ticket);
      const row = db.getFirstSync<{ revision: number; through_seq: number; manifest_json: string }>(
        "SELECT revision, through_seq, manifest_json FROM direct_device_pebble_projection WHERE scope = ? AND device_id = ? AND kind = ?",
        scope,
        deviceId,
        kind,
      );
      if (!row) return Object.freeze({ revision: 0, throughSeq: 0, manifest: Object.freeze([]) });
      try {
        const manifest = JSON.parse(row.manifest_json) as PebbleProjectionManifestEntry[];
        if (!Array.isArray(manifest)) throw new Error("invalid manifest");
        return Object.freeze({
          revision: row.revision,
          throughSeq: row.through_seq,
          manifest: Object.freeze(manifest),
        });
      } catch {
        throw new DirectDeviceStorageError("PEBBLE_PROJECTION_CORRUPT");
      }
    },

    commitPebbleProjection(ticket, input) {
      validateDeviceId(input.deviceId);
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        !Number.isSafeInteger(input.throughSeq) ||
        input.throughSeq < 0
      )
        throw new DirectDeviceConflictError("PEBBLE_PROJECTION_CURSOR_INVALID");
      const manifestIds = new Set<string>();
      for (const entry of input.manifest) {
        if (
          !entry.recordId ||
          entry.recordId.length > 120 ||
          manifestIds.has(entry.recordId) ||
          !Number.isFinite(Date.parse(entry.startTime)) ||
          !Number.isFinite(Date.parse(entry.endTime)) ||
          Date.parse(entry.endTime) <= Date.parse(entry.startTime)
        )
          throw new DirectDeviceConflictError("PEBBLE_PROJECTION_MANIFEST_INVALID");
        manifestIds.add(entry.recordId);
      }
      const identity = directDeviceIdentity.parse(input.identity);
      if (!isPebbleCaptureIdentity(identity))
        throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_MISMATCH");
      const scope = requireTicketScope(ticket);
      const requests = input.envelopes.map((envelope) =>
        validateRequest(ticket, input.deviceId, envelope),
      );
      if (
        requests.length > MAX_CAPTURE_ENVELOPES ||
        requests.reduce((sum, request) => sum + utf8ByteLength(request), 0) > MAX_CAPTURE_BYTES
      )
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_CAPTURE_TOO_LARGE");
      if (
        input.envelopes.some(
          (envelope) =>
            envelope.batch.deviceIdentity?.family !== identity.family ||
            envelope.batch.deviceIdentity.modelId !== identity.modelId,
        )
      )
        throw new DirectDeviceConflictError("DIRECT_DEVICE_IDENTITY_MISMATCH");
      const manifestJson = canonicalJson(input.manifest);
      const captureId = `pebble-${input.kind}-${input.expectedRevision + 1}-${input.throughSeq}`;
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const binding = db.getFirstSync<{
          provider_connection_id: number | null;
          family: string | null;
          model_id: string | null;
          pebble_native_id: string | null;
        }>(
          "SELECT provider_connection_id, family, model_id, pebble_native_id FROM direct_device_binding WHERE scope = ? AND device_id = ?",
          scope,
          input.deviceId,
        );
        if (
          !binding ||
          binding.provider_connection_id === null ||
          binding.family !== identity.family ||
          binding.model_id !== identity.modelId ||
          !binding.pebble_native_id
        )
          throw new DirectDeviceConflictError("PEBBLE_PEER_AUTHORITY_MISMATCH");
        const current = db.getFirstSync<{ revision: number; through_seq: number }>(
          "SELECT revision, through_seq FROM direct_device_pebble_projection WHERE scope = ? AND device_id = ? AND kind = ?",
          scope,
          input.deviceId,
          input.kind,
        );
        const revision = current?.revision ?? 0;
        const cursor = current?.through_seq ?? 0;
        if (revision !== input.expectedRevision || input.throughSeq < cursor)
          throw new DirectDeviceConflictError("PEBBLE_PROJECTION_CONFLICT");
        const inbox = db.getFirstSync<{ seq: number | null }>(
          "SELECT MAX(seq) AS seq FROM direct_device_pebble_item WHERE scope = ? AND device_id = ?",
          scope,
          input.deviceId,
        );
        if (input.throughSeq > (inbox?.seq ?? 0))
          throw new DirectDeviceConflictError("PEBBLE_PROJECTION_CURSOR_INVALID");
        if (input.kind === "activity") {
          // Projected step items are fully represented by the outbox rows and
          // the coverage manifest committed here, so they leave the inbox in
          // the same transaction. Sleep inputs stay: sleep is re-assembled
          // from every retained bound and overlay.
          db.runSync(
            "DELETE FROM direct_device_pebble_item WHERE scope = ? AND device_id = ? AND log_tag = 81 AND seq <= ?",
            scope,
            input.deviceId,
            input.throughSeq,
          );
        }
        if (input.kind === "sleep" && input.compactSleepSeqs?.length) {
          for (const seq of input.compactSleepSeqs)
            db.runSync(
              "DELETE FROM direct_device_pebble_item WHERE scope = ? AND device_id = ? AND log_tag IN (83, 84) AND seq = ? AND seq <= ?",
              scope,
              input.deviceId,
              seq,
              input.throughSeq,
            );
        }
        if (input.envelopes.length) {
          insertCaptureInTransaction(
            scope,
            input.deviceId,
            captureId,
            canonicalJson({ revision, throughSeq: input.throughSeq }),
            requests,
          );
        }
        if (current) {
          const updated = db.runSync(
            `UPDATE direct_device_pebble_projection
             SET revision = ?, through_seq = ?, manifest_json = ?
             WHERE scope = ? AND device_id = ? AND kind = ? AND revision = ?`,
            revision + 1,
            input.throughSeq,
            manifestJson,
            scope,
            input.deviceId,
            input.kind,
            input.expectedRevision,
          );
          if (updated.changes !== 1)
            throw new DirectDeviceConflictError("PEBBLE_PROJECTION_CONFLICT");
        } else {
          if (input.expectedRevision !== 0)
            throw new DirectDeviceConflictError("PEBBLE_PROJECTION_CONFLICT");
          db.runSync(
            `INSERT INTO direct_device_pebble_projection(scope, device_id, kind, revision, through_seq, manifest_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
            scope,
            input.deviceId,
            input.kind,
            1,
            input.throughSeq,
            manifestJson,
          );
        }
      });
    },

    listPending(ticket, limit) {
      const scope = requireTicketScope(ticket);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_INVALID_LIST_LIMIT");
      const rows = db.getAllSync<RawOutboxRow>(
        `SELECT seq, scope, device_id, capture_id, envelope_index, request_json, state, receipt_json, last_error_code, created_at
         FROM direct_device_outbox WHERE scope = ? AND state = 'pending' ORDER BY seq LIMIT ?`,
        scope,
        limit,
      );
      const ready: DirectOutboxRow[] = [];
      for (const row of rows) {
        let parsed: { batch?: { deviceIdentity?: unknown } };
        try {
          parsed = JSON.parse(row.request_json) as typeof parsed;
        } catch {
          throw new DirectDeviceStorageError("DIRECT_DEVICE_CORRUPT_OUTBOX_ROW");
        }
        if (!parsed.batch?.deviceIdentity) {
          db.runSync(
            `UPDATE direct_device_outbox SET state = 'blocked', last_error_code = 'IDENTITY_REQUIRED'
             WHERE scope = ? AND device_id = ? AND capture_id = ? AND envelope_index = ? AND state = 'pending'`,
            scope,
            row.device_id,
            row.capture_id,
            row.envelope_index,
          );
          continue;
        }
        ready.push(toOutboxRow(row, ticket));
      }
      return ready;
    },

    recordServerReceipt(ticket, ref, receipt) {
      const parsed = ingestDirectDeviceBatchOutput.parse(receipt);
      const serialized = canonicalJson(parsed);
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const row = db.getFirstSync<{ state: string; receipt_json: string | null }>(
          `SELECT state, receipt_json FROM direct_device_outbox
           WHERE scope = ? AND device_id = ? AND capture_id = ? AND envelope_index = ?`,
          scope,
          ref.deviceId,
          ref.captureId,
          ref.envelopeIndex,
        );
        // Purge may have removed the row while the transport was awaiting.
        if (!row) return;
        if (row.state === "accepted") {
          if (row.receipt_json !== serialized)
            throw new DirectDeviceConflictError("DIRECT_DEVICE_RECEIPT_CONFLICT");
          return;
        }
        if (row.state !== "pending") return;
        db.runSync(
          `UPDATE direct_device_outbox SET state = 'accepted', receipt_json = ?, last_error_code = NULL
           WHERE scope = ? AND device_id = ? AND capture_id = ? AND envelope_index = ? AND state = 'pending'`,
          serialized,
          scope,
          ref.deviceId,
          ref.captureId,
          ref.envelopeIndex,
        );
      });
    },

    markBlocked(ticket, ref, errorCode) {
      if (!isBlockedCode(errorCode))
        throw new DirectDeviceConflictError("DIRECT_DEVICE_ERROR_NOT_BLOCKING");
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        db.runSync(
          `UPDATE direct_device_outbox SET state = 'blocked', last_error_code = ?
           WHERE scope = ? AND device_id = ? AND capture_id = ? AND envelope_index = ? AND state = 'pending'`,
          errorCode,
          scope,
          ref.deviceId,
          ref.captureId,
          ref.envelopeIndex,
        );
      });
    },

    countUnaccepted(scopeInput) {
      const scope = scopeInput === undefined ? undefined : scopeKey(scopeInput);
      const row =
        scope === undefined
          ? db.getFirstSync<{ total: number }>(
              "SELECT COUNT(*) AS total FROM direct_device_outbox WHERE state != 'accepted'",
            )
          : db.getFirstSync<{ total: number }>(
              "SELECT COUNT(*) AS total FROM direct_device_outbox WHERE scope = ? AND state != 'accepted'",
              scope,
            );
      if (!row || !Number.isSafeInteger(row.total) || row.total < 0)
        throw new DirectDeviceStorageError("DIRECT_DEVICE_COUNT_FAILED");
      return row.total;
    },

    countBlockedIdentityEnvelopes(ticket) {
      const scope = requireTicketScope(ticket);
      const row = db.getFirstSync<{ total: number }>(
        `SELECT COUNT(*) AS total FROM direct_device_outbox
         WHERE scope = ? AND state = 'blocked' AND last_error_code = 'IDENTITY_REQUIRED'
           AND json_extract(request_json, '$.batch.deviceIdentity') IS NULL`,
        scope,
      );
      if (!row || !Number.isSafeInteger(row.total) || row.total < 0)
        throw new DirectDeviceStorageError("DIRECT_DEVICE_COUNT_FAILED");
      return row.total;
    },

    purgeScope(scopeInput) {
      const scope = scopeKey(scopeInput);
      invalidateDirectDeviceScope(scopeInput);
      db.withTransactionSync(() => {
        db.runSync("DELETE FROM direct_device_outbox WHERE scope = ?", scope);
        db.runSync("DELETE FROM direct_device_capture WHERE scope = ?", scope);
        db.runSync("DELETE FROM direct_device_pebble_projection WHERE scope = ?", scope);
        db.runSync("DELETE FROM direct_device_pebble_item WHERE scope = ?", scope);
        db.runSync("DELETE FROM direct_device_binding WHERE scope = ?", scope);
      });
    },

    purgeAll() {
      invalidateDirectDeviceAuthority();
      db.withTransactionSync(() => {
        db.runSync("DELETE FROM direct_device_outbox");
        db.runSync("DELETE FROM direct_device_capture");
        db.runSync("DELETE FROM direct_device_pebble_projection");
        db.runSync("DELETE FROM direct_device_pebble_item");
        db.runSync("DELETE FROM direct_device_binding");
      });
    },
  };

  const frozenStore = Object.freeze(store);
  repositoryIdentities.set(frozenStore, db as object);
  return frozenStore;
}

function isBlockedCode(code: DirectDeviceErrorCode): boolean {
  return (
    code === "INVALID_INPUT" ||
    code === "INVALID_RECEIPT" ||
    code === "REVOKED" ||
    code === "WRONG_OWNER" ||
    code === "IDENTITY_REQUIRED" ||
    code === "IDENTITY_MISMATCH" ||
    code === "HISTORY_UNSUPPORTED"
  );
}

function initializeDatabase(db: SyncSqliteDatabase): void {
  try {
    db.execSync("PRAGMA synchronous = FULL");
    const synchronous = db.getFirstSync<{ synchronous: number }>("PRAGMA synchronous");
    if (!synchronous || synchronous.synchronous !== 2)
      throw new DirectDeviceStorageError("DIRECT_DEVICE_DURABILITY_UNAVAILABLE");
    const integrity = db.getFirstSync<Record<string, string>>("PRAGMA integrity_check");
    if (!integrity || Object.values(integrity)[0] !== "ok")
      throw new DirectDeviceStorageError("DIRECT_DEVICE_DATABASE_CORRUPT");
    const current = db.getFirstSync<{ user_version: number }>("PRAGMA user_version");
    if (!current || current.user_version > DIRECT_DEVICE_SCHEMA_VERSION)
      throw new DirectDeviceStorageError("DIRECT_DEVICE_SCHEMA_UNSUPPORTED");
    db.withTransactionSync(() => {
      db.execSync(DIRECT_DEVICE_SCHEMA_SQL);
      const columns = db.getAllSync<{ name: string }>("PRAGMA table_info(direct_device_binding)");
      const names = new Set(columns.map((column) => column.name));
      if (!names.has("family"))
        db.execSync("ALTER TABLE direct_device_binding ADD COLUMN family TEXT");
      if (!names.has("model_id"))
        db.execSync("ALTER TABLE direct_device_binding ADD COLUMN model_id TEXT");
      if (!names.has("pebble_native_id"))
        db.execSync("ALTER TABLE direct_device_binding ADD COLUMN pebble_native_id TEXT");
      db.execSync(`PRAGMA user_version = ${DIRECT_DEVICE_SCHEMA_VERSION}`);
    });
    db.getAllSync("SELECT * FROM direct_device_binding LIMIT 0");
    db.getAllSync("SELECT * FROM direct_device_capture LIMIT 0");
    db.getAllSync("SELECT * FROM direct_device_outbox LIMIT 0");
    db.getAllSync("SELECT * FROM direct_device_pebble_item LIMIT 0");
    db.getAllSync("SELECT * FROM direct_device_pebble_projection LIMIT 0");
  } catch (error) {
    if (error instanceof DirectDeviceStorageError) throw error;
    throw new DirectDeviceStorageError();
  }
}

export function directDeviceScopeForTicket(ticket: AuthorityTicket): DirectDeviceScope {
  assertAuthorityTicket(ticket);
  return ticket.scope;
}
