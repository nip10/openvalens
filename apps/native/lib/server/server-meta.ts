import { SERVER_META_PATH, serverMetaSchema, type ServerMeta } from "@openvalens/api/server-meta";

/**
 * Issue #295 — the server check before the app saves an address, kept free
 * of Expo imports so it can be tested. It reads `GET /.well-known/openvalens`
 * and sorts the answer into the one problem the person can act on.
 */

/** The server API versions this app speaks. */
export const APP_API_RANGE = { min: 1, max: 1 } as const;

const PROBE_TIMEOUT_MS = 10_000;

export type ServerProblem =
  /** No answer: offline, a wrong address, or the server is down. */
  | { kind: "unreachable" }
  /** Something answered, but not an OpenValens server. */
  | { kind: "not-openvalens" }
  /** The address, or a redirect it sent, is not HTTPS. */
  | { kind: "not-https" }
  /** The server's API is older than this app supports. */
  | { kind: "server-too-old"; serverVersion: string }
  /** The server's API is newer than this app supports. */
  | { kind: "app-too-old"; serverVersion: string };

export type ServerCheck = { ok: true; meta: ServerMeta } | { ok: false; problem: ServerProblem };

/** Reads a meta document: is it OpenValens, and can this app talk to it? */
export function checkServerMeta(
  body: unknown,
  range: { min: number; max: number } = APP_API_RANGE,
): ServerCheck {
  if (!body || typeof body !== "object" || (body as { product?: unknown }).product !== "openvalens")
    return { ok: false, problem: { kind: "not-openvalens" } };
  const head = body as { apiVersion?: unknown; serverVersion?: unknown };
  const serverVersion =
    typeof head.serverVersion === "string" ? head.serverVersion.slice(0, 64) : "";
  // Judge the version before the rest of the shape: a future server may
  // change the other fields, and the person should then be told to update.
  if (typeof head.apiVersion === "number" && Number.isInteger(head.apiVersion)) {
    if (head.apiVersion < range.min)
      return { ok: false, problem: { kind: "server-too-old", serverVersion } };
    if (head.apiVersion > range.max)
      return { ok: false, problem: { kind: "app-too-old", serverVersion } };
  }
  const parsed = serverMetaSchema.safeParse(body);
  if (!parsed.success) return { ok: false, problem: { kind: "not-openvalens" } };
  return { ok: true, meta: parsed.data };
}

/** Fetches and checks the meta document of an already normalised origin. */
export async function probeServer(
  origin: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ServerCheck> {
  if (!origin.startsWith("https://") && !origin.startsWith("http://"))
    return { ok: false, problem: { kind: "not-https" } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${origin}${SERVER_META_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal: controller.signal,
    });
  } catch {
    return { ok: false, problem: { kind: "unreachable" } };
  } finally {
    clearTimeout(timer);
  }
  // An HTTPS address must not hand the app over to plain HTTP.
  if (origin.startsWith("https://") && response.url && !response.url.startsWith("https://"))
    return { ok: false, problem: { kind: "not-https" } };
  // A 5xx is a server (or its proxy) that is down, not a wrong address.
  if (response.status >= 500) return { ok: false, problem: { kind: "unreachable" } };
  if (!response.ok) return { ok: false, problem: { kind: "not-openvalens" } };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, problem: { kind: "not-openvalens" } };
  }
  return checkServerMeta(body);
}
