import { expect, test } from "bun:test";

import {
  createSecureHuaweiHiChainStore,
  purgeSecureHuaweiHiChainStore,
  type SecureKeyValue,
} from "./huawei-hichain-store";

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
    "huawei.hichain.index",
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

test("purging removes every watch's id and token, and the index", async () => {
  const { items, secure } = fakeSecure();
  const store = createSecureHuaweiHiChainStore(() => secure);
  store.setAndroidId("watch-1", "000102030405060708090A0B0C0D0E0F");
  store.setAuthToken("watch-1", Uint8Array.of(1));
  store.setAuthToken("watch-2", Uint8Array.of(2));
  items.set("unrelated.key", "kept");
  expect(JSON.parse(items.get("huawei.hichain.index")!)).toEqual(["watch-1", "watch-2"]);
  await purgeSecureHuaweiHiChainStore(() => secure);
  expect([...items.keys()]).toEqual(["unrelated.key"]);
});

test("the Honor PAKE seed and watch identity persist, clear and purge", async () => {
  const { items, secure } = fakeSecure();
  const store = createSecureHuaweiHiChainStore(() => secure);
  const seed = Uint8Array.from({ length: 32 }, (_, index) => index);
  const peer = { authId: Uint8Array.of(0x48, 0x49), authPk: new Uint8Array(32).fill(9) };
  store.setPakeSeed("watch-5", seed);
  store.setPakePeer("watch-5", peer);
  const reopened = createSecureHuaweiHiChainStore(() => secure);
  expect(reopened.getPakeSeed("watch-5")).toEqual(seed);
  expect(reopened.getPakePeer("watch-5")).toEqual(peer);
  // A wrong-length seed or key reads as absent.
  items.set("huawei.hichain.bad.pakeSeed", "0102");
  items.set("huawei.hichain.bad.pakePeerId", "01");
  items.set("huawei.hichain.bad.pakePeerPk", "0102");
  expect(reopened.getPakeSeed("bad")).toBeNull();
  expect(reopened.getPakePeer("bad")).toBeNull();
  // Clearing the watch identity keeps our seed.
  reopened.clearPakePeer("watch-5");
  expect(reopened.getPakePeer("watch-5")).toBeNull();
  expect(reopened.getPakeSeed("watch-5")).toEqual(seed);
  await purgeSecureHuaweiHiChainStore(() => secure);
  expect([...items.keys()].filter((key) => key.includes("watch-5"))).toEqual([]);
});
