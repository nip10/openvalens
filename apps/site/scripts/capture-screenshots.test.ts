import { describe, expect, test } from "bun:test";

import { HIDE_DEVTOOLS_CSS, loopbackBaseUrl, sessionSource, SHOTS } from "./capture-screenshots";

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

describe("sessionSource", () => {
  test("prefers a loopback dev magic link", () => {
    const source = sessionSource({
      SITE_SCREENSHOT_MAGIC_LINK: "http://localhost:3000/api/auth/magic-link/verify?token=x",
      SITE_SCREENSHOT_STORAGE_STATE: "/tmp/state.json",
    });
    expect(source.kind).toBe("magic-link");
  });

  test("falls back to a storage-state file", () => {
    expect(sessionSource({ SITE_SCREENSHOT_STORAGE_STATE: "/tmp/state.json" })).toEqual({
      kind: "storage-state",
      path: "/tmp/state.json",
    });
  });

  test.each(["https://health.example.org/api/auth/magic-link/verify?token=x", "not a url"])(
    "refuses the magic link %p",
    (link) => {
      expect(() => sessionSource({ SITE_SCREENSHOT_MAGIC_LINK: link })).toThrow();
    },
  );

  test("requires one of the two", () => {
    expect(() => sessionSource({})).toThrow();
  });
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
