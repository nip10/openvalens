/**
 * Landing site guards (Issue #66): the built output makes no third-party
 * request, carries a strict CSP, keeps its copy within the wording rules and
 * states the honest limits of the current release.
 *
 * Pure file work in a temporary directory; no network, no browser.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ALLOWED_PHRASES, BANNED_TERMS } from "./wording-rules";

import {
  auditCss,
  auditMarkup,
  auditSite,
  buildSite,
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

/** Visible text of the built page: tags, comments and entities flattened. */
async function pageText(): Promise<string> {
  const html = await readFile(join(outDir, "index.html"), "utf8");
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

  test("states the name, the privacy tagline and the intended purpose", async () => {
    const text = await pageText();
    expect(text).toContain("A private place for your health records.");
    expect(text).toContain("Cloud · coming soon");
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
    expect(text).toContain("Cloud is not live yet.");
    expect(text).toContain("Mobile apps are not published in the stores yet.");
    expect(text).not.toContain("No hosted service.");
    expect(text).toContain("no analytics and no telemetry");
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
