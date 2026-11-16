import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";

import type { PaletteRenderProps } from "../src/components/quick-log/log-launcher";

/**
 * app-shell#0: the log "+" opens the screen's subject in the quick log
 * palette, and pages can point it elsewhere or at their own dialog.
 */

const execFileAsync = promisify(execFile);
const mountedMode = process.env.MOUNTED_LOG_FAB_TEST === "1";

if (mountedMode) {
  // Signed out for the palette's own queries: they stay off, and the kinds follow the defaults.
  mock.module("../src/lib/auth-client", () => ({
    authClient: { useSession: () => ({ data: null, isPending: false }) },
  }));
}

const mounted = mountedMode
  ? await Promise.all([
      import("@testing-library/react"),
      import("@testing-library/user-event"),
      import("@tanstack/react-query"),
      import("@lingui/react"),
      import("@openvalens/i18n/testing"),
      import("@openvalens/api/presenters/nutrition-diary"),
      import("../src/components/quick-log/log-launcher"),
      import("../src/components/quick-log/log-targets"),
      import("../src/components/quick-log/quick-log-palette"),
      import("./router-fixture"),
    ])
  : null;

test.skipIf(mountedMode)("runs the mounted log + suite in a subprocess", async () => {
  const result = await execFileAsync(
    process.execPath,
    [
      "test",
      "--preload",
      `${import.meta.dir}/../../../scripts/test/lingui-macro.ts`,
      "--preload",
      `${import.meta.dir}/setup.tsx`,
      import.meta.path,
    ],
    {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, MOUNTED_LOG_FAB_TEST: "1", VITE_SERVER_URL: "http://localhost:3000" },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const output = `${result.stdout}${result.stderr}`;
  process.stdout.write(output);
  expect(output).toContain("2 pass");
  expect(output).toContain("0 fail");
});

test.skipIf(!mountedMode)(
  "the + opens the route's subject, a page's target or the page's own dialog",
  async () => {
    if (!mounted) throw new Error("mounted setup missing");
    const [rtl, userModule, , lingui, i18nTesting, , launcher] = mounted;
    const { act, cleanup, render, screen } = rtl;
    const user = userModule.default.setup();
    const { LogFab, LogLauncherProvider, useLogDialog, useLogTarget, useOpenLog } = launcher;
    type Target = Parameters<ReturnType<typeof useOpenLog>>[0];

    const palettes: Array<{ open: boolean; target: unknown }> = [];
    let openPageDialog: (kind: string) => boolean = () => false;
    const dialogCalls: unknown[] = [];

    function FoodTarget({ target }: { target: Target }) {
      useLogTarget(target ?? null);
      return null;
    }
    function LabsDialog() {
      useLogDialog("lab_result", (target) => dialogCalls.push(target));
      return null;
    }
    function AddLunch() {
      const openLog = useOpenLog();
      return React.createElement(
        "button",
        {
          type: "button",
          onClick: () => openLog({ kind: "food", meal: "lunch", date: "2026-11-14" }),
        },
        "Add to lunch",
      );
    }

    // A stand-in palette that records how it was asked to open.
    function Palette(props: PaletteRenderProps) {
      palettes.push({ open: props.open, target: props.target });
      openPageDialog = props.openPageDialog;
      return null;
    }

    const shell = (pathname: string, extra: React.ReactNode = null) =>
      React.createElement(
        lingui.I18nProvider,
        { i18n: i18nTesting.englishI18n },
        React.createElement(LogLauncherProvider, {
          pathname,
          Palette,
          children: [
            React.createElement(LogFab, { key: "fab" }),
            React.createElement(React.Fragment, { key: "page" }, extra),
          ],
        }),
      );
    const last = () => palettes.at(-1)!;

    try {
      // Body: weight.
      const view = render(shell("/body"));
      await user.click(screen.getByRole("button", { name: "Log: Weight" }));
      expect(last()).toEqual({ open: true, target: { kind: "weight" } });

      // Vitals: heart rate, with blood pressure and resting heart rate one tap away.
      view.rerender(shell("/records/vitals"));
      await user.click(screen.getByRole("button", { name: "Log: Heart rate" }));
      expect(last().target).toEqual({
        kind: "heart_rate",
        related: ["blood_pressure", "resting_heart_rate"],
      });

      // Elsewhere: the full palette.
      view.rerender(shell("/dashboard"));
      await user.click(screen.getByRole("button", { name: "Log something" }));
      expect(last().target).toBeNull();

      // A page's target wins over the route's while it is mounted.
      const date = "2026-11-14";
      view.rerender(
        shell("/nutrition", React.createElement(FoodTarget, { target: { kind: "food", date } })),
      );
      await user.click(screen.getByRole("button", { name: "Log: Food" }));
      expect(last().target).toEqual({ kind: "food", date });
      view.rerender(shell("/body"));
      expect(screen.getByRole("button", { name: "Log: Weight" })).toBeDefined();

      // Any button can open a given target.
      view.rerender(shell("/nutrition", React.createElement(AddLunch)));
      await user.click(screen.getByRole("button", { name: "Add to lunch" }));
      expect(last().target).toEqual({ kind: "food", meal: "lunch", date });

      // The page's own dialog: the + opens it, not the palette.
      view.rerender(shell("/records/labs", React.createElement(LabsDialog)));
      const before = palettes.filter((entry) => entry.open).length;
      await user.click(screen.getByRole("button", { name: "Log: Lab result" }));
      expect(dialogCalls).toEqual([{ kind: "lab_result" }]);
      expect(last().open).toBe(false);
      expect(palettes.filter((entry) => entry.open).length).toBe(before);

      // The palette's row for the kind hands over to the dialog, after the palette closes.
      let handled = false;
      await act(async () => {
        handled = openPageDialog("lab_result");
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      expect(handled).toBe(true);
      expect(dialogCalls).toEqual([{ kind: "lab_result" }, { kind: "lab_result" }]);
      expect(openPageDialog("weight")).toBe(false);

      // Unmounted, the dialog is gone: a page-only kind with no dialog opens the full palette.
      view.rerender(shell("/cycle"));
      await user.click(screen.getByRole("button", { name: "Log: Period" }));
      expect(last()).toEqual({ open: true, target: null });
    } finally {
      cleanup();
    }
  },
);

test.skipIf(!mountedMode)(
  "the palette starts at the target's form or at food for a meal and day",
  async () => {
    if (!mounted) throw new Error("mounted setup missing");
    const [rtl, userModule, query, lingui, i18nTesting, diary, , targets, palette, fixture] =
      mounted;
    const { cleanup, render, screen } = rtl;
    const user = userModule.default.setup();
    const { QueryClient, QueryClientProvider } = query;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { QuickLogPalette } = palette;
    const originalFetch = globalThis.fetch;
    // No server: every query fails, and the palette still opens from what it knows.
    globalThis.fetch = (async () => {
      throw new TypeError("offline in this test");
    }) as unknown as typeof fetch;

    const mount = (target: ReturnType<typeof targets.routeLogTarget>) => {
      const { router, RouterProvider } = fixture.createMountedRouter(
        React.createElement(QuickLogPalette, {
          open: true,
          onOpenChange: () => {},
          navGroups: [{ label: { id: "nav", message: "Today" }, links: [] }],
          target,
        }),
      );
      return render(
        React.createElement(
          lingui.I18nProvider,
          { i18n: i18nTesting.englishI18n },
          React.createElement(
            QueryClientProvider,
            { client },
            React.createElement(RouterProvider, { router }),
          ),
        ),
      );
    };

    try {
      mount(targets.routeLogTarget("/records/vitals"));
      expect(await screen.findByRole("heading", { name: "Heart rate" })).toBeDefined();
      // Ready to type the value.
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Heart rate" }));
      await user.click(screen.getByRole("button", { name: "Blood pressure" }));
      expect(await screen.findByRole("heading", { name: "Blood pressure" })).toBeDefined();
      expect(screen.getByRole("textbox", { name: "Systolic" })).toBeDefined();
      // Back to heart rate from blood pressure, one tap again.
      await user.click(screen.getByRole("button", { name: "Heart rate" }));
      expect(await screen.findByRole("heading", { name: "Heart rate" })).toBeDefined();
      cleanup();

      const today = diary.localDateIn(diary.deviceTimeZone());
      const pastDay = diary.shiftLocalDate(today, -3);
      mount({ kind: "food", meal: "dinner", date: pastDay });
      const chip = await screen.findByText(/^Dinner · /);
      expect(chip.textContent).not.toContain("Today");
      // Focus stays on the search box, and the list holds food only.
      expect(document.activeElement).toBe(screen.getByRole("combobox"));
      expect(screen.getByRole("option", { name: /^Food/ })).toBeDefined();
      expect(screen.queryByRole("option", { name: /^Weight/ })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Show everything" }));
      expect(await screen.findByRole("option", { name: /^Weight/ })).toBeDefined();
      expect(screen.queryByText(/^Dinner · /)).toBeNull();
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
    }
  },
);
