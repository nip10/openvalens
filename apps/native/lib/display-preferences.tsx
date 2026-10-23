import { LAB_UNIT_CHOICES, type LabUnitChoice } from "@openvalens/api/presenters/clinical-units";
import { PRODUCT_LOCALES, type ProductLocale } from "@openvalens/api/product-settings-contract";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Personal display preferences on this device (#67), separate from the
 * interface language: date and number format (`null` = app default) and how
 * lab concentrations are shown (display only; stored values never change).
 */

const FORMAT_KEY = "openvalens.formatLocale";
const LAB_UNITS_KEY = "openvalens.labUnits";

type DisplayPreferences = {
  formatLocale: ProductLocale | null;
  labUnits: LabUnitChoice;
  setFormatLocale: (value: ProductLocale | null) => void;
  setLabUnits: (value: LabUnitChoice) => void;
};

const Context = createContext<DisplayPreferences>({
  formatLocale: null,
  labUnits: "as_reported",
  setFormatLocale: () => {},
  setLabUnits: () => {},
});

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [formatLocale, setFormat] = useState<ProductLocale | null>(null);
  const [labUnits, setUnits] = useState<LabUnitChoice>("as_reported");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      SecureStore.getItemAsync(FORMAT_KEY),
      SecureStore.getItemAsync(LAB_UNITS_KEY),
    ])
      .then(([format, units]) => {
        if (cancelled) return;
        if ((PRODUCT_LOCALES as readonly string[]).includes(format ?? ""))
          setFormat(format as ProductLocale);
        if ((LAB_UNIT_CHOICES as readonly string[]).includes(units ?? ""))
          setUnits(units as LabUnitChoice);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      formatLocale,
      labUnits,
      setFormatLocale: (next: ProductLocale | null) => {
        setFormat(next);
        void (
          next
            ? SecureStore.setItemAsync(FORMAT_KEY, next)
            : SecureStore.deleteItemAsync(FORMAT_KEY)
        ).catch(() => {});
      },
      setLabUnits: (next: LabUnitChoice) => {
        setUnits(next);
        void SecureStore.setItemAsync(LAB_UNITS_KEY, next).catch(() => {});
      },
    }),
    [formatLocale, labUnits],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDisplayPreferences() {
  return useContext(Context);
}
