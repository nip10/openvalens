/**
 * Sign in with Google and Apple — configuration (Issue #296).
 *
 * The server owns the environment (`apps/server/.env.schema`); this module is
 * pure — {@link parseSocialSignInConfig} takes the raw env values and returns
 * the validated shape, and never reads `process.env`. Each provider is `off`
 * until every one of its required keys is set. A half-configured provider
 * stays off and the server boots anyway: the caller logs the missing key
 * *names* (never a value), exactly like OIDC (#65).
 *
 * Validation errors name keys only, never a configured value (the Google
 * client secret and the Apple private key are credentials).
 */

import { createPrivateKey } from "node:crypto";

/** Env keys that must all be set for Google sign-in. */
export const GOOGLE_REQUIRED_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;

/** Env keys that must all be set for Sign in with Apple. */
export const APPLE_REQUIRED_KEYS = [
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
] as const;

export type GoogleSignInConfig = {
  /** OAuth web client id (`….apps.googleusercontent.com`). */
  clientId: string;
  /** OAuth web client secret. A credential. */
  clientSecret: string;
};

export type AppleSignInConfig = {
  /** The Services ID used by the web redirect flow, e.g. `com.example.signin`. */
  clientId: string;
  /** Apple Developer Team ID (10 characters). */
  teamId: string;
  /** Key ID of the Sign in with Apple private key (10 characters). */
  keyId: string;
  /** PKCS#8 PEM of the `.p8` key. A credential; used to sign the client secret JWT. */
  privateKey: string;
  /**
   * The iOS app's bundle ID. When set, the native app may sign in with the
   * id token from the system sheet (its audience is the bundle ID). `null`
   * keeps Apple web-only.
   */
  appBundleId: string | null;
};

export type SocialSignInConfig = {
  google: GoogleSignInConfig | null;
  apple: AppleSignInConfig | null;
  /**
   * Names of required keys missing when *some but not all* of a provider's
   * keys are set. Empty when a provider is fully configured or entirely unset.
   */
  missingKeys: readonly string[];
};

export type SocialSignInEnv = Record<string, string | number | boolean | undefined>;

/** Structured configuration error; the message names keys only. */
export class SocialSignInConfigError extends Error {
  readonly code = "SOCIAL_SIGN_IN_CONFIG_INVALID";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`SOCIAL_SIGN_IN_CONFIG_INVALID: ${issues.join("; ")}`);
    this.name = "SocialSignInConfigError";
    this.issues = issues;
  }
}

function readString(env: SocialSignInEnv, name: string): string | null {
  const value = env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/;
/** Reverse-DNS identifier: a Services ID or a bundle ID. */
const REVERSE_DNS_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const GOOGLE_CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;

/**
 * Env files and secret managers often carry a PEM on one line with literal
 * `\n` escapes. Accept both shapes; the key itself is validated by parsing it.
 */
export function normalizePrivateKeyPem(raw: string): string {
  const unescaped = raw.includes("\\n") ? raw.replaceAll("\\n", "\n") : raw;
  return `${unescaped.trim()}\n`;
}

function isEcP256PrivateKey(pem: string): boolean {
  try {
    const key = createPrivateKey({ key: pem, format: "pem" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

function collect<K extends string>(env: SocialSignInEnv, keys: readonly K[]) {
  const values = Object.fromEntries(keys.map((key) => [key, readString(env, key)])) as Record<
    K,
    string | null
  >;
  const missing = keys.filter((key) => values[key] === null);
  return { values, missing, unset: missing.length === keys.length };
}

/**
 * Validates raw env into {@link SocialSignInConfig}.
 *
 * - A provider with none of its required keys set is off.
 * - A provider with only some set is off and `missingKeys` names the rest.
 * - A provider with all set has each value validated; a malformed value
 *   throws {@link SocialSignInConfigError} (a boot failure, like a bad OIDC
 *   discovery URL), so a typo never silently disables sign-in.
 *
 * `APPLE_APP_BUNDLE_ID` is optional and only read when Apple is configured.
 */
export function parseSocialSignInConfig(env: SocialSignInEnv): SocialSignInConfig {
  const issues: string[] = [];
  const missingKeys: string[] = [];

  let google: GoogleSignInConfig | null = null;
  const g = collect(env, GOOGLE_REQUIRED_KEYS);
  if (!g.unset && g.missing.length > 0) missingKeys.push(...g.missing);
  if (g.missing.length === 0) {
    const clientId = g.values.GOOGLE_CLIENT_ID!;
    if (!GOOGLE_CLIENT_ID_PATTERN.test(clientId)) {
      issues.push(
        "GOOGLE_CLIENT_ID must be an OAuth client id ending in .apps.googleusercontent.com",
      );
    }
    google = { clientId, clientSecret: g.values.GOOGLE_CLIENT_SECRET! };
  }

  let apple: AppleSignInConfig | null = null;
  const a = collect(env, APPLE_REQUIRED_KEYS);
  if (!a.unset && a.missing.length > 0) missingKeys.push(...a.missing);
  if (a.missing.length === 0) {
    const clientId = a.values.APPLE_CLIENT_ID!;
    const teamId = a.values.APPLE_TEAM_ID!;
    const keyId = a.values.APPLE_KEY_ID!;
    const privateKey = normalizePrivateKeyPem(a.values.APPLE_PRIVATE_KEY!);
    const appBundleId = readString(env, "APPLE_APP_BUNDLE_ID");
    if (!REVERSE_DNS_PATTERN.test(clientId)) {
      issues.push("APPLE_CLIENT_ID must be a Services ID such as com.example.signin");
    }
    if (!APPLE_ID_PATTERN.test(teamId)) {
      issues.push("APPLE_TEAM_ID must be 10 uppercase letters or digits");
    }
    if (!APPLE_ID_PATTERN.test(keyId)) {
      issues.push("APPLE_KEY_ID must be 10 uppercase letters or digits");
    }
    if (!isEcP256PrivateKey(privateKey)) {
      issues.push("APPLE_PRIVATE_KEY must be the PEM contents of the .p8 Sign in with Apple key");
    }
    if (appBundleId !== null && !REVERSE_DNS_PATTERN.test(appBundleId)) {
      issues.push("APPLE_APP_BUNDLE_ID must be a bundle ID such as com.example.app");
    }
    if (appBundleId !== null && appBundleId === clientId) {
      issues.push("APPLE_APP_BUNDLE_ID must differ from APPLE_CLIENT_ID (the Services ID)");
    }
    apple = { clientId, teamId, keyId, privateKey, appBundleId };
  }

  if (issues.length > 0) throw new SocialSignInConfigError(issues);
  return { google, apple, missingKeys };
}

/** Public, value-free flags for the sign-in screens and `/.well-known/openvalens`. */
export type SocialSignInOptions = {
  google: boolean;
  apple: boolean;
  /** The iOS app can use the native Apple sheet (a bundle ID is configured). */
  appleNative: boolean;
};

export function socialSignInOptions(config: SocialSignInConfig): SocialSignInOptions {
  return {
    google: config.google !== null,
    apple: config.apple !== null,
    appleNative: config.apple?.appBundleId != null,
  };
}
