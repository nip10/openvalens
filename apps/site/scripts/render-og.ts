#!/usr/bin/env bun
/**
 * Renders the Open Graph cards (1200 x 630 PNG) from their HTML sources in
 * `apps/site/og/`: the landing site's card to `apps/site/src/og.png` and the web
 * app's to `apps/web/public/og.png`.
 *
 * The cards use the app's Fraunces and Figtree from `@fontsource-variable` and
 * the real dashboard capture (synthetic demo account), so nothing is fetched
 * from the network. Playwright is not a dependency of this repository; install
 * it for the run and point it at a headless Chromium:
 *
 *   bun add --no-save playwright-core
 *   OG_CHROMIUM=/path/to/chrome-headless-shell bun run --cwd apps/site og
 *
 * Without `OG_CHROMIUM`, Playwright's own Chromium is used (`bunx playwright
 * install chromium`). When ImageMagick (`magick`) is on the PATH, each PNG is
 * stripped of metadata and recompressed (losslessly: a palette would band the
 * paper glows).
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const OG_SIZE = { width: 1200, height: 630 } as const;

const ROOT = join(import.meta.dir, "..", "..", "..");

export type Card = { source: string; out: string };

export const CARDS: readonly Card[] = [
  { source: "apps/site/og/site.html", out: "apps/site/src/og.png" },
  { source: "apps/site/og/app.html", out: "apps/web/public/og.png" },
];

type Page = {
  goto(url: string, options: object): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options: object): Promise<unknown>;
};

type Browser = {
  newPage(options: object): Promise<Page>;
  close(): Promise<void>;
};

if (import.meta.main) {
  // A variable specifier keeps Playwright optional for type checking and installs.
  const specifier = "playwright-core";
  const { chromium } = (await import(specifier)) as {
    chromium: { launch(options: object): Promise<Browser> };
  };
  const browser = await chromium.launch({ executablePath: process.env.OG_CHROMIUM || undefined });
  const magick = Bun.which("magick");
  if (!magick) console.warn("magick is not on the PATH: PNGs are kept as captured");
  try {
    for (const card of CARDS) {
      const page = await browser.newPage({ viewport: OG_SIZE, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(ROOT, card.source)).href, { waitUntil: "load" });
      await page.evaluate("document.fonts.ready");
      const out = join(ROOT, card.out);
      await page.screenshot({ path: out, type: "png" });
      if (magick) {
        const run = Bun.spawnSync([
          magick,
          out,
          "-strip",
          "-define",
          "png:compression-level=9",
          "-define",
          "png:compression-filter=5",
          `PNG24:${out}`,
        ]);
        if (run.exitCode !== 0) throw new Error(`magick failed for ${out}: ${run.stderr}`);
      }
      console.log(`Rendered ${card.source} -> ${card.out} (${Bun.file(out).size} bytes)`);
    }
  } finally {
    await browser.close();
  }
}
