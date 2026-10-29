/**
 * Public surface of Sign in with Google and Apple (Issue #296): pure config
 * parsing, the value-free sign-in flags, token revocation on account deletion,
 * and the Better Auth wiring used by `createAuth`. The provider specifics live
 * in `../providers/google.ts` and `../providers/apple.ts`.
 */
export {
  APPLE_REQUIRED_KEYS,
  GOOGLE_REQUIRED_KEYS,
  normalizePrivateKeyPem,
  parseSocialSignInConfig,
  SocialSignInConfigError,
  socialSignInOptions,
} from "./config";
export type {
  AppleSignInConfig,
  GoogleSignInConfig,
  SocialSignInConfig,
  SocialSignInEnv,
  SocialSignInOptions,
} from "./config";
export {
  APPLE_NATIVE_TOKEN_PATH,
  isSocialProviderId,
  linkEmailAllowed,
  NATIVE_NONCE_PATH,
  SIGN_UP_CONTEXT_KEY,
  SOCIAL_PROVIDER_IDS,
} from "./sign-in";
export type { SocialProviderId } from "./sign-in";
export { betterAuthTokenDecrypter, createSocialTokenRevocation } from "./revocation";
export type { PendingRevocation, SocialTokenRevocation } from "./revocation";
