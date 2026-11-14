/**
 * Onboarding (#444) — the "Get the phone app" QR code on the web's first run
 * holds `openvalens://server?url=<this server>` (`phoneAppLink`). Opening it
 * fills in that address for the person to confirm: the app never switches
 * servers from a link by itself. Kept free of Expo imports so it is tested.
 */
import { normalizeServerAddress, type NormalizedAddress } from "./server-address";

/**
 * The server address a link carries, as typed (not yet checked), or `null`
 * when the link is not a server link. Accepts the app's own scheme with
 * `server` as the host or the first path part, and Expo's `…/--/server` form.
 */
export function serverLinkAddress(link: string | null | undefined): string | null {
  if (!link) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/i.exec(link.trim());
  if (!match) return null;
  let rest = match[1] ?? "";
  const expo = rest.indexOf("/--/");
  if (expo >= 0) rest = rest.slice(expo + 4);
  const parts = /^\/?server\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(rest);
  if (!parts) return null;
  for (const pair of (parts[1] ?? "").split("&")) {
    const [key, ...value] = pair.split("=");
    if (key !== "url") continue;
    try {
      const address = decodeURIComponent(value.join("=").replace(/\+/g, " ")).trim();
      return address || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** A server link's address, checked like a typed one; `null` when it is not a server link. */
export function parseServerLink(
  link: string | null | undefined,
  options: { allowLocalHttp: boolean },
): NormalizedAddress | null {
  const address = serverLinkAddress(link);
  return address === null ? null : normalizeServerAddress(address, options);
}

// The address to offer on the server choice once the person agreed to leave
// their current server for a link's one. In memory only: a restart forgets it.
let pending: string | null = null;

export function rememberLinkedServer(address: string | null): void {
  pending = address;
}

/** The remembered address; the server choice clears it once shown. */
export function linkedServer(): string | null {
  return pending;
}

// Links already offered on the server choice (the app had no server yet), so
// the link screen that opens once a server is chosen does not ask again.
const offered = new Set<string>();

export function noteLinkOffered(address: string): void {
  offered.add(address);
}

export function wasLinkOffered(address: string): boolean {
  return offered.has(address);
}
