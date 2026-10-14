import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { INTEGRATION_STATES } from "./integrations";

/**
 * Issue #57 — vendor SDK imports appear only inside integration adapter modules.
 *
 * Runs the repository's real `.oxlintrc.json` against a private fixture tree so
 * the `no-restricted-imports` boundary is proven in both directions: a vendor
 * SDK import is rejected in domain code and allowed under `src/providers/*`.
 * No vendor SDK is resolved or executed — oxlint only parses the files.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const OXLINT_BIN = join(REPO_ROOT, "node_modules/.bin/oxlint");

const FIXTURE_FILES: Record<string, string> = {
  // Domain code must not reach a vendor SDK directly.
  "packages/api/src/leaky-ai.ts": `import { createAnthropic } from "@ai-sdk/anthropic";\nexport const a = createAnthropic;\n`,
  "packages/sleep/src/leaky-storage.ts": `import { S3Client } from "@aws-sdk/client-s3";\nexport const s = S3Client;\n`,
  "packages/observability/src/leaky-errors.ts": `import * as Sentry from "@sentry/node";\nexport const e = Sentry;\n`,
  "apps/server/src/leaky-oidc.ts": `import * as client from "openid-client";\nexport const o = client;\n`,
  // Provider-neutral AI SDK types stay importable anywhere.
  "packages/api/src/neutral.ts": `import type { LanguageModelV2 } from "@ai-sdk/provider";\nexport type M = LanguageModelV2;\n`,
  // Adapter modules are the only allowed home for vendor SDKs.
  "packages/ai/src/providers/anthropic.ts": `import { createAnthropic } from "@ai-sdk/anthropic";\nexport const a = createAnthropic;\n`,
  "packages/storage/src/providers/s3.ts": `import { S3Client } from "@aws-sdk/client-s3";\nexport const s = S3Client;\n`,
  "packages/integrations/wearables/src/providers/oura.ts": `import * as client from "openid-client";\nexport const o = client;\n`,
};

async function lintFixture(): Promise<{ exitCode: number; output: string }> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "integration-boundary-"));
  try {
    const config = await readFile(join(REPO_ROOT, ".oxlintrc.json"), "utf8");
    await writeFile(join(fixtureDir, ".oxlintrc.json"), config);
    for (const [path, contents] of Object.entries(FIXTURE_FILES)) {
      await mkdir(dirname(join(fixtureDir, path)), { recursive: true });
      await writeFile(join(fixtureDir, path), contents);
    }

    // Run the oxlint CLI entry under the current Bun runtime so the test does
    // not depend on a `node` binary on the ambient PATH.
    const result = Bun.spawnSync([process.execPath, OXLINT_BIN, "--format", "unix", "."], {
      cwd: fixtureDir,
      env: { PATH: "/usr/bin:/bin" },
    });
    return {
      exitCode: result.exitCode,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

describe("integration adapter contract", () => {
  test("readiness states are exactly configured / dry-run / off", () => {
    expect([...INTEGRATION_STATES]).toEqual(["configured", "dry-run", "off"]);
  });

  test("vendor SDK imports are rejected outside src/providers/* and allowed inside", async () => {
    const { exitCode, output } = await lintFixture();
    const flagged = Object.keys(FIXTURE_FILES).filter((path) =>
      output.split("\n").some((line) => line.startsWith(path) && line.includes("restricted")),
    );

    expect(exitCode).not.toBe(0);
    expect(flagged.toSorted()).toEqual(
      [
        "apps/server/src/leaky-oidc.ts",
        "packages/api/src/leaky-ai.ts",
        "packages/observability/src/leaky-errors.ts",
        "packages/sleep/src/leaky-storage.ts",
      ].toSorted(),
    );
  });
});
