import { describe, expect, test } from "bun:test";

import { SERVER_VERSION } from "./server-meta";
import { pickWhatsNewCard, serverReleaseNotes, type ReleaseNotes } from "./whats-new";

const NOTES: ReleaseNotes = {
  version: "1.2.3",
  date: "2026-11-20",
  highlights: {
    en: [{ kind: "list", items: ["Goals. Set private goals."] }],
    "pt-PT": [{ kind: "list", items: ["Metas. Defina metas."] }],
  },
};
const ON = { enabled: true, dismissedVersion: null };

describe("pickWhatsNewCard (#446)", () => {
  test("shows the version's English Highlights with the X.Y title and a changelog link", () => {
    expect(pickWhatsNewCard(NOTES, ON, "en")).toEqual({
      version: "1.2.3",
      shortVersion: "1.2",
      date: "2026-11-20",
      locale: "en",
      highlights: NOTES.highlights.en,
      changelogUrl: "https://openvalens.com/changelog#v1.2.3",
    });
  });

  test("uses the pt-PT notes for pt-PT members, English when there are none", () => {
    expect(pickWhatsNewCard(NOTES, ON, "pt-PT")).toMatchObject({
      locale: "pt-PT",
      highlights: NOTES.highlights["pt-PT"],
    });
    const english = { ...NOTES, highlights: { ...NOTES.highlights, "pt-PT": null } };
    expect(pickWhatsNewCard(english, ON, "pt-PT")).toMatchObject({
      locale: "en",
      highlights: NOTES.highlights.en,
    });
  });

  test("hides the card once dismissed for this version, when turned off, or without notes", () => {
    expect(pickWhatsNewCard(NOTES, { enabled: true, dismissedVersion: "1.2.3" }, "en")).toBeNull();
    expect(pickWhatsNewCard(NOTES, { enabled: false, dismissedVersion: null }, "en")).toBeNull();
    expect(pickWhatsNewCard(null, ON, "en")).toBeNull();
    // A dismissal of an earlier version does not hide a new one.
    expect(
      pickWhatsNewCard(NOTES, { enabled: true, dismissedVersion: "1.2.2" }, "en"),
    ).not.toBeNull();
  });
});

describe("serverReleaseNotes", () => {
  test("bundles the notes of this server's own version", () => {
    const notes = serverReleaseNotes();
    expect(notes?.version).toBe(SERVER_VERSION);
    expect(notes?.highlights.en.length).toBeGreaterThan(0);
    // Plain text for the apps: no Markdown markers left.
    for (const block of notes!.highlights.en) {
      const text = block.kind === "list" ? block.items.join(" ") : block.text;
      expect(text).not.toMatch(/\*\*|`|\]\(/);
    }
  });
});
