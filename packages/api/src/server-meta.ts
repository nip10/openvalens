import { z } from "zod";

/**
 * Issue #295 — the public server check behind `GET /.well-known/openvalens`.
 *
 * One store build of the mobile app connects to OpenValens Cloud or to any
 * self-hosted instance. Before it saves a server address it reads this
 * document to confirm the address is an OpenValens server, that the two speak
 * a compatible API, and which sign-in methods to show. It carries nothing
 * beyond what the server's login page already shows: no instance name, no
 * provider ids, no counts.
 */
export const SERVER_META_PATH = "/.well-known/openvalens";

/**
 * The client-facing API contract version. Bump it only for a change an older
 * app cannot follow; the app declares the range it supports
 * (`apps/native/lib/server/server-meta.ts`).
 */
export const SERVER_API_VERSION = 1;

/** This release; kept equal to the root `package.json` version (a test checks it). */
export const SERVER_VERSION = "0.9.0";

export const deploymentModes = ["self-hosted", "cloud"] as const;
export type DeploymentMode = (typeof deploymentModes)[number];

export const serverMetaSchema = z.object({
  product: z.literal("openvalens"),
  apiVersion: z.number().int().positive(),
  serverVersion: z.string().min(1).max(64),
  mode: z.enum(deploymentModes),
  signIn: z.object({
    magicLink: z.boolean(),
    oidc: z.boolean(),
    google: z.boolean(),
    apple: z.boolean(),
    signUp: z.boolean(),
  }),
});

export type ServerMeta = z.infer<typeof serverMetaSchema>;

/** Whether this instance is the Cloud, and whether it takes public sign-ups. */
export type DeploymentProfile = { mode: DeploymentMode; signUp: boolean };

export function buildServerMeta(input: {
  profile: DeploymentProfile;
  /** True when the operator configured the one OIDC provider. */
  oidc: boolean;
  /** Issue #296 — Google / Apple sign-in configured. */
  google?: boolean;
  apple?: boolean;
}): ServerMeta {
  return {
    product: "openvalens",
    apiVersion: SERVER_API_VERSION,
    serverVersion: SERVER_VERSION,
    mode: input.profile.mode,
    signIn: {
      // Magic-link sign-in is always registered (`@openvalens/auth`).
      magicLink: true,
      oidc: input.oidc,
      // Issue #296 — each only when its credentials are set.
      google: input.google === true,
      apple: input.apple === true,
      signUp: input.profile.signUp,
    },
  };
}
