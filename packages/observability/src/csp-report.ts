/**
 * CSP violation-report sanitiser (Issue #127).
 *
 * Pure, dependency-free helpers that turn a raw `application/csp-report` /
 * `application/reports+csp` payload into a PHI-safe row payload. Every value is
 * reduced to a host + path-prefix (never the full URI) or a length-capped
 * scalar, and the CSP policy literal is hashed, never stored. Unknown fields are
 * rejected; `referrer` / `sample` / `script-sample` / `style-sample` are dropped
 * silently.
 *
 * Nothing here reads the environment or logs raw values — the Hono handler in
 * `apps/server` owns transport concerns (status codes, rate limiting, insert).
 */

import { createHash } from "node:crypto";

/** Fields the sanitiser accepts and stores (Decision 2 allow-list). */
export const ACCEPTED_CSP_REPORT_FIELDS = [
  "document-uri",
  "blocked-uri",
  "violated-directive",
  "effective-directive",
  "original-policy",
  "source-file",
  "line-number",
  "column-number",
  "disposition",
] as const;

/** Fields dropped unconditionally and silently (Decision 2 denylist). */
export const SILENTLY_DROPPED_CSP_REPORT_FIELDS = [
  "referrer",
  "sample",
  "script-sample",
  "style-sample",
] as const;

const ACCEPTED_FIELD_SET = new Set<string>(ACCEPTED_CSP_REPORT_FIELDS);
const DROPPED_FIELD_SET = new Set<string>(SILENTLY_DROPPED_CSP_REPORT_FIELDS);

const MAX_HOST_LENGTH = 253;
const MAX_PATH_PREFIX_LENGTH = 1024;
const MAX_DIRECTIVE_LENGTH = 200;
const MAX_SOURCE_FILE_LENGTH = 1024;
const MAX_SOURCE_LINE = 1_000_000;
const MAX_SOURCE_COLUMN = 100_000;

/** Column payload for one accepted `csp_violation_event` row (Decision 3). */
export type SanitisedReport = {
  documentUriHost: string;
  documentUriPathPrefix: string | null;
  violatedDirective: string;
  effectiveDirective: string | null;
  blockedUriHost: string | null;
  blockedUriPathPrefix: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  /** 8-byte blake2b digest of the `original-policy` literal. */
  originalPolicyHash: Uint8Array;
  disposition: "enforce" | "report";
};

export type CspReportErrorCode =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_FIELD"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FIELD";

export type CspReportSanitiseResult = {
  accept?: SanitisedReport;
  /** Names of fields dropped silently (never their values). */
  drop?: string[];
  error?: { code: CspReportErrorCode; message: string };
};

/** Coerced host + path-prefix of a URI, or `null`s when it must not be stored. */
export type HostPath = { host: string | null; pathPrefix: string | null };

/**
 * Coerces a URI to `{ host, pathPrefix }`.
 *
 * Only absolute `http(s)` URLs yield a host; everything else (scheme-less
 * relative paths, `javascript:`/`data:`/`blob:` values, `inline`, `eval`, and
 * unparseable input) yields `{ host: null, pathPrefix: null }` so the value is
 * recorded as a violation but never persisted. `pathPrefix` keeps at most the
 * first two path segments so a deep URL never leaks its full path.
 */
export function toHostPath(uri: string): HostPath {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { host: null, pathPrefix: null };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { host: null, pathPrefix: null };
  }

  const host = url.host;
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) {
    return { host: null, pathPrefix: null };
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const pathPrefix = segments.length > 0 ? `/${segments.slice(0, 2).join("/")}` : "/";

  return {
    host,
    pathPrefix: pathPrefix.length <= MAX_PATH_PREFIX_LENGTH ? pathPrefix : null,
  };
}

/**
 * Normalized web origin (`scheme://host[:port]`) a `CORS_ORIGIN` value yields.
 * Mirrors `apps/server/src/context.ts` — an unparseable value returns
 * `undefined`, which makes the origin gate fail closed.
 */
export function expectedOriginFrom(corsOrigin: string): string | undefined {
  try {
    return new URL(corsOrigin).origin;
  } catch {
    return undefined;
  }
}

/**
 * Compares an inbound `Origin` header to the expected origin. A missing header
 * reports `"missing"`; anything that is not an exact match (including an
 * unconfigured expected origin) reports `"mismatch"`. The raw header value is
 * never returned in the reason.
 */
export function checkOrigin(
  originHeader: string | null | undefined,
  expectedOrigin: string | undefined,
): { ok: boolean; reason?: "missing" | "mismatch" } {
  if (!originHeader) {
    return { ok: false, reason: "missing" };
  }

  if (!expectedOrigin || originHeader !== expectedOrigin) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoundedInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  return value >= 0 && value <= max ? value : null;
}

function hashPolicy(policy: string): Uint8Array {
  return createHash("blake2b512").update(policy, "utf8").digest().subarray(0, 8);
}

function capSourceFile(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > MAX_SOURCE_FILE_LENGTH) {
    return null;
  }
  return value;
}

/**
 * Sanitises one CSP violation report.
 *
 * @param rawBody The report object (a bare report, `{ "csp-report": … }`, or a
 *   single Reporting API `{ body: … }` item). Use {@link extractCspReports} to
 *   normalise a full request body first.
 */
export function sanitiseCspReport(rawBody: unknown): CspReportSanitiseResult {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { error: { code: "NOT_AN_OBJECT", message: "CSP report body must be an object." } };
  }

  const report = rawBody as Record<string, unknown>;
  const drop: string[] = [];

  for (const key of Object.keys(report)) {
    if (DROPPED_FIELD_SET.has(key)) {
      drop.push(key);
      continue;
    }
    if (!ACCEPTED_FIELD_SET.has(key)) {
      return {
        drop,
        error: { code: "UNKNOWN_FIELD", message: "CSP report contained an unsupported field." },
      };
    }
  }

  const documentUri = asString(report["document-uri"]);
  const violatedDirective = asString(report["violated-directive"]);
  const originalPolicy = asString(report["original-policy"]);

  if (!documentUri || !violatedDirective || !originalPolicy) {
    return {
      drop,
      error: {
        code: "MISSING_REQUIRED_FIELD",
        message: "CSP report is missing a required field.",
      },
    };
  }

  const documentUriParts = toHostPath(documentUri);
  if (!documentUriParts.host) {
    return {
      drop,
      error: {
        code: "INVALID_FIELD",
        message: "CSP report document-uri is not an absolute http(s) URL.",
      },
    };
  }

  if (violatedDirective.length === 0 || violatedDirective.length > MAX_DIRECTIVE_LENGTH) {
    return {
      drop,
      error: { code: "INVALID_FIELD", message: "CSP report violated-directive is out of range." },
    };
  }

  const effectiveDirectiveRaw = asString(report["effective-directive"]);
  const effectiveDirective =
    effectiveDirectiveRaw && effectiveDirectiveRaw.length <= MAX_DIRECTIVE_LENGTH
      ? effectiveDirectiveRaw
      : null;

  const blockedUriRaw = asString(report["blocked-uri"]);
  const blockedUriParts = blockedUriRaw
    ? toHostPath(blockedUriRaw)
    : { host: null, pathPrefix: null };

  let disposition: "enforce" | "report" = "report";
  const dispositionRaw = report["disposition"];
  if (typeof dispositionRaw !== "undefined") {
    if (dispositionRaw !== "enforce" && dispositionRaw !== "report") {
      return {
        drop,
        error: { code: "INVALID_FIELD", message: "CSP report disposition is not supported." },
      };
    }
    disposition = dispositionRaw;
  }

  const sourceLine = asBoundedInt(report["line-number"], MAX_SOURCE_LINE);
  const sourceColumn = asBoundedInt(report["column-number"], MAX_SOURCE_COLUMN);

  return {
    accept: {
      documentUriHost: documentUriParts.host,
      documentUriPathPrefix: documentUriParts.pathPrefix,
      violatedDirective,
      effectiveDirective,
      blockedUriHost: blockedUriParts.host,
      blockedUriPathPrefix: blockedUriParts.pathPrefix,
      sourceFile: capSourceFile(asString(report["source-file"])),
      sourceLine,
      sourceColumn,
      originalPolicyHash: hashPolicy(originalPolicy),
      disposition,
    },
    drop,
  };
}

/**
 * Normalises a parsed request body into a list of report objects.
 *
 * Supports the legacy `{ "csp-report": {…} }` envelope, the Reporting API array
 * of `{ type: "csp-violation", body: {…} }` items and a bare report object.
 */
export function extractCspReports(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body.map((item) => {
      if (item && typeof item === "object" && "body" in (item as Record<string, unknown>)) {
        return (item as Record<string, unknown>).body;
      }
      return item;
    });
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if ("csp-report" in record) {
      return [record["csp-report"]];
    }
    if ("type" in record && "body" in record) {
      return [record.body];
    }
    return [record];
  }

  return [body];
}
