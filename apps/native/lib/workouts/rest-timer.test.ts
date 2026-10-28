import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";

const mountedMode = process.env.NATIVE_REST_TIMER_TEST === "1";
test.skipIf(mountedMode)(
  "mounted rest timer behavior",
  async () => {
    const result = await promisify(execFile)(process.execPath, ["test", import.meta.path], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, NATIVE_REST_TIMER_TEST: "1" },
      timeout: 25_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = `${result.stdout}${result.stderr}`;
    console.log(output);
    expect(output).toContain("11 pass");
    expect(output).toContain("1 skip");
    expect(output).toContain("0 fail");
  },
  30_000,
);

if (mountedMode) {
  const { GlobalRegistrator } =
    await import("../../../web/node_modules/@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost:3000" });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;

  const storage = new Map<string, string>();
  const scheduled = new Map<string, any>();
  const canceled: string[] = [],
    scheduledInputs: any[] = [],
    haptics: string[] = [];
  const appListeners = new Set<() => void>();
  let nextId = 0,
    permission = true,
    requests = 0,
    appState = "active";
  let scheduleFailure = false;
  let deferred: { resolve: () => void; id: string; request: any } | null = null;
  mock.module("@react-native-async-storage/async-storage", () => ({
    default: {
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  }));
  mock.module("expo-notifications", () => ({
    AndroidImportance: { HIGH: 4 },
    SchedulableTriggerInputTypes: { DATE: "date" },
    getPermissionsAsync: async () => ({ granted: permission }),
    requestPermissionsAsync: async () => {
      requests++;
      return { granted: permission };
    },
    getAllScheduledNotificationsAsync: async () =>
      [...scheduled].map(([identifier, request]) => ({ identifier, content: request.content })),
    cancelScheduledNotificationAsync: async (id: string) => {
      canceled.push(id);
      scheduled.delete(id);
    },
    scheduleNotificationAsync: async (request: any) => {
      scheduledInputs.push(request);
      const id = `n${++nextId}`;
      if (scheduleFailure) throw new Error("native schedule failed");
      if (deferred) {
        deferred.id = id;
        deferred.request = request;
        await new Promise<void>((resolve) => {
          deferred!.resolve = resolve;
        });
      }
      scheduled.set(id, request);
      return id;
    },
    setNotificationChannelAsync: async () => null,
  }));
  mock.module("expo-haptics", () => ({
    NotificationFeedbackType: { Success: "success" },
    notificationAsync: async (value: string) => {
      haptics.push(value);
    },
  }));
  mock.module("react-native", () => ({
    Platform: { OS: "ios" },
    AppState: {
      get currentState() {
        return appState;
      },
      addEventListener: (_: string, listener: () => void) => {
        appListeners.add(listener);
        return { remove: () => appListeners.delete(listener) };
      },
    },
  }));
  mock.module("@lingui/core/macro", () => ({
    msg: (strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings.raw }, ...(values as string[])),
  }));
  // The Lingui macro preload compiles macros to @lingui/react calls with message descriptors.
  const translate = (value: string | { message?: string; id?: string }) =>
    typeof value === "string" ? value : (value.message ?? value.id ?? "");
  const i18n = { _: translate };
  mock.module("@lingui/react/macro", () => ({ useLingui: () => ({ i18n }) }));
  mock.module("@lingui/react", () => ({ useLingui: () => ({ i18n, _: translate }) }));

  const [{ createRoot }, { act }, { useWorkoutRestTimer }] = await Promise.all([
    import("react-dom/client"),
    import("react"),
    import("./rest-timer"),
  ]);
  let hook!: ReturnType<typeof useWorkoutRestTimer>;
  let root: ReturnType<typeof createRoot> | null = null;
  let container: HTMLDivElement | null = null;
  function Harness({ scope }: { scope: string | null }) {
    hook = useWorkoutRestTimer(scope);
    return null;
  }
  async function mount(scope: string | null) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(Harness, { scope }));
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  async function changeScope(scope: string | null) {
    await act(async () => {
      root!.render(React.createElement(Harness, { scope }));
      await Promise.resolve();
    });
  }
  async function run(fn: () => Promise<unknown>) {
    await act(async () => {
      await fn();
    });
  }
  const reset = () => {
    storage.clear();
    scheduled.clear();
    canceled.length = 0;
    scheduledInputs.length = 0;
    haptics.length = 0;
    appListeners.clear();
    nextId = 0;
    permission = true;
    requests = 0;
    appState = "active";
    scheduleFailure = false;
    deferred = null;
  };
  const cleanup = async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    container?.remove();
    container = null;
  };

  test("uses defaults, persists preferences and resumes an absolute deadline", async () => {
    reset();
    await mount("user-a");
    expect(hook.restSeconds("id:bench")).toBe(90);
    await run(() => hook.setRestSeconds("id:bench", 120));
    await run(() => hook.start("id:bench"));
    const deadline = scheduledInputs[0].trigger.date.getTime();
    await cleanup();
    await mount("user-a");
    expect(hook.restSeconds("id:bench")).toBe(120);
    expect(hook.remainingSeconds).toBeGreaterThan(0);
    expect(scheduled.size).toBe(1);
    expect(scheduledInputs[0].trigger.date.getTime()).toBe(deadline);
    await cleanup();
  });
  test("denied explicit alert permission leaves countdown active without requesting on start", async () => {
    reset();
    permission = false;
    await mount("user-a");
    expect(await hook.enableAlerts()).toBe("denied");
    expect(requests).toBe(1);
    await run(() => hook.start("id:deadlift"));
    expect(hook.active).toBe(true);
    expect(hook.remainingSeconds).toBe(90);
    expect(requests).toBe(1);
    expect(scheduled.size).toBe(0);
    await cleanup();
  });
  test("schedule failures leave the countdown active", async () => {
    reset();
    scheduleFailure = true;
    await mount("user-a");
    await run(() => hook.start("id:bench"));
    expect(hook.active).toBe(true);
    expect(hook.remainingSeconds).toBe(90);
    await cleanup();
  });
  test("adjust replaces OS alert and skip cancels it", async () => {
    reset();
    await mount("user-a");
    await run(() => hook.start("id:squat"));
    const first = [...scheduled.keys()][0];
    await run(() => hook.adjust(15));
    const second = [...scheduled.keys()][0];
    expect(second).not.toBe(first);
    expect(canceled).toContain(first);
    expect(hook.remainingSeconds).toBe(105);
    await run(() => hook.adjust(-15));
    expect(hook.remainingSeconds).toBe(90);
    const third = [...scheduled.keys()][0];
    await run(() => hook.skip());
    expect(canceled).toContain(third);
    expect(hook.active).toBe(false);
    await cleanup();
  });
  test("cancels late schedule result across scope change", async () => {
    reset();
    await mount("user-a");
    deferred = { resolve: () => {}, id: "", request: null };
    const started = hook.start("id:bench");
    await Promise.resolve();
    await Promise.resolve();
    await changeScope("user-b");
    const pending = deferred;
    expect(pending.id).toBeTruthy();
    scheduled.set(pending.id, pending.request);
    pending.resolve();
    deferred = null;
    await act(async () => {
      await started;
    });
    expect(canceled).toContain(pending.id);
    expect(hook.active).toBe(false);
    await cleanup();
  });
  test("isolates scope deadlines and preferences and reconciles notifications", async () => {
    reset();
    await mount("user-a");
    await run(() => hook.setRestSeconds("id:row", 75));
    await run(() => hook.start("id:row"));
    const deadlineA = hook.remainingSeconds;
    await changeScope("user-b");
    expect(hook.restSeconds("id:row")).toBe(90);
    expect(hook.active).toBe(false);
    await run(() => hook.start("id:row"));
    expect(scheduled.size).toBe(1);
    await changeScope("user-a");
    expect(hook.restSeconds("id:row")).toBe(75);
    expect(hook.remainingSeconds).toBe(deadlineA);
    expect(scheduled.size).toBe(1);
    await cleanup();
  });
  test("corrupt saved record reports safe error without overwriting it", async () => {
    reset();
    const bad = "{";
    storage.set("workout-rest-timer:v1:user-a", bad);
    await mount("user-a");
    expect(hook.ready).toBe(true);
    expect(hook.error).toBe("rest_timer_storage_error");
    expect(hook.active).toBe(false);
    expect(storage.get("workout-rest-timer:v1:user-a")).toBe(bad);
    await cleanup();
  });
  test("does not invoke JS haptics for background completion", async () => {
    reset();
    await mount("user-a");
    await run(() => hook.start("id:press", 1));
    appState = "background";
    expect(haptics).toEqual([]);
    expect(scheduledInputs[0].content.data).toMatchObject({ kind: "workout-rest" });
    await cleanup();
  });
  test("fires a single foreground completion haptic", async () => {
    reset();
    await mount("user-a");
    await run(() => hook.start("id:press", 1));
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      now += 1001;
      await act(async () => {
        for (const listener of appListeners) listener();
        await Promise.resolve();
      });
      await act(async () => {
        for (const listener of appListeners) listener();
        await Promise.resolve();
      });
      expect(haptics).toEqual(["success"]);
    } finally {
      Date.now = originalNow;
      await cleanup();
    }
  });
  test("restore recreates a missing scheduled alert at the saved deadline", async () => {
    reset();
    await mount("user-a");
    await run(() => hook.start("id:row", 120));
    const saved = JSON.parse(storage.get("workout-rest-timer:v1:user-a")!);
    const deadline = saved.timer.deadline;
    scheduled.clear();
    await cleanup();
    await mount("user-a");
    expect(scheduled.size).toBe(1);
    expect(scheduledInputs.at(-1).trigger.date.getTime()).toBe(deadline);
    await cleanup();
  });
  test("scope loading cannot complete an old timer or mutate its record", async () => {
    reset();
    await mount("user-a");
    await run(() => hook.start("id:row", 1));
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      now += 1001;
      await changeScope(null);
      await act(async () => {
        for (const listener of appListeners) listener();
        await Promise.resolve();
      });
      expect(haptics).toEqual([]);
      expect(storage.get("workout-rest-timer:v1:user-a")).toContain('"deadline":');
      await cleanup();
    } finally {
      Date.now = originalNow;
    }
  });
}
