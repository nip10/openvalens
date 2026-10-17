import { describe, expect, test } from "bun:test";

import { loopbackBaseUrl } from "./capture-screenshots";

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
