import { LAB_UNIT_CHOICES, type LabUnitChoice } from "@openvalens/api/presenters/clinical-units";
import { PRODUCT_LOCALES, type ProductLocale } from "@openvalens/api/product-settings-contract";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Personal display preferences (#67), separate from the interface language:
 * - `formatLocale`: how dates and numbers look. `null` follows the
 *   installation default from product settings.
 * - `labUnits`: how lab concentrations are shown. Display only; stored values
 *   and their reported units never change.
 * Kept in this browser only, like the language choice.
 */

const FORMAT_KEY = "openvalens.formatLocale";
const LAB_UNITS_KEY = "openvalens.labUnits";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not saved; the choice still applies until the tab closes.
  }
}

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
  const [formatLocale, setFormat] = useState<ProductLocale | null>(() => {
    const saved = read(FORMAT_KEY);
    return (PRODUCT_LOCALES as readonly string[]).includes(saved ?? "")
      ? (saved as ProductLocale)
      : null;
  });
  const [labUnits, setUnits] = useState<LabUnitChoice>(() => {
    const saved = read(LAB_UNITS_KEY);
    return (LAB_UNIT_CHOICES as readonly string[]).includes(saved ?? "")
      ? (saved as LabUnitChoice)
      : "as_reported";
  });
  const value = useMemo(
    () => ({
      formatLocale,
      labUnits,
      setFormatLocale: (next: ProductLocale | null) => {
        write(FORMAT_KEY, next);
        setFormat(next);
      },
      setLabUnits: (next: LabUnitChoice) => {
        write(LAB_UNITS_KEY, next);
        setUnits(next);
      },
    }),
    [formatLocale, labUnits],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDisplayPreferences() {
  return useContext(Context);
}
