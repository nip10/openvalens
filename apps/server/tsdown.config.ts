import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    "image-sanitizer-smoke": "./src/image-sanitizer-smoke.ts",
  },
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/@openvalens\/.*/],
  },
});
