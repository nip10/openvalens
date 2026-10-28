#!/usr/bin/env bun
/**
 * Captures the landing-site and README screenshots from a running web app
 * (Issue #66).
 *
 * Screenshots must only ever show synthetic data. Run this against a
 * disposable local instance seeded with the synthetic demo account (Issue
 * #301) — never against an instance that holds anyone's real records:
 *
 *   # 1. Seed a disposable database (it is reset on every run).
 *   DEMO_DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/openvalens_demo \
 *     bun run demo:seed --today "$(date -u +%F)"
 *
 *   # 2. Run the server against it with the dev magic-link sink, and the web app.
 *   DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/openvalens_demo \
 *   NODE_ENV=development EMAIL_DRY_RUN=true AUTH_DEV_MAGIC_LINK_CONSOLE=true \
 *     bun run dev:server
 *   bun run dev:web
 *
 *   # 3. Ask for a sign-in link for alex.morgan@example.com on /login; the
 *   #    server prints it (Varlock masks the BETTER_AUTH_URL origin in console
 *   #    output: put it back). Capture with that link (it is single-use).
 *   bun add --no-save playwright && bunx playwright install chromium
 *   SITE_SCREENSHOT_BASE_URL=http://localhost:3001 \
 *   SITE_SCREENSHOT_MAGIC_LINK='http://localhost:3000/api/auth/magic-link/verify?token=…' \
 *     bun run --cwd apps/site screenshots
 *
 * Playwright is not a dependency of this repository, hence the `--no-save`
 * install. Instead of a magic link, `SITE_SCREENSHOT_STORAGE_STATE` may name a
 * Playwright storage-state file saved after signing the demo account in
 * (`page.context().storageState()`); keep it out of the repository. Only
 * loopback URLs are accepted. Seeding with today's date matters because the
 * app reads the real clock to decide what "today" and "this week" are.
 *
 * Writes `src/screenshots/<name>.webp` for every entry in {@link SHOTS}, at
 * twice the CSS pixel size. Each capture is taken as PNG and converted with
 * `cwebp` (libwebp) when it is on the PATH; without it the PNG is kept and the
 * run says so. The development-only TanStack devtools buttons are hidden.
 */
import { join } from "node:path";

export type Shot = {
  /** File name without extension, under `src/screenshots/`. */
  name: string;
  /** App route to open. */
  path: string;
  colorScheme?: "light" | "dark";
  viewport?: { width: number; height: number };
};

export const DESKTOP = { width: 1280, height: 800 } as const;
export const PHONE = { width: 390, height: 844 } as const;

export const SHOTS: readonly Shot[] = [
  { name: "dashboard", path: "/dashboard" },
  { name: "sleep", path: "/records/sleep" },
  { name: "meal-diary", path: "/nutrition" },
  { name: "labs", path: "/records/labs" },
  { name: "workouts", path: "/workouts" },
  { name: "settings", path: "/settings" },
  { name: "dashboard-dark", path: "/dashboard", colorScheme: "dark" },
  { name: "dashboard-phone", path: "/dashboard", viewport: PHONE },
];

/** Hides the development-only router and query devtools buttons and panels. */
export const HIDE_DEVTOOLS_CSS = [
  ".TanStackRouterDevtools",
  ".TanStackRouterDevtoolsPanel",
  ".tsqd-parent-container",
  ".tsqd-open-btn-container",
]
  .map((selector) => `${selector} { display: none !important; }`)
  .join("\n");

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

export type SessionSource =
  | { kind: "storage-state"; path: string }
  | { kind: "magic-link"; url: URL };

/**
 * How the demo account is signed in: a dev magic link printed by the local
 * server, or a saved storage-state file. A magic link must be on a loopback
 * host too, so it can only sign in to a local instance.
 */
export function sessionSource(env: Record<string, string | undefined>): SessionSource {
  const link = env.SITE_SCREENSHOT_MAGIC_LINK;
  if (link) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new Error("SITE_SCREENSHOT_MAGIC_LINK must be an absolute http(s) URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error("SITE_SCREENSHOT_MAGIC_LINK must point at a local, disposable instance");
    }
    return { kind: "magic-link", url };
  }
  const path = env.SITE_SCREENSHOT_STORAGE_STATE;
  if (path) return { kind: "storage-state", path };
  throw new Error("Set SITE_SCREENSHOT_MAGIC_LINK or SITE_SCREENSHOT_STORAGE_STATE");
}

type Page = {
  goto(url: string, options: object): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: object): Promise<unknown>;
  close(): Promise<void>;
};

type Context = {
  newPage(): Promise<Page>;
  storageState(): Promise<object>;
  close(): Promise<void>;
};

type Browser = {
  newContext(options: object): Promise<Context>;
  close(): Promise<void>;
};

/** Opens the magic link once and keeps the signed-in cookies for every shot. */
async function signInWithMagicLink(browser: Browser, url: URL): Promise<object> {
  const context = await browser.newContext({});
  try {
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "networkidle" });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

if (import.meta.main) {
  const baseUrl = loopbackBaseUrl(process.env.SITE_SCREENSHOT_BASE_URL);
  const source = sessionSource(process.env);
  const outDir = join(import.meta.dir, "..", "src", "screenshots");
  const cwebp = Bun.which("cwebp");
  if (!cwebp) console.warn("cwebp is not on the PATH: keeping PNG files");

  // A variable specifier keeps Playwright optional for type checking and installs.
  const specifier = "playwright";
  const { chromium } = (await import(specifier)) as {
    chromium: { launch(): Promise<Browser> };
  };
  const browser = await chromium.launch();
  try {
    const storageState =
      source.kind === "magic-link" ? await signInWithMagicLink(browser, source.url) : source.path;
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        storageState,
        viewport: shot.viewport ?? DESKTOP,
        deviceScaleFactor: 2,
        colorScheme: shot.colorScheme ?? "light",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.goto(new URL(shot.path, baseUrl).href, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: HIDE_DEVTOOLS_CSS });
      await page.evaluate("document.fonts.ready");
      await page.waitForTimeout(400);
      const png = join(outDir, `${shot.name}.png`);
      await page.screenshot({ path: png });
      await context.close();
      let file = png;
      if (cwebp) {
        file = join(outDir, `${shot.name}.webp`);
        const run = Bun.spawnSync([
          cwebp,
          "-quiet",
          "-q",
          "82",
          "-m",
          "6",
          "-sharp_yuv",
          png,
          "-o",
          file,
        ]);
        if (run.exitCode !== 0) throw new Error(`cwebp failed for ${png}: ${run.stderr}`);
        await Bun.file(png).delete();
      }
      console.log(`Captured ${shot.path} -> ${file}`);
    }
  } finally {
    await browser.close();
  }
}
