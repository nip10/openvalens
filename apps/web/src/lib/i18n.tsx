import { I18nProvider } from "@lingui/react";
import { activateLocale, createAppI18n, resolveLocale, type Locale } from "@openvalens/i18n";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Web language (#67): a saved choice, else the browser's languages. Switching
 * re-renders in place; no reload. The choice is a per-browser convenience
 * kept in localStorage, so a blocked or empty storage simply falls back.
 */

const STORAGE_KEY = "openvalens.locale";

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function initialLocale(): Locale {
  const browser = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? [])];
  return resolveLocale([readSaved(), ...browser]);
}

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: "en",
  setLocale: () => {},
});

export function AppI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const i18n = useMemo(() => createAppI18n(locale), []); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => ({
      locale,
      setLocale: (next: Locale) => {
        activateLocale(i18n, next);
        document.documentElement.lang = next;
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Not saved; the choice still applies until the tab closes.
        }
        setLocaleState(next);
      },
    }),
    [i18n, locale],
  );
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

export function useAppLocale() {
  return useContext(LocaleContext);
}
