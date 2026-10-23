/**
 * Lingui macro transform shared by every non-bundler runtime (#67, #231): the
 * Bun preload (tests and `bun run` dev of the server) and the server's tsdown
 * build. Vite (web) and Metro (native) use Lingui's own plugins instead.
 * Files without a Lingui macro import are returned unchanged.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo's Lingui config, loaded explicitly so the transform works from any cwd. */
const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../lingui.config.ts");

export const LINGUI_MACRO_IMPORT = /from\s+["']@lingui\/(core|react)\/macro["']/;

type DescriptorFields = "all" | "message" | "id-only";

/** The one Babel function used here, typed locally (no @types/babel__core). */
type BabelCore = {
  transformAsync(code: string, options: object): Promise<{ code?: string | null } | null>;
};
// A variable specifier keeps type-checkers from resolving the untyped package.
const BABEL_CORE = "@babel/core";

let babel: Promise<
  [BabelCore, typeof import("@lingui/babel-plugin-lingui-macro"), unknown]
> | null = null;

export function hasLinguiMacro(source: string): boolean {
  return LINGUI_MACRO_IMPORT.test(source);
}

/** Returns the transformed source, or `null` when the file uses no macro. */
export async function transformLinguiMacros(
  source: string,
  path: string,
  descriptorFields: DescriptorFields = "all",
): Promise<string | null> {
  if (path.includes("/node_modules/") || !hasLinguiMacro(source)) return null;
  babel ??= Promise.all([
    import(BABEL_CORE) as Promise<BabelCore>,
    import("@lingui/babel-plugin-lingui-macro"),
    import("@lingui/conf").then(({ getConfig }) => getConfig({ configPath: CONFIG_PATH })),
  ]);
  const [{ transformAsync }, macro, linguiConfig] = await babel;
  const result = await transformAsync(source, {
    filename: path,
    babelrc: false,
    configFile: false,
    retainLines: true,
    parserOpts: { plugins: path.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"] },
    plugins: [[macro.default, { descriptorFields, linguiConfig }]],
  });
  return result?.code ?? null;
}
