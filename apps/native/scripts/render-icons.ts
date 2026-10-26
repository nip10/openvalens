/**
 * Renders the app icon, splash, Android adaptive icon layers and favicon from
 * the one SVG source, assets/source/mark.svg (the Bloom mark), on Bloom's
 * peach paper. Re-run after changing the mark:
 *
 *   cd apps/native && bun scripts/render-icons.ts
 *
 * Writes assets/source/icon.svg (the composed square icon, for review) and
 * the PNGs in assets/images that app.json points at.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const SOURCE = join(ROOT, "assets/source");
const OUT = join(ROOT, "assets/images");

// Bloom tokens (packages/ui/src/styles/tokens.css): paper, a soft steps glow.
const PAPER = "#fbf1ea";
const GLOW = "#fbe6db";
const INK = "#000000";

const mark = readFileSync(join(SOURCE, "mark.svg"), "utf8");
const inner = mark.slice(mark.indexOf(">", mark.indexOf("<svg")) + 1, mark.lastIndexOf("</svg>"));

/** The mark scaled about the centre of a 1024 canvas. */
function placed(scale: number, body = inner): string {
  const offset = (1024 * (1 - scale)) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>`;
}

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${body}</svg>`;
}

const paper = `
  <defs>
    <radialGradient id="glow" cx="0.85" cy="0.1" r="0.9">
      <stop offset="0" stop-color="${GLOW}"/>
      <stop offset="1" stop-color="${PAPER}"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#glow)"/>`;

// The square icon: paper, the bloom at about two thirds (iOS rounds the corners).
const icon = svg(paper + placed(0.86));
// Android adaptive foreground: the mark inside the 66% safe zone.
const foreground = svg(placed(0.7));
const background = svg(paper);
// Android themed (monochrome) icon: one colour, the centre cut out so the
// bloom keeps its shape.
const monoBody = `
  <defs><mask id="cut"><rect width="1024" height="1024" fill="#fff"/><circle cx="512" cy="512" r="118" fill="#000"/></mask></defs>
  <g fill="${INK}" mask="url(#cut)">
    <circle cx="512" cy="322" r="178"/>
    <circle cx="693" cy="453" r="178"/>
    <circle cx="624" cy="666" r="178"/>
    <circle cx="400" cy="666" r="178"/>
    <circle cx="331" cy="453" r="178"/>
  </g>`;
const monochrome = svg(placed(0.7, monoBody));

async function png(source: string, size: number, file: string, opaque = false) {
  let image = sharp(Buffer.from(source), { density: 72 * (size / 1024) * 4 }).resize(size, size);
  if (opaque) image = image.flatten({ background: PAPER });
  await image.png({ compressionLevel: 9 }).toFile(join(OUT, file));
  console.log(`${file} ${size}x${size}`);
}

writeFileSync(join(SOURCE, "icon.svg"), `${icon}\n`);
await png(icon, 1024, "icon.png", true);
await png(svg(placed(1)), 1024, "splash-icon.png");
await png(foreground, 512, "android-icon-foreground.png");
await png(background, 512, "android-icon-background.png", true);
await png(monochrome, 432, "android-icon-monochrome.png");
await png(icon, 48, "favicon.png", true);
