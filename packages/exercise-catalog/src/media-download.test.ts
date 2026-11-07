import { describe, expect, test } from "bun:test";

import { downloadAllowed } from "./media-download";

const allowAll = () => true;
const fakeFetch = (response: Response) => (async () => response) as unknown as typeof fetch;

describe("downloadAllowed", () => {
  test("refuses URLs outside the allowlist before any request", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("x");
    }) as unknown as typeof fetch;
    await expect(
      downloadAllowed(new URL("https://example.test/a.png"), () => false, fetchImpl),
    ).rejects.toThrow("download_url_untrusted");
    expect(called).toBe(false);
  });

  test("rejects redirects, errors and oversize bodies", async () => {
    const url = new URL("https://example.test/a.png");
    await expect(
      downloadAllowed(
        url,
        allowAll,
        fakeFetch(new Response(null, { status: 302, headers: { location: "/b" } })),
      ),
    ).rejects.toThrow("download_redirect");
    await expect(
      downloadAllowed(url, allowAll, fakeFetch(new Response("no", { status: 404 }))),
    ).rejects.toThrow("download_failed_404");
    await expect(
      downloadAllowed(url, allowAll, fakeFetch(new Response(new Uint8Array(20))), 10),
    ).rejects.toThrow("download_size_limit");
  });

  test("returns the body bytes", async () => {
    const bytes = await downloadAllowed(
      new URL("https://example.test/a.png"),
      allowAll,
      fakeFetch(new Response(new Uint8Array([1, 2, 3]))),
    );
    expect([...bytes]).toEqual([1, 2, 3]);
  });
});
