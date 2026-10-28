import { expoClient } from "@better-auth/expo/client";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";

import { getServerUrl } from "@/lib/server/server-url";

import { authSessionBackingStorage, authSessionStorage } from "./auth-session-storage";

const scheme = Constants.expoConfig?.scheme as string;
const expoOptions = {
  scheme,
  storagePrefix: scheme,
  cookiePrefix: "better-auth",
  storage: authSessionBackingStorage,
};
// Known before any client exists, so a server switch can clear the session.
authSessionStorage.configure(expoOptions);

function createClientFor(baseURL: string) {
  const expoPlugin = authSessionStorage.wrapExpoPlugin(expoClient(expoOptions), expoOptions);
  return createAuthClient({
    baseURL,
    // Issue #133 — the organization client exposes the protected workspace
    // invitation endpoints (`list-user-invitations`, `get-invitation`,
    // `accept-invitation`, `reject-invitation`) to the signed-in recipient.
    plugins: [expoPlugin, magicLinkClient(), organizationClient()],
  });
}

type AuthClient = ReturnType<typeof createClientFor>;

let current: { baseURL: string; client: AuthClient } | null = null;

/**
 * Issue #295 — the Better Auth client for the chosen server, re-created when
 * the server changes. The app renders nothing that signs in before a server
 * is chosen, so a missing server here is a bug, not a state.
 */
export function getAuthClient(): AuthClient {
  const baseURL = getServerUrl();
  if (!baseURL) throw new Error("No server is chosen on this phone.");
  if (current?.baseURL !== baseURL) current = { baseURL, client: createClientFor(baseURL) };
  return current.client;
}

/** Forget the stored session (cookie and cache), whichever server it came from. */
export function clearStoredAuthSession(): Promise<void> {
  return authSessionStorage.clearStoredSession();
}

/** Always the current server's client; every property is read from it on use. */
export const authClient: AuthClient = new Proxy({} as AuthClient, {
  get: (_target, property) => Reflect.get(getAuthClient(), property),
});
