import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";

const execFileAsync = promisify(execFile);
const mountedMode = process.env.NATIVE_EXERCISE_SCREEN_TEST === "1";
const mutationInputs: Array<Record<string, unknown>> = [];
const queryCalls: Array<{ label: string; input: unknown; scope: unknown; enabled: boolean }> = [];
const mutationOutcomes: Array<
  | { kind: "reject"; error: Error }
  | { kind: "resolve"; value: { id: number; name: string } }
  | { kind: "hold" }
> = [];
let pendingMutationResolve: ((value: { id: number; name: string }) => void) | null = null;
const mutationOptions = {
  addFromLibrary: { operation: "add" },
  createCustom: { operation: "custom" },
};
const fixtures: Record<string, unknown> = {
  filters: { muscles: [], equipment: [] },
  search: [
    {
      id: 51,
      name: "Exercice français",
      source: "wger",
      license: "CC0-1.0",
      author: "Fixture",
      muscles: [],
      category: "Strength",
    },
  ],
  get: {
    id: 51,
    name: "Exercice français",
    language: "fr",
    instructions: "Texte",
    source: "wger",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    author: "Fixture",
    sourceRecordUrl: "https://example.test/51",
    attribution: null,
    muscles: [],
    equipment: [],
    media: [],
    translationAttribution: null,
  },
  workouts: [{ id: 71, date: "2026-10-22", type: "Strength" }],
};
let currentSession = {
  user: { id: "native-fixture" },
  session: { activeOrganizationId: "workspace-a" },
};

if (mountedMode) {
  const { GlobalRegistrator } =
    await import("../../web/node_modules/@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost:3000" });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = (tag: string) => (props: Record<string, unknown>) => React.createElement(tag, props);
  mock.module("react-native", () => ({
    View: ({ children, accessibilityLabel, ...props }: Record<string, any>) =>
      React.createElement("section", { ...props, "aria-label": accessibilityLabel }, children),
    Text: ({ children, accessibilityRole, accessibilityLabel, ...props }: Record<string, any>) =>
      React.createElement(
        "span",
        { ...props, role: accessibilityRole, "aria-label": accessibilityLabel },
        children,
      ),
    TextInput: ({ onChangeText, accessibilityLabel, editable, ...props }: Record<string, any>) =>
      React.createElement("input", {
        ...props,
        "aria-label": accessibilityLabel,
        disabled: editable === false,
        onChange: (event: Event) => onChangeText?.((event.currentTarget as HTMLInputElement).value),
      }),
    Image: ({ source, accessibilityLabel, onError, ...props }: Record<string, any>) =>
      React.createElement("img", { ...props, src: source.uri, alt: accessibilityLabel, onError }),
    Platform: { OS: "android" },
    Pressable: ({
      children,
      onPress,
      accessibilityRole,
      accessibilityLabel,
      disabled,
    }: Record<string, any>) =>
      React.createElement(
        "button",
        {
          type: "button",
          role: accessibilityRole,
          "aria-label": accessibilityLabel,
          disabled,
          onClick: onPress,
        },
        children,
      ),
    Linking: { openURL: async () => {} },
  }));
  mock.module("react-native-svg", () => ({
    default: host("svg"),
    Circle: host("circle"),
    Path: host("path"),
    Rect: host("rect"),
  }));
  mock.module("heroui-native", () => ({
    Button: ({ children, onPress, isDisabled, ...props }: Record<string, any>) =>
      React.createElement(
        "button",
        { ...props, type: "button", disabled: isDisabled, onClick: onPress },
        children,
      ),
    Card: "div",
    Spinner: "span",
  }));
  mock.module("@/components/container", () => ({ Container: "div" }));
  mock.module("@/lib/auth-client", () => ({
    authClient: { useSession: () => ({ data: currentSession, isPending: false }) },
  }));
  mock.module("@/src/env", () => ({ ENV: { EXPO_PUBLIC_SERVER_URL: "http://localhost:3000" } }));
  const queryOptions =
    (label: string) =>
    ({ input }: { input: unknown }) => ({ queryKey: [label, input] });
  mock.module("@/utils/orpc", () => ({
    orpc: {
      exerciseCatalog: {
        filters: { queryOptions: queryOptions("filters") },
        search: { queryOptions: queryOptions("search") },
        get: { queryOptions: queryOptions("get") },
        addFromLibrary: { mutationOptions: () => mutationOptions.addFromLibrary },
        createCustom: { mutationOptions: () => mutationOptions.createCustom },
      },
      plans: { workouts: { listWorkouts: { queryOptions: queryOptions("workouts") } } },
    },
  }));
  mock.module("@tanstack/react-query", () => ({
    useQuery: (options: { queryKey: [string, unknown]; enabled?: boolean }) => {
      const [label] = options.queryKey;
      const scopeKey = options.queryKey.at(-1) as { scope?: unknown } | undefined;
      const input = options.queryKey[1];
      queryCalls.push({ label, input, scope: scopeKey?.scope, enabled: options.enabled !== false });
      return {
        data:
          options.enabled === false
            ? undefined
            : label === "search" && scopeKey?.scope === "native-fixture:workspace-b"
              ? [
                  {
                    id: 99,
                    name: "Workspace B exercise",
                    source: "user",
                    muscles: [],
                    category: null,
                  },
                ]
              : fixtures[label],
        isPending: false,
        isError: false,
        refetch: async () => ({ isError: false }),
      };
    },
    useMutation: (options: { operation: "add" | "custom" }) => ({
      mutateAsync: async (input: Record<string, unknown>) => {
        if (options.operation === "add") mutationInputs.push(input);
        const outcome = mutationOutcomes.shift();
        if (outcome?.kind === "reject") throw outcome.error;
        if (outcome?.kind === "hold")
          return new Promise<{ id: number; name: string }>((resolve) => {
            pendingMutationResolve = resolve;
          });
        return outcome?.kind === "resolve" ? outcome.value : { id: 51, name: "Exercice français" };
      },
    }),
  }));
  mock.module("expo-crypto", () => ({ randomUUID: () => "12345678-1234-4234-8234-123456789abc" }));
}

const mounted = mountedMode
  ? await Promise.all([
      import("react-dom/client"),
      import("./exercise-library"),
      import("../../web/node_modules/@testing-library/react"),
    ])
  : null;
const i18nModules = mountedMode
  ? await Promise.all([import("@lingui/react"), import("@openvalens/i18n/testing")])
  : null;
/** Renders with English catalogs, as the app's provider does (#67). */
const withI18n = (element: React.ReactNode) => {
  if (!i18nModules) throw new Error("i18n fixture not loaded");
  const [{ I18nProvider }, { englishI18n }] = i18nModules;
  return React.createElement(I18nProvider, { i18n: englishI18n }, element);
};

test.skipIf(mountedMode)("isolates native production screen mocks in a subprocess", async () => {
  const result = await execFileAsync(process.execPath, ["test", import.meta.path], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, NATIVE_EXERCISE_SCREEN_TEST: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout}${result.stderr}`;
  console.log(output);
  expect(output).toContain("3 pass");
  expect(output).toContain("1 skip");
  expect(output).toContain("0 fail");
});

test.skipIf(!mountedMode)(
  "native production screen adds the selected French exercise and language",
  async () => {
    if (!mounted) throw new Error("mounted native screen fixture not loaded");
    const [dom, screenModule] = mounted;
    const Screen = screenModule.default;
    const container = document.createElement("div");
    document.body.append(container);
    const root = dom.createRoot(container);
    const render = async () =>
      React.act(async () => root.render(withI18n(React.createElement(Screen))));
    const clickButton = async (label: string) => {
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) =>
          candidate.textContent?.trim() === label || candidate.textContent?.includes(label),
      );
      if (!button) throw new Error(`Missing button: ${label}`);
      await React.act(async () => button.click());
    };
    try {
      await render();
      await clickButton("Exercice français");
      expect(container.textContent).toContain("Texte");
      await clickButton("2026-10-22 · Strength");
      await clickButton("Add exercise");
      expect(mutationInputs).toEqual([
        {
          workoutId: 71,
          exerciseId: 51,
          language: "fr",
          clientMutationId: "12345678-1234-4234-8234-123456789abc",
        },
      ]);
      expect(container.textContent).toContain("Exercice français added to the workout.");
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
  },
);

test.skipIf(!mountedMode)(
  "native screen retries the exact French add intent after acknowledgement loss",
  async () => {
    if (!mounted) throw new Error("mounted native screen fixture not loaded");
    const [dom, screenModule] = mounted;
    const container = document.createElement("div");
    document.body.append(container);
    const root = dom.createRoot(container);
    const render = async () =>
      React.act(async () => root.render(withI18n(React.createElement(screenModule.default))));
    const clickButton = async (label: string) => {
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) =>
          candidate.textContent?.trim() === label || candidate.textContent?.includes(label),
      );
      if (!button) throw new Error(`Missing button: ${label}`);
      await React.act(async () => button.click());
    };
    mutationInputs.length = 0;
    mutationOutcomes.push(
      { kind: "reject", error: new Error("synthetic acknowledgement loss") },
      { kind: "resolve", value: { id: 51, name: "Exercice français" } },
    );
    try {
      await render();
      await clickButton("Exercice français");
      await clickButton("2026-10-22 · Strength");
      await clickButton("Add exercise");
      expect(mutationInputs).toHaveLength(1);
      expect(container.textContent).toContain(
        "Could not confirm. Refresh and review before trying again.",
      );
      await clickButton("Refresh and review");
      expect(container.textContent).toContain(
        "Library and workouts refreshed. Review them, then retry the same request if needed.",
      );
      await clickButton("Retry same request");
      expect(mutationInputs).toHaveLength(2);
      expect(mutationInputs[1]).toEqual(mutationInputs[0]);
      expect(mutationInputs[0]).toEqual({
        workoutId: 71,
        exerciseId: 51,
        language: "fr",
        clientMutationId: "12345678-1234-4234-8234-123456789abc",
      });
      expect(container.textContent).toContain("Exercice français added to the workout.");
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
  },
);

test.skipIf(!mountedMode)(
  "native screen fences a pending workspace-A add during live workspace-B rerender",
  async () => {
    if (!mounted) throw new Error("mounted native screen fixture not loaded");
    const [dom, screenModule, testingLibrary] = mounted;
    const container = document.createElement("div");
    document.body.append(container);
    const root = dom.createRoot(container);
    const render = async () =>
      React.act(async () => root.render(withI18n(React.createElement(screenModule.default))));
    const clickButton = async (label: string) => {
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) =>
          candidate.textContent?.trim() === label || candidate.textContent?.includes(label),
      );
      if (!button) throw new Error(`Missing button: ${label}`);
      await React.act(async () => button.click());
    };
    mutationInputs.length = 0;
    queryCalls.length = 0;
    pendingMutationResolve = null;
    mutationOutcomes.push({ kind: "hold" });
    currentSession = {
      user: { id: "native-fixture" },
      session: { activeOrganizationId: "workspace-a" },
    };
    try {
      await render();
      const searchInput = container.querySelector(
        'input[aria-label="Search by exercise name"]',
      ) as HTMLInputElement | null;
      if (!searchInput) throw new Error("Missing search input");
      await React.act(async () => {
        testingLibrary.fireEvent.change(searchInput, { target: { value: "A PRIVATE SEARCH" } });
      });
      expect(
        queryCalls.some(
          (call) =>
            call.label === "search" &&
            call.scope === "native-fixture:workspace-a" &&
            (call.input as { query?: string }).query === "A PRIVATE SEARCH",
        ),
      ).toBe(true);
      await clickButton("Exercice français");
      await clickButton("2026-10-22 · Strength");
      await clickButton("Add exercise");
      expect(mutationInputs).toHaveLength(1);
      expect(container.textContent).toContain("Cancel request");

      currentSession = {
        user: { id: "native-fixture" },
        session: { activeOrganizationId: "workspace-b" },
      };
      await render();
      const workspaceBQueries = queryCalls.filter(
        (call) => call.scope === "native-fixture:workspace-b",
      );
      expect(workspaceBQueries.length).toBeGreaterThan(0);
      const bSearch = workspaceBQueries.find((call) => call.label === "search");
      if (!bSearch) throw new Error("Workspace B search hook was not observed");
      expect((bSearch.input as { query?: string }).query).toBeUndefined();
      expect(
        workspaceBQueries
          .filter((call) => call.label === "search")
          .every((call) => (call.input as { query?: string }).query !== "A PRIVATE SEARCH"),
      ).toBe(true);
      const transitionDetail = workspaceBQueries.find((call) => call.label === "get");
      expect(transitionDetail).toBeTruthy();
      expect(transitionDetail?.enabled).toBe(false);
      expect(container.textContent).not.toContain("Exercice français");
      expect(container.textContent).toContain("Workspace B exercise");
      expect(
        (container.querySelector('input[aria-label="Search by exercise name"]') as HTMLInputElement)
          .value,
      ).toBe("");

      expect(pendingMutationResolve).toBeTruthy();
      await React.act(async () => pendingMutationResolve!({ id: 51, name: "A PRIVATE SUCCESS" }));
      expect(container.textContent).not.toContain("A PRIVATE SUCCESS");
      expect(container.textContent).not.toContain("Exercice français added to the workout.");
      expect(container.textContent).toContain("Workspace B exercise");
      expect(mutationInputs).toHaveLength(1);
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
  },
);
