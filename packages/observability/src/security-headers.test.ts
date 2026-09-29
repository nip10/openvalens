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
});
