/**
 * Issue #302 — writes `index.html` for one dated screenshot folder:
 *
 *   <root>/<platform>/<variant>/<shot>.png   (variant: en-light, pt-PT-dark, flows)
 *
 * One row per screen, one column per platform and variant, so the same screen
 * can be compared across light/dark, en/pt-PT, iPhone/Android at a glance.
 * Plain HTML with relative links: open it from disk or zip the folder.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const VARIANT_ORDER = ["en-light", "en-dark", "pt-PT-light", "pt-PT-dark", "flows"];

function dirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory());
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The screen name without the variant prefix: `en-light-drawer-05-records-sleep` → `drawer-05-records-sleep`. */
function screenName(file: string, variant: string): string {
  const stem = basename(file, ".png");
  return stem.startsWith(`${variant}-`) ? stem.slice(variant.length + 1) : stem;
}

export function writeIndex(root: string): string {
  const platforms = dirs(root).sort();
  const columns: { platform: string; variant: string }[] = [];
  const cells = new Map<string, Map<string, string>>(); // screen -> column key -> relative path
  const flowShots: { platform: string; path: string; name: string }[] = [];

  for (const platform of platforms) {
    const variants = dirs(join(root, platform)).sort(
      (a, b) => VARIANT_ORDER.indexOf(a) - VARIANT_ORDER.indexOf(b),
    );
    for (const variant of variants) {
      const files = readdirSync(join(root, platform, variant))
        .filter((name) => name.endsWith(".png"))
        .sort();
      if (variant === "flows") {
        for (const file of files)
          flowShots.push({
            platform,
            path: `${platform}/flows/${file}`,
            name: basename(file, ".png"),
          });
        continue;
      }
      const key = `${platform}/${variant}`;
      columns.push({ platform, variant });
      for (const file of files) {
        const screen = screenName(file, variant);
        if (!cells.has(screen)) cells.set(screen, new Map());
        cells.get(screen)!.set(key, `${platform}/${variant}/${file}`);
      }
    }
  }

  const screens = [...cells.keys()].sort();
  const head = columns
    .map((c) => `<th>${escape(c.platform)}<br><span>${escape(c.variant)}</span></th>`)
    .join("");
  const rows = screens
    .map((screen) => {
      const tds = columns
        .map((c) => {
          const path = cells.get(screen)?.get(`${c.platform}/${c.variant}`);
          return path
            ? `<td><a href="${escape(path)}"><img loading="lazy" src="${escape(path)}" alt="${escape(`${screen}, ${c.platform} ${c.variant}`)}"></a></td>`
            : `<td class="missing">missing</td>`;
        })
        .join("");
      return `<tr><th class="screen">${escape(screen)}</th>${tds}</tr>`;
    })
    .join("\n");
  const flows = flowShots
    .map(
      (s) =>
        `<figure><a href="${escape(s.path)}"><img loading="lazy" src="${escape(s.path)}" alt="${escape(s.name)}"></a><figcaption>${escape(s.platform)} · ${escape(s.name)}</figcaption></figure>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenValens e2e screenshots, ${escape(basename(root))}</title>
<style>
  :root { color-scheme: light dark; --bg: #fbf1ea; --ink: #2a1f1a; --muted: #7a6a62; --rule: #e6d8cf; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1d1613; --ink: #f3e9e2; --muted: #b3a39a; --rule: #3a2f2a; } }
  body { margin: 0; padding: 16px; font: 14px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--ink); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: var(--muted); margin: 0 0 16px; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid var(--rule); padding: 6px; vertical-align: top; }
  thead th { position: sticky; top: 0; background: var(--bg); font-size: 12px; }
  thead th span { color: var(--muted); font-weight: normal; }
  th.screen { text-align: left; font-size: 12px; max-width: 160px; word-break: break-word; }
  td img { width: 180px; height: auto; display: block; }
  td.missing { color: var(--muted); font-size: 12px; text-align: center; min-width: 180px; }
  .flows { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; width: 180px; }
  figure img { width: 180px; }
  figcaption { font-size: 11px; color: var(--muted); word-break: break-word; }
</style>
</head>
<body>
<h1>OpenValens e2e screenshots, ${escape(basename(root))}</h1>
<p>Synthetic demo data only (#301). ${screens.length} screens × ${columns.length} columns (platform × language × theme), plus ${flowShots.length} screenshots taken during the flows. Produced by <code>bun run e2e:ios</code> / <code>bun run e2e:android</code> (#302).</p>
<div class="wrap"><table>
<thead><tr><th>Screen</th>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
<h2>During the flows (en, light)</h2>
<div class="flows">
${flows}
</div>
</body>
</html>
`;
  const out = join(root, "index.html");
  writeFileSync(out, html);
  return out;
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: screenshot-index.ts <dated screenshot folder>");
    process.exit(2);
  }
  console.log(writeIndex(root));
}
