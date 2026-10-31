import { describe, expect, mock, test } from "bun:test";

const KEY = "openvalens.server-url.v1";
const items = new Map<string, string>([[KEY, "http://localhost:3410"]]);

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => items.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    items.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    items.delete(key);
  },
}));
// A release build (no __DEV__) built for the e2e suite (#302).
mock.module("@/src/env", () => ({ ENV: { EXPO_PUBLIC_ALLOW_LOCAL_HTTP: true } }));
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const store = await import("./server-url");

describe("EXPO_PUBLIC_ALLOW_LOCAL_HTTP (#302)", () => {
  test("a test build may use plain HTTP to a local server", async () => {
    expect(store.allowsLocalHttp()).toBe(true);
    expect(await store.loadServer()).toEqual({
      status: "set",
      url: "http://localhost:3410",
      locked: false,
    });
  });
});
