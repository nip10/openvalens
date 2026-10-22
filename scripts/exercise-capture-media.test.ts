import { describe, expect, test } from "bun:test";
import {
  adaptRawRecord,
  assertCaptureHttpResponse,
  collectPages,
  normalizeLicense,
  safeSource,
} from "./prepare-exercises";
import { downloadBounded } from "./stage-exercise-media";
import { normalizeWgerSnapshot } from "../apps/server/src/services/exercise-catalog-normalization";
import { createNewOutputDirectory } from "./stage-exercise-media";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

describe("wger capture adapters", () => {
  test("collects complete pages and rejects count changes, duplicates, loops and foreign next URLs", async () => {
    const rows = await collectPages(
      "https://wger.de/api/v2/exerciseinfo/?format=json",
      async (url) =>
        url.endsWith("format=json")
          ? { count: 2, results: [{ id: 1 }], next: "?page=2" }
          : { count: 2, results: [{ id: 2 }], next: null },
    );
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    await expect(
      collectPages("https://wger.de/api/v2/x", async () => ({
        count: 2,
        results: [{ id: 1 }],
        next: null,
      })),
    ).rejects.toThrow("Incomplete");
    await expect(
      collectPages("https://wger.de/api/v2/x", async () => ({
        count: 2,
        results: [{ id: 1 }],
        next: "?again=1",
      })),
    ).rejects.toThrow("duplicate");
    await expect(
      collectPages("https://wger.de/api/v2/x", async (url) => ({
        count: 1,
        results: [{ id: 1 }],
        next: url,
      })),
    ).rejects.toThrow("loop");
    await expect(
      collectPages("https://evil.example/api/v2/x", async () => ({
        count: 0,
        results: [],
        next: null,
      })),
    ).rejects.toThrow("Unexpected");
    await expect(
      collectPages("https://wger.de/api/v2/x", async () => ({
        count: 2,
        results: [{ id: 1 }],
        next: null,
      })),
    ).rejects.toThrow("Incomplete");
    await expect(
      collectPages(
        "https://wger.de/api/v2/x",
        async () => ({ count: 1, results: [{ id: 1 }], next: "?next=1" }),
        1,
      ),
    ).rejects.toThrow("page limit");
    await expect(
      collectPages("https://wger.de/api/v2/x", async (url) =>
        url.endsWith("x")
          ? { count: 2, results: [{ id: 1 }], next: "?next=1" }
          : { count: 3, results: [{ id: 2 }], next: null },
      ),
    ).rejects.toThrow("Inconsistent");
  });

  test("normalizes only observed agreeing license aliases; preserves provenance and record source", () => {
    const lookup = new Map([
      [
        1,
        {
          id: 1,
          short_name: "CC-BY-SA 4",
          url: "https://creativecommons.org/licenses/by-sa/4.0/deed.en",
        },
      ],
    ]);
    expect(normalizeLicense(1, lookup)).toMatchObject({
      short_name: "CC-BY-SA-4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    });
    expect(
      normalizeLicense(
        2,
        new Map([
          [
            2,
            { id: 2, short_name: "CC0", url: "http://creativecommons.org/publicdomain/zero/1.0/" },
          ],
        ]),
      ),
    ).toMatchObject({
      short_name: "CC0-1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
    });
    expect(
      normalizeLicense({ short_name: "CC-BY-SA 4", url: "https://example.test/wrong" }, lookup),
    ).toMatchObject({ short_name: "CC-BY-SA 4", url: "https://example.test/wrong" });
    const adapted = adaptRawRecord(
      {
        id: 50,
        license: 1,
        license_author: "base",
        license_title: "Base title",
        license_object_url: "https://licenses.test/base",
        license_author_url: "https://authors.test/base",
        license_derivative_source_url: "https://source.test/original",
        translations: [
          {
            language: 1,
            license: 1,
            license_title: "Translation title",
            license_object_url: "https://licenses.test/translation",
            license_author: "translator",
            license_author_url: "https://authors.test/translator",
            license_derivative_source_url: "https://source.test/translation",
            description: "<p>markup</p>",
            description_source: "plain source",
          },
        ],
        images: [
          {
            id: 359,
            image: "https://wger.de/media/exercise-images/50/uuid.png",
            license: 1,
            license_author: "image-author",
            license_title: "Image title",
            license_object_url: "https://licenses.test/image",
          },
        ],
      },
      new Map([[1, { id: 1, short_name: "en" }]]),
      lookup,
    );
    expect(adapted.translations[0]).toMatchObject({
      sourceUrl: "https://wger.de/api/v2/exerciseinfo/50/",
      description: "plain source",
    });
    expect(adapted.translations[0].attribution).toContain("https://source.test/translation");
    expect(adapted.translations[0].attribution).toContain("Translation title");
    expect(adapted.baseAttribution).toContain("https://source.test/original");
    expect(adapted.images[0].attribution).toContain("Image title");
  });

  test("normalizer keeps base, translation and image rights independent", () => {
    const input = {
      source: "wger",
      complete: true,
      snapshotVersion: "v1",
      snapshotAt: "2026-10-22T00:00:00Z",
      results: [
        {
          id: 50,
          baseLicense: {
            short_name: "CC-BY-SA-4.0",
            url: "https://creativecommons.org/licenses/by-sa/4.0/",
          },
          baseAuthor: "base",
          translations: [
            {
              language: { short_name: "en" },
              name: "Title",
              sourceUrl: "https://wger.de/api/v2/exerciseinfo/50/",
              license: {
                short_name: "CC0-1.0",
                url: "https://creativecommons.org/publicdomain/zero/1.0/",
              },
            },
          ],
          images: [
            {
              id: 359,
              image: "https://wger.de/media/exercise-images/50/uuid.png",
              author: "image",
              attribution: "image evidence",
              license: {
                short_name: "CC-BY-SA-4.0",
                url: "https://creativecommons.org/licenses/by-sa/4.0/",
              },
            },
          ],
        },
      ],
    };
    const normalized = normalizeWgerSnapshot(input, Buffer.from(JSON.stringify(input)));
    expect(normalized.accepted[0]).toMatchObject({
      licenseCode: "CC-BY-SA-4.0",
      author: "base",
      translations: [{ licenseCode: "CC0-1.0" }],
      media: [{ licenseCode: "CC-BY-SA-4.0", author: "image" }],
    });
  });

  test("source URLs must be HTTPS and media downloader rejects unsafe URLs, redirects and truncation", async () => {
    expect(() =>
      assertCaptureHttpResponse(Response.redirect("https://wger.de/redirect", 302)),
    ).toThrow("redirect");
    expect(() => assertCaptureHttpResponse(new Response("", { status: 503 }))).toThrow("503");
    expect(safeSource("https://example.org/original", "https://wger.de/record")).toBe(
      "https://example.org/original",
    );
    expect(() => safeSource("http://example.org/original", "https://wger.de/record")).toThrow();
    const good = new URL(
      "https://wger.de/media/exercise-images/50/695ced5c-9961-4076-add2-cb250d01089e.png",
    );
    await expect(
      downloadBounded(
        new URL(
          "https://evil.example/media/exercise-images/50/695ced5c-9961-4076-add2-cb250d01089e.png",
        ),
      ),
    ).rejects.toThrow("untrusted");
    await expect(
      downloadBounded(
        good,
        async () => Response.redirect("https://evil.example/file", 302) as Response,
      ),
    ).rejects.toThrow("redirect");
    await expect(
      downloadBounded(
        good,
        async () => new Response("short", { headers: { "content-length": "200" } }),
      ),
    ).rejects.toThrow("truncated");
    const streamed = await downloadBounded(
      good,
      async () => new Response(new Uint8Array([1, 2, 3])),
    );
    expect([...streamed]).toEqual([1, 2, 3]);
  });

  test("media output is create-only and rejects symlinked output parents", async () => {
    const root = await mkdtemp(
      "/private/var/folders/8t/tp50trfs7rg_gwkp1pycpmvm0000gn/T/opencode/capture-path-test-",
    );
    try {
      const output = join(root, "new-output");
      await createNewOutputDirectory(output, join(root, "manifest.json"));
      await expect(createNewOutputDirectory(output, join(root, "manifest.json"))).rejects.toThrow();
      const target = join(root, "target");
      await mkdir(target);
      const link = join(root, "linked");
      await symlink(target, link);
      await expect(
        createNewOutputDirectory(join(link, "output"), join(root, "manifest2.json")),
      ).rejects.toThrow("output_parent_invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
