import {
  directDeviceContext,
  ingestDirectDeviceBatchInput,
  ingestDirectDeviceBatchOutput,
  registerDirectDeviceInput,
  type IngestDirectDeviceBatchInput,
  type IngestDirectDeviceBatchOutput,
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

export type DirectDeviceErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "UNAUTHENTICATED"
  | "READ_ONLY"
  | "INVALID_INPUT"
  | "INVALID_RECEIPT"
  | "REVOKED"
  | "WRONG_OWNER";

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
  captureId: string;
  expectedPreviousCheckpoint: string | null;
  nextCheckpoint: string;
  envelopes: readonly IngestDirectDeviceBatchInput[];
}>;

export interface DirectDeviceStore {
  createBinding(ticket: AuthorityTicket, deviceId: string): void;
  markRegistered(ticket: AuthorityTicket, deviceId: string, providerConnectionId: number): void;
  commitCapture(ticket: AuthorityTicket, input: CaptureInput): void;
  listPending(ticket: AuthorityTicket, limit: number): DirectOutboxRow[];
  recordServerReceipt(ticket: AuthorityTicket, ref: OutboxRef, receipt: IngestDirectDeviceBatchOutput): void;
  markBlocked(ticket: AuthorityTicket, ref: OutboxRef, errorCode: DirectDeviceErrorCode): void;
  countUnaccepted(scope?: DirectDeviceScope): number;
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
  registerDirectDeviceInput.shape.deviceId.parse(deviceId);
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
  const serialized = canonicalJson(request);
  if (utf8ByteLength(serialized) > MAX_REQUEST_BYTES)
    throw new DirectDeviceAdmissionError("DIRECT_DEVICE_REQUEST_TOO_LARGE");
  return serialized;
}

function parseErrorCode(value: string | null): DirectDeviceErrorCode | null {
  if (
    value === "NETWORK" || value === "TIMEOUT" || value === "UNAUTHENTICATED" || value === "READ_ONLY" ||
    value === "INVALID_INPUT" || value === "INVALID_RECEIPT" || value === "REVOKED" ||
    value === "WRONG_OWNER"
  ) return value;
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
    const receipt = row.receipt_json === null
      ? null
      : deepFreeze(ingestDirectDeviceBatchOutput.parse(JSON.parse(row.receipt_json)));
    if ((row.state === "accepted") !== (receipt !== null)) throw new Error("receipt/state mismatch");
    if (
      request.batch.deviceId !== row.device_id ||
      row.scope !== ticket.scopeKey ||
      request.expectedContext.userId !== ticket.scope.userId ||
      request.expectedContext.organizationId !== ticket.scope.organizationId
    ) throw new Error("scope/device mismatch");
    return Object.freeze({
      seq: row.seq,
      ref: Object.freeze({ deviceId: row.device_id, captureId: row.capture_id, envelopeIndex: row.envelope_index }),
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

export function createSqliteDirectDeviceStore(db: SyncSqliteDatabase, now = Date.now): DirectDeviceStore {
  initializeDatabase(db);

  const requireTicketScope = (ticket: AuthorityTicket): string => {
    assertAuthorityTicket(ticket);
    return ticket.scopeKey;
  };

  const store: DirectDeviceStore = {
    createBinding(ticket, deviceId) {
      validateDeviceId(deviceId);
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        db.runSync(
          `INSERT OR IGNORE INTO direct_device_binding(scope, device_id, provider_connection_id, capture_checkpoint)
           VALUES (?, ?, NULL, NULL)`, scope, deviceId,
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
          scope, deviceId,
        );
        if (!binding) throw new DirectDeviceConflictError("DIRECT_DEVICE_BINDING_REQUIRED");
        if (binding.provider_connection_id !== null && binding.provider_connection_id !== providerConnectionId)
          throw new DirectDeviceConflictError("DIRECT_DEVICE_REGISTRATION_IMMUTABLE");
        db.runSync(
          "UPDATE direct_device_binding SET provider_connection_id = ? WHERE scope = ? AND device_id = ? AND provider_connection_id IS NULL",
          providerConnectionId, scope, deviceId,
        );
      });
    },

    commitCapture(ticket, input) {
      validateDeviceId(input.deviceId);
      if (!input.captureId || input.captureId.length > 200 || !input.nextCheckpoint || input.nextCheckpoint.length > 1024)
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_CAPTURE_METADATA_INVALID");
      if (input.envelopes.length < 1 || input.envelopes.length > MAX_CAPTURE_ENVELOPES)
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_CAPTURE_ENVELOPE_LIMIT");
      const requests = input.envelopes.map((request) => validateRequest(ticket, input.deviceId, request));
      const byteCount = requests.reduce((total, request) => total + utf8ByteLength(request), 0);
      if (byteCount > MAX_CAPTURE_BYTES) throw new DirectDeviceAdmissionError("DIRECT_DEVICE_CAPTURE_TOO_LARGE");
      const checkpointJson = captureCheckpoint(input);
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        const existing = db.getFirstSync<{ checkpoint_json: string; envelope_count: number }>(
          `SELECT checkpoint_json, envelope_count FROM direct_device_capture
           WHERE scope = ? AND device_id = ? AND capture_id = ?`, scope, input.deviceId, input.captureId,
        );
        if (existing) {
          if (existing.checkpoint_json !== checkpointJson || existing.envelope_count !== requests.length)
            throw new DirectDeviceConflictError("DIRECT_DEVICE_CAPTURE_REPLAY_CONFLICT");
          const rows = db.getAllSync<{ envelope_index: number; request_json: string }>(
            `SELECT envelope_index, request_json FROM direct_device_outbox
             WHERE scope = ? AND device_id = ? AND capture_id = ? ORDER BY envelope_index`,
            scope, input.deviceId, input.captureId,
          );
          if (rows.length !== requests.length || rows.some((row, index) => row.envelope_index !== index))
            throw new DirectDeviceStorageError("DIRECT_DEVICE_CORRUPT_CAPTURE");
          if (rows.some((row, index) => row.request_json !== requests[index]))
            throw new DirectDeviceConflictError("DIRECT_DEVICE_CAPTURE_REPLAY_CONFLICT");
          return;
        }
        const binding = db.getFirstSync<{ capture_checkpoint: string | null }>(
          "SELECT capture_checkpoint FROM direct_device_binding WHERE scope = ? AND device_id = ?",
          scope, input.deviceId,
        );
        if (!binding) throw new DirectDeviceConflictError("DIRECT_DEVICE_BINDING_REQUIRED");
        if (binding.capture_checkpoint !== input.expectedPreviousCheckpoint)
          throw new DirectDeviceConflictError("DIRECT_DEVICE_CHECKPOINT_CONFLICT");
        db.runSync(
          `INSERT INTO direct_device_capture(scope, device_id, capture_id, checkpoint_json, envelope_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          scope, input.deviceId, input.captureId, checkpointJson, requests.length, now(),
        );
        requests.forEach((requestJson, envelopeIndex) => {
          db.runSync(
            `INSERT INTO direct_device_outbox(
              scope, device_id, capture_id, envelope_index, request_json, state, receipt_json, last_error_code, created_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
            scope, input.deviceId, input.captureId, envelopeIndex, requestJson, now(),
          );
        });
        const updated = db.runSync(
          `UPDATE direct_device_binding SET capture_checkpoint = ?
           WHERE scope = ? AND device_id = ? AND capture_checkpoint IS ?`,
          input.nextCheckpoint, scope, input.deviceId, input.expectedPreviousCheckpoint,
        );
        if (updated.changes !== 1) throw new DirectDeviceConflictError("DIRECT_DEVICE_CHECKPOINT_CONFLICT");
      });
    },

    listPending(ticket, limit) {
      const scope = requireTicketScope(ticket);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        throw new DirectDeviceAdmissionError("DIRECT_DEVICE_INVALID_LIST_LIMIT");
      const rows = db.getAllSync<RawOutboxRow>(
        `SELECT seq, scope, device_id, capture_id, envelope_index, request_json, state, receipt_json, last_error_code, created_at
         FROM direct_device_outbox WHERE scope = ? AND state = 'pending' ORDER BY seq LIMIT ?`, scope, limit,
      );
      return rows.map((row) => toOutboxRow(row, ticket));
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
          scope, ref.deviceId, ref.captureId, ref.envelopeIndex,
        );
        // Purge may have removed the row while the transport was awaiting.
        if (!row) return;
        if (row.state === "accepted") {
          if (row.receipt_json !== serialized) throw new DirectDeviceConflictError("DIRECT_DEVICE_RECEIPT_CONFLICT");
          return;
        }
        if (row.state !== "pending") return;
        db.runSync(
          `UPDATE direct_device_outbox SET state = 'accepted', receipt_json = ?, last_error_code = NULL
           WHERE scope = ? AND device_id = ? AND capture_id = ? AND envelope_index = ? AND state = 'pending'`,
          serialized, scope, ref.deviceId, ref.captureId, ref.envelopeIndex,
        );
      });
    },

    markBlocked(ticket, ref, errorCode) {
      if (!isBlockedCode(errorCode)) throw new DirectDeviceConflictError("DIRECT_DEVICE_ERROR_NOT_BLOCKING");
      const scope = requireTicketScope(ticket);
      db.withTransactionSync(() => {
        assertAuthorityTicket(ticket);
        db.runSync(
          `UPDATE direct_device_outbox SET state = 'blocked', last_error_code = ?
           WHERE scope = ? AND device_id = ? AND capture_id = ? AND envelope_index = ? AND state = 'pending'`,
          errorCode, scope, ref.deviceId, ref.captureId, ref.envelopeIndex,
        );
      });
    },

    countUnaccepted(scopeInput) {
      const scope = scopeInput === undefined ? undefined : scopeKey(scopeInput);
      const row = scope === undefined
        ? db.getFirstSync<{ total: number }>("SELECT COUNT(*) AS total FROM direct_device_outbox WHERE state != 'accepted'")
        : db.getFirstSync<{ total: number }>("SELECT COUNT(*) AS total FROM direct_device_outbox WHERE scope = ? AND state != 'accepted'", scope);
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
        db.runSync("DELETE FROM direct_device_binding WHERE scope = ?", scope);
      });
    },

    purgeAll() {
      invalidateDirectDeviceAuthority();
      db.withTransactionSync(() => {
        db.runSync("DELETE FROM direct_device_outbox");
        db.runSync("DELETE FROM direct_device_capture");
        db.runSync("DELETE FROM direct_device_binding");
      });
    },
  };

  const frozenStore = Object.freeze(store);
  repositoryIdentities.set(frozenStore, db as object);
  return frozenStore;
}

function isBlockedCode(code: DirectDeviceErrorCode): boolean {
  return code === "INVALID_INPUT" || code === "INVALID_RECEIPT" || code === "REVOKED" || code === "WRONG_OWNER";
}

function initializeDatabase(db: SyncSqliteDatabase): void {
  try {
    const integrity = db.getFirstSync<Record<string, string>>("PRAGMA integrity_check");
    if (!integrity || Object.values(integrity)[0] !== "ok")
      throw new DirectDeviceStorageError("DIRECT_DEVICE_DATABASE_CORRUPT");
    const current = db.getFirstSync<{ user_version: number }>("PRAGMA user_version");
    if (!current || current.user_version > DIRECT_DEVICE_SCHEMA_VERSION)
      throw new DirectDeviceStorageError("DIRECT_DEVICE_SCHEMA_UNSUPPORTED");
    db.withTransactionSync(() => {
      db.execSync(DIRECT_DEVICE_SCHEMA_SQL);
      db.execSync(`PRAGMA user_version = ${DIRECT_DEVICE_SCHEMA_VERSION}`);
    });
    db.getAllSync("SELECT * FROM direct_device_binding LIMIT 0");
    db.getAllSync("SELECT * FROM direct_device_capture LIMIT 0");
    db.getAllSync("SELECT * FROM direct_device_outbox LIMIT 0");
  } catch (error) {
    if (error instanceof DirectDeviceStorageError) throw error;
    throw new DirectDeviceStorageError();
  }
}

export function directDeviceScopeForTicket(ticket: AuthorityTicket): DirectDeviceScope {
  assertAuthorityTicket(ticket);
  return ticket.scope;
}
