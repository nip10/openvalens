import { describe, expect, test } from "bun:test";

import { buildSecurityHeaders } from "./security-headers";

const ENFORCE_HEADER = "Content-Security-Policy";
const REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

describe("buildSecurityHeaders", () => {
  test("default (enforce) mode emits Content-Security-Policy, not the report-only header", () => {
    const headers = buildSecurityHeaders({ cspMode: "enforce" });

    expect(headers[ENFORCE_HEADER]).toBeDefined();
    expect(headers[REPORT_ONLY_HEADER]).toBeUndefined();
  });

  test("report-only mode emits Content-Security-Policy-Report-Only, not the enforce header", () => {
    const headers = buildSecurityHeaders({ cspMode: "report-only" });

    expect(headers[REPORT_ONLY_HEADER]).toBeDefined();
    expect(headers[ENFORCE_HEADER]).toBeUndefined();
  });

  test("allowDevScriptEval=true includes 'unsafe-eval' in script-src", () => {
    const csp = buildSecurityHeaders({ cspMode: "enforce", allowDevScriptEval: true })[
      ENFORCE_HEADER
    ];

    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  test("allowDevScriptEval=false omits 'unsafe-eval' from script-src", () => {
    const csp = buildSecurityHeaders({ cspMode: "enforce", allowDevScriptEval: false })[
      ENFORCE_HEADER
    ];

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  test("defaults to allowing dev script eval when the flag is omitted", () => {
    const csp = buildSecurityHeaders({ cspMode: "enforce" })[ENFORCE_HEADER];

    expect(csp).toContain("'unsafe-eval'");
  });

  test("CSP always includes frame-ancestors 'none' and the connect-src allowlist", () => {
    for (const cspMode of ["enforce", "report-only"] as const) {
      const headers = buildSecurityHeaders({ cspMode, allowDevScriptEval: false });
      const csp = headers[cspMode === "enforce" ? ENFORCE_HEADER : REPORT_ONLY_HEADER];

      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("connect-src 'self' api.resend.com api.telegram.org");
    }
  });

  test("CSP includes the remaining hardened directives", () => {
    const csp = buildSecurityHeaders({ cspMode: "enforce" })[ENFORCE_HEADER];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  test("always emits the static security headers", () => {
    const headers = buildSecurityHeaders({ cspMode: "enforce" });

    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    );
  });

  test("always emits same-origin COOP and CORP", () => {
    const headers = buildSecurityHeaders({ cspMode: "report-only" });

    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  test("reportToGroup alone emits the report-to directive but no Report-To header", () => {
    const headers = buildSecurityHeaders({ cspMode: "enforce", reportToGroup: "csp-endpoint" });

    expect(headers[ENFORCE_HEADER]).toContain("report-to csp-endpoint");
    expect(headers["Report-To"]).toBeUndefined();
  });

  test("reportToGroup + reportToUrl emit the group token, a report-uri fallback and both endpoint headers", () => {
    const headers = buildSecurityHeaders({
      cspMode: "enforce",
      reportToGroup: "csp-endpoint",
      reportToUrl: "/api/security/csp-report",
    });

    expect(headers[ENFORCE_HEADER]).toContain(
      "report-to csp-endpoint; report-uri /api/security/csp-report",
    );
    expect(headers["Reporting-Endpoints"]).toBe('csp-endpoint="/api/security/csp-report"');

    const parsed = JSON.parse(headers["Report-To"] ?? "{}") as {
      group?: string;
      max_age?: number;
      endpoints?: Array<{ url?: string }>;
    };
    expect(parsed.group).toBe("csp-endpoint");
    expect(parsed.max_age).toBe(10886400);
    expect(parsed.endpoints?.[0]?.url).toBe("/api/security/csp-report");
  });

  test("distinct group and URL are not conflated", () => {
    const headers = buildSecurityHeaders({
      cspMode: "enforce",
      reportToGroup: "token-group",
      reportToUrl: "https://collector.example/report",
    });

    expect(headers[ENFORCE_HEADER]).toContain("report-to token-group");
    const parsed = JSON.parse(headers["Report-To"] ?? "{}") as {
      group?: string;
      endpoints?: Array<{ url?: string }>;
    };
    expect(parsed.group).toBe("token-group");
    expect(parsed.endpoints?.[0]?.url).toBe("https://collector.example/report");
  });

  test("reportToGroup on report-only emits no report-to directive or Report-To header", () => {
    const headers = buildSecurityHeaders({
      cspMode: "report-only",
      reportToGroup: "csp-endpoint",
      reportToUrl: "/api/security/csp-report",
    });

    expect(headers[REPORT_ONLY_HEADER]).toBeDefined();
    expect(headers[REPORT_ONLY_HEADER]).not.toContain("report-to");
    expect(headers[REPORT_ONLY_HEADER]).not.toContain("report-uri");
    expect(headers["Report-To"]).toBeUndefined();
    expect(headers["Reporting-Endpoints"]).toBeUndefined();
  });

  test("additionalConnectSrc is appended after the base connect-src allowlist", () => {
    const csp = buildSecurityHeaders({
      cspMode: "enforce",
      additionalConnectSrc: ["https://api.example.com"],
    })[ENFORCE_HEADER];

    expect(csp).toContain(
      "connect-src 'self' api.resend.com api.telegram.org https://api.example.com;",
    );
  });
});
