import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

let preferenceState: Record<string, unknown>;
let historyState: Record<string, unknown>;
mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "user-a" }, session: { activeOrganizationId: "org-a" } },
      isPending: false,
    }),
  },
}));
// Bun keeps module mocks for the rest of the process, so a partial mock must
// keep the real exports (`orpc`, `queryClient`, ...) for later test files.
// Loading the real `orpc` reads the server URL from `@/env`; the root test run
// has no web env unless an earlier file happened to set one up.
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));
const actualOrpc = await import("@/utils/orpc");
mock.module("@/utils/orpc", () => ({ ...actualOrpc, client: { privateBody: {} } }));
mock.module("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[1] === "preference" ? preferenceState : historyState,
  useMutation: () => ({ mutate: () => {}, isPending: false, isError: false }),
}));

const { PrivateMeasurements } = await import("./private-measurements");

/** Renders in English through Lingui (#67). */
function renderToStaticMarkup(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}
const row = {
  id: "entry-a",
  kind: "weight",
  value: 61,
  unit: "kg",
  measuredAt: "2026-10-18T10:30:00.000Z",
};

function render() {
  return renderToStaticMarkup(<PrivateMeasurements />);
}

describe("PrivateMeasurements query-state wiring", () => {
  test("enabled preference and successful history render entry actions, not errors", () => {
    preferenceState = {
      data: { enabled: true },
      isPending: false,
      isError: false,
      refetch: () => {},
    };
    historyState = { data: [row], isPending: false, isError: false, refetch: () => {} };
    const html = render();
    expect(html).toInclude("Add an entry");
    expect(html).toInclude("History");
    expect(html).toInclude("Edit Weight entry");
    expect(html).toInclude("Delete Weight entry");
    expect(html).not.toInclude("Could not check this setting");
    expect(html).not.toInclude("Could not load entries");
    expect(html).not.toInclude("61 kg");
  });

  test("disabled preference renders the opt-in prompt", () => {
    preferenceState = {
      data: { enabled: false },
      isPending: false,
      isError: false,
      refetch: () => {},
    };
    historyState = { data: undefined, isPending: true, isError: false, refetch: () => {} };
    expect(render()).toInclude("Turn on private measurements");
  });

  test("preference failure renders a retry action", () => {
    preferenceState = { data: undefined, isPending: false, isError: true, refetch: () => {} };
    historyState = { data: undefined, isPending: true, isError: false, refetch: () => {} };
    expect(render()).toInclude("Try again");
    expect(render()).toInclude("Could not check this setting");
  });

  test("loading preference renders pending status", () => {
    preferenceState = { data: undefined, isPending: true, isError: false, refetch: () => {} };
    historyState = { data: undefined, isPending: true, isError: false, refetch: () => {} };
    expect(render()).toInclude("Checking your private measurement setting");
  });

  test("history failure renders load error and retry", () => {
    preferenceState = {
      data: { enabled: true },
      isPending: false,
      isError: false,
      refetch: () => {},
    };
    historyState = { data: undefined, isPending: false, isError: true, refetch: () => {} };
    const html = render();
    expect(html).toInclude("Could not load entries");
    expect(html).toInclude("Try again");
  });

  test("history loading renders a pending status", () => {
    preferenceState = {
      data: { enabled: true },
      isPending: false,
      isError: false,
      refetch: () => {},
    };
    historyState = { data: undefined, isPending: true, isError: false, refetch: () => {} };
    expect(render()).toInclude("Loading your entries");
  });
});
