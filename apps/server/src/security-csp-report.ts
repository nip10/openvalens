/**
 * CSP violation sink (Issue #127).
 *
 * `POST /api/security/csp-report` accepts an `application/csp-report`
 * (legacy `report-uri`) or `application/reports+csp` (Reporting API) payload,
 * sanitises it via {@link sanitiseCspReport} and appends one metadata-only row
 * per violation to `csp_violation_event`.
 *
 * The handler factory takes its dependencies (logger, rate limiter, origin,
 * insert, mode) so it can be unit-tested without booting the server or touching
 * the environment. `apps/server/src/index.ts` performs the bindings.
 *
 * Security posture:
 * - an `Origin` header must exactly match `CORS_ORIGIN` (fail closed);
 * - bodies are capped at 16 KiB inline (no upstream body-size middleware);
 * - only counts, lengths and codes are logged — never report values.
 */

import { type InMemoryRateLimiter } from "@openvalens/ai/rate-limit";
import {
  checkOrigin,
  extractCspReports,
  type SanitisedReport,
  type StructuredLogger,
  sanitiseCspReport,
} from "@openvalens/observability";
import type { Context } from "hono";

import { EXPLICIT_CSP_MODE } from "./csp-mode-capture";

// Re-export so consumers can read the snapshot through this module too.
export { EXPLICIT_CSP_MODE } from "./csp-mode-capture";

/** Route path shared by the mount point and the `report-to` destination URL. */
export const CSP_REPORT_PATH = "/api/security/csp-report";

/** Inline body cap (bytes); there is no upstream body-size middleware. */
export const CSP_REPORT_MAX_BODY_BYTES = 16 * 1024;

const ACCEPTED_CONTENT_TYPES = new Set(["application/csp-report", "application/reports+csp"]);

/**
 * Resolves the effective CSP mode. An explicit `CSP_MODE` always wins;
 * otherwise production defaults to `enforce` and every other environment to the
 * schema-resolved value (`report-only`).
 */
export function resolveCspMode(
  nodeEnv: string,
  cspMode: "enforce" | "report-only",
): "enforce" | "report-only" {
  if (EXPLICIT_CSP_MODE === "enforce" || EXPLICIT_CSP_MODE === "report-only") {
    return EXPLICIT_CSP_MODE;
  }
  return nodeEnv === "production" ? "enforce" : cspMode;
}

/** One `csp_violation_event` insert row. */
export type CspViolationRow = SanitisedReport & {
  cspModeAtEmit: "enforce" | "report-only";
  correlationId: string;
};

export type CspReportHandlerDeps = {
  logger: StructuredLogger;
  expectedOrigin: string | undefined;
  cspMode: "enforce" | "report-only";
  rateLimiter: InMemoryRateLimiter;
  insert: (rows: CspViolationRow[]) => Promise<void>;
};

function mimeOf(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function createCspReportHandler(
  deps: CspReportHandlerDeps,
): (c: Context) => Promise<Response> {
  return async (c) => {
    const correlationId = c.get("correlationId");

    const contentType = mimeOf(c.req.header("content-type"));
    if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
      deps.logger.warn("csp.report.rejected.content-type", {
        correlationId,
        contentTypeLength: (c.req.header("content-type") ?? "").length,
      });
      return c.json({ error: "UNSUPPORTED_CONTENT_TYPE" }, 415);
    }

    const originHeader = c.req.header("origin");
    const originCheck = checkOrigin(originHeader, deps.expectedOrigin);
    if (!originCheck.ok) {
      deps.logger.warn(
        originCheck.reason === "missing"
          ? "csp.report.rejected.origin-missing"
          : "csp.report.rejected.origin-mismatch",
        { correlationId, originHeaderLength: (originHeader ?? "").length },
      );
      return c.json({ error: "ORIGIN_REJECTED" }, 400);
    }

    const decision = deps.rateLimiter.check(`${correlationId}::${originHeader}`);
    if (!decision.allowed) {
      deps.logger.warn("csp.report.rate-limited", {
        correlationId,
        retryAfterMs: decision.retryAfterMs ?? 0,
      });
      return c.json({ error: "RATE_LIMITED" }, 429);
    }

    const raw = await c.req.text();
    if (raw.length > CSP_REPORT_MAX_BODY_BYTES) {
      deps.logger.warn("csp.report.rejected.body-too-large", {
        correlationId,
        bodyLength: raw.length,
      });
      return c.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      deps.logger.warn("csp.report.rejected.invalid-json", {
        correlationId,
        bodyLength: raw.length,
      });
      return c.json({ error: "INVALID_JSON" }, 400);
    }

    const rows: CspViolationRow[] = [];
    let droppedFieldCount = 0;

    for (const report of extractCspReports(parsed)) {
      const result = sanitiseCspReport(report);
      droppedFieldCount += result.drop?.length ?? 0;

      if (result.error) {
        deps.logger.warn("csp.report.rejected.invalid-report", {
          correlationId,
          code: result.error.code,
          droppedFieldCount,
        });
        return c.json({ error: "INVALID_REPORT" }, 400);
      }

      rows.push({
        ...(result.accept as SanitisedReport),
        cspModeAtEmit: deps.cspMode,
        correlationId,
      });
    }

    if (rows.length === 0) {
      deps.logger.warn("csp.report.rejected.invalid-report", {
        correlationId,
        code: "EMPTY_REPORT",
        droppedFieldCount,
      });
      return c.json({ error: "INVALID_REPORT" }, 400);
    }

    try {
      await deps.insert(rows);
    } catch (error) {
      deps.logger.error("csp.report.persist-failed", { correlationId, error });
      return c.json({ error: "PERSIST_FAILED" }, 500);
    }

    deps.logger.info("csp.report.accepted", {
      correlationId,
      reportCount: rows.length,
      droppedFieldCount,
      bodyLength: raw.length,
    });

    return c.body(null, 204);
  };
}
