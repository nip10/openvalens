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
let installedAuthority: { scope: DirectDeviceScope; sessionIdentity: string } | null = null;
const ticketScopes = new WeakMap<AuthorityTicket, string>();
const scopeGenerations = new Map<string, number>();
const invalidatedSessions = new Set<string>();
const authorityListeners = new Set<() => void>();

export function subscribeDirectDeviceAuthorityInvalidation(listener: () => void): () => void {
  authorityListeners.add(listener);
  return () => authorityListeners.delete(listener);
}

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

/** Installs the sole session authority from the headless authenticated-session observer. */
export function installDirectDeviceAuthority(
  scopeInput: DirectDeviceScope,
  sessionIdentity: string,
): void {
  if (!sessionIdentity) throw new Error("INVALID_DIRECT_DEVICE_SESSION");
  const scope = canonicalDirectDeviceScope(scopeInput);
  const identityKey = `${sessionIdentity}:${JSON.stringify([scope.serverUrl, scope.userId, scope.organizationId])}`;
  if (invalidatedSessions.has(identityKey)) return;
  installedAuthority = { scope, sessionIdentity };
}

/** Ticket minting is restricted to the currently installed authenticated context. */
export function createCurrentDirectDeviceTicket(): AuthorityTicket {
  const authority = installedAuthority;
  if (!authority) throw new Error("DIRECT_DEVICE_AUTHORITY_UNAVAILABLE");
  const ticket = createAuthorityTicket(authority.scope, authority.sessionIdentity);
  if (!isAuthorityTicketCurrent(ticket)) throw new Error("STALE_DIRECT_DEVICE_AUTHORITY");
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
  installedAuthority = null;
  for (const listener of authorityListeners) listener();
}

/** Synchronously fences callbacks before a lifecycle transition reaches its first await. */
export function beginDirectDeviceAuthorityTransition(): void {
  if (installedAuthority)
    invalidatedSessions.add(
      `${installedAuthority.sessionIdentity}:${directDeviceScopeKey(installedAuthority.scope)}`,
    );
  invalidateDirectDeviceAuthority();
}

/** Purging a single account scope also fences callbacks holding its tickets. */
export function invalidateDirectDeviceScope(scope: DirectDeviceScope): void {
  const key = directDeviceScopeKey(scope);
  scopeGenerations.set(key, (scopeGenerations.get(key) ?? 0) + 1);
  if (installedAuthority && directDeviceScopeKey(installedAuthority.scope) === key) {
    invalidatedSessions.add(`${installedAuthority.sessionIdentity}:${key}`);
    installedAuthority = null;
    for (const listener of authorityListeners) listener();
  }
}
