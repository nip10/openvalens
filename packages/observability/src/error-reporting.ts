/**
 * PHI-safe error reporting (Issue #54).
 *
 * Optional Sentry reporting for the server, web and native apps. Nothing is
 * sent unless an operator configures a DSN. Every event passes through
 * {@link scrubErrorEvent}, which keeps only what is needed to find the code
 * that failed — the exception type, mechanism and code frames, plus release
 * and environment — and drops everything that could carry health data or
 * identity: error messages, request data, cookies, headers, URLs and query
 * strings, user, extras, tags, breadcrumbs, host names and source lines.
 * Events without an exception (plain messages) are dropped entirely.
 *
 * This module is dependency-free and safe for app bundles; each app passes
 * {@link scrubErrorEvent} and {@link dropBreadcrumb} to its own Sentry SDK.
 */

/** The part of a Sentry event this module reads. Unknown fields are dropped. */
export type ErrorEvent = {
  event_id?: string;
  timestamp?: number;
  platform?: string;
  level?: string;
  release?: string;
  environment?: string;
  sdk?: { name?: string; version?: string };
  exception?: { values?: ExceptionValue[] };
  contexts?: Record<string, Record<string, unknown> | undefined>;
  [key: string]: unknown;
};

type ExceptionValue = {
  type?: string;
  value?: string;
  mechanism?: { type?: string; handled?: boolean; [key: string]: unknown };
  stacktrace?: { frames?: Frame[]; [key: string]: unknown };
  [key: string]: unknown;
};

type Frame = {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  [key: string]: unknown;
};

export type ErrorReportingConfig = {
  dsn: string;
  environment: string;
  release: string | undefined;
};

/** Error names are identifiers; anything else (a message in disguise) is replaced. */
const ERROR_TYPE = /^[A-Za-z_$][\w$.]{0,99}$/;
const MAX_FRAMES = 100;

/** Drops the query string and fragment, which can carry ids or tokens. */
function stripUrlParts(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.replace(/[?#].*$/, "").slice(0, 500);
}

function scrubFrame(frame: Frame): Frame {
  const safe: Frame = {};
  const filename = stripUrlParts(frame.filename);
  if (filename) safe.filename = filename;
  const absPath = stripUrlParts(frame.abs_path);
  if (absPath) safe.abs_path = absPath;
  if (typeof frame.function === "string") safe.function = frame.function.slice(0, 200);
  if (typeof frame.module === "string") safe.module = frame.module.slice(0, 200);
  if (Number.isFinite(frame.lineno)) safe.lineno = frame.lineno;
  if (Number.isFinite(frame.colno)) safe.colno = frame.colno;
  if (typeof frame.in_app === "boolean") safe.in_app = frame.in_app;
  return safe;
}

function scrubException(value: ExceptionValue): ExceptionValue {
  const safe: ExceptionValue = {
    type: typeof value.type === "string" && ERROR_TYPE.test(value.type) ? value.type : "Error",
  };
  if (value.mechanism)
    safe.mechanism = {
      ...(typeof value.mechanism.type === "string" ? { type: value.mechanism.type } : {}),
      ...(typeof value.mechanism.handled === "boolean" ? { handled: value.mechanism.handled } : {}),
    };
  const frames = value.stacktrace?.frames;
  if (Array.isArray(frames))
    safe.stacktrace = { frames: frames.slice(-MAX_FRAMES).map(scrubFrame) };
  return safe;
}

/** Keeps only the runtime and OS name and version, never device or host details. */
function scrubContexts(contexts: ErrorEvent["contexts"]): ErrorEvent["contexts"] | undefined {
  const safe: NonNullable<ErrorEvent["contexts"]> = {};
  for (const key of ["runtime", "os"] as const) {
    const context = contexts?.[key];
    if (!context) continue;
    const kept: Record<string, unknown> = {};
    for (const field of ["name", "version"])
      if (typeof context[field] === "string") kept[field] = context[field];
    if (Object.keys(kept).length) safe[key] = kept;
  }
  return Object.keys(safe).length ? safe : undefined;
}

/**
 * Returns the event reduced to its allowlisted fields, or `null` to drop it.
 * Pass as `beforeSend` to every Sentry SDK.
 */
export function scrubErrorEvent<T extends object>(input: T): T | null {
  const event = input as ErrorEvent;
  const values = event.exception?.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  const safe: ErrorEvent = { exception: { values: values.map(scrubException) } };
  for (const key of ["event_id", "timestamp", "platform", "level", "release", "environment"])
    if (event[key] !== undefined) safe[key] = event[key];
  if (event.sdk) safe.sdk = { name: event.sdk.name, version: event.sdk.version };
  const contexts = scrubContexts(event.contexts);
  if (contexts) safe.contexts = contexts;
  return safe as T;
}

/** Breadcrumbs record URLs, console output and UI text: never kept. */
export function dropBreadcrumb(): null {
  return null;
}

/**
 * Reads the optional reporting settings. Returns `null` (reporting off) when no
 * DSN is set; throws on a DSN that is not an `https` Sentry DSN with a key.
 */
export function errorReportingConfig(input: {
  dsn: string | undefined;
  environment: string | undefined;
  release: string | undefined;
  fallbackEnvironment: string;
}): ErrorReportingConfig | null {
  const dsn = input.dsn?.trim();
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error("SENTRY_DSN must be a Sentry DSN URL");
  }
  if (url.protocol !== "https:" || !url.username || url.password || url.pathname.length < 2)
    throw new Error("SENTRY_DSN must be an https Sentry DSN with a public key");
  return {
    dsn,
    environment: input.environment?.trim() || input.fallbackEnvironment,
    release: input.release?.trim() || undefined,
  };
}

/** The origin events are sent to, for a Content-Security-Policy `connect-src`. */
export function errorReportingOrigin(dsn: string): string {
  return new URL(dsn).origin;
}
