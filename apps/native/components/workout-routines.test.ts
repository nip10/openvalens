import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";

const child = process.env.NATIVE_ROUTINES_TEST === "1";
test.skipIf(child)(
  "isolates mounted routine interactions",
  async () => {
    const result = await promisify(execFile)(process.execPath, ["test", import.meta.path], {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NATIVE_ROUTINES_TEST: "1" },
      timeout: 25_000,
      maxBuffer: 10_000_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    console.log(output);
    expect(output).toContain("3 pass");
    expect(output).toContain("1 skip");
    expect(output).toContain("0 fail");
  },
  30_000,
);

if (child) {
  const { setupMountedHarness } = await import("./workout-test-harness");
  const fixture = {
    id: 7,
    version: 3,
    name: "Heavy day",
    notes: null,
    exercises: [
      {
        key: "row",
        exerciseId: 9,
        name: "Cable row",
        targetSets: 2,
        repsMin: 5,
        repsMax: 8,
        targetWeightKg: 40,
        restSeconds: 90,
        progression: { kind: "none" as const },
      },
    ],
  };
  let preview: any = {
    routine: fixture,
    suggestions: [
      {
        key: "row",
        suggestion: {
          weightKg: 45,
          reps: 6,
          reason: "linear_progression_increased",
          incrementKg: 5,
        },
      },
    ],
  };
  let previewFails = false;
  let created: any;
  mock.module("@/lib/offline/sync", () => ({ useOfflineScope: () => "user-a:org-a" }));
  mock.module("@/lib/workouts/model", () => ({
    createDraftFromRoutinePreview: ({ routine }: any) => ({
      id: "draft",
      exercises: routine.exercises.map((e: any) => ({
        ...e,
        sets: Array.from({ length: e.targetSets }, () => ({
          weightKg: e.targetWeightKg,
          reps: String(e.repsMin),
        })),
      })),
      routineSnapshot: {
        id: routine.id,
        version: routine.version,
        exercises: routine.exercises.map((e: any) => ({ ...e })),
      },
    }),
    weightFromKg: (n: number) => n,
    weightToKg: (n: number) => n,
  }));
  mock.module("@/utils/orpc", () => ({
    client: {
      plans: {
        routines: {
          startPreview: async () => {
            if (previewFails) throw new Error("offline");
            return preview;
          },
          createRoutine: async (input: any) => {
            created = input;
          },
        },
      },
    },
    orpc: {
      plans: { routines: { listRoutines: { queryOptions: () => ({ queryKey: ["routines"] }) } } },
      adminSettings: { productSettings: { queryOptions: () => ({ queryKey: ["settings"] }) } },
      exerciseCatalog: { search: { queryOptions: () => ({ queryKey: ["search"] }) } },
    },
  }));
  mock.module("@tanstack/react-query", () => ({
    useQuery: (options: any) => ({
      data:
        options.queryKey?.[0] === "settings"
          ? { units: "metric" }
          : options.queryKey?.[0] === "search"
            ? [{ id: 11, name: "Bench" }]
            : [fixture],
      isLoading: false,
      refetch: async () => {},
    }),
    useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: () => {} }),
  }));
  test("routine preview explains suggestion and starts the exact suggested draft without changing its target snapshot", async () => {
    const h = await setupMountedHarness();
    try {
      const { WorkoutRoutineStart } = await import("./workout-routines");
      let started: any;
      await h.render(
        React.createElement(WorkoutRoutineStart, {
          onStart: (draft: any) => {
            started = draft;
            return true;
          },
        }),
      );
      expect(h.container.textContent).toContain("Heavy day");
      expect(h.container.textContent).toContain("Cable row");
      await h.click("Heavy day");
      expect(h.alerts[0]?.title).toBe("Suggested changes");
      expect(h.alerts[0]?.message).toContain("The last session was complete, so add 5 kg.");
      await React.act(async () =>
        h.alerts[0]?.buttons?.find((b) => b.text === "Start workout")?.onPress?.(),
      );
      expect(started.exercises[0].sets.map((s: any) => [s.weightKg, s.reps])).toEqual([
        [45, "6"],
        [45, "6"],
      ]);
      expect(started.routineSnapshot.exercises[0]).toMatchObject({
        targetWeightKg: 40,
        repsMin: 5,
        repsMax: 8,
        suggestion: { weightKg: 45, reps: 6 },
      });
    } finally {
      await h.cleanup();
    }
  });
  test("cached routine starts with its original target when preview is offline", async () => {
    previewFails = true;
    const h = await setupMountedHarness();
    try {
      const { WorkoutRoutineStart } = await import("./workout-routines");
      let started: any;
      await h.render(
        React.createElement(WorkoutRoutineStart, {
          onStart: (draft: any) => {
            started = draft;
            return true;
          },
        }),
      );
      await h.click("Heavy day");
      expect(started.exercises[0].sets.map((s: any) => [s.weightKg, s.reps])).toEqual([
        [40, "5"],
        [40, "5"],
      ]);
      expect(started.routineSnapshot.exercises[0]).toMatchObject({
        targetWeightKg: 40,
        progression: { kind: "none" },
      });
    } finally {
      previewFails = false;
      await h.cleanup();
    }
  });
  test("routine editor saves typed linear progression with its offline scope", async () => {
    const h = await setupMountedHarness();
    try {
      const { WorkoutRoutines } = await import("./workout-routines");
      await h.render(React.createElement(WorkoutRoutines));
      const input = (label: string) =>
        h.container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      await h.change(input("Routine name"), "My progression");
      await h.change(input("Search exercise or enter a name"), "Bench");
      expect(h.container.textContent).toContain("Bench");
      await h.change(input("Sets"), "4");
      await h.change(input("Min reps"), "6");
      await h.change(input("Max reps"), "10");
      await h.change(input("Target weight"), "50");
      await h.click("Linear progression");
      await h.change(input("Increment"), "2.5");
      await h.change(input("Deload percent"), "15");
      await h.change(input("Failure threshold"), "3");
      await h.click("Save routine");
      expect(created).toMatchObject({
        name: "My progression",
        expectedScope: "user-a:org-a",
        exercises: [
          {
            name: "Bench",
            targetSets: 4,
            repsMin: 6,
            repsMax: 10,
            targetWeightKg: 50,
            progression: {
              kind: "linear",
              incrementKg: 2.5,
              deloadPercent: 15,
              failureThreshold: 3,
            },
          },
        ],
      });
    } finally {
      await h.cleanup();
    }
  });
}
