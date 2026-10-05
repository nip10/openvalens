type ProductionSecrets = {
  NODE_ENV: string;
  BETTER_AUTH_SECRET: string;
  CRON_SECRET: string;
};

const PLACEHOLDER_TOKENS = new Set([
  "changeme",
  "changeit",
  "password",
  "secret",
  "replaceme",
  "yoursecret",
  "yourauthsecret",
  "yourcronsecret",
  "example",
  "testsecret",
  "developmentsecret",
  "defaultsecret",
]);

function normalizeForMatching(secret: string): string {
  return secret.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isObviousPlaceholder(secret: string): boolean {
  const normalized = normalizeForMatching(secret);
  return (
    normalized.length === 0 ||
    /^(.)\1+$/.test(normalized) ||
    [...PLACEHOLDER_TOKENS].some(
      (token) =>
        normalized.length % token.length === 0 &&
        token.repeat(normalized.length / token.length) === normalized,
    )
  );
}

/** Rejects only a bounded list of obvious placeholder secrets in production. */
export function validateProductionSecrets(env: ProductionSecrets): void {
  if (env.NODE_ENV !== "production") return;

  const invalidKeys = (["BETTER_AUTH_SECRET", "CRON_SECRET"] as const).filter((key) =>
    isObviousPlaceholder(env[key]),
  );

  if (invalidKeys.length > 0) {
    throw new Error(
      `Production secrets must not be obvious placeholders: ${invalidKeys.join(", ")}`,
    );
  }
}
