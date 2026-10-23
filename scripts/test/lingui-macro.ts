/**
 * Bun test preload (#67): applies the Lingui macro transform to app sources
 * the way Vite (web) and Metro (native) do at build time, so tests can
 * import components that use `@lingui/*\/macro`. Files without a Lingui macro
 * import are returned unchanged.
 */
import { plugin } from "bun";

const MACRO_IMPORT = /from\s+["']@lingui\/(core|react)\/macro["']/;

// Babel loads lazily: `setup` must register `onLoad` synchronously, or files
// imported before an async setup finishes skip the transform.
let babel: Promise<
  [typeof import("@babel/core"), typeof import("@lingui/babel-plugin-lingui-macro")]
>;

plugin({
  name: "lingui-macro",
  setup(build) {
    build.onLoad({ filter: /\/(apps|packages)\/.+\.(tsx|ts)$/ }, async ({ path }) => {
      const loader = path.endsWith(".tsx") ? "tsx" : "ts";
      const source = await Bun.file(path).text();
      if (path.includes("/node_modules/") || !MACRO_IMPORT.test(source))
        return { contents: source, loader };
      babel ??= Promise.all([import("@babel/core"), import("@lingui/babel-plugin-lingui-macro")]);
      const [{ transformAsync }, macro] = await babel;
      const result = await transformAsync(source, {
        filename: path,
        babelrc: false,
        configFile: false,
        retainLines: true,
        parserOpts: { plugins: loader === "tsx" ? ["typescript", "jsx"] : ["typescript"] },
        plugins: [[macro.default, { descriptorFields: "all" }]],
      });
      return { contents: result?.code ?? source, loader };
    });
  },
});
