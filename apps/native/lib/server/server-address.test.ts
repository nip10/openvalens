import { describe, expect, test } from "bun:test";

import {
  CLOUD_SERVER_URL,
  isLocalHost,
  normalizeServerAddress,
  serverLabel,
} from "./server-address";

const release = { allowLocalHttp: false };
const dev = { allowLocalHttp: true };

describe("normalizeServerAddress (#295)", () => {
  test.each([
    ["https://health.example.org", "https://health.example.org"],
    ["https://health.example.org/", "https://health.example.org"],
    ["  https://Health.Example.ORG/  ", "https://health.example.org"],
    ["health.example.org", "https://health.example.org"],
    ["https://health.example.org/login?next=/x#top", "https://health.example.org"],
    ["https://health.example.org:8443/", "https://health.example.org:8443"],
    ["https://health.example.org:443", "https://health.example.org"],
    ["HTTPS://health.example.org", "https://health.example.org"],
  ])("%p becomes %p", (input, expected) => {
    expect(normalizeServerAddress(input, release)).toEqual({ ok: true, url: expected });
  });

  test("keeps the Cloud address as is", () => {
    expect(normalizeServerAddress(CLOUD_SERVER_URL, release)).toEqual({
      ok: true,
      url: CLOUD_SERVER_URL,
    });
  });

  test("an empty address is its own problem", () => {
    expect(normalizeServerAddress("   ", release)).toEqual({ ok: false, problem: "empty" });
  });

  test.each([
    "https://",
    "ftp://health.example.org",
    "https://user:secret@health.example.org",
    "https://health example.org",
    "javascript:alert(1)",
  ])("rejects %p as not a server address", (input) => {
    expect(normalizeServerAddress(input, dev)).toEqual({ ok: false, problem: "invalid" });
  });

  test("refuses plain HTTP in a release build, even to localhost", () => {
    expect(normalizeServerAddress("http://health.example.org", release)).toEqual({
      ok: false,
      problem: "not-https",
    });
    expect(normalizeServerAddress("http://localhost:3000", release)).toEqual({
      ok: false,
      problem: "not-https",
    });
  });

  test("a development build may use plain HTTP to localhost and the local network only", () => {
    for (const [input, expected] of [
      ["http://localhost:3000/", "http://localhost:3000"],
      ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
      ["http://10.0.2.2:3000", "http://10.0.2.2:3000"],
      ["http://192.168.1.20:3000", "http://192.168.1.20:3000"],
      ["http://172.20.0.5:3000", "http://172.20.0.5:3000"],
      ["http://openvalens.local:3000", "http://openvalens.local:3000"],
      ["http://[::1]:3000", "http://[::1]:3000"],
    ] as const) {
      expect(normalizeServerAddress(input, dev)).toEqual({ ok: true, url: expected });
    }
    for (const input of ["http://health.example.org", "http://8.8.8.8", "http://172.32.0.1"]) {
      expect(normalizeServerAddress(input, dev)).toEqual({ ok: false, problem: "not-https" });
    }
  });
});

describe("isLocalHost", () => {
  test("knows loopback, private ranges and mDNS names", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("192.168.0.1")).toBe(true);
    expect(isLocalHost("169.254.1.1")).toBe(true);
    expect(isLocalHost("example.org")).toBe(false);
    expect(isLocalHost("192.168.0.300")).toBe(false);
    expect(isLocalHost("11.0.0.1")).toBe(false);
  });
});

describe("serverLabel", () => {
  test("shows the host and any port", () => {
    expect(serverLabel(CLOUD_SERVER_URL)).toBe("app.openvalens.com");
    expect(serverLabel("http://192.168.1.20:3000")).toBe("192.168.1.20:3000");
  });
});
