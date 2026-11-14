/**
 * Scope vocabulary of an AI-app grant (Issue #439). One list shared by
 * personal API keys now and OAuth connections later, so a scope string means
 * the same thing on both paths. The strings are part of the persisted contract
 * (`ai_app_grant.scopes`) and of the public tool API: never rename one.
 *
 * - `records:read` is the base scope: what the Coach tools read.
 * - `nutrition:read`, `private_body:read`, `notes:read`, `trackers:read` and
 *   `pain:read` are opt-in and off by default on every create screen.
 * - Write scopes (M2) are one per domain and opt-in too, off by default on
 *   every create screen and the OAuth consent screen. A write scope lets the
 *   app add entries to that domain and delete the entries its own grant wrote;
 *   it never lets the app change or delete anything else.
 * - Reserved scopes are known names that cannot be granted yet (later M2
 *   writes). Creating a grant with one fails.
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

/**
 * Write scopes that can be granted today (M2a, the save-at-once domains).
 * Each one covers adding entries in its domain and deleting entries this
 * grant wrote there.
 */
export const WRITE_SCOPES = [
  "water:write",
  // Weight and body composition (body fat, muscle, bone, body water).
  "body:write",
  // Blood pressure, heart rate, resting heart rate, SpO₂, respiratory rate.
  "vitals:write",
  // A supplement taken (an intake of one of the member's own supplements).
  "supplements:write",
] as const;

export type WriteScope = (typeof WRITE_SCOPES)[number];

/** Every scope a grant may hold today. */
export const GRANTABLE_SCOPES = [BASE_SCOPE, ...OPT_IN_SCOPES, ...WRITE_SCOPES] as const;

export type GrantableScope = (typeof GRANTABLE_SCOPES)[number];

/**
 * Names held back for later milestones so nothing else takes them: the rest of
 * the per-domain write scopes (M2b workouts, sleep, trackers and pain; M2c
 * food and lab drafts).
 */
export const RESERVED_SCOPES = [
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

export function isWriteScope(value: string): value is WriteScope {
  return (WRITE_SCOPES as readonly string[]).includes(value);
}

export function hasScope(scopes: readonly string[], scope: GrantableScope): boolean {
  return scopes.includes(scope);
}
