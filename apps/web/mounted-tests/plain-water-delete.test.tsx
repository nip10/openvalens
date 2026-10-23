import { expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { RPCHandler } from "@orpc/server/fetch";
import { os } from "@orpc/server";
import { z } from "zod";

const date = "2026-10-20";
const entry = {
  id: 41,
  observedAt: `${date}T09:00:00.000Z`,
  timeZone: "UTC",
  quantityMl: 250,
  revision: 3,
  deleted: false,
  createdAt: `${date}T09:00:00.000Z`,
  updatedAt: `${date}T09:00:00.000Z`,
};
const captured: Array<{ path: string; method: string }> = [];
const mounted =
  process.env.MOUNTED_WATER_TEST === "1"
    ? await Promise.all([
        import("@testing-library/react"),
        import("@testing-library/user-event"),
        import("@tanstack/react-query"),
        import("react"),
        import("../src/components/plain-water-section"),
      ])
    : null;

test.skipIf(process.env.MOUNTED_WATER_TEST !== "1")(
  "delete Retry resends the identical operation after acknowledgement loss",
  async () => {
    if (!mounted) throw new Error("mounted suite setup not loaded");
    const [{ cleanup, render, screen }, userModule, query, react, section] = mounted;
    const userEvent = userModule.default;
    const { QueryClient, QueryClientProvider } = query;
    const { createElement } = react;
    const withI18n = (node: ReturnType<typeof createElement>) =>
      createElement(I18nProvider, { i18n: englishI18n }, node);
    const { PlainWaterSection } = section;

    const deleteInputs: unknown[] = [];
    const addInputs: unknown[] = [];
    let attempts = 0;
    let applied = false;
    const procedure = os.input(z.unknown());
    const router = {
      plainWater: {
        getDay: os.input(z.any()).handler(() => ({
          date,
          timeZone: "UTC",
          label: "Plain water subtotal",
          enabled: true,
          quantityMl: applied ? 0 : 250,
          personalGoalMl: null,
          entries: applied ? [] : [entry],
        })),
        getPreferences: procedure.handler(() => ({ enabled: true, personalGoalMl: null })),
        add: procedure.handler(({ input }) => {
          addInputs.push(input);
          return { outcome: "applied", entry, targetId: "42" };
        }),
        delete: procedure.handler(({ input }) => {
          attempts += 1;
          deleteInputs.push(input);
          applied = true;
          return {
            outcome: attempts === 1 ? "applied" : "replayed",
            entry: { ...entry, deleted: true, revision: 4 },
            targetId: "41",
          };
        }),
      },
    };
    const rpc = new RPCHandler(router);
    const originalFetch = globalThis.fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const fetchDiagnostics: string[] = [];

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const pathname = new URL(request.url).pathname;
        captured.push({ path: pathname, method: request.method });
        const result = await rpc.handle(request, { prefix: "/rpc", context: {} });
        if (!result.matched || !result.response) {
          fetchDiagnostics.push(`unmatched ${request.method} ${pathname}`);
          throw new Error(`Unmatched synthetic RPC request (${request.method} ${pathname})`);
        }
        const isDelete = pathname.endsWith("/plainWater/delete");
        if (isDelete && attempts === 1) {
          // The fixture router accepted the delete; discard only its acknowledgement.
          await result.response.arrayBuffer();
          throw new TypeError("synthetic acknowledgement loss after server application");
        }
        return result.response;
      },
    });

    try {
      render(
        withI18n(
          createElement(
            QueryClientProvider,
            { client },
            createElement(PlainWaterSection, {
              trustedScope: "scope-fixture",
              localDate: date,
              timeZone: "UTC",
              hideNumbers: false,
              announce: () => {},
            }),
          ),
        ),
      );

      const row = await screen.findByRole("listitem");
      expect(row.textContent).toContain("250 ml");
      expect(captured.some(({ path }) => path.endsWith("/plainWater/getDay"))).toBe(true);
      expect(captured.some(({ path }) => path.endsWith("/plainWater/getPreferences"))).toBe(true);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Add plain water" }));
      await user.type(screen.getByRole("textbox", { name: "Amount" }), "300");
      await user.click(screen.getByRole("button", { name: "Delete entry at 09:00" }));
      await user.click(screen.getByRole("button", { name: "Delete entry" }));
      await screen.findByRole("button", { name: "Retry" });
      expect(attempts).toBe(1);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(addInputs).toHaveLength(0);
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Amount" }).value).toBe("300");

      await user.click(screen.getByRole("button", { name: "Retry" }));
      await screen.findAllByText("Nothing logged for this day.");
      expect(attempts).toBe(2);
      expect(deleteInputs[1]).toEqual(deleteInputs[0]);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
      client.clear();
      cleanup();
      // Keep failure diagnostics structural only; never emit bodies, headers, or payloads.
    }
    if (fetchDiagnostics.length) throw new Error(fetchDiagnostics.join("; "));
  },
);

test.skipIf(process.env.MOUNTED_WATER_TEST !== "1")(
  "delete conflict can rebase with a fresh operation or accept the server version",
  async () => {
    if (!mounted) throw new Error("mounted suite setup not loaded");
    const [{ cleanup, render, screen }, userModule, query, react, section] = mounted;
    const user = userModule.default.setup();
    const { QueryClient, QueryClientProvider } = query;
    const { createElement } = react;
    const withI18n = (node: ReturnType<typeof createElement>) =>
      createElement(I18nProvider, { i18n: englishI18n }, node);
    const { PlainWaterSection } = section;
    const inputs: { clientMutationId: string; expectedRevision: number }[] = [];
    let deleteAttempts = 0;
    const conflictEntry = { ...entry, quantityMl: 300, revision: 4 };
    const procedure = os.input(z.unknown());
    const router = {
      plainWater: {
        getDay: os.input(z.any()).handler(() => ({
          date,
          timeZone: "UTC",
          label: "Plain water subtotal",
          enabled: true,
          quantityMl: 250,
          personalGoalMl: null,
          entries: [entry],
        })),
        getPreferences: procedure.handler(() => ({ enabled: true, personalGoalMl: null })),
        delete: procedure.handler(({ input }) => {
          deleteAttempts += 1;
          inputs.push(input as { clientMutationId: string; expectedRevision: number });
          if (deleteAttempts < 3)
            return { outcome: "conflict", entry: conflictEntry, targetId: "41" };
          return { outcome: "applied", entry: { ...conflictEntry, deleted: true }, targetId: "41" };
        }),
      },
    };
    const rpc = new RPCHandler(router);
    const originalFetch = globalThis.fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const result = await rpc.handle(request, { prefix: "/rpc", context: {} });
        if (!result.matched || !result.response)
          throw new Error(
            `Unmatched synthetic RPC request (${request.method} ${new URL(request.url).pathname})`,
          );
        return result.response;
      },
    });
    try {
      render(
        withI18n(
          createElement(
            QueryClientProvider,
            { client },
            createElement(PlainWaterSection, {
              trustedScope: "scope-fixture",
              localDate: date,
              timeZone: "UTC",
              hideNumbers: false,
              announce: () => {},
            }),
          ),
        ),
      );
      await screen.findByRole("listitem");
      await user.click(screen.getByRole("button", { name: "Delete entry at 09:00" }));
      await user.click(screen.getByRole("button", { name: "Delete entry" }));
      await screen.findByRole("button", { name: "Keep my change" });
      expect(deleteAttempts).toBe(1);

      await user.click(screen.getByRole("button", { name: "Keep my change" }));
      await screen.findByRole("button", { name: "Keep my change" });
      expect(deleteAttempts).toBe(2);
      expect(inputs[1].clientMutationId).not.toBe(inputs[0].clientMutationId);
      expect(inputs[1].expectedRevision).toBe(4);

      await user.click(screen.getByRole("button", { name: "Keep the other version" }));
      expect(screen.queryByRole("button", { name: "Keep the other version" })).toBeNull();
      expect(deleteAttempts).toBe(2);
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

test.skipIf(process.env.MOUNTED_WATER_TEST !== "1")(
  "an uncertain delete cannot adopt an unsent edit draft",
  async () => {
    if (!mounted) throw new Error("mounted suite setup not loaded");
    const [{ cleanup, render, screen }, userModule, query, react, section] = mounted;
    const user = userModule.default.setup();
    const { QueryClient, QueryClientProvider } = query;
    const { createElement } = react;
    const withI18n = (node: ReturnType<typeof createElement>) =>
      createElement(I18nProvider, { i18n: englishI18n }, node);
    const { PlainWaterSection } = section;
    const second = {
      ...entry,
      id: 42,
      observedAt: `${date}T10:00:00.000Z`,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: `${date}T10:00:00.000Z`,
    };
    let deleteAttempts = 0;
    const deleteInputs: unknown[] = [];
    const changeInputs: unknown[] = [];
    const procedure = os.input(z.unknown());
    const router = {
      plainWater: {
        getDay: os.input(z.any()).handler(() => ({
          date,
          timeZone: "UTC",
          label: "Plain water subtotal",
          enabled: true,
          quantityMl: 500,
          personalGoalMl: null,
          entries: [entry, second],
        })),
        getPreferences: procedure.handler(() => ({ enabled: true, personalGoalMl: null })),
        change: procedure.handler(({ input }) => {
          changeInputs.push(input);
          return { outcome: "applied", entry, targetId: "41" };
        }),
        delete: procedure.handler(({ input }) => {
          deleteInputs.push(input);
          deleteAttempts += 1;
          return {
            outcome: "applied",
            entry: { ...second, deleted: true, revision: 4 },
            targetId: "42",
          };
        }),
      },
    };
    const rpc = new RPCHandler(router);
    const originalFetch = globalThis.fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const result = await rpc.handle(request, { prefix: "/rpc", context: {} });
        if (!result.matched || !result.response)
          throw new Error(
            `Unmatched synthetic RPC request (${request.method} ${new URL(request.url).pathname})`,
          );
        if (new URL(request.url).pathname.endsWith("/plainWater/delete") && deleteAttempts === 1) {
          await result.response.arrayBuffer();
          throw new TypeError("synthetic acknowledgement loss after server application");
        }
        return result.response;
      },
    });
    try {
      render(
        withI18n(
          createElement(
            QueryClientProvider,
            { client },
            createElement(PlainWaterSection, {
              trustedScope: "scope-fixture",
              localDate: date,
              timeZone: "UTC",
              hideNumbers: false,
              announce: () => {},
            }),
          ),
        ),
      );
      await screen.findAllByRole("listitem");
      await user.click(screen.getByRole("button", { name: "Edit entry at 09:00" }));
      const amount = screen.getAllByRole("textbox", { name: "Amount" })[0];
      await user.clear(amount);
      await user.type(amount, "300");
      await user.click(screen.getByRole("button", { name: "Delete entry at 10:00" }));
      await user.click(screen.getByRole("button", { name: "Delete entry" }));
      await screen.findByRole("button", { name: "Retry" });
      expect(deleteAttempts).toBe(1);

      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(changeInputs).toHaveLength(0);
      expect(screen.getAllByRole<HTMLInputElement>("textbox", { name: "Amount" })[0].value).toBe(
        "300",
      );
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(deleteAttempts).toBe(2);
      expect(deleteInputs[1]).toEqual(deleteInputs[0]);
      expect(screen.getAllByRole<HTMLInputElement>("textbox", { name: "Amount" })[0].value).toBe(
        "300",
      );
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

test.skipIf(process.env.MOUNTED_WATER_TEST !== "1")(
  "a successful older add leaves a newer reopened draft untouched",
  async () => {
    if (!mounted) throw new Error("mounted suite setup not loaded");
    const [{ cleanup, render, screen }, userModule, query, react, section] = mounted;
    const user = userModule.default.setup();
    const { QueryClient, QueryClientProvider } = query;
    const { act, createElement } = react;
    const withI18n = (node: ReturnType<typeof createElement>) =>
      createElement(I18nProvider, { i18n: englishI18n }, node);
    const { PlainWaterSection } = section;
    let releaseAdd!: (result: { outcome: "applied" }) => void;
    let markAddStarted!: () => void;
    const addStarted = new Promise<void>((resolve) => (markAddStarted = resolve));
    const heldAdd = new Promise<{ outcome: "applied" }>((resolve) => (releaseAdd = resolve));
    const procedure = os.input(z.unknown());
    const router = {
      plainWater: {
        getDay: os.input(z.any()).handler(() => ({
          date,
          timeZone: "UTC",
          label: "Plain water subtotal",
          enabled: true,
          quantityMl: 0,
          personalGoalMl: null,
          entries: [],
        })),
        getPreferences: procedure.handler(() => ({ enabled: true, personalGoalMl: null })),
        add: procedure.handler(async () => {
          markAddStarted();
          return heldAdd;
        }),
      },
    };
    const rpc = new RPCHandler(router);
    const originalFetch = globalThis.fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const result = await rpc.handle(request, { prefix: "/rpc", context: {} });
        if (!result.matched || !result.response)
          throw new Error(
            `Unmatched synthetic RPC request (${request.method} ${new URL(request.url).pathname})`,
          );
        return result.response;
      },
    });
    try {
      render(
        withI18n(
          createElement(
            QueryClientProvider,
            { client },
            createElement(PlainWaterSection, {
              trustedScope: "scope-fixture",
              localDate: date,
              timeZone: "UTC",
              hideNumbers: false,
              announce: () => {},
            }),
          ),
        ),
      );
      await screen.findByRole("button", { name: "Add plain water" });
      await user.click(screen.getByRole("button", { name: "Add plain water" }));
      await user.type(screen.getByRole("textbox", { name: "Amount" }), "250");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await addStarted;

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Add plain water" }));
      await user.type(screen.getByRole("textbox", { name: "Amount" }), "375");
      await act(async () => {
        releaseAdd({ outcome: "applied" });
      });
      await screen.findByRole("button", { name: "Save" });

      const reopenedAmount = screen.queryByRole<HTMLInputElement>("textbox", { name: "Amount" });
      expect(reopenedAmount).toBeTruthy();
      if (!reopenedAmount) throw new Error("newer add draft input disappeared");
      expect(reopenedAmount.value).toBe("375");
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("button", { name: "Add plain water" });
      expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull();
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

test.skipIf(process.env.MOUNTED_WATER_TEST !== "1")(
  "a successful older edit leaves a newer reopened editor untouched",
  async () => {
    if (!mounted) throw new Error("mounted suite setup not loaded");
    const [{ cleanup, render, screen }, userModule, query, react, section] = mounted;
    const user = userModule.default.setup();
    const { QueryClient, QueryClientProvider } = query;
    const { act, createElement } = react;
    const withI18n = (node: ReturnType<typeof createElement>) =>
      createElement(I18nProvider, { i18n: englishI18n }, node);
    const { PlainWaterSection } = section;
    let releaseChange!: (result: {
      outcome: "applied";
      entry: typeof entry;
      targetId: string;
    }) => void;
    let markChangeStarted!: () => void;
    const changeStarted = new Promise<void>((resolve) => (markChangeStarted = resolve));
    const heldChange = new Promise<{ outcome: "applied"; entry: typeof entry; targetId: string }>(
      (resolve) => (releaseChange = resolve),
    );
    const procedure = os.input(z.unknown());
    const router = {
      plainWater: {
        getDay: os.input(z.any()).handler(() => ({
          date,
          timeZone: "UTC",
          label: "Plain water subtotal",
          enabled: true,
          quantityMl: 250,
          personalGoalMl: null,
          entries: [entry],
        })),
        getPreferences: procedure.handler(() => ({ enabled: true, personalGoalMl: null })),
        change: procedure.handler(async () => {
          markChangeStarted();
          return heldChange;
        }),
      },
    };
    const rpc = new RPCHandler(router);
    const originalFetch = globalThis.fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const result = await rpc.handle(request, { prefix: "/rpc", context: {} });
        if (!result.matched || !result.response)
          throw new Error(
            `Unmatched synthetic RPC request (${request.method} ${new URL(request.url).pathname})`,
          );
        return result.response;
      },
    });
    try {
      render(
        withI18n(
          createElement(
            QueryClientProvider,
            { client },
            createElement(PlainWaterSection, {
              trustedScope: "scope-fixture",
              localDate: date,
              timeZone: "UTC",
              hideNumbers: false,
              announce: () => {},
            }),
          ),
        ),
      );
      await screen.findByRole("listitem");
      await user.click(screen.getByRole("button", { name: "Edit entry at 09:00" }));
      await user.clear(screen.getByRole("textbox", { name: "Amount" }));
      await user.type(screen.getByRole("textbox", { name: "Amount" }), "400");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await changeStarted;

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Edit entry at 09:00" }));
      await user.clear(screen.getByRole("textbox", { name: "Amount" }));
      await user.type(screen.getByRole("textbox", { name: "Amount" }), "500");
      await act(async () => {
        releaseChange({
          outcome: "applied",
          entry: { ...entry, quantityMl: 400, revision: 4 },
          targetId: "41",
        });
      });
      await screen.findByRole("button", { name: "Save" });

      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Amount" }).value).toBe("500");
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
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
