/**
 * Bun preload (#67, #231): applies the Lingui macro transform to workspace
 * sources the way Vite (web) and Metro (native) do at build time, so tests
 * and `bun run` of server code can import modules that use
 * `@lingui/*\/macro`.
 */
import { plugin } from "bun";

import { transformLinguiMacros } from "../lingui/macro-transform";

plugin({
  name: "lingui-macro",
  // `setup` registers `onLoad` synchronously: files imported before an async
  // setup finished would skip the transform.
  setup(build) {
    build.onLoad({ filter: /\/(apps|packages|scripts)\/.+\.(tsx|ts)$/ }, async ({ path }) => {
      const loader = path.endsWith(".tsx") ? "tsx" : "ts";
      const source = await Bun.file(path).text();
      return { contents: (await transformLinguiMacros(source, path)) ?? source, loader };
    });
  },
});
