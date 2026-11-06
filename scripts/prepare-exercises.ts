import { createHash } from "node:crypto";
import {
  captureWgerSnapshot,
  fail,
  WGER_CAPTURE_MAX_BYTES,
} from "../packages/exercise-catalog/src/wger-capture";

export {
  adaptRawRecord,
  assertCaptureHttpResponse,
  collectPages,
  normalizeLicense,
  safeSource,
} from "../packages/exercise-catalog/src/wger-capture";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, parse, resolve, sep } from "node:path";

async function assertDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory())
    fail("Snapshot output parent must contain only real directories.");
}

async function ensureSafeOutputParent(parent: string): Promise<void> {
  const root = parse(parent).root;
  const relative = parent.slice(root.length);
  let current = root;
  for (const component of relative.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    try {
      await assertDirectory(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      }
      await assertDirectory(current);
    }
  }
  // Check the complete chain again just before opening the create-only output.
  current = root;
  for (const component of relative.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    await assertDirectory(current);
  }
}

/**
 * Create a snapshot without following symlinked ancestry. The local operator is trusted not to
 * replace validated directories concurrently; portable path-based Node APIs cannot make this
 * operation race-proof against a malicious process changing ancestors between checks and open.
 * Dot segments are rejected instead of assigning surprising output-root semantics to them.
 */
export async function writeCaptureSnapshot(
  outputPath: string,
  bytes: Uint8Array,
  writeFile: (
    handle: Awaited<ReturnType<typeof open>>,
    contents: Uint8Array,
  ) => Promise<unknown> = (handle, contents) => handle.writeFile(contents),
): Promise<string> {
  if (!outputPath || outputPath.split(/[\\/]/).some((part) => part === "." || part === ".."))
    fail("Snapshot output path must not contain dot segments.");
  const output = resolve(outputPath);
  const parent = dirname(output);
  await ensureSafeOutputParent(parent);
  const handle = await open(output, "wx", 0o600);
  let complete = false;
  try {
    await writeFile(handle, bytes);
    await handle.close();
    complete = true;
    return output;
  } finally {
    if (!complete) {
      await handle.close().catch(() => {});
      await unlink(output).catch(() => {});
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun run exercises:prepare --output <snapshot.json>\nCaptures bounded public wger data. No DB or media fetch; run exercises:media-stage separately for an explicitly selected asset.",
    );
    return;
  }
  const outputAt = args.indexOf("--output");
  if (
    outputAt < 0 ||
    !args[outputAt + 1] ||
    args.some((arg, i) => !["--output"].includes(arg) && i !== outputAt + 1)
  )
    fail("Invalid arguments; use --help.");
  const bundle = await captureWgerSnapshot();
  const bytes = Buffer.from(JSON.stringify(bundle));
  if (bytes.byteLength > WGER_CAPTURE_MAX_BYTES) fail("Serialized snapshot exceeds byte limit.");
  const output = await writeCaptureSnapshot(args[outputAt + 1]!, bytes);
  console.log(
    JSON.stringify({
      output,
      sourceCount: bundle.results.length,
      rawArtifactSha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      fetched: bundle.capture.fetched.length,
    }),
  );
}
if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Snapshot preparation failed.");
    process.exitCode = 1;
  });
