/**
 * Bun preload (#446): provides the server's bundled release notes
 * (`virtual:openvalens/release-notes`) to `bun run` and tests, the way the
 * tsdown plugin in `apps/server/tsdown.config.ts` does for the server build.
 */
import { plugin } from "bun";

import { RELEASE_NOTES_MODULE, releaseNotesModuleSource } from "../release-notes";

plugin({
  name: "openvalens-release-notes",
  setup(build) {
    build.module(RELEASE_NOTES_MODULE, () => ({
      contents: releaseNotesModuleSource(),
      loader: "js",
    }));
  },
});
