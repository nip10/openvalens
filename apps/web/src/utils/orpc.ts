import { shouldRetryQuery } from "@openvalens/api/query-retry";
import type { AppRouterClient } from "@openvalens/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ENV } from "../env";

/** Issue #298 — a write refused because the workspace's Cloud access ended. */
export function isAccessReadOnlyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ACCESS_READ_ONLY";
}

export function createQueryClient() {
  const created: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: shouldRetryQuery } },
    // #298 — a refused write means the access state changed: refresh the
    // banner so it explains why.
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isAccessReadOnlyError(error))
          void created.invalidateQueries({ queryKey: orpc.access.key() });
      },
    }),
    queryCache: new QueryCache({
      onError: (error, query) => {
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
  });
  return created;
}

export const queryClient = createQueryClient();

function getServerUrl(url: string) {
  const processEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  if (typeof window === "undefined" && processEnv?.SERVER_URL) {
    return processEnv.SERVER_URL.endsWith("/")
      ? processEnv.SERVER_URL.slice(0, -1)
      : processEnv.SERVER_URL;
  }

  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const link = new RPCLink({
  url: `${getServerUrl(ENV.VITE_SERVER_URL)}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);

// TanStack Query utils layer — callers use `orpc.example.echo.useQuery(...)`
// / `.useMutation(...)`. Failures surface as `ORPCError` carrying the stable
// `ORPCErrorCode` envelope (see `@openvalens/api/errors`).
export const orpc = createTanstackQueryUtils(client);
