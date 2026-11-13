/**
 * Scope vocabulary of an AI-app grant (Issue #439). One list shared by
 * personal API keys now and OAuth connections later, so a scope string means
 * the same thing on both paths. The strings are part of the persisted contract
 * (`ai_app_grant.scopes`) and of the public tool API: never rename one.
 *
 * - `records:read` is the base scope: what the Coach tools read.
 * - `nutrition:read`, `private_body:read`, `notes:read`, `trackers:read` and
 *   `pain:read` are opt-in and off by default on every create screen.
 * - Reserved scopes are known names that cannot be granted yet (M2 writes).
 *   Creating a grant with one fails.
 *
 * Cycle data and progress photos have no scope at all: no grant can ever
 * reach them (see `./exclusions`).
 */

export const BASE_SCOPE = "records:read";

export const OPT_IN_SCOPES = [
  "nutrition:read",
  "private_body:read",
  "notes:read",
  // Custom trackers (#441). Each tracker's own AI switch overrides it: a
  // tracker with the switch off is invisible even with this scope.
  "trackers:read",
  // Pain log (#442). The member's own pain AI switch (off by default) and the
  // pain log's opt-in override it: either off means no pain data.
  "pain:read",
] as const;

/** Every scope a grant may hold today. */
export const GRANTABLE_SCOPES = [BASE_SCOPE, ...OPT_IN_SCOPES] as const;

export type GrantableScope = (typeof GRANTABLE_SCOPES)[number];

/**
 * Names held back for later milestones so nothing else takes them: one write
 * scope per domain (M2, tracker and pain writes among them).
 */
export const RESERVED_SCOPES = [
  "water:write",
  "body:write",
  "vitals:write",
  "supplements:write",
  "workouts:write",
  "sleep:write",
  "food:write",
  "labs:write",
  "trackers:write",
  "pain:write",
] as const;

export type ReservedScope = (typeof RESERVED_SCOPES)[number];

export function isGrantableScope(value: string): value is GrantableScope {
  return (GRANTABLE_SCOPES as readonly string[]).includes(value);
}

/**
 * Normalizes a requested scope list: the base scope is always included, the
 * result is de-duplicated and sorted, and anything that is not grantable
 * (unknown or reserved) is reported instead of silently dropped.
 */
export function normalizeScopes(
  requested: readonly string[],
): { ok: true; scopes: GrantableScope[] } | { ok: false; invalid: string[] } {
  const invalid = requested.filter((scope) => !isGrantableScope(scope));
  if (invalid.length > 0) return { ok: false, invalid: [...new Set(invalid)].sort() };
  const scopes = new Set<GrantableScope>([BASE_SCOPE, ...(requested as GrantableScope[])]);
  return { ok: true, scopes: [...scopes].sort() };
}

export function hasScope(scopes: readonly string[], scope: GrantableScope): boolean {
  return scopes.includes(scope);
}
