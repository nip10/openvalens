/**
 * Reusable trusted-session validation (Issues #58 / #63).
 *
 * These pure helpers were extracted verbatim from the admission core's private
 * session helpers (`packages/auth/src/admission/service.ts`) so the settings
 * write can apply the exact same trusted-session rules without a second,
 * divergent implementation. The semantics are unchanged:
 *
 * - A trusted identity is a non-impersonated session belonging to a resolvable
 *   user id and carrying a *resolvable* expiry. A missing/null/undefined or
 *   malformed `expiresAt` (including an invalid `Date` whose `getTime()` is
 *   `NaN`) is not trusted.
 * - Liveness is always decided against real wall-clock database time by the
 *   caller, after contended locks are held; {@link isSessionLive} only performs
 *   the finite/after-now comparison.
 *
 * The helper is intentionally transport-agnostic and does not import Better
 * Auth, the database or any domain error, so both the admission core and the
 * product-settings service can share it.
 */

export type SessionIdentity = {
  userId: string;
  /** Present for Better Auth sessions; `null` when the session shape omits it. */
  sessionId: string | null;
  impersonated: boolean;
  expiresAt: Date | null;
};

export type TrustedIdentity = {
  userId: string;
  sessionId: string | null;
  expiresAt: Date;
};

/**
 * Robust conversion of a driver- or SDK-returned timestamp/date to a `Date`.
 * An invalid `Date` (NaN time) normalises to `null` and can never satisfy a
 * comparison as if it were live.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Narrows an opaque session value to its trusted identity fields. Returns
 * `null` for a missing session or one without a usable user id.
 */
export function resolveSessionIdentity(session: unknown): SessionIdentity | null {
  if (!session) {
    return null;
  }
  const value = session as {
    user?: { id?: unknown };
    session?: { id?: unknown; impersonatedBy?: unknown; expiresAt?: unknown };
  };
  const userId = value.user?.id;
  if (typeof userId !== "string" || userId.length === 0) {
    return null;
  }
  const sessionId = value.session?.id;
  const impersonated =
    typeof value.session?.impersonatedBy === "string" && value.session.impersonatedBy.length > 0;
  const expiresAt = toDate(value.session?.expiresAt);
  return {
    userId,
    sessionId: typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null,
    impersonated,
    expiresAt,
  };
}

/**
 * A trusted, non-impersonated session with a *resolvable* expiry. A missing,
 * null, undefined or malformed `expiresAt` is a denial here; the real
 * wall-clock expiry comparison happens later, after the lock wait, using
 * {@link isSessionLive}.
 */
export function requireTrustedIdentity(session: unknown): TrustedIdentity {
  const identity = resolveSessionIdentity(session);
  if (!identity || identity.impersonated || !identity.expiresAt) {
    throw new Error("Session is not trusted.");
  }
  return {
    userId: identity.userId,
    sessionId: identity.sessionId,
    expiresAt: identity.expiresAt,
  };
}

/**
 * True when the identity's expiry is a finite instant strictly after `now`.
 * Callers pass the authoritative wall-clock `now` (e.g. `clock_timestamp()`)
 * acquired after contended locks.
 */
export function isSessionLive(identity: { expiresAt: Date }, now: Date): boolean {
  const expiresAt = identity.expiresAt.getTime();
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}
