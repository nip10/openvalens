import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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
mock.module("@/utils/orpc", () => ({ client: { privateBody: {} } }));
mock.module("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[1] === "preference" ? preferenceState : historyState,
  useMutation: () => ({ mutate: () => {}, isPending: false, isError: false }),
}));

const { PrivateMeasurements } = await import("./private-measurements");
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
