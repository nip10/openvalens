/**
 * Landing site guards (Issue #66): the built output makes no third-party
 * request, carries a strict CSP, keeps its copy within the wording rules and
 * states the honest limits of the current release.
 *
 * Pure file work in a temporary directory; no network, no browser.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ALLOWED_PHRASES, BANNED_TERMS, COMPETITOR_NAMES } from "./wording-rules";

import { readAllReleaseNotes } from "../../../scripts/release-notes";
import { directDeviceSupportList } from "../../../packages/health-record/src/device-support-status";
import { FAMILY_LABELS, registeredBrands, REASON_NOTES, STATUS_LABELS } from "./devices";
import {
  auditCss,
  auditMarkup,
  auditSite,
  buildSite,
  CLOUD_SIGNUP_URL,
  formatReleaseDate,
  SITE_CSP,
  SITE_CSP_HEADER,
  type Finding,
} from "./build";

let outDir: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "openvalens-site-"));
  await buildSite(outDir);
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

/** Visible text of a built page: tags, comments and entities flattened. */
async function pageText(dir = outDir, page = "index.html"): Promise<string> {
  const html = await readFile(join(dir, page), "utf8");
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
}

describe("built site", () => {
  test("has no audit findings (no third-party resources, all local references resolve)", async () => {
    expect(await auditSite(outDir)).toEqual([]);
  });

  test("the page carries the CSP and _headers sends it with frame-ancestors", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${SITE_CSP}" />`);
    expect(html).not.toContain("__SITE_CSP__");
    const headers = await readFile(join(outDir, "_headers"), "utf8");
    expect(headers).toContain(`Content-Security-Policy: ${SITE_CSP_HEADER}`);
    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(headers).toContain("Strict-Transport-Security: max-age=31536000\n");
  });

  test("the page carries the canonical URL, Open Graph and Twitter card tags", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const meta = (key: "property" | "name", value: string) =>
      new RegExp(`<meta\\s+${key}="${value.replaceAll(".", "\\.")}"\\s+content="([^"]*)"`).exec(
        html.replace(/\s+/g, " "),
      )?.[1];
    expect(html).toContain('<link rel="canonical" href="https://openvalens.com/" />');
    expect(meta("name", "description")).toContain("private health record");
    expect(meta("property", "og:type")).toBe("website");
    expect(meta("property", "og:site_name")).toBe("OpenValens");
    expect(meta("property", "og:title")).toBe("OpenValens, your private health record");
    expect(meta("property", "og:description")).toContain("private health record");
    expect(meta("property", "og:url")).toBe("https://openvalens.com/");
    expect(meta("property", "og:image")).toBe("https://openvalens.com/og.png");
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
    expect(meta("property", "og:image:alt")).toBeTruthy();
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(meta("name", "twitter:title")).toBeTruthy();
    expect(meta("name", "twitter:description")).toBeTruthy();
    expect(meta("name", "twitter:image")).toBe("https://openvalens.com/og.png");
  });

  test("ships og.png as a 1200 x 630 PNG under 300 KB", async () => {
    const png = await readFile(join(outDir, "og.png"));
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.length).toBeLessThan(300 * 1024);
  });

  test("the nginx allowlist serves og.png instead of redirecting it to the app", async () => {
    const conf = await readFile(
      join(import.meta.dir, "..", "deploy", "default.conf.template"),
      "utf8",
    );
    expect(conf).toMatch(/location ~ \^\/\([^)]*og\\\.png/);
  });

  test("the CSP allows nothing but same-origin styles and images", () => {
    expect(SITE_CSP).toContain("default-src 'none'");
    expect(SITE_CSP).not.toMatch(/https?:|\*|'unsafe-|script-src|font-src|connect-src/);
    expect(SITE_CSP_HEADER).toContain("frame-ancestors 'none'");
  });
});

describe("auditMarkup / auditCss catch third-party resources", () => {
  const audit = (markup: string) => {
    const findings: Finding[] = [];
    auditMarkup("x.html", markup, findings);
    return findings.map((f) => f.problem);
  };

  test.each([
    ['<script src="https://cdn.example.com/a.js"></script>', "<script"],
    [
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      "<link href>",
    ],
    ['<link rel="preconnect" href="//fonts.gstatic.com">', "<link href>"],
    ['<img src="http://tracker.example/pixel.gif">', "<img src>"],
    ['<img srcset="a.png 1x, https://cdn.example/b.png 2x">', "<img srcset>"],
    ['<video poster="https://cdn.example/p.jpg"></video>', "<video poster>"],
    ['<iframe src="https://www.youtube.com/embed/x"></iframe>', "<iframe>"],
    ['<svg><image href="https://cdn.example/x.png"/></svg>', "<image href>"],
    ['<meta http-equiv="refresh" content="0; url=https://example.com">', "refresh"],
    ["<style>body{}</style>", "inline <style>"],
    ['<div style="color:red"></div>', "inline style"],
    ['<button onclick="x()"></button>', "onclick"],
  ])("%s", (markup, expected) => {
    expect(audit(markup).join("\n")).toContain(expected);
  });

  test("allows crawler metadata: Open Graph <meta content> and <link rel=canonical>", () => {
    expect(
      audit(
        '<meta property="og:image" content="https://openvalens.com/og.png"><link rel="canonical" href="https://openvalens.com/">',
      ),
    ).toEqual([]);
  });

  test("allows plain anchors to other sites and SVG namespaces", () => {
    expect(
      audit(
        '<a href="https://github.com/nip10/openvalens">x</a><svg xmlns="http://www.w3.org/2000/svg"></svg>',
      ),
    ).toEqual([]);
  });

  test("flags remote url() and @import in CSS", () => {
    const findings: Finding[] = [];
    auditCss(
      "x.css",
      '@import "https://fonts.googleapis.com/css";\n@font-face{src:url(https://fonts.gstatic.com/a.woff2)}\n.a{background:url("img/ok.png")}',
      findings,
    );
    expect(findings.map((f) => f.problem)).toEqual([
      "third-party resource in CSS: https://fonts.gstatic.com/a.woff2",
      "third-party resource in CSS: https://fonts.googleapis.com/css",
    ]);
  });
});

describe("site copy", () => {
  test("uses none of the banned terms outside the intended-purpose statement", async () => {
    const text = await pageText();
    const purposeStart = text.indexOf("OpenValens is a personal record-keeping");
    const purposeEnd = text.indexOf("about your health.", purposeStart);
    expect(purposeStart).toBeGreaterThan(-1);
    expect(purposeEnd).toBeGreaterThan(purposeStart);
    let scanned = text.slice(0, purposeStart) + text.slice(purposeEnd);
    for (const phrase of ALLOWED_PHRASES) scanned = scanned.replace(phrase, " ");
    const hits = BANNED_TERMS.filter((term) => term.test(scanned)).map(String);
    expect(hits).toEqual([]);
  });

  test("states the name, the hero and the intended purpose", async () => {
    const text = await pageText();
    expect(text).toContain("Your whole health record, on your terms.");
    expect(text).toContain(
      "Labs, sleep, workouts, food and your watch, in one private record. Open source, hosted in the EU or on your own server.",
    );
    expect(text).toContain("€7.99 / month");
    expect(text).toContain("€69 / year");
    expect(text).toContain("VAT included");
    expect(text).toContain("30-day free trial, no card required");
    expect(text).toContain("AI coach with a monthly usage cap");
    expect(text).toContain("The workspace owner pays; invited members are covered");
    expect(text).toContain("software is free");
    expect(text).toContain("you choose and pay for hosting");
    expect(text).not.toContain("One plan. No surprises.");
    expect(text).toContain("It never means your records are public");
    expect(text).toContain("OpenValens is not a medical device.");
  });

  test("states the honest limits of the release", async () => {
    const text = await pageText();
    expect(text).toContain("Off-site backups are opt-in.");
    expect(text).toContain("Encrypted daily backups stay on the host");
    expect(text).toContain("The iPhone app is in App Store review.");
    expect(text).not.toContain("Mobile apps are not published in the stores yet.");
    expect(text).not.toContain("No hosted service.");
    expect(text).toContain("No device model is tested on real hardware yet.");
    // Matches the privacy policy: Cloud analytics is opt-in, never health data.
    expect(text).not.toContain("no analytics and no telemetry");
    expect(text).toContain("usage analytics on Cloud is optional, off until you turn it on");
  });

  test("the install command matches the supported Compose install guide", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const install = await readFile(
      join(import.meta.dir, "..", "..", "..", "docs", "self-hosting", "install.md"),
      "utf8",
    );
    const command = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1];
    expect(command).toBeDefined();
    expect(command).toContain("deploy/setup.sh install");
    expect(install).toContain(command!);
    const readme = await readFile(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
    expect(readme).toContain(command!);
  });
});

describe("legal and support pages", () => {
  const PAGES = ["privacy", "subprocessors", "support", "terms"] as const;

  test("each page is built and served at its clean path, not redirected to the app", async () => {
    const conf = await readFile(
      join(import.meta.dir, "..", "deploy", "default.conf.template"),
      "utf8",
    );
    expect(conf).toContain(
      "location ~ ^/(changelog|devices|privacy|subprocessors|support|terms)/?$",
    );
    for (const page of PAGES) {
      const html = await readFile(join(outDir, `${page}.html`), "utf8");
      expect(html).toContain(`<link rel="canonical" href="https://openvalens.com/${page}" />`);
      // Absolute asset paths so /privacy/ resolves them too.
      expect(html).toContain('href="/styles.css"');
    }
  });

  test("the home page links to every page", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    for (const page of PAGES) expect(html).toContain(`href="/${page}"`);
  });

  test("support links to the Cloud status page", async () => {
    const html = await readFile(join(outDir, "support.html"), "utf8");
    expect(html).toContain('href="https://stats.uptimerobot.com/hYgbJCzAWr" id="status"');
  });

  test("support explains account deletion at a stable anchor (Google Play deletion URL)", async () => {
    const html = await readFile(join(outDir, "support.html"), "utf8");
    expect(html).toContain('id="delete-account"');
    expect(html).toContain("Delete account and all data");
    expect(html).toContain("hello@openvalens.com");
    // The three ways, and what is deleted and kept (same facts as /privacy).
    const section = html.slice(html.indexOf('id="delete-account"'), html.indexOf('id="privacy"'));
    for (const heading of [
      "In the app",
      "On the web",
      "By email",
      "What is deleted",
      "What is kept",
    ])
      expect(section).toContain(`<h3>${heading}</h3>`);
    expect(section).toContain("10 years");
    expect(section).toContain("14 days");
  });

  test("the privacy policy names the contact and leaves no draft placeholders", async () => {
    for (const page of ["privacy", "subprocessors", "terms"]) {
      const html = await readFile(join(outDir, `${page}.html`), "utf8");
      expect(html).not.toMatch(/\[(CONFIRM|[A-Z][A-Z ]{3,})[^\]]*\]/);
      expect(html).not.toMatch(/Lawyer:|Draft —/);
    }
    expect(await readFile(join(outDir, "privacy.html"), "utf8")).toContain("hello@openvalens.com");
  });
});

describe("Cloud sign-up (#309)", () => {
  test("Start free trial links to sign-up and no pre-launch copy is left", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const text = await pageText();
    expect(html).toContain(
      `<a class="button primary" href="${CLOUD_SIGNUP_URL}">Start free trial</a>`,
    );
    expect(text).toContain("Self-host it");
    expect(text).toContain("30-day free trial, no card required");
    for (const prelaunch of [
      "Cloud · coming soon",
      "Cloud is not live yet.",
      "not available yet",
      "planned",
      "future hosted service",
    ]) {
      expect(text).not.toContain(prelaunch);
    }
    expect(html).not.toContain("future hosted service");
    expect(html).not.toContain("__CLOUD_SIGNUP_URL__");
  });
});

describe("Cloud vs self-host and the store apps", () => {
  test("compares who runs the server, where records live and the price", async () => {
    const text = await pageText();
    expect(text).toContain("Cloud and self-host, side by side");
    expect(text).toContain("Who runs the server");
    expect(text).toContain("Where your records live");
    expect(text).toContain("In the EU, with our hosting provider in Germany");
    expect(text).toContain("The software is free; you pay for your own hosting");
  });

  test("a live store app links its official badge, served locally; the App Store waits", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const badges = /<ul class="store-badges"[\s\S]*?<\/ul>/.exec(html)?.[0];
    expect(badges).toBeDefined();
    expect(badges).toContain(
      'href="https://play.google.com/store/apps/details?id=com.openvalens.app"',
    );
    expect(badges).toContain('src="badges/google-play.png"');
    expect(badges).toContain('alt="Get it on Google Play"');
    expect(badges!.match(/coming soon/g)).toHaveLength(1);
    expect(badges).toContain("App Store");
    // Images come from this site only: the CSP blocks remote badges.
    expect(badges).not.toMatch(/<img[^>]+src="(https?:)?\/\//);
    expect(html).not.toMatch(/apps\.apple\.com/);
    await expect(readFile(join(outDir, "badges", "google-play.png"))).resolves.toBeDefined();
    // Google's badge guidelines ask for this attribution wherever the badge is shown.
    expect(await pageText()).toContain(
      "Google Play and the Google Play logo are trademarks of Google LLC.",
    );
  });
});

describe("nginx serves what the build outputs", () => {
  // Anything the static locations don't match is redirected to the web app, so
  // a new top-level file or folder (like badges/, #361) breaks silently.
  test("every top-level file and folder of the build is served, not redirected", async () => {
    const conf = await readFile(
      join(import.meta.dir, "..", "deploy", "default.conf.template"),
      "utf8",
    );
    const pattern = /location ~ (\^\/\(index\\\.html[^ ]*) \{/.exec(conf)?.[1];
    expect(pattern).toBeDefined();
    const staticFiles = new RegExp(pattern!);
    const entries = await readdir(outDir, { withFileTypes: true });
    const unserved = entries
      .filter((entry) => !entry.name.startsWith("_"))
      .map((entry) => `/${entry.name}${entry.isDirectory() ? "/" : ""}`)
      .filter((path) => !staticFiles.test(path));
    expect(unserved).toEqual([]);
  });
});

describe("changelog (#446)", () => {
  const releases = readAllReleaseNotes();
  const tags = releases.map((notes) => notes.tag);

  test("docs/releases has every tag from v0.9.0, newest first", () => {
    expect(tags.at(-1)).toBe("v0.9.0");
    expect(tags).toContain("v1.1.0");
    for (const notes of releases) expect(notes.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("/changelog lists each release's Highlights, date and self-hosting link, newest first", async () => {
    const html = await readFile(join(outDir, "changelog.html"), "utf8");
    expect(html).not.toContain("__CHANGELOG_ENTRIES__");
    expect(html).toContain('<link rel="canonical" href="https://openvalens.com/changelog" />');
    expect(html).toMatch(/<link\s+rel="alternate"\s+type="application\/atom\+xml"/);
    const order = [...html.matchAll(/<section class="release" id="(v[\d.]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(tags);
    for (const notes of releases) {
      const section = html.slice(html.indexOf(`id="${notes.tag}"`)).split("</section>")[0]!;
      expect(section).toContain(`<h2 id="${notes.tag}-title">Version ${notes.version}</h2>`);
      expect(section).toContain(
        `<time datetime="${notes.date}">${formatReleaseDate(notes.date)}</time>`,
      );
      expect(section).toContain(
        `<a href="https://github.com/nip10/openvalens/releases/tag/${notes.tag}">Self-hosting notes for ${notes.tag}</a>`,
      );
      expect(section).toContain("<li>");
      // Only the Highlights: the upgrade notes stay on the GitHub Release.
      expect(section).not.toContain("Migrations:");
    }
  });

  test("the changelog uses none of the banned terms", async () => {
    let scanned = await pageText(outDir, "changelog.html");
    for (const phrase of ALLOWED_PHRASES) scanned = scanned.replace(phrase, " ");
    const hits = BANNED_TERMS.filter((term) => term.test(scanned)).map(String);
    expect(hits).toEqual([]);
  });

  test("/changelog.xml is an Atom feed of the same releases, with no build time in it", async () => {
    const xml = await readFile(join(outDir, "changelog.xml"), "utf8");
    expect(xml).toStartWith(
      '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">',
    );
    expect(xml).toContain(
      '<link rel="self" type="application/atom+xml" href="https://openvalens.com/changelog.xml"/>',
    );
    expect(xml).toContain(`<updated>${releases[0]!.date}T00:00:00Z</updated>`);
    const ids = [...xml.matchAll(/<id>https:\/\/openvalens\.com\/changelog#(v[\d.]+)<\/id>/g)].map(
      (m) => m[1],
    );
    expect(ids).toEqual(tags);
    // Entry content is escaped HTML; no raw markup inside <content>.
    for (const content of xml.matchAll(/<content type="html">([\s\S]*?)<\/content>/g)) {
      expect(content[1]).not.toMatch(/<[a-z]/);
    }
    const again = await mkdtemp(join(tmpdir(), "openvalens-site-"));
    try {
      await buildSite(again);
      expect(await readFile(join(again, "changelog.xml"), "utf8")).toBe(xml);
    } finally {
      await rm(again, { recursive: true, force: true });
    }
  });

  test("nginx serves the feed as Atom", async () => {
    const conf = await readFile(
      join(import.meta.dir, "..", "deploy", "default.conf.template"),
      "utf8",
    );
    const feed = /location = \/changelog\.xml \{([\s\S]*?)\n    \}/.exec(conf)?.[1];
    expect(feed).toContain("default_type application/atom+xml;");
    expect(feed).toContain("include /etc/nginx/site-security-headers.conf;");
  });

  test("the home page links to the changelog", async () => {
    expect(await readFile(join(outDir, "index.html"), "utf8")).toContain('href="/changelog"');
  });

  test("the site image copies the release notes the build reads", async () => {
    const dockerfile = await readFile(join(import.meta.dir, "..", "Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY docs/releases ./docs/releases");
    expect(dockerfile).toContain("COPY scripts/release-notes.ts ./scripts/release-notes.ts");
  });
});

describe("positioning (#445)", () => {
  test("the page follows the settled order: hero, pillars, screens, devices, Cloud or self-host, pricing, FAQ", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const order = [
      'id="hero-title"',
      'id="why"',
      'id="screens-title"',
      'id="devices"',
      'id="ways-to-use"',
      'id="pricing"',
      'id="faq"',
      'id="purpose"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the four pillars and the four FAQ questions", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const pillars = [...html.matchAll(/<li class="pillar">[\s\S]*?<h3>([^<]+)<\/h3>/g)].map(
      (m) => m[1],
    );
    expect(pillars).toEqual([
      "Open source and yours",
      "Your devices, without their cloud",
      "The depth of your record",
      "Your own AI",
    ]);
    const faq = html.slice(html.indexOf('id="faq"'), html.indexOf('id="purpose"'));
    expect([...faq.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1])).toEqual([
      "Is it really open source?",
      "Can you read my data?",
      "Is it medical advice?",
      "What happens if you shut down?",
    ]);
  });

  test("labs copy keeps and compares results; AI copy names a local model, not connected apps", async () => {
    const text = await pageText();
    expect(text).toContain("Keep and compare your lab results");
    expect(text).toContain("what changed in them");
    expect(text).toContain("including a model on your own machine");
    // Connected AI apps (MCP, #439) are not claimed until they ship.
    expect(text).not.toMatch(/\bMCP\b|Model Context Protocol|connected AI app/i);
  });

  test("the devices headline names brands, not a count, and every brand is in the allowlist", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const headline = /<h2 id="devices-title">\s*([\s\S]*?)\s*<\/h2>/.exec(html)?.[1];
    expect(headline?.replace(/\s+/g, " ")).toBe(
      "Works with Garmin, Huawei, Amazfit and more, without their apps.",
    );
    expect(headline).not.toMatch(/\d/);
    const brands = registeredBrands();
    for (const brand of ["Garmin", "Huawei", "Amazfit"]) expect(brands).toContain(brand);
    // Every Pebble model is Experimental, so Pebble is not a headline brand (owner, 2026-11-14).
    expect(headline).not.toContain("Pebble");
    expect(html).toContain('href="/devices"');
  });

  test("Open Graph and Twitter descriptions match the new hero", async () => {
    const html = (await readFile(join(outDir, "index.html"), "utf8")).replace(/\s+/g, " ");
    const description =
      "Labs, sleep, workouts, food and your watch, in one private health record. Open source, hosted in the EU or on your own server.";
    expect(html).toContain(`<meta property="og:description" content="${description}" />`);
    expect(html).toContain(`<meta name="twitter:description" content="${description}" />`);
    expect(html).toContain("OpenValens: Your whole health record, on your terms.");
  });

  test("the OG card source carries the new headline", async () => {
    const card = await readFile(join(import.meta.dir, "..", "og", "site.html"), "utf8");
    expect(card).toContain("Your whole health record, on your terms.");
  });
});

describe("supported devices page (#445)", () => {
  test("lists every allowlisted model once, with its status, generated at build time", async () => {
    const html = await readFile(join(outDir, "devices.html"), "utf8");
    expect(html).not.toContain("__DEVICE_");
    const items = [
      ...html.matchAll(
        /<li><span class="device-name">([^<]+)<\/span><span class="status [^"]+">([^<]+)<\/span>/g,
      ),
    ];
    const list = directDeviceSupportList();
    expect(items).toHaveLength(list.length);
    const unescape = (name: string) => name.replaceAll("&amp;", "&");
    const shown = new Map(items.map((m) => [unescape(m[1]!), m[2]]));
    for (const model of list) {
      expect({ model: model.displayName, status: shown.get(model.displayName) }).toEqual({
        model: model.displayName,
        status: STATUS_LABELS[model.support.status],
      });
    }
  });

  test("each experimental model shows why, and the legend explains every status", async () => {
    const html = await readFile(join(outDir, "devices.html"), "utf8");
    const experimental = directDeviceSupportList().filter(
      (model) => model.support.status === "experimental",
    ).length;
    const notes = Object.values(REASON_NOTES)
      .map((note) => html.split(`<span class="device-note">${note}</span>`).length - 1)
      .reduce((a, b) => a + b, 0);
    expect(notes).toBe(experimental);
    for (const label of Object.values(STATUS_LABELS)) expect(html).toContain(label);
    for (const label of Object.values(FAMILY_LABELS)) {
      expect(html).toContain(label.replaceAll("&", "&amp;"));
    }
  });

  test("the headline names no count until models are tested on a device", async () => {
    const html = await readFile(join(outDir, "devices.html"), "utf8");
    const h1 = /<h1>([^<]*)<\/h1>/.exec(html)?.[1];
    expect(h1).toBe("Supported devices");
    expect(await pageText(outDir, "devices.html")).toContain(
      "No model has been tested on a real device yet",
    );
  });

  test("uses none of the banned terms", async () => {
    let scanned = await pageText(outDir, "devices.html");
    for (const phrase of ALLOWED_PHRASES) scanned = scanned.replace(phrase, " ");
    expect(BANNED_TERMS.filter((term) => term.test(scanned)).map(String)).toEqual([]);
  });

  test("is linked from the home page and served at /devices", async () => {
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const devices = html.slice(html.indexOf('id="devices"'), html.indexOf('id="ways-to-use"'));
    expect(devices).toContain('href="/devices"');
    const dockerfile = await readFile(join(import.meta.dir, "..", "Dockerfile"), "utf8");
    expect(dockerfile).toContain("packages/health-record/src/device-support-status.ts");
  });
});

describe("no competitor is named (#445)", () => {
  test("in any built page, the feed or the OG card sources", async () => {
    const files = (await readdir(outDir, { recursive: true }))
      .map(String)
      .filter((file) => /\.(html|xml|txt|css|svg)$/.test(file));
    const sources = await Promise.all([
      ...files.map(async (file) => [file, await readFile(join(outDir, file), "utf8")] as const),
      ...["site.html", "app.html"].map(
        async (file) =>
          [`og/${file}`, await readFile(join(import.meta.dir, "..", "og", file), "utf8")] as const,
      ),
    ]);
    const hits = sources.flatMap(([file, text]) =>
      COMPETITOR_NAMES.filter((name) => text.toLowerCase().includes(name)).map(
        (name) => `${file}: ${name}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  test("the guard itself matches the name", () => {
    expect(COMPETITOR_NAMES.length).toBeGreaterThan(0);
    for (const name of COMPETITOR_NAMES) expect(name).toMatch(/^[a-z0-9.-]+$/);
  });
});
