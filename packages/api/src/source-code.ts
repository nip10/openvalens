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
