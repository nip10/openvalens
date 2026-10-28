import { expect, mock, test } from "bun:test";
import * as React from "react";

const mountedMode = process.env.MOUNTED_STRENGTH_TEST === "1";
const scope = "strength-ui-fixture:workspace-a";
const session = {
  user: { id: "strength-ui-fixture" },
  session: { activeOrganizationId: "workspace-a" },
};
let displayUnits: "metric" | "imperial" = "metric";
if (mountedMode) {
  mock.module("../src/lib/auth-client", () => ({
    authClient: { useSession: () => ({ data: session, isPending: false }) },
  }));
  mock.module("../src/utils/product-settings", () => ({
    useProductSettings: () => ({ data: { locale: "en-US", units: displayUnits } }),
  }));
  mock.module("@tanstack/react-router", () => ({
    createFileRoute: () => (options: { component: React.ComponentType }) => ({ options }),
    Link: (props: { children: React.ReactNode }) =>
      React.createElement("a", { href: "/exercise-library" }, props.children),
  }));
}

const mounted = mountedMode
  ? await Promise.all([
      import("@testing-library/react"),
      import("@testing-library/user-event"),
      import("@tanstack/react-query"),
      import("@lingui/react"),
      import("@openvalens/i18n/testing"),
      import("@orpc/server/fetch"),
      import("@orpc/server"),
      import("zod"),
      import("../src/components/workout-session-editor"),
      import("../src/components/workout-routines"),
      import("../src/components/workout-history"),
      import("../src/utils/orpc"),
      import("../src/routes/_auth/workouts"),
    ])
  : null;

test.skipIf(!mountedMode)("mounted strength-training contracts", async () => {
  if (!mounted) throw new Error("mounted suite setup missing");
  const [
    testing,
    userModule,
    query,
    lingui,
    i18nTesting,
    rpcModule,
    server,
    zod,
    editorModule,
    routinesModule,
    historyModule,
    orpcModule,
    routeModule,
  ] = mounted;
  const { cleanup, render, screen, waitFor, within } = testing;
  const user = userModule.default.setup();
  const { QueryClient, QueryClientProvider } = query;
  const { RPCHandler } = rpcModule;
  const { os } = server;
  const { z } = zod;
  const { WorkoutSessionEditor } = editorModule;
  const { WorkoutRoutines } = routinesModule;
  const { WorkoutExerciseHistory } = historyModule;
  const { orpc } = orpcModule;
  const WorkoutsPage = routeModule.Route.options.component;
  if (!WorkoutsPage) throw new Error("Workouts route has no component");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const input = os.input(z.unknown());
  const requests: Array<{ path: string; input: any }> = [];
  let handlers: Record<string, (input: any) => unknown> = {};
  let pageIndex = 0;
  const router = {
    plans: {
      workouts: {
        listWorkouts: input.handler(() => handlers.listWorkouts?.({})),
        getWorkout: input.handler(({ input: args }: any) => handlers.getWorkout?.(args)),
        updateWorkout: input.handler(({ input: args }: any) => {
          requests.push({ path: "updateWorkout", input: args });
          return handlers.updateWorkout?.(args);
        }),
        deleteWorkout: input.handler(({ input: args }: any) => {
          requests.push({ path: "deleteWorkout", input: args });
          return handlers.deleteWorkout?.(args);
        }),
        exerciseHistory: input.handler(({ input: args }: any) => {
          requests.push({ path: "exerciseHistory", input: args });
          return handlers.exerciseHistory?.(args);
        }),
      },
      goals: { listGoals: input.handler(() => handlers.listGoals?.({})) },
      routines: {
        listRoutines: input.handler(() => handlers.listRoutines?.({})),
        createRoutine: input.handler(({ input: args }: any) => {
          requests.push({ path: "createRoutine", input: args });
          return handlers.createRoutine?.(args);
        }),
        updateRoutine: input.handler(({ input: args }: any) => {
          requests.push({ path: "updateRoutine", input: args });
          return handlers.updateRoutine?.(args);
        }),
        deleteRoutine: input.handler(({ input: args }: any) => handlers.deleteRoutine?.(args)),
        startPreview: input.handler(({ input: args }: any) => handlers.startPreview?.(args)),
      },
    },
    exerciseCatalog: { search: input.handler(() => []) },
    activity: { weeklyLoad: input.handler(() => handlers.weeklyLoad?.({})) },
  };
  const rpc = new RPCHandler(router);
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (request: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(request, init);
      const result = await rpc.handle(req, { prefix: "/rpc", context: {} });
      if (!result.matched || !result.response)
        throw new Error(`Unmatched synthetic RPC request ${new URL(req.url).pathname}`);
      return result.response;
    },
  });
  const tree = (node: React.ReactNode) =>
    React.createElement(
      lingui.I18nProvider,
      { i18n: i18nTesting.englishI18n },
      React.createElement(QueryClientProvider, { client }, node),
    );
  try {
    // The editor round-trips canonical kg and nested nullable notes unchanged.
    const value = {
      date: "2026-10-20",
      type: "weights" as const,
      duration: null,
      notes: null,
      intensity: null,
      effortRating: null,
      exercises: [
        {
          name: "Squat",
          exerciseId: null,
          notes: "tempo",
          sets: [{ reps: 13, weightKg: 60, rpe: null, notes: null }],
        },
      ],
    };
    let saved: any;
    render(
      tree(
        React.createElement(WorkoutSessionEditor, {
          initial: value,
          units: "metric",
          onCancel: () => {},
          onSave: (next: any) => {
            saved = next;
          },
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Save workout" }));
    await waitFor(() => expect(saved).toEqual(value));
    cleanup();

    // A new cardio session is valid with no fabricated exercise or sets.
    let cardio: any;
    render(
      tree(
        React.createElement(WorkoutSessionEditor, {
          initial: { ...value, type: "running", exercises: [] },
          units: "metric",
          onCancel: () => {},
          onSave: (next: any) => {
            cardio = next;
          },
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Save workout" }));
    await waitFor(() => expect(cardio?.exercises).toEqual([]));
    cleanup();

    // Routine creation/edit payloads preserve versioning and no-progression defaults.
    let routines: any[] = [];
    handlers = {
      listRoutines: () => routines,
      createRoutine: (args) => {
        routines = [
          { id: 17, version: 1, name: args.name, notes: args.notes, exercises: args.exercises },
        ];
        return routines[0];
      },
      updateRoutine: (args) => {
        requests.push({ path: "updateRoutine", input: args });
        return args;
      },
    };
    const routinesOptions = orpc.plans.routines.listRoutines.queryOptions({ input: {} });
    client.setQueryData([...routinesOptions.queryKey, { scope }], []);
    render(tree(React.createElement(WorkoutRoutines)));
    await user.click(screen.getByRole("button", { name: "New routine" }));
    await user.type(screen.getByLabelText("Name"), "Base plan");
    await user.type(screen.getByRole("textbox", { name: "Exercise name" }), "Deadlift");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Save routine" }));
    await waitFor(() => expect(requests.some((r) => r.path === "createRoutine")).toBe(true));
    const created = requests.find((r) => r.path === "createRoutine")!.input;
    expect(created.expectedScope).toBe(scope);
    expect(created.exercises[0]).toMatchObject({
      name: "Deadlift",
      progression: { kind: "none" },
      targetWeightKg: null,
    });
    cleanup();

    const savedRoutine = {
      id: 17,
      version: 4,
      name: "Base plan",
      notes: "keep",
      exercises: [
        {
          key: "fixed-key",
          exerciseId: null,
          name: "Deadlift",
          targetSets: 3,
          repsMin: 8,
          repsMax: 12,
          targetWeightKg: 80,
          restSeconds: 90,
          progression: { kind: "linear", incrementKg: 2.5, deloadPercent: 10, failureThreshold: 2 },
        },
      ],
    };
    client.setQueryData([...routinesOptions.queryKey, { scope }], [savedRoutine]);
    render(tree(React.createElement(WorkoutRoutines)));
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    await user.click(screen.getByRole("button", { name: "Save routine" }));
    await waitFor(() => expect(requests.some((r) => r.path === "updateRoutine")).toBe(true));
    const updated = requests.find((r) => r.path === "updateRoutine")!.input;
    expect(updated).toMatchObject({ id: 17, expectedVersion: 4, expectedScope: scope });
    expect(updated.exercises[0].progression).toEqual(savedRoutine.exercises[0].progression);
    cleanup();

    // History paginates, formats kg/lb, retains 13-rep sets, and labels PR badges.
    const item = (id: number, weightKg: number) => ({
      workoutId: id,
      date: `2026-10-${20 + id}`,
      createdAt: `2026-10-${20 + id}T09:00:00Z`,
      topSetWeightKg: weightKg,
      estimated1RmKg: weightKg,
      volumeKg: weightKg * 13,
      prs: [{ kind: "heaviest_weight" }],
      exercises: [{ sets: [{ reps: 13, weightKg }] }],
    });
    handlers.exerciseHistory = (args) => {
      pageIndex++;
      return {
        items: args.cursor ? [item(1, 80)] : [item(2, 100)],
        nextCursor: args.cursor ? null : "older",
        records: {
          heaviestWeightKg: 100,
          bestEstimated1RmKg: 100,
          mostRepsAtWeight: [{ weightKg: 80, reps: 13 }],
        },
      };
    };
    render(tree(React.createElement(WorkoutExerciseHistory, { exercise: { name: "Deadlift" } })));
    await screen.findByText(/13 reps/);
    expect(screen.getByText(/Heaviest weight PR/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load older sessions" }));
    await waitFor(() => expect(pageIndex).toBe(2));
    expect(requests.filter((r) => r.path === "exerciseHistory")[1]!.input.cursor).toBe("older");
    cleanup();
    displayUnits = "imperial";
    const historyOptions = orpc.plans.workouts.exerciseHistory.queryOptions({
      input: { exercise: { name: "Deadlift" }, limit: 20, cursor: undefined },
    });
    client.setQueryData([...historyOptions.queryKey, { scope }], {
      items: [item(3, 100)],
      nextCursor: null,
      records: {
        heaviestWeightKg: 100,
        bestEstimated1RmKg: 100,
        mostRepsAtWeight: [{ weightKg: 80, reps: 13 }],
      },
    });
    render(tree(React.createElement(WorkoutExerciseHistory, { exercise: { name: "Deadlift" } })));
    await waitFor(() => expect(screen.getAllByText(/220.5 lb/).length).toBeGreaterThan(0));
    expect(screen.getByRole("img", { name: "Exercise history chart in pounds" })).toBeTruthy();
    cleanup();
    displayUnits = "metric";

    // Exercise the actual file-route component: detail -> editor -> update RPC.
    let workout: any = {
      id: 71,
      version: 6,
      date: "2026-10-20",
      type: "weights",
      duration: 45,
      notes: "session note",
      intensity: "moderate",
      effortRating: null,
      canEdit: true,
      prs: [],
      exercises: [
        {
          name: "Squat",
          exerciseId: 9,
          notes: "slow eccentric",
          sets: [{ reps: 13, weightKg: 60, rpe: null, notes: "pause" }],
        },
      ],
    };
    handlers = {
      listWorkouts: () =>
        workout
          ? [
              {
                id: workout.id,
                date: workout.date,
                type: workout.type,
                duration: workout.duration,
                effortRating: null,
              },
            ]
          : [],
      getWorkout: () => workout,
      listGoals: () => [],
      listRoutines: () => [],
      weeklyLoad: () => null,
      updateWorkout: (args) => {
        workout = { ...workout, ...args, version: 7 };
        return workout;
      },
      deleteWorkout: (args) => {
        expect(args).toMatchObject({ id: 71, expectedVersion: 7, expectedScope: scope });
        workout = null;
        return { id: 71 };
      },
    };
    render(tree(React.createElement(WorkoutsPage)));
    await user.click(await screen.findByRole("button", { name: "View workout details" }));
    await screen.findByRole("dialog", { name: "Workout details" });
    expect(screen.getByText("slow eccentric")).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog", { name: "Workout details" })).getByRole("button", {
        name: "Edit",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save workout" }));
    await waitFor(() => expect(requests.some((r) => r.path === "updateWorkout")).toBe(true));
    const updateRequest = requests.find((r) => r.path === "updateWorkout")!.input;
    expect(updateRequest).toMatchObject({
      id: 71,
      expectedVersion: 6,
      expectedScope: scope,
      workout: {
        date: "2026-10-20",
        notes: "session note",
      },
    });
    expect(updateRequest.workout.exercises).toEqual([
      {
        name: "Squat",
        exerciseId: 9,
        notes: "slow eccentric",
        sets: [{ reps: 13, weightKg: 60, rpe: null, notes: "pause" }],
      },
    ]);
    cleanup();

    // Confirmation dispatches the versioned delete RPC and successful deletion hides detail.
    client.clear();
    workout = { ...workout, version: 7 };
    requests.length = 0;
    render(tree(React.createElement(WorkoutsPage)));
    await user.click(await screen.findByRole("button", { name: "View workout details" }));
    await screen.findByRole("dialog", { name: "Workout details" });
    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    await screen.findByText("Delete this workout?");
    await user.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => expect(requests.some((r) => r.path === "deleteWorkout")).toBe(true));
    expect(requests.find((r) => r.path === "deleteWorkout")!.input).toMatchObject({
      id: 71,
      expectedVersion: 7,
      expectedScope: scope,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Workout details" })).toBeNull(),
    );
    cleanup();

    // Legacy detail is visible but exposes no mutating controls.
    workout = {
      id: 72,
      version: 2,
      date: "2026-10-19",
      type: "weights",
      duration: null,
      notes: "legacy",
      intensity: null,
      effortRating: null,
      canEdit: false,
      prs: [],
      exercises: [],
    };
    client.clear();
    handlers.listWorkouts = () => [
      {
        id: 72,
        date: workout.date,
        type: workout.type,
        duration: workout.duration,
        effortRating: null,
      },
    ];
    render(tree(React.createElement(WorkoutsPage)));
    await user.click(await screen.findByRole("button", { name: "View workout details" }));
    await screen.findByText("This legacy workout is read-only.");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    cleanup();
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    client.clear();
  }
});
