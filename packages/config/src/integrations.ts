/**
 * Integration adapter contract (Issue #57).
 *
 * OpenValens talks to a deliberately narrow set of external services. Each
 * *family* (email, AI, messaging, and later object storage, OIDC sign-in and
 * wearables) owns one small interface in the package that owns its domain —
 * there is no generic plugin framework, registry or dynamic loading. What the
 * families share is only this vocabulary, so the server can report every
 * family's state on the readiness probe the same way.
 *
 * Rules every adapter follows (see `docs/integrations.md`):
 *
 * - **Off by default, no vendor account needed.** With no provider env set the
 *   family reports `off` (or `dry-run` where a safe local fallback exists) and
 *   the server still boots.
 * - **Selected by env, bound by the server.** The server parses its validated
 *   varlock `ENV` with the family's pure `parse*Config` and builds the adapter;
 *   packages never read `process.env`. Switching provider is an env change and
 *   a restart, never a code change.
 * - **Vendor SDKs stay inside adapter modules.** `.oxlintrc.json` restricts
 *   vendor SDK imports to `packages/<family>/src/providers/*`.
 * - **Value-free status.** A status names the provider and its state only —
 *   never a key, URL, account id or any user data.
 *
 * Families depend on this module with a type-only import (`import type`), so
 * there is no runtime coupling between families or on this package.
 */

/**
 * Lifecycle state of one integration family, as reported by readiness:
 *
 * - `configured` — a provider is selected and its credentials are present; the
 *   family makes real provider calls.
 * - `dry-run` — the family accepts work but never reaches a provider (for
 *   example email without a Resend key: sends are logged, not delivered).
 * - `off` — the family is disabled; callers fail closed or skip.
 */
export const INTEGRATION_STATES = ["configured", "dry-run", "off"] as const;

export type IntegrationState = (typeof INTEGRATION_STATES)[number];

/**
 * Value-free status of one integration family.
 *
 * `provider` is the selected adapter's stable lowercase id (`"resend"`,
 * `"anthropic"`, `"telegram"`), or `null` when the family is `off` and no
 * provider is selected. It is an identifier, never a credential or endpoint.
 */
export type IntegrationStatus<Provider extends string = string> = {
  readonly provider: Provider | null;
  readonly state: IntegrationState;
};

/**
 * Every family's status, keyed by family name (`email`, `ai`, `messaging`, …).
 * The server composes it once at startup from the parsed configs.
 */
export type IntegrationStatuses = Readonly<Record<string, IntegrationStatus>>;
