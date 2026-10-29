import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

/**
 * Query-state wiring: a failed query shows an error with Retry, never an
 * empty screen or a misleading default ("No periods", "Not connected").
 */

type QueryState = {
  data?: unknown;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};
const ok = (data: unknown): QueryState => ({
  data,
  isPending: false,
  isError: false,
  refetch: () => {},
});
const failed: QueryState = {
  data: undefined,
  isPending: false,
  isError: true,
  refetch: () => {},
};

/** Query state by the key's leading names, e.g. "cycle.periods". */
let queries: Record<string, QueryState> = {};
function stateFor(queryKey: readonly unknown[]): QueryState {
  const names = queryKey.filter((part): part is string => typeof part === "string");
  for (let length = names.length; length > 0; length--) {
    const found = queries[names.slice(0, length).join(".")];
    if (found) return found;
  }
  return ok(undefined);
}

/** An oRPC client stand-in: every path has queryOptions, mutationOptions and key. */
function orpcProxy(path: string[]): unknown {
  const target = () => Promise.resolve(undefined);
  return new Proxy(target, {
    get(_target, prop) {
      if (prop === "queryOptions") return () => ({ queryKey: path });
      if (prop === "mutationOptions") return (options: unknown) => options ?? {};
      if (prop === "key") return () => path;
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return orpcProxy([...path, prop]);
    },
  });
}

mock.module("@/utils/orpc", () => ({
  orpc: orpcProxy([]),
  client: orpcProxy([]),
  queryClient: { invalidateQueries: () => Promise.resolve(), clear: () => {} },
  createQueryClient: () => ({}),
  link: {},
}));
mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "user-a", email: "a@example.com" }, session: {} },
      isPending: false,
    }),
    listAccounts: () => Promise.resolve({ data: [], error: null }),
  },
}));
mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => () => {},
}));
mock.module("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => stateFor(queryKey),
  useMutation: () => ({ mutate: () => {}, isPending: false, isError: false, isSuccess: false }),
}));

const { BodyMapPage } = await import("./body-map");
const { CycleEnabled } = await import("./cycle");
const { TelegramSettingsPage } = await import("./settings/telegram");
const { DeleteAccountSection } = await import("./settings/index");
const { InsightNotificationsSection } = await import("@/components/insight-notifications-section");
const { SignInMethodsSection: OidcConnectSection } =
  await import("@/components/sign-in-methods-section");

function render(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

describe("body map", () => {
  test("a failed composition query shows an error with Retry", () => {
    queries = {
      "bodyMap.scans": ok([{ id: 1, date: "2026-10-01" }]),
      "bodyMap.composition": failed,
    };
    const html = render(<BodyMapPage />);
    expect(html).toInclude("Could not load this scan.");
    expect(html).toInclude("Retry");
  });

  test("a loaded composition shows no error", () => {
    queries = {
      "bodyMap.scans": ok([{ id: 1, date: "2026-10-01" }]),
      "bodyMap.composition": ok({ scan: { source: "DEXA", date: "2026-10-01" }, values: [] }),
    };
    const html = render(<BodyMapPage />);
    expect(html).not.toInclude("Could not load this scan.");
    expect(html).toInclude("This scan has no regional values.");
  });
});

describe("cycle", () => {
  const renderCycle = () =>
    render(
      <CycleEnabled
        noNaturalCycle={false}
        keyFor={(name, ...rest) => ["cycle", name, "scope", ...rest]}
        refresh={() => {}}
      />,
    );

  test("failed periods and imports show errors, not the empty state", () => {
    queries = { "cycle.periods": failed, "cycle.imports": failed, "cycle.estimates": failed };
    const html = renderCycle();
    expect(html).toInclude("Could not load your periods.");
    expect(html).toInclude("Could not load your imports.");
    expect(html).not.toInclude("No periods logged yet.");
  });

  test("loaded but empty periods still show the empty state", () => {
    queries = { "cycle.periods": ok([]), "cycle.imports": ok([]), "cycle.estimates": failed };
    const html = renderCycle();
    expect(html).toInclude("No periods logged yet.");
    expect(html).not.toInclude("Could not load your periods.");
    expect(html).not.toInclude("Could not load your imports.");
  });
});

describe("settings", () => {
  test("a failed Telegram status shows an error, not Not connected", () => {
    queries = { telegram: failed };
    const html = render(<TelegramSettingsPage />);
    expect(html).toInclude("Could not check your Telegram connection.");
    expect(html).toInclude("Retry");
    expect(html).not.toInclude("Not connected");
  });

  test("a loaded Telegram status still says Not connected", () => {
    queries = { telegram: ok({ connected: false }) };
    const html = render(<TelegramSettingsPage />);
    expect(html).toInclude("Not connected");
    expect(html).not.toInclude("Could not check your Telegram connection.");
  });

  test("failed insight notification settings show an error", () => {
    queries = { insights: failed };
    const html = render(<InsightNotificationsSection />);
    expect(html).toInclude("Could not load your notification settings.");
    expect(html).toInclude("Retry");
  });

  test("a failed deletion preview shows an error under its heading", () => {
    queries = { dataRights: failed };
    const html = render(<DeleteAccountSection />);
    expect(html).toInclude("Delete account and all data");
    expect(html).toInclude("Could not load what would be deleted.");
    expect(html).toInclude("Retry");
  });

  test("failed OIDC accounts show an error instead of Connect", () => {
    queries = {
      "signIn.options": ok({ oidc: { providerId: "corp", displayName: "Corp SSO" } }),
      "auth.accounts": failed,
    };
    const html = render(<OidcConnectSection />);
    expect(html).toInclude("Could not check your sign-in methods.");
    expect(html).toInclude("Retry");
    expect(html).not.toInclude(">Connect<");
  });

  test("loaded OIDC accounts without a link offer Connect", () => {
    queries = {
      "signIn.options": ok({ oidc: { providerId: "corp", displayName: "Corp SSO" } }),
      "auth.accounts": ok([]),
    };
    const html = render(<OidcConnectSection />);
    expect(html).toInclude(">Connect<");
    expect(html).not.toInclude("Could not check your sign-in methods.");
  });

  test("Issue #296 — Google and Apple rows appear only when configured", () => {
    queries = {
      "signIn.options": ok({ oidc: null, google: true, apple: false, appleNative: false }),
      "auth.accounts": ok([]),
    };
    const html = render(<OidcConnectSection />);
    expect(html).toInclude("Google");
    expect(html).not.toInclude("Apple");
    expect(html).toInclude("Email link");
    queries = { "signIn.options": ok({ oidc: null, google: false, apple: false }) };
    expect(render(<OidcConnectSection />)).toBe("");
  });
});
