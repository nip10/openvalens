/**
 * Public surface of the `oidc` integration family (Issue #65): pure config
 * parsing, the value-free readiness status and the public sign-in option. The
 * Better Auth adapter lives in `../providers/generic-oidc.ts` and is wired by
 * `createAuth`.
 */
export {
  describeOidcIntegration,
  OIDC_REQUIRED_KEYS,
  OidcConfigError,
  oidcSignInOption,
  parseOidcConfig,
} from "./config";
export type { OidcConfig, OidcEnv, OidcProviderConfig, OidcSignInOption } from "./config";
