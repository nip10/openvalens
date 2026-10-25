import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";

const execFileAsync = promisify(execFile);
const mountedMode = process.env.MOUNTED_EXERCISE_LIBRARY_TEST === "1";
const scope = "exercise-ui-fixture:workspace-a";
const session = {
  user: { id: "exercise-ui-fixture" },
  session: { activeOrganizationId: "workspace-a" },
};
let currentSession = session;

if (mountedMode) {
  mock.module("../src/lib/auth-client", () => ({
    authClient: { useSession: () => ({ data: currentSession, isPending: false }) },
  }));
  mock.module("@tanstack/react-router", () => ({
    Link: (props: { children: React.ReactNode }) =>
      React.createElement("a", { href: "/workouts" }, props.children),
  }));
}

const mounted = mountedMode
  ? await Promise.all([
      import("@testing-library/react"),
      import("@testing-library/user-event"),
      import("@tanstack/react-query"),
      import("react"),
      import("@orpc/server/fetch"),
      import("@orpc/server"),
      import("zod"),
      import("../src/components/exercise-library"),
      import("../src/utils/orpc"),
      import("@lingui/react"),
      import("@openvalens/i18n/testing"),
    ])
  : null;

test.skipIf(mountedMode)(
  "isolates the mounted exercise-library mocks in a subprocess",
  async () => {
    const result = await execFileAsync(
      process.execPath,
      [
        "test",
        // Lingui macros (#67): the subprocess runs outside apps/web, so its bunfig preload is not picked up.
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
          MOUNTED_EXERCISE_LIBRARY_TEST: "1",
          VITE_SERVER_URL: "http://localhost:3000",
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    process.stdout.write(output);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
  },
);

test.skipIf(!mountedMode)(
  "mounted detail presents parent, translation and image provenance as separate records",
  async () => {
    if (!mounted) throw new Error("mounted setup missing");
    const [
      { act, cleanup, fireEvent, render, screen, waitFor },
      userModule,
      query,
      react,
      rpcServer,
      server,
      zod,
      component,
      orpcModule,
      lingui,
      i18nTesting,
    ] = mounted;
    const user = userModule.default.setup();
    const { QueryClient, QueryClientProvider } = query;
    const { createElement } = react;
    const { ExerciseLibraryPage } = component;
    const { orpc } = orpcModule;
    const page = () =>
      createElement(
        lingui.I18nProvider,
        { i18n: i18nTesting.englishI18n },
        createElement(QueryClientProvider, { client }, createElement(ExerciseLibraryPage)),
      );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const key = (queryKey: readonly unknown[]) => [...queryKey, { scope }];
    const assetId = "a1b2c3d4-e5f6-4789-8123-456789abcdef";
    const media = [
      {
        assetId,
        path: `/api/exercise-assets/${assetId}`,
        contentType: "image/jpeg",
        width: 640,
        height: 480,
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        author: "Image author",
        attribution: "Image credit",
        sourceUrl: "https://images.example.test/source",
        transformationNotice: "Cropped",
      },
    ];
    const detail = {
      id: 51,
      name: "Translated squat",
      language: "fr",
      instructions: "<img src=x onerror=alert(1)>Keep your balance.",
      instructionsArePlainText: true,
      source: "wger",
      category: "Strength",
      license: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      author: "Parent author",
      attribution: "Parent notice",
      sourceRecordUrl: "https://example.test/parent-source",
      muscles: [{ externalMuscleId: "11", name: "Biceps", role: "primary", location: "front" }],
      equipment: [],
      media,
      translationAttribution: {
        license: "CC-BY-SA-4.0",
        author: "Translator",
        sourceUrl: "https://example.test/translation-source",
        rawAttribution: null,
      },
    };
    const catalogLanguage = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 16) || "en";
    const searchOptions = orpc.exerciseCatalog.search.queryOptions({
      input: { language: catalogLanguage, limit: 50 },
    });
    const detailOptions = orpc.exerciseCatalog.get.queryOptions({
      input: { id: 51, language: catalogLanguage },
    });
    const filterOptions = orpc.exerciseCatalog.filters.queryOptions({ input: {} });
    const workoutOptions = orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } });
    client.setQueryData(key(searchOptions.queryKey), [
      {
        id: 51,
        name: "Translated squat",
        muscles: detail.muscles,
        category: "Strength",
        source: "wger",
        license: detail.license,
        author: detail.author,
      },
    ]);
    client.setQueryData(key(detailOptions.queryKey), detail);
    client.setQueryData(key(filterOptions.queryKey), { muscles: [], equipment: [] });
    client.setQueryData(key(workoutOptions.queryKey), [
      { id: 71, date: "2026-10-22", type: "Strength" },
      { id: 72, date: "2026-10-23", type: "Mobility" },
    ]);
    const requests: string[] = [];
    const searchInputs: Array<Record<string, unknown>> = [];
    const addInputs: Array<Record<string, unknown>> = [];
    const addResolvers: Array<(value: { id: number; name: string }) => void> = [];
    const addStartedResolvers: Array<() => void> = [];
    const procedure = server.os.input(zod.z.any());
    const rpc = new rpcServer.RPCHandler({
      exerciseCatalog: {
        filters: procedure.handler(() => ({ muscles: [], equipment: [] })),
        search: procedure.handler(({ input }: { input: Record<string, unknown> }) => {
          searchInputs.push({
            ...input,
            activeOrganizationId: currentSession.session.activeOrganizationId,
          });
          return currentSession.session.activeOrganizationId === "workspace-b"
            ? []
            : [
                {
                  id: 51,
                  name: "Translated squat",
                  muscles: detail.muscles,
                  category: "Strength",
                  source: "wger",
                  license: detail.license,
                  author: detail.author,
                },
              ];
        }),
        get: procedure.handler(() => detail),
        addFromLibrary: procedure.handler(({ input }: { input: Record<string, unknown> }) => {
          addInputs.push(input);
          addStartedResolvers.shift()?.();
          if (addInputs.length === 3)
            return Promise.reject(new Error("synthetic acknowledgement loss"));
          if (addInputs.length === 4) return { id: 51, name: "Translated squat" };
          return new Promise<{ id: number; name: string }>((resolve) => addResolvers.push(resolve));
        }),
      },
      plans: {
        workouts: {
          listWorkouts: procedure.handler(() => [
            { id: 71, date: "2026-10-22", type: "Strength" },
            { id: 72, date: "2026-10-23", type: "Mobility" },
          ]),
        },
      },
    });
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request.url);
        const response = await rpc.handle(request, { prefix: "/rpc", context: {} });
        if (!response.matched || !response.response)
          throw new Error(`Unexpected request ${request.url}`);
        return response.response;
      },
    });
    try {
      const view = render(page());
      await user.click(await screen.findByRole("button", { name: /Translated squat/ }));
      await screen.findByText("Parent notice");
      expect(screen.getByRole("region", { name: "Exercise record" })).toBeTruthy();
      expect(screen.getByRole("region", { name: "Selected translation (fr)" })).toBeTruthy();
      expect(screen.queryByText("Translation notice")).toBeNull();
      expect(screen.getByText("License: CC0-1.0 · Parent author")).toBeTruthy();
      expect(screen.getByText("License: CC-BY-SA-4.0 · Translator")).toBeTruthy();
      expect(
        screen
          .getAllByRole("link", { name: "License details" })
          .some(
            (link) =>
              (link as HTMLAnchorElement).href ===
              "https://creativecommons.org/publicdomain/zero/1.0/",
          ),
      ).toBe(true);
      expect(
        (
          screen.getByRole("link", {
            name: "Selected translation license details",
          }) as HTMLAnchorElement
        ).href,
      ).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
      await screen.findByText("License: CC BY 4.0 · Image author");
      expect(screen.getByText("Image credit")).toBeTruthy();
      expect((screen.getByRole("link", { name: "Image source" }) as HTMLAnchorElement).href).toBe(
        "https://images.example.test/source",
      );
      expect(
        screen
          .getAllByRole("link", { name: "Source record" })
          .some(
            (link) => (link as HTMLAnchorElement).href === "https://example.test/parent-source",
          ),
      ).toBe(true);

      const fallbackDetail = {
        ...detail,
        language: "en",
        translationAttribution: {
          license: "CC-BY-SA-3.0",
          author: "English fallback translator",
          sourceUrl: "https://example.test/english-fallback-source",
          rawAttribution: null,
        },
      };
      client.setQueryData(key(detailOptions.queryKey), fallbackDetail);
      expect(
        await screen.findByRole("region", { name: "Selected translation (English fallback)" }),
      ).toBeTruthy();
      expect(
        (
          screen.getByRole("link", {
            name: "Selected translation license details",
          }) as HTMLAnchorElement
        ).href,
      ).toBe("https://creativecommons.org/licenses/by-sa/3.0/");
      expect(screen.getByText("License: CC-BY-SA-3.0 · English fallback translator")).toBeTruthy();
      expect(
        screen
          .getAllByRole("link", { name: "Source record" })
          .some(
            (link) =>
              (link as HTMLAnchorElement).href === "https://example.test/english-fallback-source",
          ),
      ).toBe(true);
      client.setQueryData(key(detailOptions.queryKey), detail);
      await screen.findByText("License: CC-BY-SA-4.0 · Translator");
      expect(screen.getByText("Cropped")).toBeTruthy();
      expect(screen.getByText(/<img src=x onerror=alert\(1\)>Keep your balance\./)).toBeTruthy();
      const preview = screen.getByRole("img", {
        name: "Translated squat preview 1",
      }) as HTMLImageElement;
      expect(screen.getAllByRole("img")).toHaveLength(1);
      expect(document.querySelector("[onerror]")).toBeNull();
      expect(preview.src).toBe(`http://localhost:3000/api/exercise-assets/${assetId}`);
      expect(preview.src).not.toContain("images.example.test");
      expect(requests.some((url) => url.includes("example.test"))).toBe(false);
      expect(screen.queryByRole("region", { name: "Muscle guide" })).toBeNull();
      fireEvent.error(preview);
      await screen.findByRole("region", { name: "Muscle guide" });
      expect(screen.getByText("License: CC BY 4.0 · Image author")).toBeTruthy();
      expect(screen.getByText("Image credit")).toBeTruthy();
      expect(
        screen.getByText(
          (_, element) => element?.tagName === "P" && element.textContent === "Primary: Biceps",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          (_, element) =>
            element?.tagName === "P" && element.textContent === "Secondary: None listed",
        ),
      ).toBeTruthy();
      // Decorative lucide icons (class "lucide", aria-hidden) are not part of the
      // muscle guide; count only the guide's own drawings.
      expect(document.querySelectorAll("svg:not(.lucide) rect")).toHaveLength(2);
      expect(document.querySelector("svg image")).toBeNull();
      expect(document.querySelectorAll("svg:not(.lucide)")).toHaveLength(2);
      await waitFor(() => expect(document.querySelector("img[src*='example.test']")).toBeNull());

      const workoutSelect = screen.getByLabelText("Add to workout") as HTMLSelectElement;
      await user.selectOptions(workoutSelect, "71");
      const firstStarted = new Promise<void>((resolve) => addStartedResolvers.push(resolve));
      const addButton = screen.getByRole("button", { name: "Add exercise" });
      fireEvent.click(addButton);
      fireEvent.click(addButton);
      await firstStarted;
      await waitFor(() => expect(addInputs).toHaveLength(1));
      await user.click(screen.getByRole("button", { name: "Cancel request" }));
      await user.selectOptions(screen.getByLabelText("Add to workout"), "72");
      client.setQueryData(key(detailOptions.queryKey), fallbackDetail);
      const secondStarted = new Promise<void>((resolve) => addStartedResolvers.push(resolve));
      await user.click(screen.getByRole("button", { name: "Add exercise" }));
      await secondStarted;
      expect(addInputs).toHaveLength(2);
      expect(addInputs[0].clientMutationId).not.toBe(addInputs[1].clientMutationId);
      expect(addInputs[0].workoutId).toBe(71);
      expect(addInputs[1].workoutId).toBe(72);
      expect(addInputs[0].language).toBe("fr");
      expect(addInputs[1].language).toBe("en");
      await act(async () => addResolvers.shift()!({ id: 51, name: "Translated squat" }));
      expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
      await act(async () => addResolvers.shift()!({ id: 51, name: "Translated squat" }));
      await screen.findByText("Translated squat added to the workout.");
      await user.click(screen.getByRole("button", { name: "Add exercise" }));
      await screen.findByRole("button", { name: "Refresh and review" });
      const retryId = addInputs[2]?.clientMutationId;
      await user.click(screen.getByRole("button", { name: "Refresh and review" }));
      await user.click(await screen.findByRole("button", { name: "Retry same request" }));
      await waitFor(() => expect(addInputs).toHaveLength(4));
      await screen.findByText("Translated squat added to the workout.");
      expect(addInputs).toHaveLength(4);
      expect(addInputs[3]?.clientMutationId).toBe(retryId);

      client.setQueryData(key(detailOptions.queryKey), {
        ...detail,
        muscles: [{ name: "Unknown muscle", role: "primary", location: "front" }],
        media: [],
      });
      await screen.findByText("No preview image is provided.");
      await screen.findByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === "Primary: Unknown muscle",
      );
      expect(screen.getByText(/No matching diagram mapping is available/)).toBeTruthy();
      expect(document.querySelectorAll("svg:not(.lucide) rect")).toHaveLength(0);
      expect(document.querySelectorAll("svg:not(.lucide)")).toHaveLength(0);

      client.setQueryData(key(detailOptions.queryKey), {
        ...detail,
        media: [
          {
            ...media[0],
            license: "",
            licenseUrl: "",
            sourceUrl: "https://images.example.test/source",
          },
        ],
      });
      await screen.findByText("Preview unavailable because image license details are incomplete.");
      expect(screen.queryByRole("img", { name: "Translated squat preview 1" })).toBeNull();

      await user.type(screen.getByLabelText("Search by name"), "private-workspace-query");
      await waitFor(() =>
        expect(searchInputs.some((input) => input.query === "private-workspace-query")).toBe(true),
      );
      await user.selectOptions(screen.getByLabelText("Add to workout"), "71");
      const staleStarted = new Promise<void>((resolve) => addStartedResolvers.push(resolve));
      await user.click(screen.getByRole("button", { name: "Add exercise" }));
      await staleStarted;
      expect(addInputs).toHaveLength(5);
      const staleMutationId = addInputs[4]?.clientMutationId;
      expect(staleMutationId).toBeTruthy();
      currentSession = { ...session, session: { activeOrganizationId: "workspace-b" } };
      client.setQueryData(key(searchOptions.queryKey), [
        {
          id: 99,
          name: "Workspace A private row",
          muscles: [],
          category: null,
          source: "user",
        },
      ]);
      await act(async () => view.rerender(page()));
      await waitFor(() => expect(screen.queryByText("Loading your workspace…")).toBeNull());
      await screen.findByText("The library is empty for now.");
      expect(screen.queryByText("Workspace A private row")).toBeNull();
      expect(screen.queryByText("Parent notice")).toBeNull();
      expect((screen.getByLabelText("Search by name") as HTMLInputElement).value).toBe("");
      expect(
        searchInputs.filter((input) => input.query === "private-workspace-query"),
      ).toHaveLength(1);
      expect(
        searchInputs.find((input) => input.query === "private-workspace-query")
          ?.activeOrganizationId,
      ).toBe("workspace-a");
      expect(
        searchInputs.filter(
          (input) =>
            input.query === "private-workspace-query" &&
            input.activeOrganizationId === "workspace-b",
        ),
      ).toHaveLength(0);

      let unsubscribe = () => {};
      const staleMutationCompleted = new Promise<void>((resolve) => {
        unsubscribe = client.getMutationCache().subscribe((event) => {
          if (
            event.type === "updated" &&
            event.mutation.state.status === "success" &&
            (event.mutation.state.variables as Record<string, unknown> | undefined)
              ?.clientMutationId === staleMutationId
          ) {
            unsubscribe();
            resolve();
          }
        });
      });
      await act(async () => {
        addResolvers.shift()!({ id: 51, name: "A-only stale exercise" });
        await staleMutationCompleted;
      });
      expect(screen.queryByText("A-only stale exercise added to the workout.")).toBeNull();
      expect(screen.queryByText("Parent notice")).toBeNull();
      expect(
        searchInputs.filter(
          (input) =>
            input.query === "private-workspace-query" &&
            input.activeOrganizationId === "workspace-b",
        ),
      ).toHaveLength(0);

      currentSession = session;
      await act(async () => view.rerender(page()));
      await user.click(await screen.findByRole("button", { name: /Workspace A private row/ }));
      await screen.findByText("Parent notice");
      await user.selectOptions(screen.getByLabelText("Add to workout"), "71");
      const unmountStarted = new Promise<void>((resolve) => addStartedResolvers.push(resolve));
      await user.click(screen.getByRole("button", { name: "Add exercise" }));
      await unmountStarted;
      cleanup();
      await act(async () => addResolvers.shift()!({ id: 51, name: "Translated squat" }));
      expect(document.body.textContent).not.toContain("Translated squat added to the workout.");
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
