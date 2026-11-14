import { describe, expect, test } from "bun:test";

/**
 * The pain screens on mobile (#442) show a record, not a diagnosis: no copy
 * written in the pain panel or the body map names a cause, a condition or a
 * severity. The fixed notice comes from `PAIN_COPY.notice` (tested in the API
 * presenters) and is the only place "severe" may appear. Same rule as the web
 * panel's test.
 */
const BANNED =
  /\b(diagnos\w*|caus\w*|because|due to|injur\w*|symptom\w*|condition\w*|likely|pattern\w*|trigger\w*|overuse|strain\w*|sprain\w*|inflam\w*|arthrit\w*|tendin\w*|warning|alert|danger\w*|urgent|emergency|severe|serious|worse|should|recommend\w*|seek|risk\w*)\b/i;

function copyIn(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\bt`([^`]*)`/g)) found.push(match[1]!);
  for (const match of source.matchAll(/<Trans>([\s\S]*?)<\/Trans>/g)) found.push(match[1]!);
  for (const match of source.matchAll(/\bmessage:\s*"([^"]*)"/g)) found.push(match[1]!);
  return found.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("native pain screen copy", () => {
  test("the pain panel has no causal, diagnostic or severity wording", async () => {
    const source = await read("./pain-panel.tsx");
    const copy = copyIn(source);
    expect(copy.length).toBeGreaterThan(10);
    for (const text of copy) expect(text).not.toMatch(BANNED);
    // The panel never branches its wording on the rating value.
    expect(source).not.toMatch(/rating\s*[<>]=?\s*\d/);
  });

  test("the body map's pain layer adds none either and always shows the fixed notice", async () => {
    const source = await read("../../app/(drawer)/body-map.tsx");
    for (const text of copyIn(source)) expect(text).not.toMatch(BANNED);
    expect(source).not.toMatch(/rating\s*[<>]=?\s*\d/);
    // The notice sits at the top of the pain layer, before the opt-in check.
    const pain = source.slice(source.indexOf('layer === "pain" ? ('));
    expect(pain.indexOf("<PainNotice />")).toBeGreaterThan(-1);
    expect(pain.indexOf("<PainNotice />")).toBeLessThan(pain.indexOf("<PainOff"));
    expect((await read("./pain-panel.tsx")).includes("PAIN_COPY.notice")).toBe(true);
  });
});
