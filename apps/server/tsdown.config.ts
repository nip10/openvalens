import { defineConfig } from "tsdown";

import { transformLinguiMacros } from "../../scripts/lingui/macro-transform.ts";

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
  plugins: [
    {
      // Server-sent text is translated (#231): compile Lingui macros in the
      // bundle. Messages are kept as a fallback beside their ids.
      name: "lingui-macro",
      transform: {
        filter: { code: /@lingui\/(core|react)\/macro/ },
        async handler(code, id) {
          const out = await transformLinguiMacros(code, id, "message");
          return out === null ? null : { code: out };
        },
      },
    },
  ],
});
