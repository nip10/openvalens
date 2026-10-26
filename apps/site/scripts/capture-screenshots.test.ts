import { describe, expect, test } from "bun:test";

import { HIDE_DEVTOOLS_CSS, loopbackBaseUrl, SHOTS } from "./capture-screenshots";

describe("loopbackBaseUrl", () => {
  test.each(["http://localhost:3001", "http://127.0.0.1:3001/", "https://[::1]:8443"])(
    "accepts the local instance %s",
    (value) => {
      expect(loopbackBaseUrl(value).href).toStartWith(value.replace(/\/$/, ""));
    },
  );

  test.each([undefined, "", "health.example.org", "https://health.example.org", "file:///tmp"])(
    "refuses %p so a real instance is never captured",
    (value) => {
      expect(() => loopbackBaseUrl(value)).toThrow();
    },
  );
});

describe("SHOTS", () => {
  test("names are unique, file-safe and paths are app routes", () => {
    const names = SHOTS.map((shot) => shot.name);
    expect(new Set(names).size).toBe(names.length);
    for (const shot of SHOTS) {
      expect(shot.name).toMatch(/^[a-z0-9-]+$/);
      expect(shot.path).toStartWith("/");
    }
  });

  test("hides both devtools toggles", () => {
    expect(HIDE_DEVTOOLS_CSS).toContain(".TanStackRouterDevtools");
    expect(HIDE_DEVTOOLS_CSS).toContain(".tsqd-open-btn-container");
  });
});
