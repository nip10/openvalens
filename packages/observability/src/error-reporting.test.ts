import { describe, expect, test } from "bun:test";

import {
  dropBreadcrumb,
  errorReportingConfig,
  errorReportingOrigin,
  scrubErrorEvent,
  type ErrorEvent,
} from "./error-reporting";

const EMAIL = "ana.silva@example.test";
const SUBJECT_ID = "user_8f3a2c";
const METRIC = "systolic 142 mmHg";

/** An event as an SDK would build it for a failure while saving a reading. */
function realisticEvent(): ErrorEvent {
  return {
    event_id: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    timestamp: 1_790_000_000,
    platform: "node",
    level: "error",
    release: "openvalens@abc1234",
    environment: "production",
    server_name: "vps-ana-home",
    message: `Could not save ${METRIC} for ${EMAIL}`,
    transaction: `/rpc/vitals/save?subject=${SUBJECT_ID}`,
    sdk: { name: "sentry.javascript.bun", version: "11.7.0" },
    exception: {
      values: [
        {
          type: "VitalsSaveError",
          value: `Reading ${METRIC} rejected for ${SUBJECT_ID} (${EMAIL})`,
          mechanism: { type: "onunhandledrejection", handled: false, data: { email: EMAIL } },
          stacktrace: {
            frames: [
              {
                filename: `https://app.example.test/assets/index.js?subject=${SUBJECT_ID}#frag`,
                function: "saveReading",
                lineno: 12,
                colno: 7,
                in_app: true,
                vars: { email: EMAIL, value: 142 },
                pre_context: [`const email = "${EMAIL}";`],
                context_line: "throw new VitalsSaveError(message);",
              },
            ],
          },
        },
      ],
    },
    request: {
      url: `https://api.example.test/rpc/vitals/save?subject=${SUBJECT_ID}`,
      method: "POST",
      data: JSON.stringify({ email: EMAIL, systolic: 142 }),
      headers: { authorization: "Bearer secret", cookie: "session=secret" },
      query_string: `subject=${SUBJECT_ID}`,
    },
    user: { id: SUBJECT_ID, email: EMAIL, ip_address: "203.0.113.7" },
    extra: { reading: { systolic: 142 }, email: EMAIL },
    tags: { subject: SUBJECT_ID },
    breadcrumbs: [{ category: "fetch", data: { url: `/rpc/vitals?email=${EMAIL}` } }],
    fingerprint: [EMAIL],
    contexts: {
      runtime: { name: "bun", version: "1.4.2" },
      os: { name: "Linux", version: "6.8", kernel_version: "vps-ana-home" },
      device: { name: "Ana's iPhone" },
      trace: { trace_id: "abc" },
    },
  };
}

describe("scrubErrorEvent", () => {
  test("strips the id, email and metric value from every field", () => {
    const scrubbed = scrubErrorEvent(realisticEvent());
    const serialized = JSON.stringify(scrubbed);
    for (const secret of [
      EMAIL,
      SUBJECT_ID,
      "142",
      "systolic",
      "Bearer",
      "session=",
      "203.0.113.7",
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("vps-ana-home");
    expect(serialized).not.toContain("iPhone");
  });

  test("keeps what is needed to locate the failing code", () => {
    expect(scrubErrorEvent(realisticEvent())).toEqual({
      event_id: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      timestamp: 1_790_000_000,
      platform: "node",
      level: "error",
      release: "openvalens@abc1234",
      environment: "production",
      sdk: { name: "sentry.javascript.bun", version: "11.7.0" },
      exception: {
        values: [
          {
            type: "VitalsSaveError",
            mechanism: { type: "onunhandledrejection", handled: false },
            stacktrace: {
              frames: [
                {
                  filename: "https://app.example.test/assets/index.js",
                  function: "saveReading",
                  lineno: 12,
                  colno: 7,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      contexts: {
        runtime: { name: "bun", version: "1.4.2" },
        os: { name: "Linux", version: "6.8" },
      },
    });
  });

  test("replaces an exception type that is not an identifier", () => {
    const event = realisticEvent();
    event.exception!.values![0]!.type = `Invalid reading for ${EMAIL}`;
    expect(scrubErrorEvent(event)?.exception?.values?.[0]?.type).toBe("Error");
  });

  test("drops events without an exception and every breadcrumb", () => {
    expect(scrubErrorEvent({ message: `Hello ${EMAIL}` })).toBeNull();
    expect(scrubErrorEvent({ exception: { values: [] } })).toBeNull();
    expect(dropBreadcrumb()).toBeNull();
  });
});

describe("errorReportingConfig", () => {
  const base = { environment: undefined, release: undefined, fallbackEnvironment: "production" };

  test("is off without a DSN", () => {
    expect(errorReportingConfig({ ...base, dsn: undefined })).toBeNull();
    expect(errorReportingConfig({ ...base, dsn: "  " })).toBeNull();
  });

  test("reads the DSN, environment and release", () => {
    expect(
      errorReportingConfig({
        dsn: "https://abc123@o1.ingest.de.sentry.io/42",
        environment: "staging",
        release: "openvalens@abc1234",
        fallbackEnvironment: "production",
      }),
    ).toEqual({
      dsn: "https://abc123@o1.ingest.de.sentry.io/42",
      environment: "staging",
      release: "openvalens@abc1234",
    });
    expect(
      errorReportingConfig({ ...base, dsn: "https://abc123@sentry.example.test/7" })?.environment,
    ).toBe("production");
    expect(errorReportingOrigin("https://abc123@o1.ingest.de.sentry.io/42")).toBe(
      "https://o1.ingest.de.sentry.io",
    );
  });

  test("rejects a DSN that is not https or has no key or project", () => {
    for (const dsn of [
      "not a url",
      "http://abc@sentry.example.test/1",
      "https://sentry.example.test/1",
      "https://abc:secret@sentry.example.test/1",
      "https://abc@sentry.example.test/",
    ])
      expect(() => errorReportingConfig({ ...base, dsn })).toThrow("SENTRY_DSN");
  });
});
