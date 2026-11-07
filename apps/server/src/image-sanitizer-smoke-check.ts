export type EmittedModule = {
  name: string;
  source: string;
};

const bundledSharpPath = ["node_modules", "sharp"].join("/");
const sharpSpecifier = /(?:\bfrom\s*|\brequire\s*\(\s*)["']sharp["']/;
const sanitizeImageDeclaration = /\bfunction\s+sanitizeImage\s*\(/;

/** Returns the first failed external-Sharp packaging proof, if any. */
export function findSharpDistributionFailure(
  modules: readonly EmittedModule[],
): string | undefined {
  if (modules.some(({ source }) => source.includes(bundledSharpPath))) return "sharp_inlined";

  const implementationModules = modules.filter(({ source }) =>
    sanitizeImageDeclaration.test(source),
  );
  if (implementationModules.length === 0) return "sanitize_image_missing";
  if (implementationModules.some(({ source }) => !sharpSpecifier.test(source)))
    return "sharp_bare_specifier";
  return undefined;
}
