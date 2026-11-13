import { defineConfig } from "tsdown";

import { transformLinguiMacros } from "../../scripts/lingui/macro-transform.ts";
import { RELEASE_NOTES_MODULE, releaseNotesModuleSource } from "../../scripts/release-notes.ts";

const RESOLVED_RELEASE_NOTES = `\0${RELEASE_NOTES_MODULE}`;

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
      // The Highlights of this version (docs/releases/vX.Y.Z.md), compiled
      // into the bundle for the in-app "What's new" card (#446).
      name: "openvalens-release-notes",
      resolveId(id) {
        return id === RELEASE_NOTES_MODULE ? RESOLVED_RELEASE_NOTES : null;
      },
      load(id) {
        return id === RESOLVED_RELEASE_NOTES ? releaseNotesModuleSource() : null;
      },
    },
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
