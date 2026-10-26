import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";
import type {} from "uniwind/types";

const execFileAsync = promisify(execFile);
const mountedMode = process.env.NATIVE_EXERCISE_ATTRIBUTION_TEST === "1";
const openedUrls: string[] = [];

if (mountedMode) {
  // Happy DOM is provided by the already-installed web test harness; keep native manifests untouched.
  const { GlobalRegistrator } =
    await import("../../web/node_modules/@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost:3000" });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mock.module("react-native", () => ({
    View: ({
      children,
      accessibilityLabel,
    }: {
      children: React.ReactNode;
      accessibilityLabel?: string;
    }) => React.createElement("section", { "aria-label": accessibilityLabel }, children),
    Text: ({ children }: { children: React.ReactNode }) =>
      React.createElement("span", null, children),
    TextInput: "input",
    Image: ({
      source,
      onError,
      accessibilityLabel,
    }: {
      source: { uri: string };
      onError?: () => void;
      accessibilityLabel?: string;
    }) => React.createElement("img", { src: source.uri, onError, alt: accessibilityLabel }),
    Platform: { OS: "android" },
    Pressable: ({
      children,
      onPress,
      accessibilityRole,
      accessibilityLabel,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      accessibilityRole?: string;
      accessibilityLabel?: string;
    }) =>
      React.createElement(
        "button",
        {
          type: "button",
          role: accessibilityRole,
          "aria-label": accessibilityLabel,
          onClick: onPress,
        },
        children,
      ),
    Linking: {
      openURL: async (url: string) => {
        openedUrls.push(url);
      },
    },
  }));
  const svgHost = (tag: string) => (props: Record<string, unknown>) =>
    React.createElement(tag, props);
  mock.module("react-native-svg", () => ({
    default: svgHost("svg"),
    Circle: svgHost("circle"),
    Path: svgHost("path"),
    Rect: svgHost("rect"),
  }));
  mock.module("@tanstack/react-query", () => ({ useMutation: () => ({}), useQuery: () => ({}) }));
  mock.module("expo-crypto", () => ({ randomUUID: () => "12345678-1234-4234-8234-123456789abc" }));
  mock.module("heroui-native", () => ({ Button: "button", Card: "div", Spinner: "span" }));
  mock.module("@/components/container", () => ({ Container: "div" }));
  mock.module("@/lib/auth-client", () => ({ authClient: { useSession: () => ({ data: null }) } }));
  mock.module("@/src/env", () => ({ ENV: { EXPO_PUBLIC_SERVER_URL: "http://localhost:3000" } }));
  mock.module("@/utils/orpc", () => ({ orpc: {} }));
}

const reactDomClientModule = "react-dom/client";
const mounted = mountedMode
  ? await Promise.all([
      import(reactDomClientModule),
      import("./exercise-attribution"),
      import("./exercise-library"),
    ])
  : null;
const i18nModules = mountedMode
  ? await Promise.all([import("@lingui/react"), import("@openvalens/i18n/testing")])
  : null;
/** Renders with English catalogs, as the app's provider does (#67). */
const withI18n = (element: React.ReactNode) => {
  if (!i18nModules) throw new Error("i18n fixture not loaded");
  const [{ I18nProvider }, { englishI18n }] = i18nModules;
  return React.createElement(I18nProvider, { i18n: englishI18n }, element);
};

test.skipIf(mountedMode)("isolates native attribution host mocks in a subprocess", async () => {
  const result = await execFileAsync(process.execPath, ["test", import.meta.path], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, NATIVE_EXERCISE_ATTRIBUTION_TEST: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout}${result.stderr}`;
  expect(output).toContain("2 pass");
  expect(output).toContain("0 fail");
});

test.skipIf(!mountedMode)(
  "native translation attribution opens only its own canonical license link on activation",
  async () => {
    if (!mounted) throw new Error("native attribution fixture not loaded");
    const [dom, component] = mounted;
    const { ExerciseAttribution, TranslationAttribution } = component;
    const container = document.createElement("div");
    document.body.append(container);
    const root = dom.createRoot(container);
    const render = async (element: React.ReactNode) => {
      await React.act(async () => root.render(withI18n(element)));
    };
    const text = (value: string) => {
      const element = Array.from(container.querySelectorAll("span")).find(
        (candidate) => candidate.textContent === value,
      );
      if (!element) throw new Error(`Missing rendered text: ${value}`);
      return element;
    };
    const links = (name: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="link"]')).filter(
        (link) => link.getAttribute("aria-label") === name,
      );
    const link = (name: string) => {
      const match = links(name)[0];
      if (!match) throw new Error(`Missing rendered native link: ${name}`);
      return match;
    };
    const section = (name: string) => container.querySelector(`[aria-label="${name}"]`);
    const frAttribution = {
      license: "CC-BY-SA-4.0",
      author: "French translator",
      sourceUrl: "https://example.test/french-translation",
      rawAttribution: null,
    };
    try {
      await render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ExerciseAttribution, {
            title: "Exercise record",
            license: "CC0-1.0",
            author: "Exercise author",
            sourceUrl: "https://example.test/parent-record",
            licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          }),
          React.createElement(TranslationAttribution, {
            language: "fr",
            requestedLanguage: "fr-FR",
            attribution: frAttribution,
          }),
        ),
      );
      expect(text("License: CC0-1.0, Exercise author")).toBeTruthy();
      expect(text("License: CC-BY-SA-4.0, French translator")).toBeTruthy();
      expect(section("Selected translation (fr)")).toBeTruthy();
      const sourceLinks = links("Source record");
      expect(sourceLinks).toHaveLength(2);
      expect(openedUrls).toHaveLength(0);
      link("Selected translation license details").click();
      expect(openedUrls).toEqual(["https://creativecommons.org/licenses/by-sa/4.0/"]);
      sourceLinks[1]!.click();
      expect(openedUrls[1]).toBe("https://example.test/french-translation");

      openedUrls.length = 0;
      await render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ExerciseAttribution, {
            title: "Exercise record",
            license: "CC0-1.0",
            licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          }),
          React.createElement(TranslationAttribution, {
            language: "en",
            requestedLanguage: "en-US",
            attribution: {
              ...frAttribution,
              license: "CC-BY-SA-3.0",
              author: "Fallback translator",
            },
          }),
        ),
      );
      expect(section("Selected translation (English fallback)")).toBeTruthy();
      link("Selected translation license details").click();
      expect(openedUrls).toEqual(["https://creativecommons.org/licenses/by-sa/3.0/"]);
      expect(openedUrls).not.toContain("https://creativecommons.org/publicdomain/zero/1.0/");

      await render(
        React.createElement(TranslationAttribution, {
          language: "fr",
          requestedLanguage: "fr-FR",
          attribution: { ...frAttribution, license: "UNKNOWN-LICENSE" },
        }),
      );
      expect(links("Selected translation license details")).toHaveLength(0);
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
  },
);

test.skipIf(!mountedMode)(
  "native production exercise gallery renders a local guide on failure",
  async () => {
    if (!mounted) throw new Error("mounted native exercise-library fixture not loaded");
    const [dom, , library] = mounted;
    const { ExerciseMediaGallery } = library;
    const container = document.createElement("div");
    document.body.append(container);
    const root = dom.createRoot(container);
    const render = async (props: Record<string, unknown>) =>
      React.act(async () =>
        root.render(withI18n(React.createElement(ExerciseMediaGallery, props as never))),
      );
    const muscles = [
      { name: "Biceps", role: "primary", location: "front", externalMuscleId: "11" },
    ];
    const media = [
      {
        assetId: "a1b2c3d4-e5f6-4789-8123-456789abcdef",
        path: "/api/exercise-assets/a1b2c3d4-e5f6-4789-8123-456789abcdef",
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
    try {
      await render({ exerciseName: "Test exercise", media: [], muscles });
      expect(container.textContent).toContain("Primary: Biceps");
      expect(container.textContent).toContain("Secondary: None listed");
      expect(container.querySelectorAll("svg")).toHaveLength(2);
      expect(container.querySelectorAll("rect")).toHaveLength(2);
      expect(container.querySelector("image")).toBeNull();
      await render({ exerciseName: "Test exercise", media, muscles });
      const preview = container.querySelector("img");
      expect(preview?.getAttribute("src")).toBe(
        "http://localhost:3000/api/exercise-assets/a1b2c3d4-e5f6-4789-8123-456789abcdef",
      );
      expect(preview?.getAttribute("src")).not.toContain("images.example.test");
      expect(container.textContent).toContain("License: CC BY 4.0, Image author");
      await React.act(async () => preview?.dispatchEvent(new Event("error")));
      expect(container.textContent).toContain("Muscle guide");
      expect(container.textContent).toContain("Primary: Biceps");
      await render({
        exerciseName: "Test exercise",
        media: [],
        muscles: [{ name: "Unknown", role: "primary", location: "front" }],
      });
      expect(container.textContent).toContain("No matching diagram mapping is available");
      expect(container.querySelectorAll("rect")).toHaveLength(0);
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      expect(container.querySelector("image")).toBeNull();
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
  },
);
