import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src/index.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    // Workspace packages are inlined. Third-party runtime dependencies listed
    // in package.json stay external; `pdfkit` (Issue #132) must stay external
    // because it lazily loads its built-in fonts through package `imports`
    // (`#standard-fonts/*`), which do not resolve once inlined.
    alwaysBundle: [/@openvalens\/.*/],
  },
});
