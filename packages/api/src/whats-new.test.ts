import { describe, expect, test } from "bun:test";

import { SERVER_VERSION } from "./server-meta";
import {
  changelogEntries,
  pickWhatsNewCard,
  platformHeadlines,
  serverReleaseHistory,
  serverReleaseNotes,
  type ReleaseNotes,
} from "./whats-new";

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
      headlines: [],
      changelogUrl: "https://openvalens.com/changelog#v1.2.3",
    });
  });

  test("gives the platform's headlines in the member's language, three at most", () => {
    const notes: ReleaseNotes = {
      ...NOTES,
      headlines: {
        en: ["Android: sync works", "Goals", "iOS: widget", "Trackers", "Pain", "Drinks"],
        "pt-PT": ["Android: sincronização", "Metas"],
      },
    };
    expect(pickWhatsNewCard(notes, ON, "en", "web")?.headlines).toEqual([
      "Goals",
      "Trackers",
      "Pain",
    ]);
    expect(pickWhatsNewCard(notes, ON, "en", "android")?.headlines).toEqual([
      "Android: sync works",
      "Goals",
      "Trackers",
    ]);
    expect(pickWhatsNewCard(notes, ON, "pt-PT", "web")?.headlines).toEqual(["Metas"]);
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

describe("platformHeadlines", () => {
  test("keeps headlines for every platform plus the asking one's own", () => {
    const all = [
      "Android: background sync works",
      "iOS: a fix",
      "iPhone: widget",
      "Custom trackers",
    ];
    expect(platformHeadlines(all, "web")).toEqual(["Custom trackers"]);
    expect(platformHeadlines(all, "ios")).toEqual([
      "iOS: a fix",
      "iPhone: widget",
      "Custom trackers",
    ]);
    // An older app sends no platform: it gets the first three, as written.
    expect(platformHeadlines(all, undefined)).toEqual(all.slice(0, 3));
  });
});

describe("changelogEntries", () => {
  test("lists each release in the member's language when translated, English otherwise", () => {
    const older = {
      ...NOTES,
      version: "1.2.2",
      highlights: { ...NOTES.highlights, "pt-PT": null },
    };
    expect(changelogEntries([NOTES, older], "pt-PT")).toEqual([
      {
        version: "1.2.3",
        date: "2026-11-20",
        locale: "pt-PT",
        highlights: NOTES.highlights["pt-PT"]!,
      },
      { version: "1.2.2", date: "2026-11-20", locale: "en", highlights: NOTES.highlights.en },
    ]);
  });
});

describe("serverReleaseHistory", () => {
  test("bundles every release up to this server's version, newest first", () => {
    const history = serverReleaseHistory();
    expect(history[0]?.version).toBe(SERVER_VERSION);
    expect(history.length).toBeGreaterThan(1);
    const versions = history.map((notes) => notes.version.split(".").map(Number));
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [versions[i - 1]!, versions[i]!];
      expect(a[0]! * 1e6 + a[1]! * 1e3 + a[2]!).toBeGreaterThan(b[0]! * 1e6 + b[1]! * 1e3 + b[2]!);
    }
    // Each release carries one headline per list item.
    for (const notes of history) {
      const items = notes.highlights.en.flatMap((block) =>
        block.kind === "list" ? block.items : [],
      );
      expect(notes.headlines?.en.length).toBe(items.length);
    }
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
