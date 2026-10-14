import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai/rate-limit";
import {
  checkOrigin,
  correlationMiddleware,
  createStructuredLogger,
  expectedOriginFrom,
  sanitiseCspReport,
  toHostPath,
} from "@openvalens/observability";
import { Hono } from "hono";

import {
  CSP_REPORT_MAX_BODY_BYTES,
  CSP_REPORT_PATH,
  type CspReportHandlerDeps,
  type CspViolationRow,
  createCspReportHandler,
} from "./security-csp-report";

const EXPECTED_ORIGIN = "http://localhost:3000";

type Harness = {
  app: Hono;
  inserted: CspViolationRow[][];
  logs: string[];
};

function buildHarness(overrides: Partial<CspReportHandlerDeps> = {}): Harness {
  const inserted: CspViolationRow[][] = [];
  const logs: string[] = [];
  const logger = createStructuredLogger({
    level: "info",
    sink: (_level, line) => logs.push(line),
  });

  const deps: CspReportHandlerDeps = {
    logger,
    expectedOrigin: EXPECTED_ORIGIN,
    cspMode: "enforce",
    rateLimiter: new InMemoryRateLimiter({ limitPerMinute: 60 }),
    insert: async (rows) => {
      inserted.push(rows);
    },
    ...overrides,
  };

  const app = new Hono();
  app.use(correlationMiddleware());
  app.post(CSP_REPORT_PATH, createCspReportHandler(deps));

  return { app, inserted, logs };
}

function reportBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    "csp-report": {
      "document-uri": "https://example.com/abc/def/ghi",
      "blocked-uri": "https://cdn.example.net/x/y/z.js",
      "violated-directive": "script-src 'self'",
      "effective-directive": "script-src-elem",
      "original-policy": "default-src 'self'; script-src 'self'",
      "source-file": "https://example.com/abc/def/app.js",
      "line-number": 12,
      "column-number": 34,
      disposition: "enforce",
      ...extra,
    },
  });
}

async function post(
  app: Hono,
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(CSP_REPORT_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/csp-report",
      origin: EXPECTED_ORIGIN,
      "x-correlation-id": "corr-1",
      ...headers,
    },
    body,
  });
}

describe("sanitiseCspReport allow-list", () => {
  test("accepts a well-formed report and coerces URIs to host + path-prefix", () => {
    const result = sanitiseCspReport({
      "document-uri": "https://example.com/abc/def/ghi",
      "blocked-uri": "https://cdn.example.net/x/y/z.js",
      "violated-directive": "script-src 'self'",
      "effective-directive": "script-src-elem",
      "original-policy": "default-src 'self'",
      "source-file": "https://example.com/app.js",
      "line-number": 12,
      "column-number": 34,
      disposition: "enforce",
    });

    expect(result.error).toBeUndefined();
    expect(result.accept?.documentUriHost).toBe("example.com");
    expect(result.accept?.documentUriPathPrefix).toBe("/abc/def");
    expect(result.accept?.blockedUriHost).toBe("cdn.example.net");
    expect(result.accept?.blockedUriPathPrefix).toBe("/x/y");
    expect(result.accept?.disposition).toBe("enforce");
    expect(result.accept?.originalPolicyHash).toBeInstanceOf(Uint8Array);
    expect(result.accept?.originalPolicyHash.length).toBe(8);
  });

  test("rejects an unknown field", () => {
    const result = sanitiseCspReport({
      "document-uri": "https://example.com/abc",
      "violated-directive": "script-src 'self'",
      "original-policy": "default-src 'self'",
      "totally-unknown": "SECRET",
    });

    expect(result.accept).toBeUndefined();
    expect(result.error?.code).toBe("UNKNOWN_FIELD");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("silently drops referrer, sample, script-sample and style-sample", () => {
    const result = sanitiseCspReport({
      sample: "SAMPLE_SECRET",
      referrer: "https://phi.example/patient/1",
      "script-sample": "SCRIPT_SAMPLE_SECRET",
      "style-sample": "STYLE_SAMPLE_SECRET",
      "document-uri": "https://example.com/abc",
      "violated-directive": "script-src 'self'",
      "original-policy": "default-src 'self'",
    });

    expect(result.error).toBeUndefined();
    expect(result.drop?.sort()).toEqual(["referrer", "sample", "script-sample", "style-sample"]);
    expect(JSON.stringify(result)).not.toContain("SAMPLE_SECRET");
    expect(JSON.stringify(result)).not.toContain("phi.example");
  });

  test("rejects a report that is not an object", () => {
    expect(sanitiseCspReport("nope").error?.code).toBe("NOT_AN_OBJECT");
    expect(sanitiseCspReport(null).error?.code).toBe("NOT_AN_OBJECT");
  });
});

describe("toHostPath", () => {
  test("keeps only the host and the first two path segments", () => {
    expect(toHostPath("https://example.com/abc/def/ghi")).toEqual({
      host: "example.com",
      pathPrefix: "/abc/def",
    });
  });

  test("returns nulls for non-http(s) and unparseable values", () => {
    expect(toHostPath("javascript:alert(1)")).toEqual({ host: null, pathPrefix: null });
    expect(toHostPath("inline")).toEqual({ host: null, pathPrefix: null });
    expect(toHostPath("data:text/html,<b/>")).toEqual({ host: null, pathPrefix: null });
    expect(toHostPath("not a url")).toEqual({ host: null, pathPrefix: null });
  });
});

describe("origin helpers", () => {
  test("expectedOriginFrom normalizes and fails closed on garbage", () => {
    expect(expectedOriginFrom("http://localhost:3000")).toBe("http://localhost:3000");
    expect(expectedOriginFrom("not-a-url")).toBeUndefined();
  });

  test("checkOrigin reports missing and mismatch", () => {
    expect(checkOrigin(null, EXPECTED_ORIGIN)).toEqual({ ok: false, reason: "missing" });
    expect(checkOrigin("https://evil.example", EXPECTED_ORIGIN)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(checkOrigin(EXPECTED_ORIGIN, EXPECTED_ORIGIN)).toEqual({ ok: true });
  });
});

describe("POST /api/security/csp-report", () => {
  test("rejects an unsupported content type with 415", async () => {
    const { app, inserted } = buildHarness();
    const response = await post(app, reportBody(), { "content-type": "application/json" });

    expect(response.status).toBe(415);
    expect(inserted.length).toBe(0);
  });

  test("rejects a body larger than 16 KiB with 413", async () => {
    const { app, inserted } = buildHarness();
    const response = await post(app, "x".repeat(CSP_REPORT_MAX_BODY_BYTES + 1));

    expect(response.status).toBe(413);
    expect(inserted.length).toBe(0);
  });

  test("rejects a missing Origin with 400 and a structured log", async () => {
    const { app, inserted, logs } = buildHarness();
    const response = await post(app, reportBody(), { origin: "" });

    expect(response.status).toBe(400);
    expect(inserted.length).toBe(0);
    expect(logs.join("\n")).toContain("csp.report.rejected.origin-missing");
  });

  test("rejects a mismatched Origin with 400 and logs only the length", async () => {
    const { app, inserted, logs } = buildHarness();
    const response = await post(app, reportBody(), { origin: "https://evil.example" });

    expect(response.status).toBe(400);
    expect(inserted.length).toBe(0);
    const joined = logs.join("\n");
    expect(joined).toContain("csp.report.rejected.origin-mismatch");
    expect(joined).toContain("originHeaderLength");
    expect(joined).not.toContain("evil.example");
  });

  test("accepts a valid report with 204 and inserts a redacted row", async () => {
    const { app, inserted, logs } = buildHarness();
    const policyLiteral = "default-src 'self'; script-src 'self'";
    const response = await post(app, reportBody());

    expect(response.status).toBe(204);
    expect(inserted.length).toBe(1);

    const row = inserted[0]?.[0];
    expect(row?.documentUriHost).toBe("example.com");
    expect(row?.documentUriPathPrefix).toBe("/abc/def");
    expect(row?.cspModeAtEmit).toBe("enforce");
    expect(row?.correlationId).toBe("corr-1");
    expect(row?.originalPolicyHash).toBeInstanceOf(Uint8Array);
    expect(row?.originalPolicyHash.length).toBe(8);

    expect(JSON.stringify(inserted)).not.toContain(policyLiteral);
    expect(logs.join("\n")).not.toContain(policyLiteral);
    expect(logs.join("\n")).toContain("csp.report.accepted");
  });

  test("rejects an unknown field with 400 and never logs report values", async () => {
    const { app, inserted, logs } = buildHarness();
    const response = await post(
      app,
      reportBody({ sample: "SAMPLE_SECRET", "totally-unknown": "UNKNOWN_SECRET" }),
    );

    expect(response.status).toBe(400);
    expect(inserted.length).toBe(0);
    const joined = logs.join("\n");
    expect(joined).toContain("csp.report.rejected.invalid-report");
    expect(joined).toContain("droppedFieldCount");
    expect(joined).not.toContain("SAMPLE_SECRET");
    expect(joined).not.toContain("UNKNOWN_SECRET");
  });

  test("silently drops sample fields and still accepts the report", async () => {
    const { app, inserted, logs } = buildHarness();
    const response = await post(
      app,
      reportBody({
        referrer: "https://phi.example/patient/1",
        sample: "SAMPLE_SECRET",
        "script-sample": "SCRIPT_SAMPLE_SECRET",
        "style-sample": "STYLE_SAMPLE_SECRET",
      }),
    );

    expect(response.status).toBe(204);
    expect(inserted.length).toBe(1);
    const joined = logs.join("\n");
    expect(joined).not.toContain("phi.example");
    expect(joined).not.toContain("SAMPLE_SECRET");
  });

  test("rejects malformed JSON with 400", async () => {
    const { app, inserted } = buildHarness();
    const response = await post(app, "{not json");

    expect(response.status).toBe(400);
    expect(inserted.length).toBe(0);
  });

  test("denies after the per-key budget without inserting a row", async () => {
    const { app, inserted } = buildHarness();

    for (let i = 0; i < 60; i += 1) {
      const response = await post(app, reportBody());
      expect(response.status).toBe(204);
    }
    expect(inserted.length).toBe(60);

    const denied = await post(app, reportBody());
    expect(denied.status).toBe(429);
    expect(inserted.length).toBe(60);
  });

  test("the budget binds per origin even when every report gets its own correlation id", async () => {
    const { app, inserted } = buildHarness();

    for (let i = 0; i < 60; i += 1) {
      const response = await post(app, reportBody(), { "x-correlation-id": `corr-${i}` });
      expect(response.status).toBe(204);
    }

    const denied = await post(app, reportBody(), { "x-correlation-id": "corr-fresh" });
    expect(denied.status).toBe(429);
    expect(inserted.length).toBe(60);
  });

  test("accepts a legacy report-uri payload as Chromium sends it (status-code dropped)", async () => {
    const { app, inserted } = buildHarness();
    const response = await post(
      app,
      reportBody({ referrer: "", "status-code": 200, "script-sample": "" }),
    );

    expect(response.status).toBe(204);
    expect(inserted.length).toBe(1);
  });

  test("accepts a Reporting API batch and skips non-CSP report types", async () => {
    const { app, inserted } = buildHarness();
    const batch = [
      {
        type: "csp-violation",
        age: 10,
        url: "https://example.com/login",
        user_agent: "Mozilla/5.0",
        body: {
          documentURL: "https://example.com/login",
          referrer: "",
          blockedURL: "https://blocked.example/probe.png?secret=1",
          effectiveDirective: "img-src",
          originalPolicy: "default-src 'self'; img-src 'self'",
          sourceFile: "https://example.com/assets/index.js",
          sample: "",
          disposition: "enforce",
          statusCode: 200,
          lineNumber: 1,
          columnNumber: 2,
        },
      },
      { type: "deprecation", age: 1, url: "https://example.com/", body: { id: "x" } },
    ];
    const response = await post(app, JSON.stringify(batch), {
      "content-type": "application/reports+json",
    });

    expect(response.status).toBe(204);
    expect(inserted.length).toBe(1);
    expect(inserted[0]?.length).toBe(1);
    const row = inserted[0]?.[0];
    expect(row?.violatedDirective).toBe("img-src");
    expect(row?.blockedUriHost).toBe("blocked.example");
    expect(JSON.stringify(inserted)).not.toContain("secret");
  });
});
