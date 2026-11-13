import { describe, expect, test } from "bun:test";

/**
 * The pain screens (#442) show a record, not a diagnosis: no copy written in
 * these files names a cause, a condition or a severity. The fixed notice
 * comes from `PAIN_COPY.notice` (tested in the API presenters) and is the only
 * place "severe" may appear.
 */
const BANNED =
  /\b(diagnos\w*|caus\w*|because|due to|injur\w*|symptom\w*|condition\w*|likely|pattern\w*|trigger\w*|overuse|strain\w*|sprain\w*|inflam\w*|arthrit\w*|tendin\w*|warning|alert|danger\w*|urgent|emergency|severe|serious|worse|should|recommend\w*|seek|risk\w*)\b/i;

function copyIn(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\bt`([^`]*)`/g)) found.push(match[1]!);
  for (const match of source.matchAll(/<Trans>([\s\S]*?)<\/Trans>/g)) found.push(match[1]!);
  return found.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
}

describe("pain screen copy", () => {
  test("has no causal, diagnostic or severity wording", async () => {
    const source = await Bun.file(new URL("./pain-panel.tsx", import.meta.url)).text();
    const copy = copyIn(source);
    expect(copy.length).toBeGreaterThan(10);
    for (const text of copy) expect(text).not.toMatch(BANNED);
    // The panel never branches its wording on the rating value.
    expect(source).not.toMatch(/rating\s*[<>]=?\s*\d/);
  });
});
