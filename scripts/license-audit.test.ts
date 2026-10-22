import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  auditPackages,
  collectInstalledPackages,
  declaredLicense,
  isAllowedExpression,
} from "./license-audit";

describe("licence audit", () => {
  test("evaluates SPDX expressions with OR, AND, parentheses and WITH", () => {
    expect(isAllowedExpression("MIT")).toBe(true);
    expect(isAllowedExpression("(BSD-3-Clause OR GPL-2.0)")).toBe(true);
    expect(isAllowedExpression("MIT AND Apache-2.0")).toBe(true);
    expect(isAllowedExpression("MIT AND GPL-3.0-only")).toBe(false);
    expect(isAllowedExpression("GPL-3.0-only OR (MIT AND ISC)")).toBe(true);
    expect(isAllowedExpression("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isAllowedExpression("AGPL-3.0-or-later")).toBe(false);
    expect(isAllowedExpression("CC-BY-NC-4.0")).toBe(false);
    expect(() => isAllowedExpression("(MIT OR ISC")).toThrow("Unbalanced");
  });

  test("reads modern and legacy licence fields", () => {
    expect(declaredLicense({ license: "MIT" })).toBe("MIT");
    expect(declaredLicense({ license: { type: "ISC" } })).toBe("ISC");
    expect(declaredLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe(
      "(MIT OR Apache-2.0)",
    );
    expect(declaredLicense({})).toBeNull();
  });

  test("flags missing, copyleft and drifted-exception licences only", () => {
    const violations = auditPackages([
      { name: "ok", version: "1.0.0", license: "MIT" },
      { name: "missing", version: "1.0.0", license: null },
      { name: "copyleft", version: "1.0.0", license: "GPL-3.0-only" },
      { name: "@img/sharp-libvips-linux-x64", version: "1.2.4", license: "LGPL-3.0-or-later" },
      { name: "@img/sharp-libvips-darwin-arm64", version: "2.0.0", license: "GPL-3.0-only" },
    ]);
    expect(violations.map((violation) => [violation.name, violation.problem])).toEqual([
      ["missing", "no declared licence"],
      ["copyleft", "licence is not on the allowlist"],
      [
        "@img/sharp-libvips-darwin-arm64",
        "licence changed from documented exception LGPL-3.0-or-later",
      ],
    ]);
  });

  test("collects store entries and ignores linked dependencies", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "license-audit-"));
    try {
      const write = (entry: string, name: string, manifest: object) => {
        const directory = join(root, "node_modules/.bun", entry, "node_modules", name);
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
      };
      write("left-pad@1.3.0", "left-pad", { name: "left-pad", version: "1.3.0", license: "WTFPL" });
      write("left-pad@1.3.0", "linked-peer", {
        name: "linked-peer",
        version: "9.9.9",
        license: "GPL-3.0",
      });
      write("@scope+pkg@2.0.0+abc123", "@scope/pkg", {
        name: "@scope/pkg",
        version: "2.0.0",
        license: "MIT",
      });
      expect(collectInstalledPackages(root)).toEqual([
        { name: "@scope/pkg", version: "2.0.0", license: "MIT" },
        { name: "left-pad", version: "1.3.0", license: "WTFPL" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
