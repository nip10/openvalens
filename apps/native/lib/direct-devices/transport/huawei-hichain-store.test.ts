import { expect, test } from "bun:test";

import { createSecureHuaweiHiChainStore, type SecureKeyValue } from "./huawei-hichain-store";

function fakeSecure() {
  const items = new Map<string, string>();
  const secure: SecureKeyValue = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    deleteItemAsync: async (key) => void items.delete(key),
  };
  return { items, secure };
}

test("the HiChain id and token persist under sanitized keystore keys", async () => {
  const { items, secure } = fakeSecure();
  const store = createSecureHuaweiHiChainStore(() => secure);
  store.setAndroidId("AA:BB:CC/1", "000102030405060708090A0B0C0D0E0F");
  store.setAuthToken("AA:BB:CC/1", Uint8Array.of(1, 2, 0xfe));
  expect([...items.keys()].sort()).toEqual([
    "huawei.hichain.AA_BB_CC_1.androidId",
    "huawei.hichain.AA_BB_CC_1.authToken",
  ]);
  // A new process reads them back.
  const reopened = createSecureHuaweiHiChainStore(() => secure);
  expect(reopened.getAndroidId("AA:BB:CC/1")).toBe("000102030405060708090A0B0C0D0E0F");
  expect(Array.from(reopened.getAuthToken("AA:BB:CC/1")!)).toEqual([1, 2, 0xfe]);
  // Clearing the token is visible at once; the id stays.
  reopened.clearAuthToken("AA:BB:CC/1");
  expect(reopened.getAuthToken("AA:BB:CC/1")).toBeNull();
  await Promise.resolve();
  expect(items.has("huawei.hichain.AA_BB_CC_1.authToken")).toBe(false);
  expect(reopened.getAndroidId("AA:BB:CC/1")).not.toBeNull();
});

test("malformed stored values read as absent", () => {
  const { items, secure } = fakeSecure();
  items.set("huawei.hichain.d.androidId", "not-an-id");
  items.set("huawei.hichain.d.authToken", "zz");
  const store = createSecureHuaweiHiChainStore(() => secure);
  expect(store.getAndroidId("d")).toBeNull();
  expect(store.getAuthToken("d")).toBeNull();
});
