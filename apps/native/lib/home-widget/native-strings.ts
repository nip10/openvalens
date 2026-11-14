import { createAppI18n, LOCALES, type Locale } from "@openvalens/i18n";

import { NATIVE_WIDGET_STRINGS } from "./copy";

/**
 * The widget's native string files (#449), generated from the Lingui
 * catalogs so the labels the iOS widget and the Android widget picker show are
 * translated in one place. `bun run widget:strings` (also run by
 * `bun run i18n:compile`) writes them; `native-strings.test.ts` fails when a
 * committed file is out of date.
 */

export type NativeWidgetStringKey = keyof typeof NATIVE_WIDGET_STRINGS;

/** Where each generated file lives, relative to `apps/native`. */
export const IOS_WIDGET_TARGET_DIR = "targets/quick-log-widget";
export const WIDGET_STRINGS_JSON = "plugins/home-widget/strings.json";

export function iosStringsPath(locale: Locale): string {
  return `${IOS_WIDGET_TARGET_DIR}/${locale}.lproj/Localizable.strings`;
}

export function nativeWidgetStrings(locale: Locale): Record<NativeWidgetStringKey, string> {
  const i18n = createAppI18n(locale);
  return Object.fromEntries(
    Object.entries(NATIVE_WIDGET_STRINGS).map(([key, message]) => [key, i18n._(message)]),
  ) as Record<NativeWidgetStringKey, string>;
}

const HEADER = "Generated from the Lingui catalogs by `bun run widget:strings`. Do not edit.";

const escapeStrings = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

/** `Localizable.strings` for the iOS widget extension. */
export function iosStringsFile(locale: Locale): string {
  const lines = Object.entries(nativeWidgetStrings(locale)).map(
    ([key, value]) => `"${key}" = "${escapeStrings(value)}";`,
  );
  return `/* ${HEADER} */\n${lines.join("\n")}\n`;
}

/** Every locale's strings, which the Android config plugin turns into resources at prebuild. */
export function widgetStringsJson(): string {
  const all = Object.fromEntries(LOCALES.map((locale) => [locale, nativeWidgetStrings(locale)]));
  return `${JSON.stringify({ $comment: HEADER, ...all }, null, 2)}\n`;
}

/** Every generated file, by its path relative to `apps/native`. */
export function generatedWidgetFiles(): Record<string, string> {
  return {
    ...Object.fromEntries(
      LOCALES.map((locale) => [iosStringsPath(locale), iosStringsFile(locale)]),
    ),
    [WIDGET_STRINGS_JSON]: widgetStringsJson(),
  };
}
