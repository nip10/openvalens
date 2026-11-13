import { describe, expect, test } from "bun:test";

import {
  createPinnedMetadataFetch,
  MetadataFetchRefused,
  type PinnedFetchImpl,
  type ResolvedAddress,
} from "./transport";

/**
 * Issue #439 (M1b) — the CIMD fetch transport refuses private, loopback and
 * link-local targets, resolves once and pins the approved address, and never
 * follows a redirect. No network: the resolver and fetch are fakes.
 */

type Call = { url: string; init: Parameters<PinnedFetchImpl>[1] };

function harness(answers: Record<string, readonly ResolvedAddress[]>, response?: Response) {
  const lookups: string[] = [];
  const calls: Call[] = [];
  const fetchImpl: PinnedFetchImpl = async (url, init) => {
    calls.push({ url, init });
    const reply =
      response?.clone() ??
      new Response(JSON.stringify({ client_id: "x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return reply as Awaited<ReturnType<PinnedFetchImpl>>;
  };
  const transport = createPinnedMetadataFetch({
    resolve: async (hostname) => {
      lookups.push(hostname);
      const result = answers[hostname];
      if (!result) throw new Error("ENOTFOUND");
      return result;
    },
    fetchImpl,
  });
  return { transport, lookups, calls };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MetadataFetchRefused);
    return (error as MetadataFetchRefused).reason;
  }
  throw new Error("expected the fetch to be refused");
}

const PUBLIC_V4 = { address: "93.184.215.14", family: 4 };
const PUBLIC_V6 = { address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 };

describe("CIMD metadata transport", () => {
  test("resolves once, pins the address and keeps the hostname for Host and TLS", async () => {
    const { transport, lookups, calls } = harness({ "app.example.com": [PUBLIC_V4, PUBLIC_V6] });
    const response = await transport("https://app.example.com/oauth/client.json", {
      headers: { accept: "application/json" },
    });
    expect(response.status).toBe(200);
    expect(lookups).toEqual(["app.example.com"]);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://93.184.215.14/oauth/client.json");
    expect(new Headers(call!.init.headers).get("host")).toBe("app.example.com");
    expect(new Headers(call!.init.headers).get("accept")).toBe("application/json");
    expect(call!.init.tls).toEqual({ serverName: "app.example.com", rejectUnauthorized: true });
    expect(call!.init.redirect).toBe("manual");
    expect(call!.init.proxy).toBe("");
  });

  test("pins an IPv6 answer as a bracketed literal and keeps the port", async () => {
    const { transport, calls } = harness({ "v6.example.com": [PUBLIC_V6] });
    await transport("https://v6.example.com:8443/client");
    expect(calls[0]!.url).toBe(`https://[${PUBLIC_V6.address}]:8443/client`);
    expect(new Headers(calls[0]!.init.headers).get("host")).toBe("v6.example.com:8443");
  });

  test.each([
    ["loopback", "127.0.0.1"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.16.0.9"],
    ["private 192.168/16", "192.168.1.20"],
    ["link-local / cloud metadata", "169.254.169.254"],
    ["CGNAT", "100.64.0.1"],
    ["unspecified", "0.0.0.0"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique local", "fd00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
  ])("refuses a host that resolves to %s", async (_label, address) => {
    const { transport, calls } = harness({
      "evil.example.com": [{ address, family: address.includes(":") ? 6 : 4 }],
    });
    expect(await refusal(transport("https://evil.example.com/client"))).toBe("address");
    expect(calls).toHaveLength(0);
  });

  test("refuses when any one answer is private (rebinding among public records)", async () => {
    const { transport, calls } = harness({
      "mixed.example.com": [PUBLIC_V4, { address: "10.0.0.5", family: 4 }],
    });
    expect(await refusal(transport("https://mixed.example.com/client"))).toBe("address");
    expect(calls).toHaveLength(0);
  });

  test("refuses private IP literals without a lookup", async () => {
    const { transport, lookups, calls } = harness({});
    expect(await refusal(transport("https://127.0.0.1/client"))).toBe("address");
    expect(await refusal(transport("https://[::1]/client"))).toBe("address");
    expect(await refusal(transport("https://169.254.169.254/latest/meta-data"))).toBe("address");
    expect(lookups).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("refuses plain HTTP, credentials and methods other than GET or HEAD", async () => {
    const { transport, calls } = harness({ "app.example.com": [PUBLIC_V4] });
    expect(await refusal(transport("http://app.example.com/client"))).toBe("scheme");
    expect(await refusal(transport("https://user:pw@app.example.com/client"))).toBe("scheme");
    expect(
      await refusal(transport("https://app.example.com/client", { method: "POST", body: "{}" })),
    ).toBe("method");
    expect(calls).toHaveLength(0);
  });

  test("refuses an unresolvable host", async () => {
    const { transport } = harness({});
    expect(await refusal(transport("https://missing.example.com/client"))).toBe("dns");
  });

  test.each([301, 302, 303, 307, 308])("never follows a %i redirect", async (status) => {
    const { transport, calls } = harness(
      { "app.example.com": [PUBLIC_V4] },
      new Response(null, { status, headers: { location: "http://169.254.169.254/" } }),
    );
    expect(await refusal(transport("https://app.example.com/client"))).toBe("redirect");
    expect(calls).toHaveLength(1);
  });

  test("passes a 304 through for conditional revalidation", async () => {
    const { transport } = harness(
      { "app.example.com": [PUBLIC_V4] },
      new Response(null, { status: 304 }),
    );
    expect((await transport("https://app.example.com/client")).status).toBe(304);
  });
});
