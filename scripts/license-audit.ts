#!/usr/bin/env bun
/**
 * Dependency licence audit (Issue #56).
 *
 * Walks every package Bun installed under `node_modules/.bun` and checks its
 * declared licence against an allowlist that is compatible with shipping the
 * project under AGPL-3.0-or-later plus the app-store permission in
 * LICENSE-APP-STORE. Copyleft licences that would need that permission from
 * their authors (GPL, AGPL, SSPL), non-commercial licences, and missing
 * licences fail the audit unless the package has a documented exception below.
 *
 * Run with `bun run licenses:check`; CI runs it after `bun install`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Licences that may be bundled into the server, web and mobile builds. */
export const ALLOWED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
]);

/**
 * Packages allowed despite a licence outside the allowlist. Keys are package
 * names or a `prefix*` pattern; each entry records why it is acceptable.
 */
export const LICENSE_EXCEPTIONS: Record<string, { license: string; reason: string }> = {
  "@img/sharp-libvips-*": {
    license: "LGPL-3.0-or-later",
    reason:
      "Prebuilt libvips loaded dynamically by sharp on the server only; it is never bundled into the web or mobile apps, and LGPL is AGPL-compatible.",
  },
};

export type InstalledPackage = { name: string; version: string; license: string | null };
export type LicenseViolation = InstalledPackage & { problem: string };

/** Reads the licence from the `license` field or the legacy `licenses` array. */
export function declaredLicense(pkg: Record<string, unknown>): string | null {
  const { license, licenses } = pkg;
  if (typeof license === "string" && license.trim()) return license.trim();
  if (
    license &&
    typeof license === "object" &&
    typeof (license as { type?: unknown }).type === "string"
  )
    return (license as { type: string }).type;
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((entry) =>
        entry && typeof entry === "object" ? (entry as { type?: unknown }).type : null,
      )
      .filter((type): type is string => typeof type === "string" && type.length > 0);
    if (types.length) return types.length === 1 ? types[0]! : `(${types.join(" OR ")})`;
  }
  return null;
}

/**
 * Evaluates an SPDX expression: true when the package can be used under at
 * least one allowed choice. AND binds tighter than OR; `WITH` exceptions only
 * widen a licence, so the base identifier decides.
 */
export function isAllowedExpression(expression: string, allowed = ALLOWED_LICENSES): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let index = 0;
  const peek = () => tokens[index];
  function parseOr(): boolean {
    let value = parseAnd();
    while (peek()?.toUpperCase() === "OR") {
      index++;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  }
  function parseAnd(): boolean {
    let value = parseAtom();
    while (peek()?.toUpperCase() === "AND") {
      index++;
      const right = parseAtom();
      value = value && right;
    }
    return value;
  }
  function parseAtom(): boolean {
    const token = tokens[index++];
    if (token === undefined) throw new Error(`Incomplete licence expression: ${expression}`);
    if (token === "(") {
      const value = parseOr();
      if (tokens[index++] !== ")") throw new Error(`Unbalanced licence expression: ${expression}`);
      return value;
    }
    if (peek()?.toUpperCase() === "WITH") index += 2;
    return allowed.has(token.replace(/\+$/, ""));
  }
  const result = parseOr();
  if (index !== tokens.length) throw new Error(`Unparsed licence expression: ${expression}`);
  return result;
}

function exceptionFor(name: string) {
  for (const [pattern, exception] of Object.entries(LICENSE_EXCEPTIONS)) {
    if (pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern)
      return exception;
  }
  return null;
}

export function auditPackages(packages: InstalledPackage[]): LicenseViolation[] {
  const violations: LicenseViolation[] = [];
  for (const pkg of packages) {
    if (!pkg.license) {
      violations.push({ ...pkg, problem: "no declared licence" });
      continue;
    }
    let allowed: boolean;
    try {
      allowed = isAllowedExpression(pkg.license);
    } catch (error) {
      violations.push({ ...pkg, problem: (error as Error).message });
      continue;
    }
    if (allowed) continue;
    const exception = exceptionFor(pkg.name);
    if (exception?.license === pkg.license) continue;
    violations.push({
      ...pkg,
      problem: exception
        ? `licence changed from documented exception ${exception.license}`
        : "licence is not on the allowlist",
    });
  }
  return violations;
}

/** Lists the packages in Bun's isolated store, skipping its symlinked peers. */
export function collectInstalledPackages(repoRoot: string): InstalledPackage[] {
  const store = join(repoRoot, "node_modules/.bun");
  if (!existsSync(store))
    throw new Error(`No Bun package store at ${store}; run bun install first.`);
  const packages = new Map<string, InstalledPackage>();
  for (const entry of readdirSync(store)) {
    const modules = join(store, entry, "node_modules");
    if (!existsSync(modules)) continue;
    for (const top of readdirSync(modules)) {
      const names = top.startsWith("@")
        ? readdirSync(join(modules, top)).map((scoped) => `${top}/${scoped}`)
        : [top];
      for (const name of names) {
        // The store entry is `<name with / as +>@<version>[+peer-hash]`; other
        // folders beside it are links to dependencies owned by other entries.
        if (!entry.startsWith(`${name.replace("/", "+")}@`)) continue;
        const manifestPath = join(modules, name, "package.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        const version = typeof manifest.version === "string" ? manifest.version : "unknown";
        packages.set(`${name}@${version}`, { name, version, license: declaredLicense(manifest) });
      }
    }
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, "..");
  const packages = collectInstalledPackages(repoRoot);
  const violations = auditPackages(packages);
  if (violations.length) {
    for (const violation of violations)
      console.error(
        `${violation.name}@${violation.version}: ${violation.license ?? "-"} (${violation.problem})`,
      );
    console.error(
      `\n${violations.length} of ${packages.length} packages failed the licence audit. Replace the dependency or document an exception in scripts/license-audit.ts.`,
    );
    process.exit(1);
  }
  console.log(`Licence audit passed for ${packages.length} installed packages.`);
}
