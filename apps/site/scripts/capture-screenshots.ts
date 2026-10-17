#!/usr/bin/env bun
/**
 * Captures the landing-site screenshots from a running web app (Issue #66).
 *
 * Screenshots must only ever show synthetic data. Run this against a
 * disposable local instance whose only account is a synthetic demo account
 * (made-up name and email, synthetic records) — never against an instance that
 * holds anyone's real records. A `seed:demo` fixture that creates that account
 * deterministically does not exist yet, so the account is prepared by hand.
 *
 * Playwright is not a dependency of this repository. Install it for the run:
 *
 *   bun add --no-save playwright && bunx playwright install chromium
 *   SITE_SCREENSHOT_BASE_URL=http://localhost:3001 \
 *   SITE_SCREENSHOT_STORAGE_STATE=/path/to/demo-session.json \
 *     bun run --cwd apps/site screenshots
 *
 * `SITE_SCREENSHOT_STORAGE_STATE` is a Playwright storage-state file saved
 * after signing the synthetic account in (`page.context().storageState()`).
 * Keep it out of the repository. Only loopback base URLs are accepted.
 *
 * Writes `src/screenshots/<name>.png` (1280×800). Point the `<img>` elements in
 * `src/index.html` at the PNGs and drop "Placeholder" from their captions.
 */
import { join } from "node:path";

export const SHOTS = [
  { name: "dashboard", path: "/dashboard" },
  { name: "labs", path: "/records/labs" },
  { name: "sleep", path: "/records/sleep" },
] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Accepts only an http(s) URL on a loopback host, so a real instance is never captured. */
export function loopbackBaseUrl(value: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("SITE_SCREENSHOT_BASE_URL must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("SITE_SCREENSHOT_BASE_URL must point at a local, disposable instance");
  }
  return url;
}

type Browser = {
  newContext(options: object): Promise<{
    newPage(): Promise<{
      goto(url: string, options: object): Promise<unknown>;
      screenshot(options: object): Promise<unknown>;
    }>;
  }>;
  close(): Promise<void>;
};

if (import.meta.main) {
  const baseUrl = loopbackBaseUrl(process.env.SITE_SCREENSHOT_BASE_URL);
  const storageState = process.env.SITE_SCREENSHOT_STORAGE_STATE;
  if (!storageState) throw new Error("SITE_SCREENSHOT_STORAGE_STATE is required");

  // A variable specifier keeps Playwright optional for type checking and installs.
  const specifier = "playwright";
  const { chromium } = (await import(specifier)) as {
    chromium: { launch(): Promise<Browser> };
  };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1280, height: 800 },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const shot of SHOTS) {
      await page.goto(new URL(shot.path, baseUrl).href, { waitUntil: "networkidle" });
      const file = join(import.meta.dir, "..", "src", "screenshots", `${shot.name}.png`);
      await page.screenshot({ path: file });
      console.log(`Captured ${shot.path} -> ${file}`);
    }
  } finally {
    await browser.close();
  }
}
