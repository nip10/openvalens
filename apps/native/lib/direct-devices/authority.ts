export type DirectDeviceScope = Readonly<{
  serverUrl: string;
  userId: string;
  organizationId: string;
}>;

export type AuthorityTicket = Readonly<{
  scope: DirectDeviceScope;
  scopeKey: string;
  sessionIdentity: string;
  generation: number;
  scopeGeneration: number;
}>;

let generation = 0;
let nextIdentity = 0;
const ticketScopes = new WeakMap<AuthorityTicket, string>();
const scopeGenerations = new Map<string, number>();

export function canonicalServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("INVALID_DIRECT_DEVICE_SCOPE");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_DIRECT_DEVICE_SCOPE");
  }
  // URL normalizes host/default ports but preserves deployment base paths.
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
}

export function canonicalDirectDeviceScope(scope: DirectDeviceScope): DirectDeviceScope {
  if (!scope.userId || !scope.organizationId || !scope.serverUrl)
    throw new Error("INVALID_DIRECT_DEVICE_SCOPE");
  return Object.freeze({
    serverUrl: canonicalServerUrl(scope.serverUrl),
    userId: scope.userId,
    organizationId: scope.organizationId,
  });
}

export function directDeviceScopeKey(scope: DirectDeviceScope): string {
  const canonical = canonicalDirectDeviceScope(scope);
  return JSON.stringify([canonical.serverUrl, canonical.userId, canonical.organizationId]);
}

export function createAuthorityTicket(
  scopeInput: DirectDeviceScope,
  sessionIdentity = `session-${++nextIdentity}`,
): AuthorityTicket {
  if (!sessionIdentity) throw new Error("INVALID_DIRECT_DEVICE_SESSION");
  const scope = canonicalDirectDeviceScope(scopeInput);
  const scopeKey = JSON.stringify([scope.serverUrl, scope.userId, scope.organizationId]);
  const ticket = Object.freeze({
    scope,
    scopeKey,
    sessionIdentity,
    generation,
    scopeGeneration: scopeGenerations.get(scopeKey) ?? 0,
  });
  ticketScopes.set(ticket, scopeKey);
  return ticket;
}

export function isAuthorityTicketCurrent(ticket: AuthorityTicket): boolean {
  return (
    ticketScopes.get(ticket) === ticket.scopeKey &&
    ticket.generation === generation &&
    ticket.scopeGeneration === (scopeGenerations.get(ticket.scopeKey) ?? 0)
  );
}

export function assertAuthorityTicket(ticket: AuthorityTicket): void {
  if (!isAuthorityTicketCurrent(ticket)) throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
}

/** Invalidates every issued ticket; sign-in must issue a new ticket. */
export function invalidateDirectDeviceAuthority(): void {
  generation += 1;
}

/** Purging a single account scope also fences callbacks holding its tickets. */
export function invalidateDirectDeviceScope(scope: DirectDeviceScope): void {
  const key = directDeviceScopeKey(scope);
  scopeGenerations.set(key, (scopeGenerations.get(key) ?? 0) + 1);
}
