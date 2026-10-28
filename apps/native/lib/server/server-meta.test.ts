import { describe, expect, test } from "bun:test";

import { buildServerMeta, SERVER_META_PATH } from "@openvalens/api/server-meta";

import { APP_API_RANGE, checkServerMeta, probeServer } from "./server-meta";

const meta = buildServerMeta({ profile: { mode: "self-hosted", signUp: false }, oidc: true });

function respond(body: unknown, init: ResponseInit & { url?: string } = {}): typeof fetch {
  return (async () => {
    const response = new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
    if (init.url) Object.defineProperty(response, "url", { value: init.url });
    return response;
  }) as unknown as typeof fetch;
}

describe("checkServerMeta (#295)", () => {
  test("accepts what the server publishes", () => {
    expect(checkServerMeta(meta)).toEqual({ ok: true, meta });
  });

  test("the app supports the server's current API version", () => {
    expect(meta.apiVersion).toBeGreaterThanOrEqual(APP_API_RANGE.min);
    expect(meta.apiVersion).toBeLessThanOrEqual(APP_API_RANGE.max);
  });

  test("ignores fields a newer server adds", () => {
    const result = checkServerMeta({ ...meta, region: "eu", signIn: { ...meta.signIn, x: 1 } });
    expect(result.ok).toBe(true);
  });

  test("anything else is not an OpenValens server", () => {
    for (const body of [
      null,
      "openvalens",
      [],
      {},
      { product: "something-else" },
      { ...meta, product: "OpenValens" },
    ]) {
      expect(checkServerMeta(body)).toEqual({ ok: false, problem: { kind: "not-openvalens" } });
    }
  });

  test("an OpenValens document with a broken shape is not trusted", () => {
    expect(checkServerMeta({ ...meta, signIn: undefined })).toEqual({
      ok: false,
      problem: { kind: "not-openvalens" },
    });
  });

  test("a server below the supported range is too old, and names its version", () => {
    expect(
      checkServerMeta({ ...meta, apiVersion: 1, serverVersion: "0.1.0" }, { min: 2, max: 3 }),
    ).toEqual({ ok: false, problem: { kind: "server-too-old", serverVersion: "0.1.0" } });
  });

  test("a server above the supported range needs a newer app, whatever else it changed", () => {
    expect(
      checkServerMeta({
        product: "openvalens",
        apiVersion: 7,
        serverVersion: "3.0.0",
        signIn: "new",
      }),
    ).toEqual({ ok: false, problem: { kind: "app-too-old", serverVersion: "3.0.0" } });
  });
});

describe("probeServer (#295)", () => {
  test("reads the well-known document of the origin, without credentials", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify(meta), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await probeServer("https://health.example.org", fetchImpl)).toEqual({ ok: true, meta });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(`https://health.example.org${SERVER_META_PATH}`);
    expect(calls[0]?.[1]?.credentials).toBe("omit");
    expect(calls[0]?.[1]?.method).toBe("GET");
  });

  test("no answer is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    expect(await probeServer("https://down.example.org", fetchImpl)).toEqual({
      ok: false,
      problem: { kind: "unreachable" },
    });
  });

  test("a request that never answers times out as unreachable", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expect(await probeServer("https://slow.example.org", fetchImpl, 5)).toEqual({
      ok: false,
      problem: { kind: "unreachable" },
    });
  });

  test("a 5xx is a server that is down; a 404 is not OpenValens", async () => {
    expect(await probeServer("https://x.example.org", respond({}, { status: 502 }))).toEqual({
      ok: false,
      problem: { kind: "unreachable" },
    });
    expect(await probeServer("https://x.example.org", respond({}, { status: 404 }))).toEqual({
      ok: false,
      problem: { kind: "not-openvalens" },
    });
  });

  test("a web page instead of JSON is not OpenValens", async () => {
    expect(
      await probeServer("https://x.example.org", respond("<!doctype html><html></html>")),
    ).toEqual({ ok: false, problem: { kind: "not-openvalens" } });
  });

  test("an HTTPS address that redirects to plain HTTP is refused", async () => {
    const fetchImpl = respond(meta, { url: `http://x.example.org${SERVER_META_PATH}` });
    expect(await probeServer("https://x.example.org", fetchImpl)).toEqual({
      ok: false,
      problem: { kind: "not-https" },
    });
  });

  test("an address without a scheme is never fetched", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await probeServer("ftp://x.example.org", fetchImpl)).toEqual({
      ok: false,
      problem: { kind: "not-https" },
    });
    expect(called).toBe(false);
  });
});
