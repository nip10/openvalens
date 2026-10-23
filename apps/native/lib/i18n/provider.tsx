import { I18nProvider } from "@lingui/react";
import {
  activateLocale,
  createAppI18n,
  isLocale,
  resolveLocale,
  type Locale,
} from "@openvalens/i18n";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Mobile language (#67): a saved choice, else the device language. Switching
 * re-renders in place; no restart. The choice is stored on the device only.
 */

const STORAGE_KEY = "openvalens.locale";

function deviceLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return null;
  }
}

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: "en",
  setLocale: () => {},
});

export function AppI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocale([deviceLocale()]));
  const i18n = useMemo(() => createAppI18n(locale), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (cancelled || !isLocale(saved)) return;
        activateLocale(i18n, saved);
        setLocaleState(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [i18n]);

  const value = useMemo(
    () => ({
      locale,
      setLocale: (next: Locale) => {
        activateLocale(i18n, next);
        setLocaleState(next);
        void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
      },
    }),
    [i18n, locale],
  );
  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

export function useAppLocale() {
  return useContext(LocaleContext);
}
