import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";

const child = process.env.NATIVE_HISTORY_TEST === "1";
test.skipIf(child)(
  "isolates mounted workout history interactions",
  async () => {
    const result = await promisify(execFile)(process.execPath, ["test", import.meta.path], {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NATIVE_HISTORY_TEST: "1" },
      timeout: 25_000,
      maxBuffer: 10_000_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    console.log(output);
    expect(output).toContain("1 pass");
    expect(output).toContain("1 skip");
    expect(output).toContain("0 fail");
  },
  30_000,
);

if (child) {
  const hPromise = import("./workout-test-harness");
  const session = { user: { id: "person-a" }, session: { activeOrganizationId: "org-a" } };
  const make = (id: number, date: string, reps: number) => ({
    workoutId: id,
    date,
    createdAt: `${date}T12:00:00Z`,
    topSetWeightKg: id === 1 ? 100 : 60,
    estimated1RmKg: reps <= 12 ? (id === 1 ? 110 : 62) : null,
    volumeKg: reps * 50,
    prs: id === 1 ? [{ kind: "heaviest_weight", weightKg: 100 }] : [],
    exercises: [{ sets: [{ reps, weightKg: 50 }] }],
  });
  const first = {
    items: [make(2, "2026-10-02", 13), make(1, "2026-10-01", 8)],
    nextCursor: "cursor-2" as string | null,
    records: {
      heaviestWeightKg: 100,
      bestEstimated1RmKg: 110,
      mostRepsAtWeight: [{ weightKg: 50, reps: 13 }],
    },
  };
  const second = {
    items: [make(1, "2026-10-01", 8), make(3, "2026-10-03", 10)],
    nextCursor: null,
    records: first.records,
  };
  let units: "metric" | "imperial" = "metric";
  let inputFactory: any;
  mock.module("@/lib/auth-client", () => ({
    authClient: { useSession: () => ({ data: session }) },
  }));
  mock.module("@/lib/workouts/model", () => ({
    weightFromKg: (kg: number, unit: string) => (unit === "imperial" ? kg * 2.2046226218 : kg),
  }));
  mock.module("@/utils/orpc", () => ({
    orpc: {
      adminSettings: { productSettings: { queryOptions: () => ({ queryKey: ["settings"] }) } },
      plans: {
        workouts: {
          exerciseHistory: {
            infiniteOptions: (options: any) => {
              inputFactory = options.input;
              return { ...options, queryKey: ["history"] };
            },
          },
        },
      },
    },
  }));
  mock.module("@/components/chart", () => ({
    TrendChart: ({ data }: any) =>
      React.createElement("div", { "data-testid": "chart" }, JSON.stringify(data)),
  }));
  const { useState } = React;
  mock.module("@tanstack/react-query", () => ({
    useQuery: () => ({ data: { units } }),
    useInfiniteQuery: () => {
      const [pages, setPages] = useState([first]);
      return {
        data: { pages },
        isPending: false,
        isError: false,
        hasNextPage: pages.length === 1,
        isFetchingNextPage: false,
        refetch: async () => {},
        fetchNextPage: async () => {
          expect(inputFactory("cursor-2")).toEqual({
            exercise: { exerciseId: 12 },
            limit: 20,
            cursor: "cursor-2",
          });
          setPages([first, second]);
        },
      };
    },
  }));
  test("mounted history paginates, deduplicates, labels PRs, converts units, and excludes 13-rep Epley values", async () => {
    const h = await (await hPromise).setupMountedHarness();
    try {
      const { WorkoutExerciseHistory } = await import("./workout-history");
      await h.render(React.createElement(WorkoutExerciseHistory, { exercise: { exerciseId: 12 } }));
      expect(h.container.textContent).toContain("100.0 kg");
      expect(h.container.textContent).toContain("Personal record · Heaviest weight");
      const chart = () =>
        JSON.parse(h.container.querySelector('[data-testid="chart"]')?.textContent ?? "[]");
      expect(chart().map((p: any) => p.value)).toEqual([100, 60]);
      await h.click("Estimated 1RM");
      expect(h.container.textContent).toContain(
        "Sets above 12 reps remain included in history and volume.",
      );
      expect(chart().map((p: any) => p.value)).toEqual([110]);
      await h.click("Volume");
      expect(chart()).toHaveLength(2);
      expect(h.container.textContent).toContain("13");
      await h.click("Load more sessions");
      expect(h.container.querySelectorAll("[data-testid='chart']")).toHaveLength(1);
      expect(h.container.textContent.match(/Personal record · Heaviest weight/g)).toHaveLength(1);
      expect(h.container.textContent).toContain("2026");
      units = "imperial";
      await h.click("Top weight");
      expect(h.container.textContent).toContain("lb");
      expect(chart()[0].value).toBeCloseTo(220.462, 2);
    } finally {
      await h.cleanup();
    }
  });
}
