import { expoClient } from "@better-auth/expo/client";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";

import { ENV } from "../src/env";
import { authSessionBackingStorage, authSessionStorage } from "./auth-session-storage";

const scheme = Constants.expoConfig?.scheme as string;
const expoOptions = {
  scheme,
  storagePrefix: scheme,
  cookiePrefix: "better-auth",
  storage: authSessionBackingStorage,
};
const expoPlugin = authSessionStorage.wrapExpoPlugin(expoClient(expoOptions), expoOptions);

export const authClient = createAuthClient({
  baseURL: ENV.EXPO_PUBLIC_SERVER_URL,
  // Issue #133 — the organization client exposes the protected workspace
  // invitation endpoints (`list-user-invitations`, `get-invitation`,
  // `accept-invitation`, `reject-invitation`) to the signed-in recipient.
  plugins: [expoPlugin, magicLinkClient(), organizationClient()],
});
