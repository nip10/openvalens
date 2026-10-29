/**
 * Issue #56 — where users get the source code (AGPL-3.0 section 13 and the
 * app-store permission in LICENSE-APP-STORE).
 *
 * The server reports its own `SOURCE_CODE_URL` (an operator running a modified
 * version points it at their fork); this constant is the upstream default and
 * the source the mobile app links to for its own code.
 */
export const UPSTREAM_SOURCE_CODE_URL = "https://github.com/nip10/openvalens";

export const SOURCE_LICENSE = "AGPL-3.0-or-later";

/**
 * Issue #306 — the source of the exact release an app build was made from:
 * `<upstream>/tree/v<version>`. Store builds come only from a release tag, so
 * the tag holds the Corresponding Source LICENSE-APP-STORE asks the app to
 * point to. A version that is not plain `MAJOR.MINOR.PATCH` (or no version at
 * all) gets the repository root instead.
 */
export function appSourceCodeUrl(version: string | null | undefined): string {
  const clean = version?.trim() ?? "";
  if (!/^\d+\.\d+\.\d+$/.test(clean)) return UPSTREAM_SOURCE_CODE_URL;
  return `${UPSTREAM_SOURCE_CODE_URL}/tree/v${clean}`;
}
