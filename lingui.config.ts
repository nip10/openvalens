import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";

/**
 * Lingui catalogs (#67), shared by apps/web and apps/native. `bun run
 * i18n:extract` updates the .po files from the macros in app code;
 * `bun run i18n:compile` writes the committed TypeScript catalogs that both
 * apps import. `bun run i18n:check` (CI) fails on drift, invalid ICU syntax
 * or a missing translation in a shipped locale.
 */
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "pt-PT"],
  fallbackLocales: false,
  catalogs: [
    {
      path: "<rootDir>/packages/i18n/src/locales/{locale}/messages",
      include: [
        "<rootDir>/apps/web/src",
        "<rootDir>/apps/native/app",
        "<rootDir>/apps/native/components",
        "<rootDir>/apps/native/contexts",
        "<rootDir>/apps/native/lib",
        "<rootDir>/apps/native/utils",
        // Server code renders email and push in the recipient's language (#231).
        "<rootDir>/packages/api/src",
        "<rootDir>/packages/auth/src",
        "<rootDir>/packages/email/src",
        "<rootDir>/packages/integrations/telegram/src",
        "<rootDir>/apps/server/src",
      ],
      exclude: ["**/node_modules/**", "**/*.test.*", "**/routeTree.gen.ts"],
    },
  ],
  // A fixed creation date keeps catalogs stable, so the CI drift check only
  // fails on real message changes.
  format: formatter({
    lineNumbers: false,
    customHeaderAttributes: { "POT-Creation-Date": "2026-10-23 00:00+0000" },
  }),
  compileNamespace: "ts",
  orderBy: "message",
});
