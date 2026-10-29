import {
  buildServerMeta,
  SERVER_META_PATH,
  type DeploymentProfile,
} from "@openvalens/api/server-meta";
import { deploymentCapabilities, type DeploymentConfig } from "@openvalens/auth/deployment";
import type { Hono } from "hono";

/**
 * Cloud or self-hosted, and whether this instance takes public sign-ups
 * (Issue #294). Derived from the validated `DEPLOYMENT_MODE` config the server
 * parsed at boot; with none given it is self-hosted and invite-only.
 */
export function deploymentProfile(
  config: DeploymentConfig = { mode: "self-hosted" },
): DeploymentProfile {
  return deploymentCapabilities(config);
}

/**
 * Issue #295 — public, unauthenticated `GET /.well-known/openvalens`. The
 * mobile app reads it before saving a server address: product, API version,
 * Cloud or self-hosted, and the sign-in methods to show. The body is built
 * once; it holds nothing that changes without a restart.
 */
export function registerServerMetaRoute(
  app: Hono,
  options: {
    signInOptions: {
      readonly oidc: object | null;
      readonly google?: boolean;
      readonly apple?: boolean;
    };
    profile?: () => DeploymentProfile;
  },
): void {
  const meta = buildServerMeta({
    profile: (options.profile ?? deploymentProfile)(),
    oidc: options.signInOptions.oidc !== null,
    google: options.signInOptions.google === true,
    apple: options.signInOptions.apple === true,
  });
  app.get(SERVER_META_PATH, (c) =>
    c.json(meta, 200, {
      // Short-lived, so new sign-in settings show up a minute after a restart.
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    }),
  );
}
