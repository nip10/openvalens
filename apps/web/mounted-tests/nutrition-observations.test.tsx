import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import * as React from "react";
import type { InsightsResult } from "@openvalens/api/insight-contract";

const execFileAsync = promisify(execFile);
const mountedMode = process.env.MOUNTED_NUTRITION_OBSERVATIONS_TEST === "1";
let submittedPatch: unknown;
let preference = { channels: { observation: { in_app: false, push: false, email: false } } };
let sessionPending = false;
let sessionUserId: string | null = "nutrition-test";
let sessionOrganizationId: string | null = null;
let preferenceFailure = false;
let insightsFailure = false;
let observationPayload: InsightsResult["observations"] = [];
let updateOverride: (() => Promise<unknown>) | null = null;
let insightsOverride: (() => Promise<unknown>) | null = null;

if (mountedMode) {
  mock.module("../src/lib/auth-client", () => ({
    authClient: {
      useSession: () => ({
        data: sessionUserId
          ? {
              user: { id: sessionUserId },
              session: { activeOrganizationId: sessionOrganizationId },
            }
          : null,
        isPending: sessionPending,
      }),
    },
  }));
  mock.module("@tanstack/react-router", () => ({
    Link: (props: { children: React.ReactNode }) => React.createElement("a", null, props.children),
  }));
  mock.module("../src/utils/product-settings", () => ({
    useProductSettings: () => ({ data: null }),
  }));
  mock.module("../src/components/insights-panel", () => ({
    InsightsCard: () => React.createElement("div", null, "Synthetic summary card"),
    PushOfferCard: () => null,
    SummaryCards: () => null,
  }));
  mock.module("../src/utils/orpc", () => {
    const queryOptions = (name: string, queryFn: (actor: string) => unknown) => {
      const actor = `${sessionUserId ?? "anonymous"}:${sessionOrganizationId ?? "personal"}`;
      return {
        queryKey: ["nutrition-test", name],
        queryFn: () => queryFn(actor),
      };
    };
    const mutationOptions = (name: string, options: Record<string, unknown> = {}) => ({
      ...options,
      mutationFn: (input: unknown) => {
        if (name === "preferences.update") {
          submittedPatch = input;
          if (updateOverride) return updateOverride();
          preference = {
            channels: {
              observation: {
                in_app: (input as { channels: { observation: { in_app: boolean } } }).channels
                  .observation.in_app,
                push: false,
                email: false,
              },
            },
          };
        }
        return Promise.resolve(preference);
      },
    });
    return {
      orpc: {
        score: {
          readiness: { queryOptions: () => queryOptions("readiness", () => null) },
          goalProgress: { queryOptions: () => queryOptions("goals", () => null) },
        },
        insights: {
          list: {
            queryOptions: () =>
              queryOptions("insights", (actor: string) => {
                if (actor !== "nutrition-test:personal")
                  return { observations: [], insights: [], offerPush: false };
                if (insightsOverride) return insightsOverride();
                if (insightsFailure) throw new Error("synthetic permission failure");
                return { observations: observationPayload, insights: [], offerPush: false };
              }),
          },
          preferences: {
            get: {
              queryOptions: () => {
                if (preferenceFailure)
                  return {
                    queryKey: ["nutrition-test", "preferences"],
                    queryFn: () => {
                      throw new Error("synthetic preference failure");
                    },
                  };
                return queryOptions("preferences", (actor: string) =>
                  actor === "nutrition-test:personal"
                    ? preference
                    : { channels: { observation: { in_app: false, push: false, email: false } } },
                );
              },
            },
            update: {
              mutationOptions: (options: Record<string, unknown>) =>
                mutationOptions("preferences.update", options),
            },
          },
          feedback: {
            mutationOptions: (options: Record<string, unknown>) =>
              mutationOptions("feedback", options),
          },
        },
        ai: {
          consent: {
            get: { queryOptions: () => queryOptions("consent", () => ({ granted: false })) },
          },
        },
      },
    };
  });
}

const observation = {
  ruleId: "observation.meals_near_sleep",
  matchingEvents: 13,
  minimumMatchingEvents: 9,
  title: "Meals and recorded sleep timing",
  body: "Some logged meals were recorded within four hours before sleep starts (13 matching events).",
  completeness: "Diary marked complete on 5 days; 7 evenings recorded.",
  window: { from: "2026-10-01", to: "2026-10-07", days: 7 },
} satisfies InsightsResult["observations"][number];
observationPayload = [observation];
const mounted = mountedMode
  ? await Promise.all([
      import("@testing-library/react"),
      import("@tanstack/react-query"),
      import("react"),
      import("../src/components/insights-section"),
      import("@openvalens/api/presenters/insights"),
    ])
  : null;

test.skipIf(mountedMode)("isolates nutrition observation mounts in a subprocess", async () => {
  const result = await execFileAsync(
    process.execPath,
    [
      "test",
      // Lingui macros (#67): the subprocess runs outside the web package's bunfig.
      "--preload",
      `${import.meta.dir}/../../../scripts/test/lingui-macro.ts`,
      "--preload",
      `${import.meta.dir}/setup.tsx`,
      import.meta.path,
    ],
    {
      cwd: `${import.meta.dir}/../..`,
      env: {
        ...process.env,
        MOUNTED_NUTRITION_OBSERVATIONS_TEST: "1",
        VITE_SERVER_URL: "http://localhost:3000",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  expect(`${result.stdout}${result.stderr}`).toContain("1 pass");
});

test.skipIf(!mountedMode)(
  "saved-off observations stay hidden until the dedicated opt-in is enabled",
  async () => {
    if (!mounted) throw new Error("mounted setup not loaded");
    const [{ cleanup, render, screen, waitFor }, query, react, component, presenter] = mounted;
    const { QueryClient, QueryClientProvider } = query;
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    submittedPatch = undefined;
    preference = { channels: { observation: { in_app: false, push: false, email: false } } };
    try {
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      await screen.findByText("Off by default. No nutrition observations are shown.");
      expect(screen.queryByText(observation.title)).toBeNull();
      await mounted[0].fireEvent.click(
        screen.getByRole("button", { name: "Turn on nutrition observations" }),
      );
      expect(
        await screen.findByRole("article", {
          name: `${observation.title}. ${observation.body}. ${observation.completeness}`,
        }),
      ).toBeTruthy();
      expect(screen.getByRole("article").textContent).toContain("13 matching events");
      expect(screen.getByRole("article").getAttribute("aria-label")).toContain(
        "13 matching events",
      );
      expect(screen.getByText("Period: 2026-10-01 to 2026-10-07 (7 days)")).toBeTruthy();
      expect(screen.getByText(observation.completeness)).toBeTruthy();
      expect(submittedPatch).toEqual(presenter.observationPreferencePatch(true));
      expect(submittedPatch).toEqual({ channels: { observation: { in_app: true } } });
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Turn off nutrition observations" }),
        ).toBeTruthy(),
      );

      // Revocation hides while a deferred update is unresolved, then stays hidden after rejection.
      let rejectUpdate!: (error: Error) => void;
      updateOverride = () =>
        new Promise((_resolve, reject) => {
          rejectUpdate = reject;
        });
      mounted[0].fireEvent.click(
        screen.getByRole("button", { name: "Turn off nutrition observations" }),
      );
      expect(screen.queryByRole("article")).toBeNull();
      await waitFor(() => expect(typeof rejectUpdate).toBe("function"));
      expect(
        client.getQueryData(
          presenter.privateInsightsQueryKey(
            ["nutrition-test", "preferences"],
            "nutrition-test",
            null,
          ) as readonly unknown[],
        ) as unknown,
      ).toEqual({ channels: { observation: { in_app: true, push: false, email: false } } });
      expect(screen.queryByRole("alert")).toBeNull();
      rejectUpdate(new Error("synthetic deferred update failure"));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Your saved setting is unchanged",
      );
      expect(screen.getByRole("button", { name: "Turn off nutrition observations" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry saving choice" })).toBeTruthy();
      expect(screen.queryByText(observation.title)).toBeNull();
      updateOverride = null;

      // A preference-read failure fails closed even if the cached permission said on.
      cleanup();
      client.clear();
      preference = { channels: { observation: { in_app: true, push: false, email: false } } };
      preferenceFailure = true;
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      await screen.findByText("Could not load observation setting. Retry");
      expect(screen.queryByText(observation.title)).toBeNull();
      expect(screen.queryByRole("article")).toBeNull();

      // Insights permission errors retain the actor cache but must not expose its observation/count.
      cleanup();
      preferenceFailure = false;
      insightsFailure = true;
      const insightsKey = presenter.privateInsightsQueryKey(
        ["nutrition-test", "insights"],
        "nutrition-test",
        null,
      );
      const retained = { observations: [observation], insights: [], offerPush: false };
      client.setQueryData<typeof retained>(insightsKey, retained);
      let rejectInsights!: (error: Error) => void;
      let insightsStarted!: () => void;
      const fetchingStarted = new Promise<void>((resolve) => {
        insightsStarted = resolve;
      });
      insightsOverride = () => {
        insightsStarted();
        return new Promise((_resolve, reject) => {
          rejectInsights = reject;
        });
      };
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      void client.invalidateQueries({ queryKey: insightsKey });
      await fetchingStarted;
      await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
      expect(client.getQueryData(insightsKey) as unknown).toEqual(retained);
      expect(document.body.textContent).not.toContain("13 matching events");
      rejectInsights(new Error("synthetic permission denial"));
      await screen.findByText("Could not load insights.");
      expect(client.getQueryData(insightsKey) as unknown).toEqual(retained);
      expect(document.body.textContent).not.toContain("13 matching events");
      expect(screen.queryByRole("article")).toBeNull();
      insightsOverride = null;

      cleanup();
      client.clear();
      insightsFailure = false;
      preference = { channels: { observation: { in_app: true, push: false, email: false } } };
      observationPayload = [];
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      expect(
        await screen.findByText(
          "No observations to show for this period. Some records may be missing or incomplete.",
        ),
      ).toBeTruthy();
      expect(screen.queryByRole("article")).toBeNull();

      // Redacted values stay absent from both visible copy and accessibility labels; restore proves records are unchanged.
      cleanup();
      client.clear();
      observationPayload = [
        {
          ...observation,
          matchingEvents: null,
          minimumMatchingEvents: null,
          body: "Some logged meals were recorded within four hours before sleep starts.",
          completeness: "Some records may be missing or incomplete.",
        },
      ];
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      const redactedArticle = await screen.findByRole("article");
      expect(redactedArticle.textContent).toContain("2026-10-01 to 2026-10-07");
      expect(redactedArticle.textContent).toContain("Some records may be missing or incomplete.");
      expect(redactedArticle.textContent).not.toContain("13 matching events");
      expect(redactedArticle.getAttribute("aria-label")).not.toContain("13 matching events");
      observationPayload = [observation];
      cleanup();
      client.clear();
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      const restored = await screen.findByRole("article");
      expect(restored.textContent).toContain("13 matching events");
      expect(restored.getAttribute("aria-label")).toContain("13 matching events");
      expect(restored.textContent).toContain(
        "Diary marked complete on 5 days; 7 evenings recorded.",
      );
      expect(restored.textContent).toContain("Period: 2026-10-01 to 2026-10-07 (7 days)");

      // Pending auth and an owner/org switch never paint the previous subject's cached view.
      cleanup();
      sessionPending = true;
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      expect(screen.getByText("Loading insights…")).toBeTruthy();
      expect(screen.queryByRole("article")).toBeNull();
      cleanup();
      sessionPending = false;
      sessionUserId = "nutrition-owner-b";
      sessionOrganizationId = "workspace-b";
      render(
        react.createElement(
          QueryClientProvider,
          { client },
          react.createElement(
            I18nProvider,
            { i18n: englishI18n },
            react.createElement(component.InsightsSection),
          ),
        ),
      );
      await screen.findByText("Off by default. No nutrition observations are shown.");
      expect(screen.queryByRole("article")).toBeNull();
      expect(screen.queryByText(observation.title)).toBeNull();
      expect(client.getQueryData(insightsKey) as unknown).toEqual(retained);
    } finally {
      cleanup();
      client.clear();
      sessionPending = false;
      sessionUserId = "nutrition-test";
      sessionOrganizationId = null;
      preferenceFailure = false;
      insightsFailure = false;
    }
  },
);
