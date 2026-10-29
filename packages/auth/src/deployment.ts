/**
 * Deployment mode (Issue #294).
 *
 * `DEPLOYMENT_MODE` decides whether this server is a self-hosted instance
 * (`self-hosted`, the default) or OpenValens Cloud (`cloud`). Self-host stays
 * invite-only: nothing Cloud-only (public sign-up, billing, and later usage
 * caps) is reachable unless the operator sets `cloud` explicitly.
 *
 * The server owns the environment (`apps/server/.env.schema`); this module is
 * pure — {@link parseDeploymentConfig} takes the raw env values and returns the
 * validated shape, and never reads `process.env`. Cloud mode refuses to start
 * without the configuration it depends on, so a half-configured Cloud never
 * serves a sign-up page that cannot record what the person agreed to.
 *
 * Validation errors name the missing or invalid *keys* only, never a value.
 */

export const DEPLOYMENT_MODES = ["self-hosted", "cloud"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/** One legal document a new Cloud account accepts at sign-up. */
export type LegalDocument = {
  /** Public page the sign-up form links to. */
  url: string;
  /** Operator-chosen version label recorded with every acceptance. */
  version: string;
};

export type DeploymentConfig =
  | { mode: "self-hosted" }
  | {
      mode: "cloud";
      /**
       * Terms of service and privacy policy (#300). Every public sign-up records
       * acceptance of exactly these versions, with a timestamp.
       */
      legal: { terms: LegalDocument; privacy: LegalDocument };
    };

/** Raw env input accepted by {@link parseDeploymentConfig}. */
export type DeploymentEnv = {
  DEPLOYMENT_MODE?: string;
  LEGAL_TERMS_URL?: string;
  LEGAL_TERMS_VERSION?: string;
  LEGAL_PRIVACY_URL?: string;
  LEGAL_PRIVACY_VERSION?: string;
  /** Cloud billing (#297); parsed in full by `@openvalens/billing`. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_ANNUAL?: string;
};

/**
 * Keys that must be set when `DEPLOYMENT_MODE=cloud`: the legal documents
 * every sign-up records (#294) and the Stripe billing keys (#297), so Cloud
 * refuses to start without everything it needs. The Stripe values' shape is
 * checked by `parseBillingConfig` in `@openvalens/billing`.
 */
export const CLOUD_REQUIRED_KEYS = [
  "LEGAL_TERMS_URL",
  "LEGAL_TERMS_VERSION",
  "LEGAL_PRIVACY_URL",
  "LEGAL_PRIVACY_VERSION",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_ANNUAL",
] as const satisfies readonly (keyof DeploymentEnv)[];

const VERSION_MAX_LENGTH = 64;

/**
 * Structured configuration error. The structured logger serializes `Error`
 * instances to `{ name, code? }`; the message names keys only, never values.
 */
export class DeploymentConfigError extends Error {
  readonly code = "DEPLOYMENT_CONFIG_INVALID";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`DEPLOYMENT_CONFIG_INVALID: ${issues.join("; ")}`);
    this.name = "DeploymentConfigError";
    this.issues = issues;
  }
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validates the deployment settings. Unset (or empty) `DEPLOYMENT_MODE` is
 * `self-hosted`, and in self-host the legal keys are ignored entirely. Throws
 * {@link DeploymentConfigError} for an unknown mode or an incomplete Cloud.
 */
export function parseDeploymentConfig(env: DeploymentEnv): DeploymentConfig {
  const rawMode = present(env.DEPLOYMENT_MODE) ? env.DEPLOYMENT_MODE.trim() : "self-hosted";
  if (rawMode === "self-hosted") return { mode: "self-hosted" };
  if (rawMode !== "cloud") {
    throw new DeploymentConfigError(["DEPLOYMENT_MODE must be `self-hosted` or `cloud`"]);
  }

  const issues: string[] = [];
  for (const key of CLOUD_REQUIRED_KEYS) {
    if (!present(env[key])) issues.push(`${key} is required when DEPLOYMENT_MODE=cloud`);
  }
  for (const key of ["LEGAL_TERMS_URL", "LEGAL_PRIVACY_URL"] as const) {
    const value = env[key];
    if (present(value) && !isHttpUrl(value.trim())) issues.push(`${key} must be an http(s) URL`);
  }
  for (const key of ["LEGAL_TERMS_VERSION", "LEGAL_PRIVACY_VERSION"] as const) {
    const value = env[key];
    if (present(value) && value.trim().length > VERSION_MAX_LENGTH) {
      issues.push(`${key} must be at most ${VERSION_MAX_LENGTH} characters`);
    }
  }
  if (issues.length > 0) throw new DeploymentConfigError(issues);

  return {
    mode: "cloud",
    legal: {
      terms: { url: env.LEGAL_TERMS_URL!.trim(), version: env.LEGAL_TERMS_VERSION!.trim() },
      privacy: { url: env.LEGAL_PRIVACY_URL!.trim(), version: env.LEGAL_PRIVACY_VERSION!.trim() },
    },
  };
}

/** What a client may learn about this deployment: no secret, no config value. */
export type DeploymentCapabilities = {
  mode: DeploymentMode;
  /** Whether anyone may create an account (`/signup`); only ever true in Cloud. */
  signUp: boolean;
};

/**
 * Public, value-free view of the deployment, for the capabilities endpoint
 * (`GET /.well-known/openvalens`, #295) and the web sign-in screens.
 */
export function deploymentCapabilities(config: DeploymentConfig): DeploymentCapabilities {
  return { mode: config.mode, signUp: config.mode === "cloud" };
}
