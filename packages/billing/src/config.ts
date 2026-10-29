/**
 * Billing configuration (Issue #297). Pure: takes the raw env values the
 * server owns and never reads `process.env`. Only parsed in Cloud
 * (`DEPLOYMENT_MODE=cloud`), where `CLOUD_REQUIRED_KEYS` in
 * `@openvalens/auth/deployment` already refuses to start without the keys;
 * this adds the shape checks. Errors name keys only, never a value.
 */

export type BillingEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_ANNUAL?: string;
  LEGAL_TERMS_URL?: string;
  LEGAL_CHECKOUT_ACK_VERSION?: string;
};

export type BillingPlan = "monthly" | "annual";
export const BILLING_PLANS: readonly BillingPlan[] = ["monthly", "annual"];

export type BillingConfig = {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly prices: Readonly<Record<BillingPlan, string>>;
  readonly termsUrl: string;
  readonly checkoutAcknowledgementVersion: string;
};

export class BillingConfigError extends Error {
  readonly code = "BILLING_CONFIG_INVALID";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`BILLING_CONFIG_INVALID: ${issues.join("; ")}`);
    this.name = "BillingConfigError";
    this.issues = issues;
  }
}

const SHAPES: { key: keyof BillingEnv; prefixes: readonly string[] }[] = [
  // A restricted key (`rk_`) is the recommended choice; a full secret key works too.
  { key: "STRIPE_SECRET_KEY", prefixes: ["sk_", "rk_"] },
  { key: "STRIPE_WEBHOOK_SECRET", prefixes: ["whsec_"] },
  { key: "STRIPE_PRICE_MONTHLY", prefixes: ["price_"] },
  { key: "STRIPE_PRICE_ANNUAL", prefixes: ["price_"] },
];

export function parseBillingConfig(env: BillingEnv): BillingConfig {
  const issues: string[] = [];
  const values: Partial<Record<keyof BillingEnv, string>> = {};
  for (const { key, prefixes } of SHAPES) {
    const value = env[key]?.trim();
    if (!value) {
      issues.push(`${key} is required when DEPLOYMENT_MODE=cloud`);
      continue;
    }
    if (!prefixes.some((prefix) => value.startsWith(prefix))) {
      issues.push(`${key} must start with ${prefixes.map((p) => `\`${p}\``).join(" or ")}`);
      continue;
    }
    values[key] = value;
  }
  if (values.STRIPE_PRICE_MONTHLY && values.STRIPE_PRICE_MONTHLY === values.STRIPE_PRICE_ANNUAL) {
    issues.push("STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL must be different prices");
  }
  const termsUrl = env.LEGAL_TERMS_URL?.trim();
  if (!termsUrl || !/^https:\/\//i.test(termsUrl))
    issues.push("LEGAL_TERMS_URL must be an https URL");
  const acknowledgementVersion = env.LEGAL_CHECKOUT_ACK_VERSION?.trim();
  if (!acknowledgementVersion) issues.push("LEGAL_CHECKOUT_ACK_VERSION is required when DEPLOYMENT_MODE=cloud");
  else if (acknowledgementVersion.length > 64) issues.push("LEGAL_CHECKOUT_ACK_VERSION must be at most 64 characters");
  if (issues.length > 0) throw new BillingConfigError(issues);
  return Object.freeze({
    secretKey: values.STRIPE_SECRET_KEY!,
    webhookSecret: values.STRIPE_WEBHOOK_SECRET!,
    prices: Object.freeze({
      monthly: values.STRIPE_PRICE_MONTHLY!,
      annual: values.STRIPE_PRICE_ANNUAL!,
    }),
    termsUrl: termsUrl!,
    checkoutAcknowledgementVersion: acknowledgementVersion!,
  });
}

/** The plan a Stripe price id belongs to, or `null` for an unknown price. */
export function planForPrice(
  prices: Readonly<Record<BillingPlan, string>>,
  priceId: string | null,
): BillingPlan | null {
  if (!priceId) return null;
  if (priceId === prices.monthly) return "monthly";
  if (priceId === prices.annual) return "annual";
  return null;
}
