/**
 * Renders the Google Play feature graphic (1024×500 PNG, no alpha) for each
 * listing locale, in the fastlane `supply` layout:
 *
 *   cd apps/native && bun scripts/render-feature-graphic.ts
 *
 * writes store/play/<locale>/images/featureGraphic.png. The art is the app's
 * own brand: the Bloom mark (assets/source/mark.svg) on Bloom's peach paper
 * with the landing site's two soft glows, the app name in Fraunces and the
 * listing's short description (store/play/<locale>/short_description.txt) in
 * Figtree, the font files the app ships. Re-run after changing the mark, the
 * colours or the short description; listing.test.ts checks the size and that
 * the file has no alpha channel.
 *
 * Needs ImageMagick 7 (`magick`, `brew install imagemagick`) for the text:
 * it draws straight from the font files, so no font has to be installed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const WIDTH = 1024;
const HEIGHT = 500;
const LOCALES = ["en-US", "pt-PT"] as const;

// Bloom tokens (packages/ui/src/styles/tokens.css, apps/site/src/styles.css).
const PAPER = "#fbf1ea";
const SHEET = "#fffbf8";
const GLOW_1 = "#f7d9c9";
const GLOW_2 = "#ece3f8";
const INK = "#2e211c";
const INK_2 = "#57463e";
const ACCENT = "#c2512e";

function fontFile(pkg: "fraunces" | "figtree", face: string): string {
  const dir = dirname(require.resolve(`@expo-google-fonts/${pkg}/package.json`));
  return join(dir, face, `${pkg === "fraunces" ? "Fraunces" : "Figtree"}_${face}.ttf`);
}

const FRAUNCES = fontFile("fraunces", "600SemiBold");
const FIGTREE = fontFile("figtree", "500Medium");

const mark = readFileSync(join(ROOT, "assets/source/mark.svg"), "utf8");
const markBody = mark.slice(
  mark.indexOf(">", mark.indexOf("<svg")) + 1,
  mark.lastIndexOf("</svg>"),
);

// Layout: the bloom on the left, the words on the right, both centred on the
// middle line. Play may crop the edges, so nothing sits near them.
const MARK_SIZE = 320;
const MARK_CX = 240;
const TEXT_X = 438;
const TEXT_WIDTH = WIDTH - TEXT_X - 56;

const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="g1" gradientUnits="userSpaceOnUse" cx="${WIDTH * 0.92}" cy="-40" r="640">
      <stop offset="0" stop-color="${GLOW_1}"/>
      <stop offset="1" stop-color="${GLOW_1}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" gradientUnits="userSpaceOnUse" cx="-80" cy="${HEIGHT * 0.9}" r="560">
      <stop offset="0" stop-color="${GLOW_2}"/>
      <stop offset="1" stop-color="${GLOW_2}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" gradientUnits="userSpaceOnUse" cx="${MARK_CX}" cy="${HEIGHT / 2}" r="${MARK_SIZE * 0.68}">
      <stop offset="0" stop-color="${SHEET}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="${SHEET}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g1)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g2)"/>
  <circle cx="${MARK_CX}" cy="${HEIGHT / 2}" r="${MARK_SIZE * 0.68}" fill="url(#halo)"/>
  <g transform="translate(${MARK_CX - MARK_SIZE / 2} ${(HEIGHT - MARK_SIZE) / 2}) scale(${MARK_SIZE / 1024})">${markBody}</g>
</svg>`;

/** Splits `text` into `lines` lines of as even a length as possible (no orphan word). */
function balance(text: string, lines: number): string[] {
  const words = text.split(/\s+/);
  if (lines <= 1 || words.length <= 1) return [text];
  let best: string[] = [text];
  let bestWidth = Infinity;
  const search = (start: number, left: number, acc: string[]) => {
    if (left === 1) {
      const all = [...acc, words.slice(start).join(" ")];
      const widest = Math.max(...all.map((line) => line.length));
      if (widest < bestWidth) [best, bestWidth] = [all, widest];
      return;
    }
    for (let end = start + 1; end <= words.length - left + 1; end += 1)
      search(end, left - 1, [...acc, words.slice(start, end).join(" ")]);
  };
  search(0, lines, []);
  return best;
}

/** A transparent PNG of `text` drawn by ImageMagick from a font file. */
async function textLayer(options: {
  text: string;
  font: string;
  size: number;
  color: string;
  kerning?: number;
  lineSpacing?: number;
}): Promise<{ data: Buffer; width: number; height: number }> {
  const proc = Bun.spawn(
    [
      "magick",
      "-background",
      "none",
      "-fill",
      options.color,
      "-font",
      options.font,
      "-pointsize",
      String(options.size),
      "-density",
      "72",
      "-kerning",
      String(options.kerning ?? 0),
      "-interline-spacing",
      String(options.lineSpacing ?? 0),
      // Text from a file argument, so no character is read as an option.
      "label:@-",
      "-trim",
      "+repage",
      "png:-",
    ],
    { stdin: new Blob([options.text]), stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`magick failed (${code}): ${err}`);
  const data = Buffer.from(out);
  const meta = await sharp(data).metadata();
  return { data, width: meta.width ?? 0, height: meta.height ?? 0 };
}

async function render(locale: (typeof LOCALES)[number]) {
  const tagline = readFileSync(
    join(ROOT, "store", "play", locale, "short_description.txt"),
    "utf8",
  ).trim();
  const name = await textLayer({
    text: "OpenValens",
    font: FRAUNCES,
    size: 88,
    color: INK,
    kerning: -1,
  });
  let line = await textLayer({
    text: balance(tagline, 2).join("\n"),
    font: FIGTREE,
    size: 28,
    color: INK_2,
    lineSpacing: 10,
  });
  if (line.width > TEXT_WIDTH)
    line = await textLayer({
      text: balance(tagline, 3).join("\n"),
      font: FIGTREE,
      size: 28,
      color: INK_2,
      lineSpacing: 10,
    });
  if (name.width > TEXT_WIDTH || line.width > TEXT_WIDTH)
    throw new Error(`${locale}: the text is wider than ${TEXT_WIDTH}px`);

  const ruleWidth = 64;
  const ruleHeight = 5;
  const gapAfterName = 28;
  const gapAfterRule = 26;
  const blockHeight = name.height + gapAfterName + ruleHeight + gapAfterRule + line.height;
  const top = Math.round((HEIGHT - blockHeight) / 2);
  const ruleTop = top + name.height + gapAfterName;
  const rule = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ruleWidth}" height="${ruleHeight}"><rect width="${ruleWidth}" height="${ruleHeight}" rx="${ruleHeight / 2}" fill="${ACCENT}"/></svg>`,
  );
  const file = join(ROOT, "store", "play", locale, "images", "featureGraphic.png");
  await sharp(Buffer.from(background))
    .composite([
      { input: name.data, left: TEXT_X, top },
      { input: rule, left: TEXT_X + 3, top: ruleTop },
      { input: line.data, left: TEXT_X + 2, top: ruleTop + ruleHeight + gapAfterRule },
    ])
    .flatten({ background: PAPER })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`${file} ${WIDTH}x${HEIGHT}`);
}

for (const locale of LOCALES) await render(locale);
