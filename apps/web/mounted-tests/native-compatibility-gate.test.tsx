import { expect, mock, test } from "bun:test";
import * as React from "react";

type Result =
  | { ok: true }
  | { ok: false; problem: { kind: "server-too-old"; serverVersion: string } };
type Safety =
  | { kind: "safe" }
  | { kind: "pending"; records: number; drafts: number }
  | { kind: "busy" }
  | { kind: "unknown" };
type NativeGateProps = React.PropsWithChildren<{
  url: string;
  probe?: (url: string) => Promise<Result>;
  appState?: {
    currentState: string;
    addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
  };
}>;
type NativeGateModule = {
  ServerCompatibilityGate: React.ComponentType<NativeGateProps>;
};
type NativeRuntimeModule = {
  ServerRuntime: React.ComponentType<React.PropsWithChildren>;
};

function loadNativeTestModule<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

let nextSafety: Safety = { kind: "safe" };
let guardSafety: Safety = { kind: "safe" };
let locked = false;
let authFactoryCalls = 0;
let modalCloseCalls = 0;
const leaveCalls: unknown[][] = [];
const alerts: Array<{
  title: string;
  message?: string;
  buttons?: Array<{ text: string; onPress?: () => void }>;
}> = [];
const appStateListeners = new Set<(state: "active" | "background") => void>();
const appStateSource: {
  currentState: string;
  addEventListener: (event: "change", listener: (state: string) => void) => { remove(): void };
  emit: (state: "active" | "background") => void;
} = {
  currentState: "active" as "active" | "background",
  addEventListener: (_event, listener) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  },
  emit(state: "active" | "background") {
    this.currentState = state;
    for (const listener of appStateListeners) listener(state);
  },
};
let probeImplementation: (url: string) => Promise<Result> = async () => ({ ok: true });
const controlledProbe = (url: string) => probeImplementation(url);

const host = "https://saved.example";
const mountedMode = process.env.MOUNTED_NATIVE_COMPAT === "1";

if (mountedMode) {
  const translate = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  mock.module("@lingui/react/macro", () => ({ useLingui: () => ({ t: translate }) }));
  mock.module("@lingui/core/macro", () => ({
    plural: (count: number, forms: { one: string; other: string }) =>
      (count === 1 ? forms.one : forms.other).replace("#", String(count)),
  }));
  mock.module("react-native", () => {
    const element = (tag: string) =>
      function Primitive({
        children,
        accessibilityRole,
        accessibilityLabel,
        className,
      }: React.PropsWithChildren<{
        accessibilityRole?: string;
        accessibilityLabel?: string;
        className?: string;
      }>) {
        return React.createElement(
          tag,
          {
            className,
            role: accessibilityRole === "alert" ? "alert" : undefined,
            "aria-label": accessibilityLabel,
          },
          children,
        );
      };
    return {
      AppState: appStateSource,
      Alert: {
        alert: (title: string, message?: string, buttons?: (typeof alerts)[number]["buttons"]) =>
          alerts.push({ title, message, buttons }),
      },
      Modal: ({
        visible,
        onRequestClose,
        children,
      }: {
        visible: boolean;
        onRequestClose?: () => void;
        children: React.ReactNode;
      }) => {
        if (!visible) return null;
        return React.createElement(
          "div",
          {
            role: "dialog",
            "aria-modal": true,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Escape") {
                modalCloseCalls += 1;
                onRequestClose?.();
              }
            },
          },
          children,
        );
      },
      Text: element("span"),
      View: element("div"),
    };
  });

  mock.module("heroui-native", () => {
    const Button = Object.assign(
      ({
        children,
        onPress,
        accessibilityLabel,
      }: React.PropsWithChildren<{ onPress?: () => void; accessibilityLabel?: string }>) =>
        React.createElement(
          "button",
          { onClick: onPress, "aria-label": accessibilityLabel },
          children,
        ),
      {
        Label: ({ children }: React.PropsWithChildren) =>
          React.createElement("span", null, children),
      },
    );
    return {
      Button,
      Spinner: () => React.createElement("span", { role: "status" }, "Loading"),
      useToast: () => ({ toast: { show: () => {} } }),
    };
  });

  mock.module("lucide-react-native", () => ({ Server: () => null, ArrowLeftRight: () => null }));
  mock.module("../../native/components/container", () => ({
    Container: ({ children }: { children: React.ReactNode }) =>
      React.createElement("main", null, children),
  }));
  mock.module("../../native/components/bloom", () => ({
    Sheet: ({ children }: { children: React.ReactNode }) =>
      React.createElement("section", null, children),
    ToneIcon: () => null,
    Icon: () => null,
    Section: ({ children }: { children: React.ReactNode }) =>
      React.createElement("section", null, children),
  }));
  mock.module("../../native/components/list-row", () => ({ ListRow: () => null }));
  mock.module("../../native/components/server-choice", () => ({
    useServerProblemCopy: () => () => ({
      title: "This server needs an update",
      description: "This server runs an API version this app no longer supports.",
    }),
  }));
  mock.module("../../native/lib/server/server-url", () => ({
    isServerLocked: () => locked,
    useServer: () => ({ status: "set", url: host, locked: false }),
  }));
  mock.module("../../native/lib/auth-client", () => ({
    getAuthClient: () => {
      authFactoryCalls += 1;
      return {};
    },
  }));
  mock.module("../../native/lib/server/switch-server", () => ({
    switchServer: (...args: unknown[]) => {
      leaveCalls.push(args);
      return Promise.resolve();
    },
    unsyncedWriteCount: () => 0,
  }));
  mock.module("../../native/lib/server/server-leave-safety", () => ({
    readServerLeaveSafety: () => nextSafety,
    guardServerLeave: async (leave: () => Promise<void>) => {
      if (guardSafety.kind === "safe") await leave();
      return guardSafety;
    },
  }));
  mock.module("../../native/utils/orpc", () => ({ queryClient: { isMutating: () => 0 } }));
}

const mounted = mountedMode
  ? await Promise.all([
      import("@testing-library/react"),
      import("@testing-library/user-event"),
      import("@lingui/react"),
      import("@openvalens/i18n/testing"),
      loadNativeTestModule<NativeGateModule>("../../native/components/server-compatibility-gate"),
      loadNativeTestModule<NativeRuntimeModule>("../../native/components/server-runtime"),
    ])
  : null;

function resetFixtures() {
  nextSafety = { kind: "safe" };
  guardSafety = { kind: "safe" };
  locked = false;
  authFactoryCalls = 0;
  modalCloseCalls = 0;
  leaveCalls.length = 0;
  alerts.length = 0;
  appStateListeners.clear();
  appStateSource.currentState = "active";
  probeImplementation = async () => ({ ok: true });
}

test.skipIf(process.env.MOUNTED_NATIVE_COMPAT !== "1")(
  "mounted native startup gate controls runtime admission and preserves it across rechecks",
  async () => {
    if (!mounted) throw new Error("mounted native compatibility setup missing");
    resetFixtures();
    const [
      { cleanup, render, screen, act, fireEvent },
      userModule,
      lingui,
      i18nTest,
      gateModule,
      runtimeModule,
    ] = mounted;
    const user = userModule.default.setup();
    const { ServerCompatibilityGate } = gateModule;
    const { ServerRuntime } = runtimeModule;
    let resolveInitial: ((result: Result) => void) | undefined;
    probeImplementation = () => new Promise((resolve) => (resolveInitial = resolve));
    let mountCount = 0;
    function RuntimeSubtree() {
      const [value, setValue] = React.useState("");
      React.useEffect(() => {
        mountCount += 1;
        return () => {
          mountCount -= 1;
        };
      }, []);
      return React.createElement("input", {
        "aria-label": "Saved goal draft",
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
      });
    }
    const tree = () =>
      React.createElement(
        lingui.I18nProvider,
        { i18n: i18nTest.englishI18n },
        React.createElement(
          ServerCompatibilityGate,
          { url: host, probe: controlledProbe, appState: appStateSource },
          React.createElement(ServerRuntime, null, React.createElement(RuntimeSubtree)),
        ),
      );
    render(tree());
    expect(screen.queryByRole("textbox", { name: "Saved goal draft" })).toBeNull();
    expect(mountCount).toBe(0);
    expect(authFactoryCalls).toBe(0);
    await act(async () => resolveInitial?.({ ok: true }));
    expect(await screen.findByRole("textbox", { name: "Saved goal draft" })).toBeTruthy();
    expect(mountCount).toBe(1);
    expect(authFactoryCalls).toBe(1);

    await user.type(screen.getByRole("textbox", { name: "Saved goal draft" }), "unsaved target");
    let resolveForeground: ((result: Result) => void) | undefined;
    probeImplementation = () => new Promise((resolve) => (resolveForeground = resolve));
    await act(async () => {
      appStateSource.emit("background");
      appStateSource.emit("active");
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(modalCloseCalls).toBe(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mountCount).toBe(1);
    expect(authFactoryCalls).toBe(1);
    await act(async () => resolveForeground?.({ ok: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    probeImplementation = async () => ({
      ok: false,
      problem: { kind: "server-too-old", serverVersion: "1.0.1" },
    });
    await act(async () => {
      appStateSource.emit("background");
      appStateSource.emit("active");
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Saved goal draft" }).value).toBe(
      "unsaved target",
    );
    probeImplementation = async () => ({ ok: true });
    await user.click(screen.getByRole("button", { name: "Retry server check" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Saved goal draft" }).value).toBe(
      "unsaved target",
    );
    expect(mountCount).toBe(1);
    expect(authFactoryCalls).toBe(1);
    cleanup();
  },
);

test.skipIf(process.env.MOUNTED_NATIVE_COMPAT !== "1")(
  "Strict Mode effect replay does not strand initial admission or leak AppState listeners",
  async () => {
    if (!mounted) throw new Error("mounted native compatibility setup missing");
    resetFixtures();
    const [{ cleanup, render, screen, act }, , lingui, i18nTest, gateModule] = mounted;
    const { ServerCompatibilityGate } = gateModule;
    const resolutions: Array<(result: Result) => void> = [];
    probeImplementation = () => new Promise((resolve) => resolutions.push(resolve));
    render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          lingui.I18nProvider,
          { i18n: i18nTest.englishI18n },
          React.createElement(
            ServerCompatibilityGate,
            { url: host, probe: controlledProbe, appState: appStateSource },
            React.createElement("div", null, "Strict runtime"),
          ),
        ),
      ),
    );
    expect(resolutions.length).toBeGreaterThanOrEqual(2);
    expect(appStateListeners.size).toBe(1);
    await act(async () => {
      resolutions[0]?.({ ok: false, problem: { kind: "server-too-old", serverVersion: "1" } });
      resolutions[resolutions.length - 1]?.({ ok: true });
    });
    expect(await screen.findByText("Strict runtime")).toBeTruthy();
    expect(appStateListeners.size).toBe(1);
    cleanup();
    expect(appStateListeners.size).toBe(0);
  },
);

test.skipIf(process.env.MOUNTED_NATIVE_COMPAT !== "1")(
  "mounted gate blocks old API, ignores stale success, and cleans up disposed probes",
  async () => {
    if (!mounted) throw new Error("mounted native compatibility setup missing");
    resetFixtures();
    const [{ cleanup, render, screen, act }, , lingui, i18nTest, gateModule, runtimeModule] =
      mounted;
    const { ServerCompatibilityGate } = gateModule;
    const { ServerRuntime } = runtimeModule;
    let finish: ((result: Result) => void) | undefined;
    probeImplementation = () => new Promise((resolve) => (finish = resolve));
    const tree = () =>
      React.createElement(
        lingui.I18nProvider,
        { i18n: i18nTest.englishI18n },
        React.createElement(
          ServerCompatibilityGate,
          { url: host, probe: controlledProbe, appState: appStateSource },
          React.createElement(
            ServerRuntime,
            null,
            React.createElement("div", null, "Runtime mounted"),
          ),
        ),
      );
    const view = render(tree());
    await act(async () =>
      finish?.({ ok: false, problem: { kind: "server-too-old", serverVersion: "1.0.1" } }),
    );
    expect(screen.getByText("This server needs an update")).toBeTruthy();
    expect(screen.queryByText("Runtime mounted")).toBeNull();
    expect(authFactoryCalls).toBe(0);
    cleanup();
    expect(view.container.textContent).not.toContain("Runtime mounted");

    resetFixtures();
    let resolveOld: ((result: Result) => void) | undefined;
    let calls = 0;
    probeImplementation = () => {
      calls += 1;
      return new Promise((resolve) => {
        if (calls === 1) resolveOld = resolve;
        else resolve({ ok: false, problem: { kind: "server-too-old", serverVersion: "1" } });
      });
    };
    render(tree());
    act(() => {
      appStateSource.emit("background");
      appStateSource.emit("active");
    });
    await act(async () => resolveOld?.({ ok: true }));
    expect(screen.queryByText("Runtime mounted")).toBeNull();
    expect(screen.getByText("This server needs an update")).toBeTruthy();
    cleanup();
  },
);

test.skipIf(process.env.MOUNTED_NATIVE_COMPAT !== "1")(
  "mounted change-server action is cancellable and fails closed before the switch call",
  async () => {
    if (!mounted) throw new Error("mounted native compatibility setup missing");
    resetFixtures();
    const [{ cleanup, render, screen, act }, , lingui, i18nTest, gateModule] = mounted;
    const { ServerCompatibilityGate } = gateModule;
    probeImplementation = async () => ({
      ok: false,
      problem: { kind: "server-too-old", serverVersion: "1.0.1" },
    });
    render(
      React.createElement(
        lingui.I18nProvider,
        { i18n: i18nTest.englishI18n },
        React.createElement(
          ServerCompatibilityGate,
          { url: host, probe: controlledProbe, appState: appStateSource },
          "Runtime",
        ),
      ),
    );
    await screen.findByText("This server needs an update");
    const user = (await import("@testing-library/user-event")).default.setup();
    await user.click(screen.getByRole("button", { name: "Change server" }));
    const cancelAlert = alerts.at(-1);
    expect(cancelAlert?.buttons?.length).toBe(2);
    act(() => cancelAlert?.buttons?.[0]?.onPress?.());
    expect(leaveCalls).toHaveLength(0);

    for (const unsafe of [
      { kind: "pending" as const, records: 2, drafts: 1 },
      { kind: "busy" as const },
      { kind: "unknown" as const },
    ]) {
      nextSafety = unsafe;
      await user.click(screen.getByRole("button", { name: "Change server" }));
      expect(alerts.at(-1)?.buttons?.map((button) => button.text)).toEqual(["Close"]);
      expect(leaveCalls).toHaveLength(0);
    }

    nextSafety = { kind: "safe" };
    await user.click(screen.getByRole("button", { name: "Change server" }));
    const confirmAlert = alerts.at(-1);
    guardSafety = { kind: "busy" };
    await act(async () => confirmAlert?.buttons?.[1]?.onPress?.());
    expect(leaveCalls).toHaveLength(0);

    guardSafety = { kind: "safe" };
    await user.click(screen.getByRole("button", { name: "Change server" }));
    const finalConfirm = alerts.at(-1);
    await act(async () => finalConfirm?.buttons?.[1]?.onPress?.());
    expect(leaveCalls).toHaveLength(1);
    expect(leaveCalls[0]?.[0]).toBeNull();
    expect(leaveCalls[0]?.[1]).toMatchObject({ pendingDataPolicy: "preserve" });
    const leaveOptions = leaveCalls[0]?.[1];
    expect(
      leaveOptions !== null &&
        typeof leaveOptions === "object" &&
        "hasInFlightWrites" in leaveOptions &&
        typeof leaveOptions.hasInFlightWrites === "function",
    ).toBe(true);
    cleanup();

    resetFixtures();
    locked = true;
    probeImplementation = async () => ({
      ok: false,
      problem: { kind: "server-too-old", serverVersion: "1.0.1" },
    });
    render(
      React.createElement(
        lingui.I18nProvider,
        { i18n: i18nTest.englishI18n },
        React.createElement(
          ServerCompatibilityGate,
          { url: host, probe: controlledProbe, appState: appStateSource },
          "Runtime",
        ),
      ),
    );
    await screen.findByText("This server needs an update");
    expect(screen.queryByRole("button", { name: "Change server" })).toBeNull();
    cleanup();
  },
);

test.skipIf(process.env.MOUNTED_NATIVE_COMPAT !== "1")(
  "unmounting a gate disposes its pending server probe",
  async () => {
    if (!mounted) throw new Error("mounted native compatibility setup missing");
    resetFixtures();
    const [{ cleanup, render, act }, , lingui, i18nTest, gateModule] = mounted;
    const { ServerCompatibilityGate } = gateModule;
    let finish: ((result: Result) => void) | undefined;
    probeImplementation = () => new Promise((resolve) => (finish = resolve));
    let mountedChildren = 0;
    function Child() {
      React.useEffect(() => {
        mountedChildren += 1;
        return () => {
          mountedChildren -= 1;
        };
      }, []);
      return React.createElement("div", null, "never mounted");
    }
    const view = render(
      React.createElement(
        lingui.I18nProvider,
        { i18n: i18nTest.englishI18n },
        React.createElement(
          ServerCompatibilityGate,
          { url: host, probe: controlledProbe, appState: appStateSource },
          React.createElement(Child),
        ),
      ),
    );
    view.unmount();
    await act(async () => finish?.({ ok: true }));
    expect(mountedChildren).toBe(0);
    expect(appStateListeners.size).toBe(0);
    cleanup();
  },
);
