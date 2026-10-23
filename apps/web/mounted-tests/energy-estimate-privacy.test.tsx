import { expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";

const mounted =
  process.env.MOUNTED_ENERGY_PRIVACY_TEST === "1"
    ? await Promise.all([
        import("@testing-library/react"),
        import("@tanstack/react-query"),
        import("react"),
        import("../src/components/energy-estimate-card"),
        import("../src/utils/orpc"),
        import("@openvalens/api/presenters/nutrition-diary"),
        import("@openvalens/api/contracts/energy-estimate"),
      ])
    : null;

const scope = "synthetic-energy-scope";
const targetKey = ["synthetic-targets"];
const estimateValues = ["7,777 kcal/day", "6,777–8,777 kcal/day"];

test.skipIf(process.env.MOUNTED_ENERGY_PRIVACY_TEST !== "1")(
  "mounted card never presents cached proposal numbers without an authorized current estimate",
  async () => {
    if (!mounted) throw new Error("mounted suite setup not loaded");
    const [{ cleanup, render, screen, waitFor }, query, react, component, orpcModule, diary] =
      mounted;
    const { QueryClient, QueryClientProvider } = query;
    const { createElement } = react;
    const withI18n = (node: ReturnType<typeof createElement>) =>
      createElement(I18nProvider, { i18n: englishI18n }, node);
    const { EnergyEstimateCard } = component;
    const { orpc } = orpcModule;
    const date = diary.localDateIn(diary.deviceTimeZone());
    const estimateOptions = orpc.nutritionEnergy.estimate.queryOptions({ input: { to: date } });
    const proposalOptions = orpc.nutritionEnergy.listProposals.queryOptions({ input: {} });
    const cacheKey = (key: readonly unknown[]) => [...key, { offlineScope: scope }];
    const proposal = {
      id: 42,
      kind: "maintenance",
      status: "pending",
      expired: false,
      estimateKcal: 7_777,
      targetKcal: 7_777,
      currentTargetKcal: 6_777,
      stepLimited: false,
      methodVersion: 1,
      policyVersion: "synthetic",
      window: { from: date, to: date },
      estimate: null,
      createdAt: `${date}T12:00:00.000Z`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      decidedAt: null,
      acceptedGoalId: null,
      needsConfirmation: false,
      notes: [],
    } satisfies import("@openvalens/api/contracts/energy-estimate").EnergyProposalWire;
    const estimate = {
      status: "estimated",
      experimental: true,
      window: { from: date, to: date, days: 1 },
      method: {
        id: "energy_balance",
        version: 1,
        windowDays: 1,
        energyDensityKcalPerKg: 7_700,
        minIntakeDays: 1,
        maxRecentMissingIntakeDays: 1,
        minWeightDays: 1,
        minWeightChangeDays: 1,
        maxWeightGapDays: 1,
        weightChangeFloorKg: 0.1,
        plausibleKcalPerDay: { min: 1, max: 10_000 },
        rangeStandardDeviations: 1,
        precisionKcal: 1,
        weightTrendMethod: { id: "synthetic", version: 1 },
      },
      formula: "Synthetic formula",
      energyDensity: {
        valueKcalPerKg: 7_700,
        label: "Synthetic density",
        sources: [],
        caveat: "Synthetic caveat",
      },
      inputs: {
        intake: {
          days: [],
          usedDays: 1,
          notMarkedCompleteDays: 0,
          nothingLoggedDays: 0,
          energyNotKnownDays: 0,
          recentMissingDays: 0,
          meanKcal: 7_777,
          standardDeviationKcal: 0,
        },
        weight: {
          trendMethod: { id: "synthetic", version: 1 },
          observedDays: 1,
          trendDays: 1,
          longestGapDays: 0,
          change: null,
          ratePerWeekKg: 0,
          residualStandardDeviationKg: 0,
        },
        activity: "not_used",
      },
      reasons: [],
      reasonNotes: [],
      estimate: {
        kcalPerDay: 7_777,
        range: { lowKcal: 6_777, highKcal: 8_777 },
        components: { meanIntakeKcal: 7_777, weightChangeKcalPerDay: 0 },
        uncertainty: {
          intakeStandardErrorKcal: 0,
          weightChangeStandardDeviationKg: 0,
          combinedStandardDeviationKcal: 0,
          rangeStandardDeviations: 1,
        },
      },
      notes: {
        experimental: "Synthetic note",
        units: "Synthetic units",
        missing: "Synthetic missing",
        activity: "Synthetic activity",
        variability: "Synthetic variability",
        proposals: "Synthetic proposals",
      },
    } satisfies import("@openvalens/api/contracts/energy-estimate").EnergyEstimateOutput;

    const originalFetch = globalThis.fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const setCache = () => {
      client.setQueryData(cacheKey(estimateOptions.queryKey), estimate);
      client.setQueryData(cacheKey(proposalOptions.queryKey), { proposals: [proposal] });
    };
    const show = (hideNumbers: boolean) =>
      render(
        withI18n(
          createElement(
            QueryClientProvider,
            { client },
            createElement(EnergyEstimateCard, { hideNumbers, scope, targetsQueryKey: targetKey }),
          ),
        ),
      );
    try {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async () => new Response("synthetic forbidden", { status: 403 }),
      });

      setCache();
      show(false);
      await screen.findByRole("alert");
      await waitFor(() => {
        const content = document.body.textContent ?? "";
        for (const value of estimateValues) expect(content).not.toContain(value);
        expect(content).not.toContain("7,777 kcal/day");
        expect(content).not.toContain("6,777 kcal/day");
      });
      expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      cleanup();

      for (const status of ["hidden", "off", "adults_only"] as const) {
        client.clear();
        client.setQueryData(cacheKey(estimateOptions.queryKey), {
          status,
          experimental: true,
          note: "Synthetic withheld",
        });
        client.setQueryData(cacheKey(proposalOptions.queryKey), { proposals: [proposal] });
        show(false);
        await screen.findByText("An estimate is not available yet.");
        expect(document.body.textContent).not.toContain("7,777 kcal/day");
        expect(document.body.textContent).not.toContain("6,777 kcal/day");
        cleanup();
      }

      client.clear();
      client.setQueryDefaults(cacheKey(estimateOptions.queryKey), { staleTime: Infinity });
      client.setQueryDefaults(cacheKey(proposalOptions.queryKey), { staleTime: Infinity });
      client.setQueryData(cacheKey(estimateOptions.queryKey), estimate);
      client.setQueryData(cacheKey(proposalOptions.queryKey), { proposals: [proposal] });
      show(true);
      await screen.findByText(/Numbers are hidden/);
      expect(document.body.textContent).not.toContain("7,777 kcal/day");
      cleanup();

      client.clear();
      client.setQueryDefaults(cacheKey(estimateOptions.queryKey), { staleTime: Infinity });
      client.setQueryDefaults(cacheKey(proposalOptions.queryKey), { staleTime: Infinity });
      client.setQueryData(cacheKey(estimateOptions.queryKey), estimate);
      client.setQueryData(cacheKey(proposalOptions.queryKey), { proposals: [proposal] });
      show(false);
      await screen.findByText("Suggested: 7,777 kcal/day");
      expect(document.body.textContent).toContain("Current target: 6,777 kcal/day");
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
      client.clear();
      cleanup();
    }
  },
);
