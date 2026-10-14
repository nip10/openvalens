import { describe, expect, test } from "bun:test";

import { CSP_REPORT_PATH as SERVER_CSP_REPORT_PATH } from "../apps/server/src/security-csp-report";
import { CSP_REPORT_PATH, renderSnippet, serverOriginFrom } from "./render-web-security-headers";

const ORIGIN = "https://api.health.example";

describe("serverOriginFrom", () => {
  test("normalises a URL to its origin", () => {
    expect(serverOriginFrom("https://api.health.example/some/path/")).toBe(ORIGIN);
  });

  test.each([undefined, "", "not a url", "javascript:alert(1)", "ftp://api.health.example"])(
    "fails closed on %p",
    (value) => {
      expect(() => serverOriginFrom(value)).toThrow("VITE_SERVER_URL");
    },
  );
});

describe("renderSnippet", () => {
  test("the report path matches the server sink", () => {
    expect(CSP_REPORT_PATH).toBe(SERVER_CSP_REPORT_PATH);
  });

  test("enforce emits the enforced policy, the API origin in connect-src and a Report-To group", () => {
    const snippet = renderSnippet("enforce", ORIGIN);

    expect(snippet).toContain('add_header Content-Security-Policy "default-src');
    expect(snippet).not.toContain("Content-Security-Policy-Report-Only");
    expect(snippet).toContain(`connect-src 'self' api.resend.com api.telegram.org ${ORIGIN};`);
    expect(snippet).toContain("report-to csp-endpoint");
    expect(snippet).not.toContain("'unsafe-eval'");
    expect(snippet).toContain(
      `add_header Report-To "{\\"group\\":\\"csp-endpoint\\",\\"max_age\\":10886400,\\"endpoints\\":[{\\"url\\":\\"${ORIGIN}${CSP_REPORT_PATH}\\"}]}" always;`,
    );
  });

  test("report-only emits the report-only header without a reporting destination", () => {
    const snippet = renderSnippet("report-only", ORIGIN);

    expect(snippet).toContain('add_header Content-Security-Policy-Report-Only "default-src');
    expect(snippet).not.toContain("report-to");
    expect(snippet).not.toContain("Report-To");
  });

  test("every header line is added on error responses too", () => {
    const lines = renderSnippet("enforce", ORIGIN)
      .split("\n")
      .filter((line) => line.startsWith("add_header"));

    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      expect(line.endsWith(" always;")).toBe(true);
    }
  });
});
