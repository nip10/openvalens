import {
  getCookie,
  normalizeCookieName,
  storageAdapter,
  type ExpoClientStorage,
  type expoClient,
} from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

type ExpoPlugin = ReturnType<typeof expoClient>;
type ExpoOptions = Parameters<typeof import("@better-auth/expo/client").expoClient>[0];
type ExpoStore = Parameters<ExpoPlugin["getActions"]>[1];
type ExpoSuccessContext = Parameters<
  NonNullable<ExpoPlugin["fetchPlugins"][number]["hooks"]["onSuccess"]>
>[0];

const INSTALL_ERROR = "Sign-in session could not be safely installed.";
const SUPERSEDED_ERROR = "A newer sign-in session replaced this response.";

function cookiePairs(header: string): Array<{ name: string; value: string }> {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? { name: part, value: "" }
        : { name: part.slice(0, separator), value: part.slice(separator + 1) };
    });
}

function safeJarHasSingleSessionToken(jar: string, tokenCookieNames: readonly string[]): boolean {
  try {
    const parsed: unknown = JSON.parse(jar);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const entries = Object.entries(parsed);
    return (
      entries.length === 1 &&
      tokenCookieNames.includes(entries[0]?.[0] ?? "") &&
      !!entries[0]?.[1] &&
      typeof entries[0][1] === "object" &&
      typeof (entries[0][1] as { value?: unknown }).value === "string" &&
      (entries[0][1] as { value: string }).value.length > 0
    );
  } catch {
    return false;
  }
}

/** Coordinates Better Auth Expo storage and verified native session installs. */
export class AuthSessionStorageCoordinator {
  readonly backingStorage: ExpoClientStorage;
  private readonly managedStorage: ReturnType<typeof storageAdapter>;
  private operationTail: Promise<void> = Promise.resolve();
  private uncertainState = false;
  private clientStore: ExpoStore | null = null;
  private cookieKey: string | null = null;
  private sessionCacheKey: string | null = null;
  private tokenCookieNames: string[] = [];

  constructor(backingStorage: ExpoClientStorage) {
    this.backingStorage = backingStorage;
    this.managedStorage = storageAdapter(backingStorage);
  }

  wrapExpoPlugin(plugin: ExpoPlugin, options: ExpoOptions): ExpoPlugin {
    const storagePrefix = options.storagePrefix || "better-auth";
    const cookiePrefix = options.cookiePrefix || "better-auth";
    this.cookieKey = normalizeCookieName(`${storagePrefix}_cookie`);
    this.sessionCacheKey = normalizeCookieName(`${storagePrefix}_session_data`);
    this.tokenCookieNames = [
      `${cookiePrefix}.session_token`,
      `__Secure-${cookiePrefix}.session_token`,
    ];
    const originalGetActions = plugin.getActions;

    return {
      ...plugin,
      getActions: (fetch, store) => {
        this.clientStore = store;
        const actions = originalGetActions(fetch, store);
        return {
          ...actions,
          getCookie: () => this.withLock(() => actions.getCookie()),
        };
      },
      fetchPlugins: plugin.fetchPlugins.map((fetchPlugin) => {
        const originalInit = fetchPlugin.init;
        const originalOnSuccess = fetchPlugin.hooks.onSuccess;
        return {
          ...fetchPlugin,
          init: async (url, initOptions) => this.withLock(() => originalInit(url, initOptions)),
          hooks: {
            ...fetchPlugin.hooks,
            onSuccess: async (context) =>
              this.withLock(async () => {
                this.assertKnownState();
                if (this.isGetSessionContext(context)) {
                  await this.assertResponseSessionIsCurrent(context);
                }
                await originalOnSuccess(context);
              }),
          },
        };
      }),
    };
  }

  async installVerifiedSessionCookie(candidateJar: string): Promise<void> {
    const store = this.clientStore;
    if (!store || !this.cookieKey || !this.sessionCacheKey) throw new Error(INSTALL_ERROR);
    if (!safeJarHasSingleSessionToken(candidateJar, this.tokenCookieNames)) {
      throw new Error(INSTALL_ERROR);
    }

    await this.withLock(async () => {
      const cookieKey = this.cookieKey;
      const sessionCacheKey = this.sessionCacheKey;
      if (!cookieKey || !sessionCacheKey) throw new Error(INSTALL_ERROR);

      const previousJar = await this.managedStorage.getItemAsync(cookieKey);
      const previousCache = await this.managedStorage.getItemAsync(sessionCacheKey);
      try {
        await this.writeAndVerify(cookieKey, candidateJar);
        await this.writeAndVerify(sessionCacheKey, "{}");
      } catch {
        const cookieRestored = await this.tryRestore(cookieKey, previousJar ?? "{}");
        const cacheRestored = await this.tryRestore(sessionCacheKey, previousCache ?? "{}");
        if (!cookieRestored || !cacheRestored) this.uncertainState = true;
        throw new Error(INSTALL_ERROR);
      }
    });

    // Notify after releasing the coordinator so listeners can synchronously
    // schedule their own credential reads without re-entering the lock.
    store.notify("$sessionSignal");
  }

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(async () => {
      this.assertKnownState();
      return operation();
    });
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertKnownState(): void {
    if (this.uncertainState) throw new Error(INSTALL_ERROR);
  }

  private async writeAndVerify(key: string, value: string): Promise<void> {
    await this.managedStorage.setItemAsync(key, value);
    if ((await this.managedStorage.getItemAsync(key)) !== value) throw new Error(INSTALL_ERROR);
  }

  private async tryRestore(key: string, value: string): Promise<boolean> {
    try {
      await this.writeAndVerify(key, value);
      return true;
    } catch {
      return false;
    }
  }

  private isGetSessionContext(context: ExpoSuccessContext): boolean {
    try {
      return new URL(context.request.url).pathname.endsWith("/get-session");
    } catch {
      return false;
    }
  }

  private async assertResponseSessionIsCurrent(context: ExpoSuccessContext): Promise<void> {
    const cookieKey = this.cookieKey;
    if (!cookieKey) throw new Error(SUPERSEDED_ERROR);
    const jar = (await this.managedStorage.getItemAsync(cookieKey)) ?? "{}";
    const storedCookie = cookiePairs(getCookie(jar)).filter(({ name }) =>
      this.tokenCookieNames.includes(name),
    );
    const sentCookie = cookiePairs(context.request.headers.get("cookie") ?? "").filter(({ name }) =>
      this.tokenCookieNames.includes(name),
    );
    if (storedCookie.length > 1 || sentCookie.length > 1) throw new Error(SUPERSEDED_ERROR);
    const stored = storedCookie[0];
    const sent = sentCookie[0];
    if (
      (stored?.name ?? null) !== (sent?.name ?? null) ||
      (stored?.value ?? null) !== (sent?.value ?? null)
    ) {
      throw new Error(SUPERSEDED_ERROR);
    }
  }
}

export const authSessionBackingStorage = SecureStore;
export const authSessionStorage = new AuthSessionStorageCoordinator(authSessionBackingStorage);

export function installVerifiedSessionCookie(candidateJar: string): Promise<void> {
  return authSessionStorage.installVerifiedSessionCookie(candidateJar);
}
