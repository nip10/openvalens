import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import * as React from "react";
import type { InsightsResult } from "@openvalens/api/insight-contract";
import type {} from "uniwind/types";

const childMode = process.env.NATIVE_INSIGHTS_GATE_TEST === "1";
if (!childMode) {
  test("isolates mounted insights regression in a subprocess", async () => {
    const result = await promisify(execFile)(process.execPath, ["test", import.meta.path], {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NATIVE_INSIGHTS_GATE_TEST: "1" },
      timeout: 25_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
  }, 30_000);
} else {
  const { GlobalRegistrator } =
    await import("../../web/node_modules/@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost:3000" });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  type HostProps = {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    onPress?: () => void;
    isDisabled?: boolean;
  };
  const View = ({ children, accessibilityLabel }: HostProps) =>
    React.createElement("section", { "aria-label": accessibilityLabel }, children);
  const Text = ({ children, accessibilityLabel, accessibilityRole }: HostProps) =>
    React.createElement(
      "span",
      {
        "aria-label": accessibilityLabel,
        role: accessibilityRole === "header" ? "heading" : accessibilityRole,
      },
      children,
    );
  const Pressable = ({
    children,
    accessibilityLabel,
    accessibilityRole,
    onPress,
    isDisabled,
  }: HostProps) =>
    React.createElement(
      "button",
      {
        type: "button",
        "aria-label": accessibilityLabel,
        role: accessibilityRole,
        onClick: onPress,
        disabled: isDisabled,
      },
      children,
    );
  mock.module("react-native", () => ({ View, Text, Pressable }));
  mock.module("heroui-native", () => ({
    Card: View,
    Button: Object.assign(Pressable, { Label: Text }),
    cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
  }));
  const unexpected = () => {
    throw new Error("Unexpected navigation, push, or RPC call");
  };
  mock.module("expo-router", () => ({ router: { push: unexpected } }));
  mock.module("@/lib/push-notifications", () => ({
    enablePushOnThisPhone: unexpected,
    describePushRegistration: unexpected,
  }));
  let session: { user: { id: string }; session: { activeOrganizationId: string | null } } | null = {
    user: { id: "member-1" },
    session: { activeOrganizationId: "workspace-1" },
  };
  let sessionPending = false;
  mock.module("@/lib/auth-client", () => ({
    authClient: {
      useSession: () => ({
        isPending: sessionPending,
        data: session,
      }),
    },
  }));
  const endpoint = (name: string) => ({ queryOptions: () => ({ queryKey: [name] }) });
  const preferencePatches: unknown[] = [];
  let preferenceWrite: () => Promise<unknown> = async () => {
    throw new Error("Unexpected preference update");
  };
  mock.module("@/utils/orpc", () => ({
    orpc: {
      score: { readiness: endpoint("readiness"), goalProgress: endpoint("goals") },
      insights: { list: endpoint("insights"), preferences: { get: endpoint("preferences") } },
      ai: { consent: { get: endpoint("consent") } },
    },
    client: {
      insights: {
        feedback: unexpected,
        preferences: {
          update: (input: unknown) => {
            preferencePatches.push(input);
            return preferenceWrite();
          },
        },
      },
    },
  }));
  const realQuery = { ...(await import("@tanstack/react-query")) };
  const queryClient = new realQuery.QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  let phase: "success" | "fetching" | "denied" = "success";
  let preferenceState: "success" | "pending" | "error" = "success";
  const denied = Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  mock.module("@tanstack/react-query", () => ({
    ...realQuery,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const isInsights = queryKey[0] === "insights";
      const isPreferences = queryKey[0] === "preferences";
      const isError = isInsights && phase === "denied";
      const isFetching = isInsights && phase === "fetching";
      const preferenceError = isPreferences && preferenceState === "error";
      const preferencePending = isPreferences && preferenceState === "pending";
      return {
        data: queryClient.getQueryData(queryKey),
        error: isError || preferenceError ? denied : null,
        status: isError || preferenceError ? "error" : preferencePending ? "pending" : "success",
        fetchStatus: isFetching ? "fetching" : "idle",
        isSuccess: !isError && !preferenceError && !preferencePending,
        isError: isError || preferenceError,
        isPending: preferencePending,
        isFetching,
        refetch: unexpected,
      };
    },
  }));
  const { runInsightRules } = await import("@openvalens/api/insight-rules");
  const { nutritionObservationView, privateInsightsQueryKey } =
    await import("@openvalens/api/presenters/insights");
  const { observationPreferencePatch } = await import("@openvalens/api/presenters/insights");
  const reactDomClientModule = "react-dom/client";
  const { createRoot } = await import(reactDomClientModule);
  const { InsightsSection } = await import("./insights-section");
  test("retained numeric observations require a successful settled insights read", async () => {
    const asOf = "2026-10-15";
    const series = Array.from({ length: 40 }, (_, i) => {
      const date = new Date(`${asOf}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - i);
      return {
        date: date.toISOString().slice(0, 10),
        value: (i <= 8 ? 68 : 60) + (i % 2 === 0 ? 1 : -1),
        source: null,
      };
    });
    const output = runInsightRules({ asOf, series: { resting_heart_rate: series }, goals: null });
    const observation: InsightsResult["observations"][number] = {
      ruleId: "observation.meals_and_workouts",
      window: { from: "2026-10-01", to: "2026-10-07", days: 7 },
      matchingEvents: 4,
      minimumMatchingEvents: 3,
      completeness: "4 matching timestamped records from completed diary days in the 7-day window.",
      title: "Meals and recorded workouts",
      body: "Some logged meals occurred within four hours of recorded workouts in this window. This describes timing in your records only and does not establish a relationship between meal timing and workouts.",
    };
    const payload: InsightsResult = {
      engineVersion: output.engineVersion,
      asOf,
      status: "available",
      withheldReason: null,
      insights: output.insights,
      observations: [observation],
      readiness: output.readiness,
      hiddenCount: 1,
      budget: { changeCap: 2, suppressedChanges: 0 },
      offerPush: false,
    };
    const key = (name: string) => privateInsightsQueryKey([name], "member-1", "workspace-1");
    const cache = queryClient as unknown as {
      setQueryData: (queryKey: readonly unknown[], data: unknown) => void;
      getQueryData: (queryKey: readonly unknown[]) => unknown;
    };
    const preferences = { channels: { observation: { in_app: true, push: false, email: false } } };
    cache.setQueryData(key("insights"), payload);
    cache.setQueryData(key("preferences"), preferences);
    cache.setQueryData(key("consent"), { granted: false });
    const view = nutritionObservationView(englishI18n, observation);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const labels = () =>
      Array.from(container.querySelectorAll("[aria-label]")).map(
        (element) => element.getAttribute("aria-label") ?? "",
      );
    const render = async (next: typeof phase = phase) => {
      phase = next;
      await React.act(async () => {
        root.render(
          React.createElement(
            realQuery.QueryClientProvider,
            { client: queryClient },
            React.createElement(
              I18nProvider,
              { i18n: englishI18n },
              React.createElement(InsightsSection),
            ),
          ),
        );
      });
    };
    const assertObservation = (
      visible: boolean,
      expectedPayload: unknown = payload,
      expectedPreferences: unknown = preferences,
    ) => {
      for (const text of [view.title, view.body, view.completeness, view.period])
        expect(container.textContent?.includes(text)).toBe(visible);
      expect(labels().includes(view.accessibilityLabel)).toBe(visible);
      expect(labels().join("\n").includes("4 matching timestamped records")).toBe(visible);
      expect(cache.getQueryData(key("insights"))).toEqual(expectedPayload);
      expect(cache.getQueryData(key("preferences"))).toEqual(expectedPreferences);
    };
    const reset = async (nextPreferences = preferences, nextPayload = payload) => {
      await React.act(async () => root.render(null));
      queryClient.clear();
      session = { user: { id: "member-1" }, session: { activeOrganizationId: "workspace-1" } };
      sessionPending = false;
      preferenceState = "success";
      phase = "success";
      cache.setQueryData(key("insights"), nextPayload);
      cache.setQueryData(key("preferences"), nextPreferences);
      cache.setQueryData(key("consent"), { granted: false });
      await render();
    };
    try {
      expect(view.accessibilityLabel).toContain("4 matching timestamped records");
      await render("success");
      assertObservation(true);
      await render("fetching");
      assertObservation(false);
      await render("denied");
      expect(container.textContent).toContain("Could not load insights. Retry");
      assertObservation(false);
      await render("success");
      assertObservation(true);

      await reset({ channels: { observation: { in_app: false, push: false, email: false } } });
      assertObservation(false, payload, {
        channels: { observation: { in_app: false, push: false, email: false } },
      });
      await reset();
      preferenceState = "pending";
      await render();
      assertObservation(false);
      preferenceState = "error";
      await render();
      expect(container.textContent).toContain("Could not load setting. Retry");
      assertObservation(false);

      const emptyPayload = { ...payload, observations: [] };
      await reset(preferences, emptyPayload);
      assertObservation(false, emptyPayload);
      expect(container.textContent).toContain(
        "No observations to show for this period. Some records may be missing or incomplete.",
      );

      await reset();
      const redacted = {
        ...observation,
        matchingEvents: null,
        minimumMatchingEvents: null,
        completeness: "Some records may be missing or incomplete.",
      } as unknown as InsightsResult["observations"][number];
      const redactedPayload = { ...payload, observations: [redacted] };
      await reset(preferences, redactedPayload);
      const redactedView = nutritionObservationView(englishI18n, redacted);
      expect(container.textContent).not.toContain("matching timestamped records");
      expect(container.textContent).not.toContain("minimum");
      expect(labels().join("\n")).not.toContain("matching timestamped records");
      expect(labels().join("\n")).not.toContain("minimum");
      expect(cache.getQueryData(key("insights"))).toEqual(redactedPayload);
      expect(redactedView.accessibilityLabel).not.toContain("matching timestamped records");
      await reset();
      expect(container.textContent).toContain("4 matching timestamped records");
      expect(labels().join("\n")).toContain("4 matching timestamped records");
      expect(cache.getQueryData(key("insights"))).toEqual(payload);

      await reset();
      sessionPending = true;
      await render();
      expect(container.textContent).toContain("Loading insights…");
      assertObservation(false);
      sessionPending = false;
      session = { user: { id: "member-2" }, session: { activeOrganizationId: "workspace-1" } };
      await render();
      assertObservation(false);
      session = { user: { id: "member-1" }, session: { activeOrganizationId: "workspace-2" } };
      await render();
      assertObservation(false);
      expect(cache.getQueryData(key("insights"))).toEqual(payload);
      expect(queryClient.getQueryCache().getAll()).toHaveLength(3);

      await reset();
      let rejectWrite!: (error: Error) => void;
      preferenceWrite = () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        });
      const toggleOff = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Turn off nutrition observations"]',
      );
      expect(toggleOff).toBeTruthy();
      await React.act(async () => toggleOff!.click());
      assertObservation(false);
      expect(preferencePatches.at(-1)).toEqual(observationPreferencePatch(false));
      expect(preferencePatches.at(-1)).toEqual({
        channels: { observation: { in_app: false } },
      });
      await React.act(async () => rejectWrite(new Error("offline")));
      expect(container.textContent).toContain("Your saved setting is unchanged.");
      expect(
        Array.from(container.querySelectorAll("button")).some((button) =>
          button.textContent?.includes("Retry saving choice"),
        ),
      ).toBe(true);
      assertObservation(false);

      await reset();
      let resolveWrite!: (value: unknown) => void;
      preferenceWrite = () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        });
      const toggleOn = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Turn off nutrition observations"]',
      );
      await React.act(async () => toggleOn!.click());
      assertObservation(false);
      expect(preferencePatches.at(-1)).toEqual(observationPreferencePatch(false));
      await React.act(async () => resolveWrite({}));

      const disabledPreferences = {
        channels: { observation: { in_app: false, push: false, email: false } },
      };
      await reset(disabledPreferences);
      let resolveEnable!: (value: unknown) => void;
      preferenceWrite = () =>
        new Promise((resolve) => {
          resolveEnable = resolve;
        });
      const enableToggle = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Turn on nutrition observations"]',
      );
      expect(enableToggle).toBeTruthy();
      await React.act(async () => enableToggle!.click());
      expect(preferencePatches.at(-1)).toEqual(observationPreferencePatch(true));
      expect(preferencePatches.at(-1)).toEqual({
        channels: { observation: { in_app: true } },
      });
      await React.act(async () => resolveEnable({}));
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
      queryClient.clear();
    }
  });
}
