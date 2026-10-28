import {
  buildServerMeta,
  SERVER_META_PATH,
  type DeploymentProfile,
} from "@openvalens/api/server-meta";
import type { Hono } from "hono";

/**
 * Cloud or self-hosted, and whether this instance takes public sign-ups. Every
 * instance is self-hosted and invite-only until the Cloud mode exists.
 */
export function deploymentProfile(): DeploymentProfile {
  // #294 wires DEPLOYMENT_MODE here
  return { mode: "self-hosted", signUp: false };
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
    signInOptions: { readonly oidc: object | null };
    profile?: () => DeploymentProfile;
  },
): void {
  const meta = buildServerMeta({
    profile: (options.profile ?? deploymentProfile)(),
    oidc: options.signInOptions.oidc !== null,
  });
  app.get(SERVER_META_PATH, (c) =>
    c.json(meta, 200, {
      // Short-lived, so new sign-in settings show up a minute after a restart.
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    }),
  );
}
