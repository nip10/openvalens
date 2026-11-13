import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Issue #439 (M1b) — the network boundary for Client ID Metadata Document
 * fetches (`@better-auth/cimd`): the client's metadata document and, for a
 * `private_key_jwt` client, its `jwks_uri`. Both URLs are chosen by whoever
 * starts an authorization request, so a fetch must never reach this server's
 * own network.
 *
 * The bundled transport (`@better-auth/cimd/node`) pins the connection through
 * `node:https`'s `lookup` hook, which Bun does not honour. This one gets the
 * same guarantees on Bun:
 *
 * 1. **HTTPS, GET or HEAD only.**
 * 2. **Resolve once.** The hostname is resolved a single time; every answer
 *    must be public-routable (RFC 6890: no loopback, private, link-local,
 *    CGNAT, documentation, multicast, cloud-metadata or IPv4-mapped/NAT64
 *    forms of those). One bad answer refuses the whole fetch, so a rebinding
 *    record cannot hide among good ones.
 * 3. **Pin the address.** The request goes to the approved IP literal; the
 *    original hostname stays the HTTP `Host`, the TLS SNI and the name the
 *    certificate is verified against (`tls.serverName`), so a second lookup
 *    never happens and a certificate for another name fails.
 * 4. **Refuse redirects.** Nothing is followed; any 3xx is an error.
 *
 * Env proxies are bypassed (`proxy: ""`) so the pinned connection is direct.
 */

export type ResolvedAddress = { address: string; family: number };
export type ResolveHost = (hostname: string) => Promise<readonly ResolvedAddress[]>;
export type PinnedFetchImpl = (
  url: string,
  init: RequestInit & BunFetchExtras,
) => Promise<Response>;

type BunFetchExtras = {
  tls?: { serverName?: string; rejectUnauthorized?: boolean };
  proxy?: string;
  decompress?: boolean;
};

export class MetadataFetchRefused extends TypeError {
  readonly reason: "scheme" | "method" | "dns" | "address" | "redirect";

  constructor(reason: MetadataFetchRefused["reason"], message: string) {
    super(message);
    this.name = "MetadataFetchRefused";
    this.reason = reason;
  }
}

const defaultResolve: ResolveHost = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

/** A default timeout when the caller passes no signal of its own. */
const DEFAULT_TIMEOUT_MS = 5_000;

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function pinnedUrl(url: URL, address: string, family: number): string {
  const pinned = new URL(url.toString());
  pinned.hostname = family === 6 ? `[${address}]` : address;
  return pinned.toString();
}

/**
 * Builds the CIMD fetch transport. `resolve` and `fetchImpl` are injectable for
 * tests; production uses the system resolver and Bun's `fetch`.
 */
export function createPinnedMetadataFetch(
  deps: { resolve?: ResolveHost; fetchImpl?: PinnedFetchImpl } = {},
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const resolve = deps.resolve ?? defaultResolve;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as PinnedFetchImpl);

  return async (input, init) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.protocol !== "https:") {
      throw new MetadataFetchRefused("scheme", "Client metadata must be fetched over HTTPS.");
    }
    if (url.username || url.password) {
      throw new MetadataFetchRefused("scheme", "Client metadata URLs must not carry credentials.");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new MetadataFetchRefused("method", "Client metadata is fetched with GET or HEAD only.");
    }

    const hostname = stripBrackets(url.hostname);
    let addresses: readonly ResolvedAddress[];
    if (isIP(hostname) !== 0) {
      addresses = [{ address: hostname, family: isIP(hostname) }];
    } else {
      try {
        addresses = await resolve(hostname);
      } catch {
        throw new MetadataFetchRefused("dns", "The client metadata host could not be resolved.");
      }
    }
    if (addresses.length === 0) {
      throw new MetadataFetchRefused("dns", "The client metadata host has no addresses.");
    }
    for (const answer of addresses) {
      if (!isPublicRoutableHost(answer.address)) {
        throw new MetadataFetchRefused(
          "address",
          "The client metadata host must resolve only to public addresses.",
        );
      }
    }
    const pinned = addresses[0]!;

    const headers = new Headers(request.headers);
    headers.set("host", url.host);
    const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const response = await fetchImpl(pinnedUrl(url, pinned.address, pinned.family), {
      method: request.method,
      headers,
      redirect: "manual",
      signal,
      proxy: "",
      tls: { serverName: hostname, rejectUnauthorized: true },
    });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      await response.body?.cancel().catch(() => undefined);
      throw new MetadataFetchRefused("redirect", "Client metadata fetches never follow redirects.");
    }
    return response;
  };
}
