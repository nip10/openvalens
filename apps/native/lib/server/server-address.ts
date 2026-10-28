/**
 * Issue #295 — server addresses, kept free of Expo imports so they can be
 * tested. The store app connects to OpenValens Cloud by default or to an
 * address the person types; both end up as a bare origin
 * (`https://host[:port]`) that every request is built on.
 */

/** OpenValens Cloud, the one-tap default. */
export const CLOUD_SERVER_URL = "https://app.openvalens.com";

export type AddressProblem = "empty" | "invalid" | "not-https";

export type NormalizedAddress = { ok: true; url: string } | { ok: false; problem: AddressProblem };

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a = 0, b = 0] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** localhost, a loopback or private (LAN) address, or a `.local` mDNS name. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    isPrivateIpv4(host)
  );
}

/**
 * Turns what someone typed into the origin the app stores: trims it, assumes
 * `https://` when no scheme is given, and drops any path, query, fragment or
 * trailing slash. Only HTTPS is accepted, except that a development build
 * (`allowLocalHttp`) may use plain HTTP to localhost or the local network.
 */
export function normalizeServerAddress(
  input: string,
  options: { allowLocalHttp: boolean },
): NormalizedAddress {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, problem: "empty" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (!parsed.hostname || parsed.username || parsed.password || /\s/.test(trimmed)) {
    return { ok: false, problem: "invalid" };
  }
  if (parsed.protocol === "http:") {
    if (!(options.allowLocalHttp && isLocalHost(parsed.hostname))) {
      return { ok: false, problem: "not-https" };
    }
  } else if (parsed.protocol !== "https:") {
    return { ok: false, problem: "invalid" };
  }
  // `URL.origin` lower-cases the host and leaves out a default port.
  return { ok: true, url: parsed.origin };
}

/** The host to show people: `app.openvalens.com`, `192.168.1.20:3000`. */
export function serverLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
