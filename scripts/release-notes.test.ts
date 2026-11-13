/**
 * Release notes as data (Issue #446): what the release guard refuses, and how
 * the Highlights become the changelog and the in-app card.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  highlightsToHtml,
  inlineToHtml,
  inlineToText,
  parseReleaseNotes,
  readAllReleaseNotes,
  releaseNotesProblems,
  RELEASES_DIR,
} from "./release-notes";

const NOTES = `<!-- released: 2026-11-05 -->

A short summary.

## Highlights

- **Goals.** Set private goals,
  with milestones.
- Uses \`GET /api/health\` and [the guide](../self-hosting/upgrading.md).

OpenValens is a personal record-keeping and general-wellness app. It is not a
medical device.

## Self-hosting: upgrade notes

- Migrations: none.
`;

describe("releaseNotesProblems (the release guard)", () => {
  test("complete notes have no problems", () => {
    expect(releaseNotesProblems("v1.1.0", NOTES)).toEqual([]);
  });

  test("refuses notes without a Highlights section", () => {
    expect(releaseNotesProblems("v1.1.0", NOTES.replace("## Highlights", "## Changes"))).toEqual([
      "no `## Highlights` section",
    ]);
  });

  test("refuses an empty Highlights section", () => {
    const empty = "<!-- released: 2026-11-05 -->\n\n## Highlights\n\n## Self-hosting\n\n- x\n";
    expect(releaseNotesProblems("v1.1.0", empty)).toEqual(["the `## Highlights` section is empty"]);
  });

  test("refuses a missing or invalid release date", () => {
    expect(releaseNotesProblems("v1.1.0", NOTES.replace(/^<!--.*-->\n/, ""))[0]).toContain(
      "no release date",
    );
    expect(releaseNotesProblems("v1.1.0", NOTES.replace("2026-11-05", "2026-02-30"))[0]).toContain(
      "is not a YYYY-MM-DD date",
    );
  });

  test("a pt-PT translation needs no date and may translate the heading", () => {
    const translated = "## Destaques\n\n- **Metas.** Defina metas.\n";
    expect(releaseNotesProblems("v1.1.0", translated, "pt-PT")).toEqual([]);
    expect(parseReleaseNotes("v1.1.0", translated, "pt-PT").highlights).toEqual([
      { kind: "list", items: ["**Metas.** Defina metas."] },
    ]);
  });

  test("refuses a tag that is not vMAJOR.MINOR.PATCH", () => {
    expect(releaseNotesProblems("v1.1", NOTES)[0]).toContain("is not a release tag");
  });
});

describe("parseReleaseNotes", () => {
  const notes = parseReleaseNotes("v1.1.0", NOTES);

  test("reads the date and only the Highlights, without the intended-purpose sentence", () => {
    expect(notes).toEqual({
      tag: "v1.1.0",
      version: "1.1.0",
      date: "2026-11-05",
      highlights: [
        {
          kind: "list",
          items: [
            "**Goals.** Set private goals, with milestones.",
            "Uses `GET /api/health` and [the guide](../self-hosting/upgrading.md).",
          ],
        },
      ],
    });
  });

  test("renders HTML with escaping, code spans and absolute links into the tag", () => {
    expect(highlightsToHtml(notes)).toBe(
      [
        "<ul>",
        "  <li><strong>Goals.</strong> Set private goals, with milestones.</li>",
        '  <li>Uses <code>GET /api/health</code> and <a href="https://github.com/nip10/openvalens/blob/v1.1.0/docs/self-hosting/upgrading.md">the guide</a>.</li>',
        "</ul>",
      ].join("\n"),
    );
    expect(inlineToHtml('a <b> & "c" `**x**`', "v1.0.0")).toBe(
      "a &lt;b&gt; &amp; &quot;c&quot; <code>**x**</code>",
    );
    expect(inlineToHtml("**`GET /api/health`** for monitors", "v1.0.2")).toBe(
      "<strong><code>GET /api/health</code></strong> for monitors",
    );
  });

  test("reduces inline Markdown to plain text for the app", () => {
    expect(inlineToText("**Goals.** Use `x` and [docs](https://example.com), *now*.")).toBe(
      "Goals. Use x and docs, now.",
    );
  });
});

describe("docs/releases", () => {
  test("every notes file passes the release guard", () => {
    const files = readdirSync(RELEASES_DIR).filter((name) =>
      /^v\d+\.\d+\.\d+(\.pt-PT)?\.md$/.test(name),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const [, tag, locale] = /^(v\d+\.\d+\.\d+)(?:\.(pt-PT))?\.md$/.exec(name)!;
      const markdown = readFileSync(join(RELEASES_DIR, name), "utf8");
      expect({
        name,
        problems: releaseNotesProblems(tag!, markdown, locale ? "pt-PT" : "en"),
      }).toEqual({ name, problems: [] });
    }
  });

  test("the notes for the root package version exist (the server bundles them)", async () => {
    const { version } = (await Bun.file(join(import.meta.dir, "..", "package.json")).json()) as {
      version: string;
    };
    expect(readAllReleaseNotes().map((notes) => notes.version)).toContain(version);
  });
});
