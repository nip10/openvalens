import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ExpoClientStorage } from "@better-auth/expo/client";

class MemorySecureStore implements ExpoClientStorage {
  readonly values = new Map<string, string>();
  failReadAfterWriteValue: string | null = null;
  failNextReadForKey: string | null = null;
  swallowWriteValue: string | null = null;
  failWriteValue: string | null = null;
  holdWriteValue: string | null = null;
  writeStarted: (() => void) | null = null;
  releaseWrite: Promise<void> | null = null;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  async getItemAsync(key: string): Promise<string | null> {
    if (this.failNextReadForKey === key) {
      this.failNextReadForKey = null;
      throw new Error("one-shot storage read failure");
    }
    return this.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (value === this.failWriteValue) throw new Error("storage write failure");
    if (value === this.swallowWriteValue) return;
    if (value === this.holdWriteValue) {
      this.writeStarted?.();
      await this.releaseWrite;
    }
    this.values.set(key, value);
    if (value === this.failReadAfterWriteValue) this.failNextReadForKey = key;
  }
}

const defaultStore = new MemorySecureStore();
mock.module("expo-secure-store", () => defaultStore);
mock.module("expo-constants", () => ({ default: { expoConfig: { scheme: "openvalens" } } }));
mock.module("expo-linking", () => ({ createURL: () => "openvalens:///" }));
mock.module("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

const { AuthSessionStorageCoordinator } = await import("../auth-session-storage");
const { getSetCookie, expoClient } = await import("@better-auth/expo/client");

const STORAGE_PREFIX = "auth:primary";
const NORMALIZED_PREFIX = "auth_primary";
const COOKIE_KEY = `${NORMALIZED_PREFIX}_cookie`;
const CACHE_KEY = `${NORMALIZED_PREFIX}_session_data`;
const TOKEN_NAME = "better-auth.session_token";

type ExpoPlugin = ReturnType<typeof expoClient>;
type SuccessContext = Parameters<
  NonNullable<ExpoPlugin["fetchPlugins"][number]["hooks"]["onSuccess"]>
>[0];

function setup() {
  const storage = new MemorySecureStore();
  const coordinator = new AuthSessionStorageCoordinator(storage);
  const options = {
    scheme: "openvalens",
    storagePrefix: STORAGE_PREFIX,
    cookiePrefix: "better-auth",
    storage,
  };
  const plugin = coordinator.wrapExpoPlugin(expoClient(options), options);
  const notificationReads: Array<Promise<string>> = [];
  const store: Parameters<ExpoPlugin["getActions"]>[1] = {
    notify: () => {
      notificationReads.push(actions.getCookie());
    },
    listen: () => {},
    atoms: {},
  };
  const actions = plugin.getActions(undefined, store);
  const expoFetchPlugin = plugin.fetchPlugins[0];
  if (!expoFetchPlugin) throw new Error("Expected Expo fetch plugin");
  return { storage, coordinator, plugin, actions, expoFetchPlugin, notificationReads };
}

function jar(token: string): string {
  return getSetCookie(`${TOKEN_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=None`);
}

function successContext(
  path: string,
  cookieHeader: string,
  data: unknown,
  response = new Response(null),
): SuccessContext {
  return {
    data,
    response,
    request: {
      url: `https://auth.example${path}`,
      headers: new Headers({ cookie: cookieHeader }),
      body: "",
      method: "GET",
      signal: new AbortController().signal,
    },
  };
}

afterEach(() => mock.restore());

describe("coordinated Better Auth Expo storage", () => {
  test("uses the same SecureStore object, Expo adapter queue, and normalized configured prefix", async () => {
    const { storage, coordinator, actions, notificationReads } = setup();
    expect(coordinator.backingStorage).toBe(storage);

    await coordinator.installVerifiedSessionCookie(jar("fresh-token"));

    expect(storage.values.get(COOKIE_KEY)).toBe(jar("fresh-token"));
    expect(storage.values.get(CACHE_KEY)).toBe("{}");
    expect(await actions.getCookie()).toBe(`${TOKEN_NAME}=fresh-token`);
    expect(await notificationReads[0]).toBe(`${TOKEN_NAME}=fresh-token`);
  });

  test("serializes an original Expo response write before verified installation", async () => {
    const { storage, coordinator, expoFetchPlugin, actions } = setup();
    const pluginSetCookie = jar("from-client-response");
    let markWriteStarted!: () => void;
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => (markWriteStarted = resolve));
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    storage.holdWriteValue = pluginSetCookie;
    storage.writeStarted = markWriteStarted;
    storage.releaseWrite = writeGate;

    const clientWrite = expoFetchPlugin.hooks.onSuccess(
      successContext(
        "/api/auth/sign-in/magic-link",
        "",
        { status: true },
        new Response(null, {
          headers: { "set-cookie": `${TOKEN_NAME}=from-client-response; Path=/` },
        }),
      ),
    );
    await writeStarted;
    const installation = coordinator.installVerifiedSessionCookie(jar("verified-token"));
    releaseWrite();
    await clientWrite;
    await installation;

    expect(storage.values.get(COOKIE_KEY)).toBe(jar("verified-token"));
    expect(await actions.getCookie()).toBe(`${TOKEN_NAME}=verified-token`);
  });

  test("restores jar and cache after a post-write readback failure and holds readers until rollback", async () => {
    const { storage, coordinator, actions } = setup();
    const previousJar = jar("previous-token");
    const previousCache = JSON.stringify({ session: { id: "previous-session" } });
    storage.values.set(COOKIE_KEY, previousJar);
    storage.values.set(CACHE_KEY, previousCache);
    storage.failReadAfterWriteValue = jar("candidate-token");

    let markRollbackStarted!: () => void;
    let releaseRollback!: () => void;
    const rollbackStarted = new Promise<void>((resolve) => (markRollbackStarted = resolve));
    const rollbackGate = new Promise<void>((resolve) => (releaseRollback = resolve));
    storage.holdWriteValue = previousJar;
    storage.writeStarted = markRollbackStarted;
    storage.releaseWrite = rollbackGate;

    const install = coordinator.installVerifiedSessionCookie(jar("candidate-token"));
    await rollbackStarted;
    let readerFinished = false;
    const reader = actions.getCookie().then((value) => {
      readerFinished = true;
      return value;
    });
    await Promise.resolve();
    expect(readerFinished).toBe(false);
    releaseRollback();

    await expect(install).rejects.toThrow("Sign-in session could not be safely installed.");
    expect(await reader).toBe(`${TOKEN_NAME}=previous-token`);
    expect(storage.values.get(COOKIE_KEY)).toBe(previousJar);
    expect(storage.values.get(CACHE_KEY)).toBe(previousCache);
  });

  test("detects Expo adapter swallowed writes by checking the logical readback", async () => {
    const { storage, coordinator, actions } = setup();
    const previousJar = jar("previous-token");
    storage.values.set(COOKIE_KEY, previousJar);
    storage.values.set(CACHE_KEY, "{}");
    storage.swallowWriteValue = jar("silently-dropped");

    await expect(coordinator.installVerifiedSessionCookie(jar("silently-dropped"))).rejects.toThrow(
      "Sign-in session could not be safely installed.",
    );

    expect(storage.values.get(COOKIE_KEY)).toBe(previousJar);
    expect(await actions.getCookie()).toBe(`${TOKEN_NAME}=previous-token`);
  });

  test("blocks all plugin credentials and hooks after rollback cannot be verified", async () => {
    const { storage, coordinator, actions, expoFetchPlugin } = setup();
    const previousJar = jar("previous-token");
    storage.values.set(COOKIE_KEY, previousJar);
    storage.values.set(CACHE_KEY, "{}");
    storage.failReadAfterWriteValue = jar("candidate-token");
    storage.failWriteValue = previousJar;

    await expect(
      coordinator.installVerifiedSessionCookie(jar("candidate-token")),
    ).rejects.toThrow();
    await expect(actions.getCookie()).rejects.toThrow(
      "Sign-in session could not be safely installed.",
    );
    await expect(
      expoFetchPlugin.init("https://auth.example/api/auth/get-session", {
        baseURL: "https://auth.example",
      }),
    ).rejects.toThrow("Sign-in session could not be safely installed.");
    await expect(
      expoFetchPlugin.hooks.onSuccess(successContext("/api/auth/get-session", "", null)),
    ).rejects.toThrow("Sign-in session could not be safely installed.");
  });

  test("rejects a delayed old get-session response before its cookie deletion or cache write", async () => {
    const { storage, coordinator, expoFetchPlugin, actions } = setup();
    await coordinator.installVerifiedSessionCookie(jar("new-session-token"));
    const staleResponse = successContext(
      "/api/auth/get-session",
      `${TOKEN_NAME}=old-session-token`,
      { session: { id: "stale" }, user: { id: "stale-user" } },
      new Response(null, {
        headers: { "set-cookie": `${TOKEN_NAME}=; Max-Age=0; Path=/` },
      }),
    );

    await expect(expoFetchPlugin.hooks.onSuccess(staleResponse)).rejects.toThrow(
      "A newer sign-in session replaced this response.",
    );

    expect(storage.values.get(COOKIE_KEY)).toBe(jar("new-session-token"));
    expect(storage.values.get(CACHE_KEY)).toBe("{}");
    expect(await actions.getCookie()).toBe(`${TOKEN_NAME}=new-session-token`);
  });

  test("allows a current get-session response and notifies without lock re-entry deadlock", async () => {
    const { storage, coordinator, expoFetchPlugin, actions, notificationReads } = setup();
    await coordinator.installVerifiedSessionCookie(jar("current-token"));
    const sessionData = {
      session: { id: "current-session", userId: "current-user", expiresAt: "2040-01-01T00:00:00Z" },
      user: { id: "current-user", email: "current@example.test" },
    };

    await expoFetchPlugin.hooks.onSuccess(
      successContext("/api/auth/get-session", `${TOKEN_NAME}=current-token`, sessionData),
    );
    await Promise.all(notificationReads);

    expect(JSON.parse(storage.values.get(CACHE_KEY) ?? "null")).toEqual(sessionData);
    expect(await actions.getCookie()).toBe(`${TOKEN_NAME}=current-token`);
  });

  test("clears the stored session before a server switch, even after an uncertain install (#295)", async () => {
    const { storage, coordinator, actions } = setup();
    const previousJar = jar("old-server-token");
    storage.values.set(COOKIE_KEY, previousJar);
    storage.values.set(CACHE_KEY, JSON.stringify({ session: { id: "old-server-session" } }));
    storage.failReadAfterWriteValue = jar("candidate-token");
    storage.failWriteValue = previousJar;
    await expect(
      coordinator.installVerifiedSessionCookie(jar("candidate-token")),
    ).rejects.toThrow();
    storage.failWriteValue = null;

    await coordinator.clearStoredSession();

    expect(storage.values.get(COOKIE_KEY)).toBe("{}");
    expect(storage.values.get(CACHE_KEY)).toBe("{}");
    expect(await actions.getCookie()).toBe("");
  });

  test("fails a session clear whose write cannot be read back (#295)", async () => {
    const { storage, coordinator } = setup();
    storage.values.set(COOKIE_KEY, jar("old-server-token"));
    storage.swallowWriteValue = "{}";

    await expect(coordinator.clearStoredSession()).rejects.toThrow(
      "The stored sign-in session could not be cleared.",
    );
  });
});
