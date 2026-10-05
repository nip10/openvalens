import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runIsolatedHarness(path: string): Promise<string> {
  let output = "";
  let exitCode = 0;
  try {
    const result = await execFileAsync(process.execPath, ["test", path], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    exitCode = typeof failure.code === "number" ? failure.code : 1;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  if (exitCode !== 0 || !/\d+ pass/.test(output) || !/0 fail/.test(output)) {
    throw new Error(`Isolated Bun test harness failed (exit ${exitCode}):\n${output}`);
  }

  return output;
}
