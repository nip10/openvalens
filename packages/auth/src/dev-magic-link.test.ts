import { describe, expect, spyOn, test } from "bun:test";

import { devMagicLinkSink } from "./index";

const base = {
  BETTER_AUTH_URL: "http://x",
  BETTER_AUTH_SECRET: "s".repeat(32),
  CORS_ORIGIN: "http://y",
};

describe("devMagicLinkSink", () => {
  test("off when the explicit flag is disabled in development", () => {
    expect(devMagicLinkSink({ ...base, NODE_ENV: "development" })).toBeUndefined();
  });

  test("enabled in development", () => {
    expect(
      devMagicLinkSink({ ...base, NODE_ENV: "development", AUTH_DEV_MAGIC_LINK_CONSOLE: true }),
    ).toBeFunction();
  });

  test.each(["production", "test", "staging", undefined])(
    "disabled for NODE_ENV=%s even when the flag is set",
    (NODE_ENV) => {
      expect(
        devMagicLinkSink({ ...base, NODE_ENV, AUTH_DEV_MAGIC_LINK_CONSOLE: true }),
      ).toBeUndefined();
    },
  );

  test("does not accept truthy non-boolean values", () => {
    expect(
      devMagicLinkSink({
        ...base,
        NODE_ENV: "development",
        AUTH_DEV_MAGIC_LINK_CONSOLE: "true" as unknown as boolean,
      }),
    ).toBeUndefined();
  });

  test("writes the URL only through the explicitly enabled development sink", () => {
    const sink = devMagicLinkSink({
      ...base,
      NODE_ENV: "development",
      AUTH_DEV_MAGIC_LINK_CONSOLE: true,
    });
    const consoleInfo = spyOn(console, "info").mockImplementation(() => {});
    try {
      sink?.("https://example.test/secret-token");
      expect(consoleInfo).toHaveBeenCalledWith(
        expect.stringContaining("https://example.test/secret-token"),
      );
    } finally {
      consoleInfo.mockRestore();
    }
  });
});
