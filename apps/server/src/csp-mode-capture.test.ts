import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Locks in the ordering invariant behind `resolveCspMode` (Issue #127).
 *
 * Varlock's `auto-load` injects the `CSP_MODE` schema default (`report-only`)
 * into `process.env` for an unset value, so `EXPLICIT_CSP_MODE` only means
 * "operator-set" if it is captured *before* `env.server.ts` is imported. These
 * cases run in a fresh subprocess (the module can only be captured once per
 * graph) and prove the snapshot cannot be affected by a later Varlock default.
 *
 * The full cold-boot behaviour (with `env.server.ts` and the real schema) is
 * covered by `security-config.test.ts`.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const CAPTURE_URL = pathToFileURL(join(SRC_DIR, "csp-mode-capture.ts")).href;

function runChild(script: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

describe("EXPLICIT_CSP_MODE capture", () => {
  test("an operator-set CSP_MODE present before import is captured", () => {
    const run = runChild(
      `(async () => {
        process.env.CSP_MODE = "report-only";
        const mod = await import(${JSON.stringify(CAPTURE_URL)});
        console.log("CAPTURED", mod.EXPLICIT_CSP_MODE);
      })();`,
    );

    expect(run.status).toBe(0);
    expect(run.output).toContain("CAPTURED report-only");
  });

  test("stays undefined when unset, even if Varlock later injects the default", () => {
    const run = runChild(
      `(async () => {
        delete process.env.CSP_MODE;
        const mod = await import(${JSON.stringify(CAPTURE_URL)});
        const captured = mod.EXPLICIT_CSP_MODE;
        // This is what Varlock's auto-load does for an unset key.
        process.env.CSP_MODE = "report-only";
        console.log("SNAPSHOT", String(captured), String(process.env.CSP_MODE));
      })();`,
    );

    expect(run.status).toBe(0);
    expect(run.output).toContain("SNAPSHOT undefined report-only");
  });
});
