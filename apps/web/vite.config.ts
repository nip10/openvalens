import { lingui } from "@lingui/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Issue #54 — source maps for Sentry, only when the build has an auth token
// (OpenValens Cloud). The maps are uploaded, then deleted from dist, so they
// are never served. Without a token nothing changes: no maps, no upload.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();

export default defineConfig({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    sourcemap: sentryAuthToken ? "hidden" : false,
  },
  plugins: [
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    // Lingui macros (#67), transformed natively; catalogs are committed TS modules.
    lingui({ macroTransform: true }),
    react(),
    sentryAuthToken &&
      sentryVitePlugin({
        authToken: sentryAuthToken,
        org: process.env.SENTRY_ORG || "openvalens",
        project: process.env.SENTRY_PROJECT || "javascript-react",
        release: process.env.VITE_SENTRY_RELEASE ? { name: process.env.VITE_SENTRY_RELEASE } : {},
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
        telemetry: false,
      }),
  ],
});
