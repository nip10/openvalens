import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { mock } from "bun:test";

// Resolve through the native workspace manifest rather than pinning an
// implementation-specific node_modules path. The mounted native tree must
// use the same React/renderer pair that the real native package declares.
const nativeRequire = createRequire(
  fileURLToPath(new URL("../../native/package.json", import.meta.url)),
);
const reactVersion = (nativeRequire("react/package.json") as { version: string }).version;
const rendererVersion = (nativeRequire("react-dom/package.json") as { version: string }).version;

if (reactVersion !== rendererVersion) {
  throw new Error(
    `Native mounted compatibility test has mismatched React runtimes: ${reactVersion} / ${rendererVersion}`,
  );
}

console.info(`[native-compat] React ${reactVersion}; React DOM ${rendererVersion}`);

// Keep the real provider and native component hook on one Lingui module
// instance as well as one React runtime.
const nativeLinguiReact = await import(nativeRequire.resolve("@lingui/react"));
mock.module("@lingui/react", () => nativeLinguiReact);

// Bun's test module graph can resolve a dependency before runtime plugins are
// registered. Install aliases through the test loader instead, using the real
// modules resolved from apps/native (not hook mocks or web's React pair).
for (const specifier of [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "react-dom/test-utils",
  "react-dom/server",
  "react-dom/server.browser",
]) {
  const nativeModule = nativeRequire(specifier);
  mock.module(specifier, () => nativeModule);
}
