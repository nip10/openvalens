import { shouldRetryQuery } from "@openvalens/api/query-retry";
import type { AppRouterClient } from "@openvalens/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import { requireServerUrl } from "@/lib/server/server-url";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetryQuery } },
  queryCache: new QueryCache({
    onError: (error) => {
      console.log(error);
    },
  }),
});

async function expoFetch(request: Request, init?: RequestInit) {
  const { fetch } = await import("expo/fetch");

  return fetch(request.url, {
    body: await request.blob(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...init,
  });
}

// TODO(#7 / #29): switch to mobile device-session auth (custom 3-token
// contract). Until then we use the Better-T-Stack default: Better Auth Expo
// session cookies forwarded manually on native via `authClient.getCookie()`.
// Issue #295 — the server is read per request, so a server change takes
// effect on the next call and a headless background run waits for the saved
// address instead of using a build-time one.
export const link = new RPCLink({
  url: async () => `${await requireServerUrl()}/rpc`,
  fetch(request, init) {
    return expoFetch(request, {
      ...init,
      // Better Auth Expo forwards the session cookie manually on native.
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  },
  async headers() {
    if (Platform.OS === "web") {
      return {};
    }
    const headers = new Map<string, string>();
    await requireServerUrl();
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    return Object.fromEntries(headers);
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
