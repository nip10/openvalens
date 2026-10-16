/**
 * Generic OIDC sign-in configuration (Issue #65).
 *
 * The server owns the environment (`apps/server/.env.schema`); this module is
 * deliberately pure — {@link parseOidcConfig} takes the raw env object and
 * returns the validated shape, and never reads `process.env`. At most one
 * generic OpenID Connect provider is supported. It is `off` by default and the
 * server boots without it: local magic-link accounts always keep working.
 *
 * OIDC never creates accounts and never links an identity by email. See
 * `docs/self-hosting/oidc.md` for the admission model.
 *
 * Validation errors never include a configured *value* (the client secret in
 * particular); only the variable name and the reason.
 */

import type { IntegrationStatus } from "@openvalens/config/integrations";

/** Env keys that must all be set for OIDC to be enabled. */
export const OIDC_REQUIRED_KEYS = [
  "OIDC_PROVIDER_ID",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_DISCOVERY_URL",
] as const;

/**
 * Provider ids that would shadow a Better Auth endpoint segment or an
 * account-provider id the instance already uses.
 */
const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "credential",
  "email",
  "email-password",
  "magic-link",
  "anonymous",
]);

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DISPLAY_NAME_MAX_LENGTH = 40;

/** Enabled OIDC provider settings. `clientSecret` is a credential. */
export type OidcProviderConfig = {
  /** Stable id used in callback URLs (`/api/auth/callback/<id>`) and account rows. */
  providerId: string;
  clientId: string;
  clientSecret: string;
  /** Full OpenID discovery document URL (`…/.well-known/openid-configuration`). */
  discoveryUrl: string;
  /** Button label: "Continue with <displayName>". */
  displayName: string;
};

export type OidcConfig = {
  /** `null` when OIDC is off (no OIDC env, or an incomplete set). */
  provider: OidcProviderConfig | null;
  /**
   * Names of required keys that are missing when *some but not all* OIDC keys
   * are set. Empty when OIDC is fully configured or entirely unset. Lets the
   * server log a value-free warning instead of failing the boot.
   */
  missingKeys: readonly string[];
};

/** Raw env input accepted by {@link parseOidcConfig}. */
export type OidcEnv = Record<string, string | number | boolean | undefined>;

/**
 * Structured configuration error. The structured logger serializes `Error`
 * instances to `{ name, code? }`, so the message is never emitted.
 */
export class OidcConfigError extends Error {
  readonly code = "OIDC_CONFIG_INVALID";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`OIDC_CONFIG_INVALID: ${issues.join("; ")}`);
    this.name = "OidcConfigError";
    this.issues = issues;
  }
}

function readString(env: OidcEnv, name: string): string | null {
  const value = env[name];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * The discovery URL must be `https`, except on a loopback host (local mock
 * issuers and development IdPs). It must not embed credentials or a fragment.
 */
function discoveryUrlIssue(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "OIDC_DISCOVERY_URL must be an absolute URL";
  }
  if (url.username || url.password) {
    return "OIDC_DISCOVERY_URL must not embed credentials";
  }
  if (url.hash) {
    return "OIDC_DISCOVERY_URL must not contain a fragment";
  }
  if (url.protocol === "https:") {
    return null;
  }
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    return null;
  }
  return "OIDC_DISCOVERY_URL must use https (http is allowed only for localhost)";
}

/**
 * Validates raw env into {@link OidcConfig}.
 *
 * - With none of {@link OIDC_REQUIRED_KEYS} set, OIDC is off.
 * - With only some set, OIDC is off and `missingKeys` names the rest; this is
 *   never a boot failure.
 * - With all set, each value is validated. `OIDC_DISPLAY_NAME` is optional and
 *   defaults to "Single sign-on".
 *
 * @throws {OidcConfigError} with code `OIDC_CONFIG_INVALID` when a set value is
 *   malformed (bad provider id or discovery URL, overlong display name).
 */
export function parseOidcConfig(env: OidcEnv): OidcConfig {
  const values = Object.fromEntries(
    OIDC_REQUIRED_KEYS.map((key) => [key, readString(env, key)]),
  ) as Record<(typeof OIDC_REQUIRED_KEYS)[number], string | null>;
  const missingKeys = OIDC_REQUIRED_KEYS.filter((key) => values[key] === null);

  if (missingKeys.length === OIDC_REQUIRED_KEYS.length) {
    return { provider: null, missingKeys: [] };
  }
  if (missingKeys.length > 0) {
    return { provider: null, missingKeys };
  }

  const providerId = values.OIDC_PROVIDER_ID!;
  const clientId = values.OIDC_CLIENT_ID!;
  const clientSecret = values.OIDC_CLIENT_SECRET!;
  const discoveryUrl = values.OIDC_DISCOVERY_URL!;
  const displayName = readString(env, "OIDC_DISPLAY_NAME") ?? "Single sign-on";

  const issues: string[] = [];
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    issues.push(
      "OIDC_PROVIDER_ID must be 1-32 lowercase letters, digits or hyphens, starting with a letter or digit",
    );
  } else if (RESERVED_PROVIDER_IDS.has(providerId)) {
    issues.push("OIDC_PROVIDER_ID is reserved; choose another id");
  }
  const urlIssue = discoveryUrlIssue(discoveryUrl);
  if (urlIssue) {
    issues.push(urlIssue);
  }
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    issues.push(`OIDC_DISPLAY_NAME must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`);
  }

  if (issues.length > 0) {
    throw new OidcConfigError(issues);
  }

  return {
    provider: { providerId, clientId, clientSecret, discoveryUrl, displayName },
    missingKeys: [],
  };
}

/**
 * Issue #57 / #65 — value-free readiness status of the `oidc` family. There is
 * one generic adapter; the status never carries the provider id, client id,
 * issuer or any URL.
 */
export function describeOidcIntegration(config: OidcConfig): IntegrationStatus<"generic"> {
  return config.provider === null
    ? { provider: null, state: "off" }
    : { provider: "generic", state: "configured" };
}

/**
 * Public, value-free sign-in option the web and mobile clients render as a
 * "Continue with <displayName>" button. `null` when OIDC is off.
 */
export type OidcSignInOption = { providerId: string; displayName: string } | null;

export function oidcSignInOption(config: OidcConfig): OidcSignInOption {
  return config.provider === null
    ? null
    : { providerId: config.provider.providerId, displayName: config.provider.displayName };
}
