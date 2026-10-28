import { describe, expect, mock, test } from "bun:test";

const KEY = "openvalens.server-url.v1";
const items = new Map<string, string>();
let failReads = false;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => {
    if (failReads) throw new Error("keychain locked");
    return items.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    items.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    items.delete(key);
  },
}));
mock.module("@/src/env", () => ({ ENV: {} }));
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const store = await import("./server-url");

describe("runtime server store (#295)", () => {
  test("an unreadable store stays loading instead of asking for a server", async () => {
    failReads = true;
    expect((await store.loadServer()).status).toBe("loading");
    expect(store.getServerUrl()).toBeNull();
    await expect(store.requireServerUrl()).rejects.toThrow("No server is chosen");
    failReads = false;
  });

  test("a saved address is read once and normalised", async () => {
    items.set(KEY, "https://Health.Example.org/");
    expect(await store.loadServer()).toEqual({
      status: "set",
      url: "https://health.example.org",
      locked: false,
    });
    expect(await store.requireServerUrl()).toBe("https://health.example.org");
    expect(store.isServerLocked()).toBe(false);
  });

  test("saving and forgetting update storage and the current server", async () => {
    await store.saveServerUrl("https://app.openvalens.com");
    expect(items.get(KEY)).toBe("https://app.openvalens.com");
    expect(store.getServerUrl()).toBe("https://app.openvalens.com");
    await store.forgetServerUrl();
    expect(items.has(KEY)).toBe(false);
    expect(store.getServerUrl()).toBeNull();
    await expect(store.requireServerUrl()).rejects.toThrow("No server is chosen");
  });
});
