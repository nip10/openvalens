import { setupI18n, type I18n } from "@lingui/core";

import { messagesFor } from "./catalogs";
import { SOURCE_LOCALE, type Locale } from "./locales";

export { messagesFor, reviewStatusOf, type ReviewStatus } from "./catalogs";
export * from "./locales";

/** A Lingui instance with every shipped locale loaded through {@link messagesFor}. */
export function createAppI18n(locale: Locale = SOURCE_LOCALE): I18n {
  const i18n = setupI18n();
  activateLocale(i18n, locale);
  return i18n;
}

export function activateLocale(i18n: I18n, locale: Locale): void {
  i18n.loadAndActivate({ locale, messages: messagesFor(locale) });
}
