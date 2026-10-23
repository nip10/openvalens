import { expect, test } from "bun:test";

/**
 * #67: switching the interface language re-renders the page in place (no
 * reload) and the choice is remembered for the next visit.
 */
const mounted =
  process.env.MOUNTED_I18N_TEST === "1"
    ? await Promise.all([
        import("@testing-library/react"),
        import("@testing-library/user-event"),
        import("react"),
        import("../src/lib/i18n"),
        import("../src/components/language-section"),
      ])
    : null;

test.skipIf(process.env.MOUNTED_I18N_TEST !== "1")(
  "the language switch re-renders without a reload and persists the choice",
  async () => {
    if (!mounted) throw new Error("mounted suite setup not loaded");
    const [{ cleanup, render, screen }, { default: userEvent }, react, i18n, section] = mounted;
    localStorage.removeItem("openvalens.locale");
    const reloads: string[] = [];
    window.addEventListener("beforeunload", () => reloads.push("unload"));
    render(
      react.createElement(i18n.AppI18nProvider, null, react.createElement(section.LanguageSection)),
    );
    expect(screen.getByText("Interface language")).toBeTruthy();
    expect(screen.queryByText("Community translation")).toBeNull();

    await userEvent.selectOptions(screen.getByRole("combobox"), "pt-PT");
    expect(screen.getByText("Idioma da interface")).toBeTruthy();
    expect(screen.getByText("Tradução da comunidade")).toBeTruthy();
    expect(document.documentElement.lang).toBe("pt-PT");
    expect(localStorage.getItem("openvalens.locale")).toBe("pt-PT");
    expect(reloads).toEqual([]);
    cleanup();

    // A fresh mount (the next visit) starts in the saved language.
    render(
      react.createElement(i18n.AppI18nProvider, null, react.createElement(section.LanguageSection)),
    );
    expect(screen.getByText("Idioma")).toBeTruthy();
    cleanup();
  },
);
