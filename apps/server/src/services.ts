import { createAuth, setRegisteredAuth } from "@openhealth/auth";
import { createDb } from "@openhealth/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);

/**
 * Readiness capability flags (Issue #11).
 *
 * `mobilePairing` is always available in this platform layer; the integration
 * flags are `true` only when the optional provider env var is present. These
 * provider env vars are not part of `.env.schema` yet (they arrive with the
 * integration issues), so they are read from `process.env` rather than the
 * validated `ENV` proxy to avoid introducing new required config.
 */
export const capabilities = {
  telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  resend: Boolean(process.env.RESEND_API_KEY),
  mobilePairing: true,
};

// Register the auth singleton so the guards in `@openhealth/auth/authz/*`
// can resolve the active Better Auth instance without it being threaded
// through every call site.
setRegisteredAuth(auth);
