import { describe, expect, test } from "bun:test";

import { aiAppHostOf, aiAppNameSkeleton, isReservedAiAppName } from "./client-name";

/** Issue #507 — no OAuth client may call itself OpenValens, however it spells it. */
describe("isReservedAiAppName", () => {
  test.each([
    "OpenValens",
    "openvalens",
    "OPENVALENS",
    "Open Valens",
    "open-valens",
    "Open_Valens.",
    "  OpenValens  ",
    "Open Valens 2",
    // Look-alikes: digits, capital I for small l, accents, full-width and bold forms.
    "0penValens",
    "OpenVa1ens",
    "OpenVaIens",
    "OpenVa|ens",
    "OpenValen$",
    "Öpen Valéns",
    "Ｏｐｅｎ Ｖａｌｅｎｓ",
    "𝐎𝐩𝐞𝐧𝐕𝐚𝐥𝐞𝐧𝐬",
    // Cyrillic О, е, а; Greek Ο, ν, α.
    "ОpеnVаlens",
    "Οpenναlens",
  ])("refuses %p", (name) => {
    expect(isReservedAiAppName(name)).toBe(true);
  });

  test.each([
    "Claude",
    "Claude Code (openvalens)",
    "OpenValens helper",
    "My OpenValens",
    "Open",
    "Valens",
    "",
    "   ",
    "!!!",
  ])("allows %p", (name) => {
    expect(isReservedAiAppName(name)).toBe(false);
  });

  test("the skeleton keeps only letters, in one shape per look-alike group", () => {
    expect(aiAppNameSkeleton("Claude Code")).toBe("clavdecode");
    expect(aiAppNameSkeleton("0penVaIens")).toBe("openvalens");
  });
});

describe("aiAppHostOf", () => {
  test("is the URL's host name, lowercased and without the port", () => {
    expect(aiAppHostOf("https://Claude.AI/oauth/client.json")).toBe("claude.ai");
    expect(aiAppHostOf("http://localhost:33418/callback")).toBe("localhost");
    expect(aiAppHostOf("http://127.0.0.1:8080/cb")).toBe("127.0.0.1");
    expect(aiAppHostOf("https://user@evil.example/cb")).toBe("evil.example");
  });

  test("an internationalised host is shown in its ASCII form", () => {
    expect(aiAppHostOf("https://\u043epenvalens.example/cb")).toBe("xn--penvalens-z2h.example");
  });

  test("a custom scheme gives its host, or the scheme when it has none", () => {
    expect(aiAppHostOf("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(
      "anysphere.cursor-retrieval",
    );
    expect(aiAppHostOf("com.example.app:/oauth")).toBe("com.example.app");
  });

  test("is null for anything that is not a URL", () => {
    expect(aiAppHostOf(null)).toBeNull();
    expect(aiAppHostOf("")).toBeNull();
    expect(aiAppHostOf("not a url")).toBeNull();
  });
});
