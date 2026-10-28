import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { WorkoutDraft } from "../lib/workouts/model";
import { expect, mock, test } from "bun:test";
import * as React from "react";

const mountedMode = process.env.NATIVE_WORKOUT_SESSION_TEST === "1";

test.skipIf(mountedMode)(
  "isolates mounted workout-session interactions",
  async () => {
    const result = await promisify(execFile)(process.execPath, ["test", import.meta.path], {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NATIVE_WORKOUT_SESSION_TEST: "1" },
      timeout: 25_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = `${result.stdout}${result.stderr}`;
    console.log(output);
    expect(output).toContain("3 pass");
    expect(output).toContain("1 skip");
    expect(output).toContain("0 fail");
  },
  30_000,
);

if (mountedMode) {
  const { GlobalRegistrator } =
    await import("../../web/node_modules/@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost:3000" });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;
  const host = (tag: string) => (props: Record<string, unknown>) => React.createElement(tag, props);
  mock.module("react-native", () => {
    const View = ({ children, accessibilityLabel, ...props }: Record<string, any>) =>
      React.createElement("div", { ...props, "aria-label": accessibilityLabel }, children);
    const Text = ({
      children,
      accessibilityRole,
      accessibilityLabel,
      ...props
    }: Record<string, any>) =>
      React.createElement(
        "span",
        { ...props, role: accessibilityRole, "aria-label": accessibilityLabel },
        children,
      );
    const TextInput = ({ onChangeText, accessibilityLabel, ...props }: Record<string, any>) =>
      React.createElement("input", {
        ...props,
        "aria-label": accessibilityLabel,
        onChange: (event: Event) => onChangeText?.((event.currentTarget as HTMLInputElement).value),
      });
    const Pressable = ({
      children,
      onPress,
      accessibilityRole,
      accessibilityLabel,
      ...props
    }: Record<string, any>) =>
      React.createElement(
        "button",
        {
          ...props,
          type: "button",
          role: accessibilityRole,
          "aria-label": accessibilityLabel,
          onClick: onPress,
        },
        children,
      );
    const Modal = ({ visible, children }: Record<string, any>) =>
      visible ? React.createElement("div", { role: "dialog" }, children) : null;
    const Alert = {
      alert: (
        _title: string,
        _message?: string,
        buttons?: Array<{ text: string; onPress?: () => void }>,
      ) => buttons?.at(-1)?.onPress?.(),
    };
    return {
      View,
      Text,
      TextInput,
      Pressable,
      Modal,
      ScrollView: View,
      KeyboardAvoidingView: View,
      Platform: { OS: "ios" },
      Alert,
    };
  });
  mock.module("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }));
  mock.module("expo-crypto", () => ({ randomUUID }));
  mock.module("heroui-native", () => ({
    Button: Object.assign(
      ({ children, onPress }: Record<string, any>) =>
        React.createElement("button", { type: "button", onClick: onPress }, children),
      {
        Label: ({ children }: { children: React.ReactNode }) =>
          React.createElement("span", null, children),
      },
    ),
    Card: "div",
    Spinner: "span",
  }));
  mock.module("lucide-react-native", () => ({
    Check: () => null,
    Plus: () => null,
    Trash2: () => null,
    ChevronUp: () => null,
    ChevronDown: () => null,
  }));
  mock.module("react-native-svg", () => ({
    default: host("svg"),
    Circle: host("circle"),
    Path: host("path"),
    Rect: host("rect"),
  }));
  mock.module("@/components/bloom", () => ({
    Section: ({ children, title }: Record<string, any>) =>
      React.createElement("section", null, React.createElement("h2", null, title), children),
    Sheet: ({ children }: Record<string, any>) =>
      React.createElement("div", { "data-testid": "workout-sheet" }, children),
  }));
  mock.module("@/utils/theme", () => ({ useThemeColor: () => "#888" }));
  // Exercise history renders gifted-charts, whose module body needs real React Native; it has its own suite.
  mock.module("@/components/workout-history", () => ({ WorkoutExerciseHistory: () => null }));
  // Rest timer and routine starter touch native storage/notification modules; both have their own suites.
  const restTimer = {
    ready: true,
    remainingSeconds: 0,
    active: false,
    exerciseKey: null,
    restSeconds: (_key: string, fallback?: number) => fallback ?? 90,
    setRestSeconds: async () => true,
    start: async () => true,
    adjust: async () => true,
    skip: async () => true,
    enableAlerts: async () => "denied" as const,
    alertsPrecision: "unavailable" as const,
    error: null,
  };
  mock.module("@/lib/workouts/rest-timer", () => ({ useWorkoutRestTimer: () => restTimer }));
  mock.module("@/components/workout-routines", () => ({ WorkoutRoutineStart: () => null }));
  // The package ships Flow source that Bun cannot parse; DateField only needs a host element here.
  mock.module("@react-native-community/datetimepicker", () => ({
    default: () => React.createElement("div", { "data-testid": "date-picker" }),
  }));
  const catalog = [{ id: 51, name: "Catalog press" }];
  let units: "metric" | "imperial" = "metric";
  mock.module("@/utils/orpc", () => ({
    client: {
      plans: { workouts: { getWorkout: async ({ id }: { id: number }) => ({ id, version: 6 }) } },
    },
    orpc: {
      adminSettings: { productSettings: { queryOptions: () => ({ queryKey: ["settings"] }) } },
      exerciseCatalog: {
        filters: { queryOptions: () => ({ queryKey: ["filters"] }) },
        search: { queryOptions: ({ input }: any) => ({ queryKey: ["catalog", input] }) },
      },
      plans: {
        workouts: {
          lastPerformance: {
            queryOptions: ({ input }: any) => ({ queryKey: ["last-performance", input] }),
          },
        },
      },
    },
  }));
  mock.module("@tanstack/react-query", () => ({
    useQuery: (options: any) => ({
      data:
        options.queryKey?.[0] === "settings"
          ? { units }
          : options.queryKey?.[0] === "filters"
            ? { muscles: [], equipment: [] }
            : options.queryKey?.[0] === "last-performance"
              ? { items: [] }
              : catalog,
    }),
  }));
  mock.module("@lingui/react/macro", () => ({
    Trans: ({ children }: { children: React.ReactNode }) => children,
    useLingui: () => ({
      t: (parts: TemplateStringsArray, ...values: unknown[]) =>
        String.raw({ raw: parts.raw }, ...(values as string[])),
    }),
  }));
  mock.module("@lingui/core/macro", () => ({
    plural: (count: number, options: { one: string; other: string }) =>
      count === 1 ? options.one.replace("#", "1") : options.other.replace("#", String(count)),
  }));

  const { createWorkoutDraft, draftToWorkoutInput } = await import("../lib/workouts/model");
  let savedDraft: ReturnType<typeof createWorkoutDraft> | null = null;
  const queued: Array<{ id: string; payload: unknown }> = [];
  let storageFails = false;
  let blocked: Array<Record<string, unknown>> = [];
  const discardCalls: Array<[string, boolean | undefined]> = [];
  const repairCalls: Array<[string, number]> = [];
  let revision = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const hook = () => {
    React.useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => revision,
    );
    return {
      scope: "test:scope",
      items: queued
        .map((item) => ({
          ...item,
          scope: "test:scope",
          state: "pending",
          attempts: 0,
          error: null,
          finishedAt: "",
          createdAt: 0,
        }))
        .concat(blocked as never[]),
      busy: false,
      draft: savedDraft,
      error: storageFails ? "STORAGE" : null,
      saveDraft: (draft: ReturnType<typeof createWorkoutDraft>) => {
        if (storageFails) {
          notify();
          return false;
        }
        savedDraft = draft;
        notify();
        return true;
      },
      discardDraft: () => {
        savedDraft = null;
        notify();
        return true;
      },
      retry: () => {},
      // A dependent change makes the first (non-cascading) discard refuse.
      discardBlocked: (id: string, cascade?: true) => {
        discardCalls.push([id, cascade]);
        if (!cascade) return false;
        blocked = [];
        notify();
        return true;
      },
      repairAsDraft: (id: string, version: number) => {
        repairCalls.push([id, version]);
        return true;
      },
      syncNow: async () => {},
      finish: (draft: ReturnType<typeof createWorkoutDraft>) => {
        if (storageFails) return false;
        queued.push({ id: draft.id, payload: draftToWorkoutInput(draft) });
        savedDraft = null;
        notify();
        return true;
      },
    };
  };
  mock.module("@/lib/workouts/sync", () => ({ useWorkoutSession: hook }));
  const [{ I18nProvider }, { englishI18n }] = await Promise.all([
    import("@lingui/react"),
    import("@openvalens/i18n/testing"),
  ]);
  await englishI18n.loadAndActivate({ locale: "en", messages: {} });
  const linguiCore = await import("@lingui/core");
  linguiCore.i18n.loadAndActivate({ locale: "en", messages: {} });
  const [{ createRoot }, workoutSessionModule] = await Promise.all([
    import("react-dom/client"),
    import("./workout-session"),
  ]);
  const WorkoutSession = workoutSessionModule.WorkoutSession;
  const renderWithProvider = (node: React.ReactNode) =>
    React.createElement(I18nProvider, { i18n: englishI18n }, node);

  test("mounted session saves exercises and completed set payload across remount", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = async () =>
      React.act(async () => root.render(renderWithProvider(React.createElement(WorkoutSession))));
    const button = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((item) =>
        item.textContent?.includes(label),
      );
    const click = async (label: string) => {
      const target = button(label);
      if (!target) throw new Error(`Missing button ${label}; rendered: ${container.textContent}`);
      await React.act(async () => target.click());
    };
    const change = async (el: HTMLInputElement, value: string) =>
      React.act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    try {
      await render();
      await click("Start workout");
      await click("Add exercise");
      await change(
        container.querySelector(
          "input[placeholder='Or enter an exercise name']",
        ) as HTMLInputElement,
        "Free-text squat",
      );
      await click("Add custom exercise");
      await click("Add exercise");
      await click("Catalog press");
      const exercises = ["Free-text squat", "Catalog press"];
      for (let ei = 0; ei < exercises.length; ei++) {
        const sheet = Array.from(container.querySelectorAll('[data-testid="workout-sheet"]')).find(
          (node) => node.textContent?.includes(exercises[ei]!),
        );
        if (!sheet) throw new Error(`No editor for ${exercises[ei]}`);
        const inputs = () => Array.from(sheet.querySelectorAll("input"));
        const addSet = async () => {
          const current = Array.from(
            container.querySelectorAll('[data-testid="workout-sheet"]'),
          ).find((node) => node.textContent?.includes(exercises[ei]!));
          const target = Array.from(current?.querySelectorAll("button") ?? []).find((button) =>
            button.textContent?.includes("Add set"),
          ) as HTMLButtonElement | undefined;
          if (!target) throw new Error(`Missing Add set in ${exercises[ei]}`);
          await React.act(async () => target.click());
        };
        await addSet();
        await addSet();
        await addSet();
        for (const input of inputs()) {
          const label = input.getAttribute("aria-label");
          if (label?.startsWith("Set ")) await change(input, ei === 0 ? "80" : "30");
          if (label === "Reps") await change(input, ei === 0 ? "8" : "10");
        }
        for (const done of Array.from(
          sheet.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'),
        ))
          await React.act(async () => done.click());
      }
      expect(savedDraft?.exercises.map((exercise) => exercise.name)).toEqual(exercises);
      expect(
        savedDraft?.exercises.map((exercise) =>
          exercise.sets.map((set) => [set.reps, set.weightKg, set.done]),
        ),
      ).toEqual([
        [
          ["8", 80, true],
          ["8", 80, true],
          ["8", 80, true],
        ],
        [
          ["10", 30, true],
          ["10", 30, true],
          ["10", 30, true],
        ],
      ]);
      await React.act(async () => root.render(null));
      await render();
      expect(container.textContent).toContain("Free-text squat");
      expect(container.textContent).toContain("Catalog press");
      await click("Finish workout");
      const duration = container.querySelector(
        'input[aria-label="Duration in minutes"]',
      ) as HTMLInputElement | null;
      if (!duration) throw new Error("Missing editable duration");
      await change(duration, "30");
      await click("Moderate");
      const effort = container.querySelector(
        'input[aria-label="Effort rating from 0 to 10"]',
      ) as HTMLInputElement | null;
      if (!effort) throw new Error("Missing optional effort rating");
      await change(effort, "7");
      await click("Save workout");
      expect(savedDraft).toBeNull();
      expect(queued).toHaveLength(1);
      expect(queued[0]?.payload).toMatchObject({
        duration: 30,
        intensity: "moderate",
        effortRating: 7,
        exercises: [
          {
            name: "Free-text squat",
            sets: [
              { reps: 8, weightKg: 80 },
              { reps: 8, weightKg: 80 },
              { reps: 8, weightKg: 80 },
            ],
          },
          {
            exerciseId: 51,
            name: "Catalog press",
            sets: [
              { reps: 10, weightKg: 30 },
              { reps: 10, weightKg: 30 },
              { reps: 10, weightKg: 30 },
            ],
          },
        ],
      });
      expect(container.textContent).toContain("Waiting to sync");
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
  });

  test("imperial weight entry stays canonical in kilograms and failed storage is surfaced", async () => {
    units = "imperial";
    savedDraft = null;
    storageFails = false;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = async () =>
      React.act(async () => root.render(renderWithProvider(React.createElement(WorkoutSession))));
    const button = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((item) =>
        item.textContent?.includes(label),
      );
    const click = async (label: string) => {
      const target = button(label);
      if (!target) throw new Error(`Missing button ${label}; rendered: ${container.textContent}`);
      await React.act(async () => target.click());
    };
    const change = async (el: HTMLInputElement, value: string) =>
      React.act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    try {
      await render();
      await click("Start workout");
      await click("Add exercise");
      await change(
        container.querySelector(
          "input[placeholder='Or enter an exercise name']",
        ) as HTMLInputElement,
        "Imperial lift",
      );
      await click("Add custom exercise");
      const sheet = container.querySelector('[data-testid="workout-sheet"]')!;
      const addSet = Array.from(sheet.querySelectorAll("button")).find((item) =>
        item.textContent?.includes("Add set"),
      )!;
      await React.act(async () => addSet.click());
      let weight = Array.from(sheet.querySelectorAll("input")).find((item) =>
        item.getAttribute("aria-label")?.startsWith("Set "),
      )!;
      await change(weight, "176.4");
      expect((savedDraft as WorkoutDraft | null)?.exercises[0]?.sets[0]?.weightKg).toBeCloseTo(
        80,
        1,
      );
      storageFails = true;
      const reps = Array.from(sheet.querySelectorAll("input")).find(
        (item) => item.getAttribute("aria-label") === "Reps",
      )!;
      await change(reps, "8");
      expect(container.textContent).toContain("Could not save workout changes. Please try again.");
      expect((savedDraft as WorkoutDraft | null)?.exercises[0]?.sets[0]?.reps).toBe("");
    } finally {
      storageFails = false;
      units = "metric";
      await React.act(async () => root.unmount());
      container.remove();
    }
  });

  test("blocked change reopens against the latest version or discards with its dependents", async () => {
    savedDraft = null;
    const blockedId = "99999999-9999-4999-8999-999999999999";
    blocked = [
      {
        id: blockedId,
        scope: "test:scope",
        operation: "update",
        targetId: 12,
        state: "blocked",
        attempts: 1,
        error: "CONFLICT",
        finishedAt: "",
        createdAt: 0,
        payload: {
          clientMutationId: blockedId,
          id: 12,
          expectedVersion: 1,
          workout: { date: "2026-02-03", type: "weights", exercises: [] },
        },
      },
    ];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const click = async (label: string) => {
      const target = Array.from(container.querySelectorAll("button")).find((item) =>
        item.textContent?.includes(label),
      );
      if (!target) throw new Error(`Missing button ${label}; rendered: ${container.textContent}`);
      await React.act(async () => target.click());
    };
    try {
      await React.act(async () =>
        root.render(renderWithProvider(React.createElement(WorkoutSession))),
      );
      expect(container.textContent).toContain("Needs attention");
      expect(container.textContent).not.toContain("Retry sync");
      await click("Review against latest");
      expect(repairCalls).toEqual([[blockedId, 6]]);
      await click("Discard change");
      expect(discardCalls).toEqual([
        [blockedId, undefined],
        [blockedId, true],
      ]);
      expect(container.textContent).not.toContain("Needs attention");
    } finally {
      blocked = [];
      await React.act(async () => root.unmount());
      container.remove();
    }
  });
}
