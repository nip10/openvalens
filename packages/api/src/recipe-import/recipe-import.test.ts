import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { InMemoryRateLimiter } from "@openvalens/ai/rate-limit";

import { extractRecipePage } from "./html-recipe";
import { isAllowedByRobots } from "./robots";
import { isPublicAddress, parseImportUrl, safeFetch, type SafeFetchOptions } from "./safe-fetch";
import { createRecipeImportService, type PageFetcher } from "./service";

describe("isPublicAddress", () => {
  test("blocks loopback, private, link-local and special ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "192.0.2.10",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:169.254.169.254",
      "64:ff9b::7f00:1",
      "2001:db8::1",
      "2002:7f00:1::1",
      "2001::1",
      "not-an-ip",
    ])
      expect(isPublicAddress(address)).toBe(false);
  });

  test("allows global unicast", () => {
    for (const address of ["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::6810:84e5"])
      expect(isPublicAddress(address)).toBe(true);
  });
});

describe("parseImportUrl", () => {
  test("accepts http(s) on default ports and drops the fragment", () => {
    expect(parseImportUrl("https://recipes.example.test/soup#steps")?.href).toBe(
      "https://recipes.example.test/soup",
    );
  });

  test("rejects other schemes, credentials and ports", () => {
    for (const url of [
      "ftp://example.test/r",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pw@example.test/r",
      "https://example.test:8443/r",
      "not a url",
    ])
      expect(parseImportUrl(url)).toBeNull();
  });
});

describe("isAllowedByRobots", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /private/",
    "Allow: /private/recipes/",
    "",
    "User-agent: OpenValensRecipeImport",
    "Disallow: /no-imports",
    "Disallow: /*.json$",
  ].join("\n");

  test("uses our named group over the wildcard group", () => {
    expect(isAllowedByRobots(robots, "OpenValensRecipeImport", "/private/soup")).toBe(true);
    expect(isAllowedByRobots(robots, "OpenValensRecipeImport", "/no-imports/soup")).toBe(false);
    expect(isAllowedByRobots(robots, "OpenValensRecipeImport", "/data/soup.json")).toBe(false);
    expect(isAllowedByRobots(robots, "OpenValensRecipeImport", "/data/soup.json?x=1")).toBe(true);
  });

  test("falls back to the wildcard group with longest match", () => {
    expect(isAllowedByRobots(robots, "OtherBot", "/private/soup")).toBe(false);
    expect(isAllowedByRobots(robots, "OtherBot", "/private/recipes/soup")).toBe(true);
    expect(isAllowedByRobots("", "OtherBot", "/anything")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow:", "OtherBot", "/a")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /", "OtherBot", "/a")).toBe(false);
  });
});

const RECIPE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Example Kitchen" },
    {
      "@type": ["Recipe"],
      name: "Lentil soup",
      recipeYield: ["4", "4 bowls"],
      author: { "@type": "Person", name: "Ana Cook" },
      recipeIngredient: ["200 g red lentils", "1 onion, chopped"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Copyrighted story and steps." }],
      image: "https://cdn.example.test/soup.jpg",
      description: "A long headnote.",
      review: [{ reviewBody: "Lovely" }],
    },
  ],
};

function page(body: string): string {
  return `<!doctype html><html><head>
    <meta property="og:title" content="Lentil soup &amp; bread">
    <meta property="og:site_name" content='Example Kitchen'>
    <meta property="og:description" content="200 g lentils">
    ${body}
  </head><body><p>Story about my grandmother.</p></body></html>`;
}

describe("extractRecipePage", () => {
  test("reads JSON-LD blocks and Open Graph metadata, skipping broken blocks", () => {
    const html = page(
      `<script type="application/ld+json">{ broken</script>
       <script type='application/ld+json'>${JSON.stringify(RECIPE_JSON_LD)}</script>`,
    );
    const extracted = extractRecipePage(html);
    expect(extracted.jsonLd).toEqual([RECIPE_JSON_LD]);
    expect(extracted.metadata).toEqual({
      title: "Lentil soup & bread",
      siteName: "Example Kitchen",
    });
  });
});

describe("safeFetch against a loopback server", () => {
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  const seen: Headers[] = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        seen.push(request.headers);
        const path = new URL(request.url).pathname;
        if (path === "/html")
          return new Response("<p>ok</p>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        if (path === "/json") return Response.json({ a: 1 });
        if (path === "/big")
          return new Response("x".repeat(5_000), { headers: { "content-type": "text/html" } });
        if (path === "/slow") {
          await Bun.sleep(1_000);
          return new Response("late", { headers: { "content-type": "text/html" } });
        }
        if (path === "/to-metadata")
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest" },
          });
        if (path.startsWith("/hop/")) {
          const left = Number(path.slice(5));
          return new Response(null, {
            status: 301,
            headers: { location: left > 0 ? `/hop/${left - 1}` : "/html" },
          });
        }
        return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
      },
    });
    origin = `http://localhost:${server.port}`;
  });
  afterAll(() => server.stop(true));

  // Loopback is allowed here only so the test can reach its own server.
  const options: SafeFetchOptions = {
    userAgent: "TestAgent/1.0",
    accept: ["text/html"],
    maxBytes: 1_000,
    timeoutMs: 300,
    maxRedirects: 3,
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    isAllowedAddress: (address) => address === "127.0.0.1",
    allowPort: () => true,
  };

  test("fetches an allowed page with an honest user agent and no cookies", async () => {
    const result = await safeFetch(`${origin}/html`, options);
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      contentType: "text/html",
      body: "<p>ok</p>",
    });
    const headers = seen.at(-1)!;
    expect(headers.get("user-agent")).toBe("TestAgent/1.0");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  test("blocks loopback with the default address policy", async () => {
    const { isAllowedAddress: _ignored, ...defaults } = options;
    expect(await safeFetch(`${origin}/html`, defaults)).toEqual({
      ok: false,
      reason: "blocked_address",
    });
    expect(
      await safeFetch(`${origin}/html`, {
        ...defaults,
        resolve: async () => [{ address: "10.0.0.5", family: 4 }],
      }),
    ).toEqual({ ok: false, reason: "blocked_address" });
  });

  test("blocks a host whose answers mix public and private addresses", async () => {
    const result = await safeFetch(`${origin}/html`, {
      ...options,
      resolve: async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
  });

  test("re-checks every redirect target", async () => {
    expect(await safeFetch(`${origin}/to-metadata`, options)).toEqual({
      ok: false,
      reason: "blocked_address",
    });
  });

  test("follows at most three redirects", async () => {
    expect(await safeFetch(`${origin}/hop/2`, options)).toMatchObject({
      ok: true,
      url: `${origin}/html`,
    });
    expect(await safeFetch(`${origin}/hop/3`, options)).toEqual({
      ok: false,
      reason: "too_many_redirects",
    });
  });

  test("enforces size, time and content-type limits", async () => {
    expect(await safeFetch(`${origin}/big`, options)).toMatchObject({
      ok: false,
      reason: "too_large",
    });
    expect(await safeFetch(`${origin}/slow`, options)).toEqual({ ok: false, reason: "timeout" });
    expect(await safeFetch(`${origin}/json`, options)).toMatchObject({
      ok: false,
      reason: "unsupported_content",
    });
    expect(await safeFetch(`${origin}/nope`, options)).toEqual({
      ok: false,
      reason: "http_error",
      status: 404,
    });
  });
});

describe("createRecipeImportService", () => {
  const scope = { organizationId: "org-a", userId: "user-a" };
  const enabledDb = (enabled: boolean) =>
    ({
      select: () => ({
        from: () => ({
          where: async () => [
            {
              revision: 1,
              hideNumbers: false,
              energyDirection: "maintain",
              activeProtein: false,
              streaksEnabled: false,
              recipeImportEnabled: enabled,
              heightCm: null,
              declarations: [],
            },
          ],
        }),
      }),
    }) as never;
  const now = () => new Date("2026-10-22T12:00:00.000Z");

  function fetcher(pages: Record<string, string | { status: number }>): {
    fetchPage: PageFetcher;
    calls: string[];
  } {
    const calls: string[] = [];
    const fetchPage: PageFetcher = async (url) => {
      calls.push(url);
      const pageBody = pages[new URL(url).pathname];
      if (pageBody === undefined) return { ok: false, reason: "http_error", status: 404 };
      if (typeof pageBody !== "string")
        return { ok: false, reason: "http_error", status: pageBody.status };
      return { ok: true, url, status: 200, contentType: "text/html", body: pageBody };
    };
    return { fetchPage, calls };
  }

  test("does nothing until the member opts in", async () => {
    const { fetchPage, calls } = fetcher({});
    const service = createRecipeImportService({ fetchPage, now });
    const result = await service.importFromUrl(enabledDb(false), scope, {
      url: "https://example.test/soup",
    });
    expect(result.status).toBe("disabled");
    expect(result.candidates).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("returns ingredients, servings and attribution only, as an unsaved draft", async () => {
    const { fetchPage } = fetcher({
      "/soup": page(
        `<script type="application/ld+json">${JSON.stringify(RECIPE_JSON_LD)}</script>`,
      ),
    });
    const service = createRecipeImportService({ fetchPage, now });
    const result = await service.importFromUrl(enabledDb(true), scope, {
      url: "https://example.test/soup",
    });
    expect(result).toEqual({
      status: "ready",
      message: null,
      candidates: [
        {
          id: "recipe-1",
          title: "Lentil soup",
          servingsText: "4, 4 bowls",
          source: {
            url: "https://example.test/soup",
            site: "example.test",
            author: "Ana Cook",
            importedAt: "2026-10-22T12:00:00.000Z",
          },
          ingredients: [
            {
              id: "ingredient-1",
              rawText: "200 g red lentils",
              quantityText: null,
              unitText: null,
              foodText: null,
              preparation: "unknown",
            },
            {
              id: "ingredient-2",
              rawText: "1 onion, chopped",
              quantityText: null,
              unitText: null,
              foodText: null,
              preparation: "unknown",
            },
          ],
        },
      ],
    });
    const serialized = JSON.stringify(result);
    for (const dropped of ["Copyrighted", "soup.jpg", "headnote", "Lovely", "grandmother"])
      expect(serialized).not.toContain(dropped);
  });

  test("an Open Graph-only page yields a title but no ingredients", async () => {
    const { fetchPage } = fetcher({ "/og": page("") });
    const service = createRecipeImportService({ fetchPage, now });
    const result = await service.importFromUrl(enabledDb(true), scope, {
      url: "https://example.test/og",
    });
    expect(result.status).toBe("no_recipe");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.title).toBe("Lentil soup & bread");
    expect(result.candidates[0]!.ingredients).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("200 g lentils");
  });

  test("respects robots.txt and refuses when it cannot be read", async () => {
    const disallowed = fetcher({
      "/robots.txt": "User-agent: OpenValensRecipeImport\nDisallow: /",
      "/soup": page(""),
    });
    const service = createRecipeImportService({ fetchPage: disallowed.fetchPage, now });
    expect(
      (await service.importFromUrl(enabledDb(true), scope, { url: "https://example.test/soup" }))
        .status,
    ).toBe("robots_disallowed");
    expect(disallowed.calls).toEqual(["https://example.test/robots.txt"]);

    const broken = fetcher({ "/robots.txt": { status: 503 }, "/soup": page("") });
    const strict = createRecipeImportService({ fetchPage: broken.fetchPage, now });
    expect(
      (await strict.importFromUrl(enabledDb(true), scope, { url: "https://example.test/soup" }))
        .status,
    ).toBe("robots_disallowed");
  });

  test("malformed recipe data fails closed with no partial draft", async () => {
    const { fetchPage } = fetcher({
      "/bad": page(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Recipe",
          name: "Half",
          recipeIngredient: ["ok", { nested: true }],
        })}</script>`,
      ),
    });
    const service = createRecipeImportService({ fetchPage, now });
    const result = await service.importFromUrl(enabledDb(true), scope, {
      url: "https://example.test/bad",
    });
    expect(result).toMatchObject({ status: "invalid", candidates: [] });
  });

  test("rejects blocked URLs and enforces per-user and per-domain limits", async () => {
    const { fetchPage } = fetcher({ "/soup": page("") });
    const service = createRecipeImportService({
      fetchPage,
      now,
      userLimiter: new InMemoryRateLimiter({ limitPerMinute: 2 }),
      domainLimiter: new InMemoryRateLimiter({ limitPerMinute: 3 }),
    });
    const db = enabledDb(true);
    expect((await service.importFromUrl(db, scope, { url: "file:///etc/passwd" })).status).toBe(
      "blocked_url",
    );
    const url = { url: "https://example.test/soup" };
    expect((await service.importFromUrl(db, scope, url)).status).toBe("no_recipe");
    expect((await service.importFromUrl(db, scope, url)).status).toBe("no_recipe");
    expect((await service.importFromUrl(db, scope, url)).status).toBe("rate_limited");
    const other = { organizationId: "org-a", userId: "user-b" };
    expect((await service.importFromUrl(db, other, url)).status).toBe("no_recipe");
    expect((await service.importFromUrl(db, other, url)).status).toBe("rate_limited");
  });

  test("maps fetch failures to safe copy that echoes nothing", async () => {
    const service = createRecipeImportService({
      fetchPage: async (url) =>
        url.endsWith("/robots.txt")
          ? { ok: false, reason: "http_error", status: 404 }
          : { ok: false, reason: "timeout" },
      now,
    });
    const result = await service.importFromUrl(enabledDb(true), scope, {
      url: "https://example.test/secret-path",
    });
    expect(result.status).toBe("fetch_failed");
    expect(result.message).not.toContain("secret-path");
  });
});
