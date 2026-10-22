import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * Outbound fetch for user-requested recipe imports (Issue #82).
 *
 * The URL comes from a member, so every hop is treated as hostile:
 * - http/https on the default ports only, no credentials in the URL;
 * - every address the host resolves to must be public (no loopback, private,
 *   link-local, CGNAT, multicast or documentation ranges, in IPv4 or IPv6);
 * - the connection is pinned to the addresses that were checked, so a second
 *   DNS answer cannot rebind it to an internal host;
 * - redirects are followed by hand, at most `maxRedirects`, and each target
 *   goes through the same checks;
 * - one deadline covers the whole request, the body is capped at `maxBytes`,
 *   and only the listed content types are read;
 * - no cookies or auth headers are sent, and nothing about the body is logged.
 */

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type SafeFetchOptions = {
  userAgent: string;
  /** Media types accepted, e.g. `text/html`. Anything else is not read. */
  accept: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  /** Resolver override for tests. Defaults to the system resolver. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Address policy override for tests. Defaults to {@link isPublicAddress}. */
  isAllowedAddress?: (address: string) => boolean;
  /** Port policy override for tests. Defaults to the scheme's default port only. */
  allowPort?: (url: URL) => boolean;
};

export type SafeFetchFailure =
  | "invalid_url"
  | "blocked_address"
  | "too_many_redirects"
  | "timeout"
  | "too_large"
  | "unsupported_content"
  | "http_error"
  | "network_error";

export type SafeFetchResult =
  | { ok: true; url: string; status: number; contentType: string; body: string }
  | { ok: false; reason: SafeFetchFailure; status?: number };

class FetchFailure extends Error {
  constructor(
    readonly reason: SafeFetchFailure,
    readonly status?: number,
  ) {
    super(reason);
  }
}

/** Parses and checks a member-supplied URL; `null` when it may not be fetched. */
export function parseImportUrl(
  value: string,
  allowPort: (url: URL) => boolean = (url) => url.port === "",
): URL | null {
  if (value.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  if (!allowPort(url)) return null;
  url.hash = "";
  return url;
}

function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isPublicIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Expands an IPv6 address to eight 16-bit groups, or `null` if malformed. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) return null; // scoped (link-local) addresses are never public
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const embedded = text.slice(lastColon + 1);
  if (embedded.includes(".")) {
    const octets = ipv4Octets(embedded);
    if (!octets) return null;
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const values = groups.map((group) => Number.parseInt(group, 16));
  if (tail.length) values.splice(6, 2, ...tail);
  return values;
}

function isPublicIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const [g0, g1, , , , g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // IPv4-mapped (::ffff:a.b.c.d): judge the IPv4 address.
  if (groups.slice(0, 5).every((group) => group === 0) && g5 === 0xffff)
    return isPublicIpv4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  // Only global unicast (2000::/3) can be public.
  if (g0 < 0x2000 || g0 > 0x3fff) return false;
  if (g0 === 0x2001 && g1 < 0x0200) return false; // IETF special purpose, Teredo
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2002) return false; // 6to4 can tunnel to any IPv4
  if (g0 === 0x3fff && g1 < 0x1000) return false; // documentation (3fff::/20)
  return true;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function systemResolve(hostname: string): Promise<ResolvedAddress[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
}

async function resolvePinned(url: URL, options: SafeFetchOptions): Promise<ResolvedAddress[]> {
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  let addresses: ResolvedAddress[];
  if (literal) addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  else {
    try {
      addresses = await (options.resolve ?? systemResolve)(host);
    } catch {
      throw new FetchFailure("network_error");
    }
  }
  // Every answer must be allowed: a mixed answer could still reach an internal host.
  if (!addresses.length || addresses.some((entry) => !allowed(entry.address)))
    throw new FetchFailure("blocked_address");
  return addresses;
}

type Hop = { status: number; location: string | null; contentType: string; body: string | null };

function requestOnce(
  url: URL,
  addresses: ResolvedAddress[],
  options: SafeFetchOptions,
  signal: AbortSignal,
): Promise<Hop> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise<Hop>((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        signal,
        headers: {
          "user-agent": options.userAgent,
          accept: options.accept.join(", "),
          "accept-encoding": "identity",
        },
        // Connect only to the addresses that were checked above.
        lookup: ((
          _hostname: string,
          lookupOptions: { all?: boolean },
          callback: (...args: unknown[]) => void,
        ) => {
          if (lookupOptions?.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, addresses[0]!.family);
        }) as never,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location =
          typeof response.headers.location === "string" ? response.headers.location : null;
        const contentType = String(response.headers["content-type"] ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        // Redirects and errors carry no body we want.
        if (status < 200 || status >= 300) {
          response.resume();
          resolve({ status, location, contentType, body: null });
          return;
        }
        if (!options.accept.includes(contentType)) {
          response.destroy();
          reject(new FetchFailure("unsupported_content", status));
          return;
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          response.destroy();
          reject(new FetchFailure("too_large", status));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            response.destroy();
            reject(new FetchFailure("too_large", status));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status,
            location,
            contentType,
            body: new TextDecoder("utf-8").decode(Buffer.concat(chunks)),
          }),
        );
        response.on("error", () => reject(new FetchFailure("network_error", status)));
      },
    );
    request.on("error", (error) =>
      reject(error instanceof FetchFailure ? error : new FetchFailure("network_error")),
    );
    request.end();
  });
}

/** Fetches `input` under the rules above. Never throws. */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let url = parseImportUrl(input, options.allowPort);
    if (!url) return { ok: false, reason: "invalid_url" };
    for (let redirects = 0; ; redirects++) {
      const addresses = await resolvePinned(url, options);
      if (controller.signal.aborted) throw new FetchFailure("timeout");
      const hop = await requestOnce(url, addresses, options, controller.signal);
      if (hop.status >= 300 && hop.status < 400 && hop.location) {
        if (redirects >= options.maxRedirects) return { ok: false, reason: "too_many_redirects" };
        let next: URL | null;
        try {
          next = parseImportUrl(new URL(hop.location, url).href, options.allowPort);
        } catch {
          next = null;
        }
        if (!next) return { ok: false, reason: "invalid_url" };
        url = next;
        continue;
      }
      if (hop.body === null) return { ok: false, reason: "http_error", status: hop.status };
      return {
        ok: true,
        url: url.href,
        status: hop.status,
        contentType: hop.contentType,
        body: hop.body,
      };
    }
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, reason: "timeout" };
    if (error instanceof FetchFailure)
      return { ok: false, reason: error.reason, ...(error.status ? { status: error.status } : {}) };
    return { ok: false, reason: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
