/**
 * Intl polyfills for Hermes (#67). Hermes lacks Intl.Locale and a complete
 * Intl.PluralRules, which Lingui needs for plural selection. The polyfills
 * install only where missing; plural data covers the shipped languages and
 * Polish, whose few/many forms the plural test uses as a canary.
 * Import this before anything that formats or pluralizes.
 */
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/pt.js";
import "@formatjs/intl-pluralrules/locale-data/pt-PT.js";
import "@formatjs/intl-pluralrules/locale-data/pl.js";
