#!/usr/bin/env bun
/**
 * Issue #302 — runs the Maestro suite on the iOS simulator or the Android
 * emulator from a clean seed, then the screenshot tour (light and dark, en and
 * pt-PT), and writes a dated, indexed screenshot folder.
 *
 *   bun run e2e:ios                        # whole suite + screenshots
 *   bun run e2e:android -- --build         # rebuild the app first
 *   bun run e2e:ios -- --flows 05,06       # some flows (state from 01-04 needed)
 *   bun run e2e:ios -- --no-screenshots    # suite only
 *   bun run e2e:ios -- --screenshots-only  # tour only (signs in first)
 *   bun apps/native/e2e/run.ts stack       # just the seeded server, for writing flows
 *
 * See docs/mobile/e2e.md.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { E2E, FLOWS_DIR, NATIVE_DIR, helperUrl, serverUrl } from "./config";
import {
  androidAppearance,
  androidBuildAndInstall,
  androidDevice,
  iosAppearance,
  iosBuildAndInstall,
  iosDevice,
  type Platform,
} from "./devices";
import { writeIndex } from "./screenshot-index";
import { startStack } from "./stack";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    build: { type: "boolean", default: false },
    flows: { type: "string" },
    "no-screenshots": { type: "boolean", default: false },
    "screenshots-only": { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
});

const mode = positionals[0];
const log = (message: string) => console.log(`[e2e] ${message}`);

function maestroBin(): string {
  const local = join(homedir(), ".maestro", "bin", "maestro");
  if (existsSync(local)) return local;
  return "maestro";
}

function localDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function maestro(
  device: string,
  platform: Platform,
  args: string[],
  env: Record<string, string>,
) {
  const envArgs = Object.entries({
    SERVER_URL: serverUrl(),
    HELPER_URL: helperUrl(),
    PLATFORM: platform,
    ...env,
  }).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const proc = Bun.spawn([maestroBin(), "--device", device, "test", ...envArgs, ...args], {
    cwd: NATIVE_DIR,
    env: {
      ...process.env,
      MAESTRO_CLI_NO_ANALYTICS: "1",
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

function selectedFlows(): string[] {
  const all = readdirSync(join(FLOWS_DIR, "flows"))
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  if (!values.flows) return all.map((name) => join(FLOWS_DIR, "flows", name));
  const wanted = values.flows.split(",").map((part) => part.trim());
  return all
    .filter((name) => wanted.some((prefix) => name.startsWith(prefix)))
    .map((name) => join(FLOWS_DIR, "flows", name));
}

/** Copies every `takeScreenshot` file of a Maestro output tree into `dest`. */
function collectScreenshots(maestroOut: string, dest: string): number {
  if (!existsSync(maestroOut)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".png") && basename(dir) === "takeScreenshot") {
        cpSync(path, join(dest, name));
        count += 1;
      }
    }
  };
  walk(maestroOut);
  return count;
}

type FlowResult = { name: string; passed: boolean; message: string };

function junitResults(file: string): FlowResult[] {
  if (!existsSync(file)) return [];
  const xml = readFileSync(file, "utf8");
  const results: FlowResult[] = [];
  for (const match of xml.matchAll(
    /<testcase[^>]*name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const body = match[3] ?? "";
    const failure =
      /<(?:failure|error)[^>]*message="([^"]*)"/.exec(body) ??
      /<(?:failure|error)[^>]*>([^<]*)/.exec(body);
    results.push({
      name: match[1] ?? "?",
      passed: !/<(failure|error)/.test(body),
      message: (failure?.[1] ?? "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim(),
    });
  }
  return results;
}

async function main() {
  if (mode === "stack") {
    const stack = await startStack({ metro: false, logDir: join(E2E.outDir, "logs") });
    log(`server ${serverUrl()}, helper ${helperUrl()}; Ctrl-C to stop`);
    const stop = async () => {
      await stack.stop();
      process.exit(0);
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
    await new Promise(() => {});
  }
  if (mode !== "ios" && mode !== "android") {
    console.error(
      "usage: run.ts <ios|android|stack> [--build] [--flows 01,02] [--no-screenshots] [--screenshots-only] [--keep]",
    );
    process.exit(2);
  }
  const platform: Platform = mode;
  const date = localDate();
  const runDir = join(E2E.outDir, "runs", date, platform);
  const shotsRoot = join(E2E.outDir, "screenshots", date);
  mkdirSync(runDir, { recursive: true });

  const device = platform === "ios" ? await iosDevice() : await androidDevice();
  log(`device ${device}`);
  if (platform === "ios") await iosBuildAndInstall(device, values.build);
  else await androidBuildAndInstall(device, values.build);
  const setAppearance = (theme: "light" | "dark") =>
    platform === "ios" ? iosAppearance(device, theme) : androidAppearance(device, theme);
  await setAppearance("light");

  const stack = await startStack({ metro: false, logDir: join(runDir, "logs") });
  let failed = false;
  try {
    // ─── The suite ───────────────────────────────────────────────
    let results: FlowResult[] = [];
    if (!values["screenshots-only"]) {
      const flows = selectedFlows();
      const report = join(runDir, "report.xml");
      log(`running ${flows.map((f) => basename(f)).join(", ")}`);
      await maestro(
        device,
        platform,
        [
          "--format",
          "junit",
          "--output",
          report,
          "--test-output-dir",
          join(runDir, "maestro"),
          // Explicit files run in this order, one after the other, sharing
          // the app session.
          ...flows,
        ],
        {},
      );
      results = junitResults(report);
      const shots = collectScreenshots(join(runDir, "maestro"), join(shotsRoot, platform, "flows"));
      log(`${shots} flow screenshots`);
    }

    // ─── The screenshot tour ─────────────────────────────────────
    if (!values["no-screenshots"]) {
      for (const locale of ["en", "pt-PT"] as const) {
        for (const theme of ["light", "dark"] as const) {
          const variant = `${locale}-${theme}`;
          log(`screenshot tour: ${variant}`);
          await setAppearance(theme);
          const out = join(runDir, "tour", variant);
          const code = await maestro(
            device,
            platform,
            [
              "--format",
              "junit",
              "--output",
              join(out, "report.xml"),
              "--test-output-dir",
              out,
              join(FLOWS_DIR, "screenshots", "tour.yaml"),
            ],
            { LOCALE: locale, THEME: theme, PREFIX: variant, VARIANT: variant },
          );
          const tour = junitResults(join(out, "report.xml"));
          results.push(...tour.map((r) => ({ ...r, name: `Screenshot tour ${variant}` })));
          if (code !== 0 && tour.length === 0)
            results.push({
              name: `Screenshot tour ${variant}`,
              passed: false,
              message: `exit ${code}`,
            });
          const shots = collectScreenshots(out, join(shotsRoot, platform, variant));
          log(`${shots} screenshots for ${variant}`);
        }
      }
      await setAppearance("light");
      const index = writeIndex(shotsRoot);
      log(`screenshot index: ${index}`);
    }

    // ─── Summary ─────────────────────────────────────────────────
    console.log(`\n[e2e] ${platform} results`);
    for (const result of results) {
      console.log(
        `  ${result.passed ? "PASS" : "FAIL"}  ${result.name}${result.passed ? "" : `  (${result.message})`}`,
      );
    }
    failed = results.length === 0 || results.some((result) => !result.passed);
    console.log(`\n[e2e] artifacts: ${runDir}`);
    console.log(`[e2e] screenshots: ${shotsRoot}`);
  } finally {
    if (values.keep) {
      log("--keep: the stack stays up; Ctrl-C to stop");
      await new Promise(() => {});
    }
    await stack.stop();
  }
  process.exit(failed ? 1 : 0);
}

await main();
