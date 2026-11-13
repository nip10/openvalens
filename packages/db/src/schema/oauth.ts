import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { session, user } from "./auth";

// ─── OAuth 2.1 for connected AI apps (Issue #439, M1b) ──────────
//
// The tables `@better-auth/oauth-provider` (through `@better-auth/mcp` and
// `@better-auth/cimd`) reads and writes when the MCP server is on. Better Auth
// owns their rows; property names follow its model fields, which the Drizzle
// adapter maps by key. Exported from `./auth`'s adapter schema in
// `@openvalens/auth`.
//
// Every OAuth connection a member approves is also an `ai_app_grant` of kind
// `oauth`: the consent row, each access token and each refresh token carry
// that grant's id in `reference_id`, so scopes, workspace, the AI-app consent
// (`mcp-v1`), revoke, usage, rate limits and the workspace switch apply exactly
// as they do for personal keys. Tokens are opaque and stored as SHA-256
// digests only.
//
// A client is an AI app (Claude, ChatGPT, Cursor), not a person: a CIMD client
// is keyed by its metadata-document URL and shared by every member who
// connects it; a dynamically registered client that never completes a grant is
// deleted after 24 hours. Tokens, refresh tokens and consents go with their
// client, their user and (for the token pair) each other.

/** A registered or discovered OAuth client (an AI app). */
export const oauthClient = pgTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    /** Encrypted at rest by Better Auth; `null` for public (PKCE) clients. */
    clientSecret: text("client_secret"),
    /** `cimd` for a Client ID Metadata Document client; `null` for DCR. */
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    oauthClientClientIdUnique: uniqueIndex("oauth_client_client_id_key").on(table.clientId),
    oauthClientUserIdx: index("oauth_client_user_id_idx").on(table.userId),
    oauthClientCreatedIdx: index("oauth_client_created_at_idx").on(table.createdAt),
  }),
);

/** A protected resource tokens are issued for: the MCP endpoint (RFC 8707). */
export const oauthResource = pgTable(
  "oauth_resource",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    name: text("name").notNull(),
    accessTokenTtl: integer("access_token_ttl"),
    refreshTokenTtl: integer("refresh_token_ttl"),
    signingAlgorithm: text("signing_algorithm"),
    signingKeyId: text("signing_key_id"),
    allowedScopes: text("allowed_scopes").array(),
    customClaims: jsonb("custom_claims"),
    dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
    disabled: boolean("disabled").default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
    policyVersion: integer("policy_version").default(1),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    oauthResourceIdentifierUnique: uniqueIndex("oauth_resource_identifier_key").on(
      table.identifier,
    ),
  }),
);

/** Which clients may request which resources (`enforcePerClientResources`). */
export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    oauthClientResourceClientIdx: index("oauth_client_resource_client_id_idx").on(table.clientId),
    oauthClientResourceResourceIdx: index("oauth_client_resource_resource_id_idx").on(
      table.resourceId,
    ),
    oauthClientResourcePairUnique: uniqueIndex(
      "oauth_client_resource_client_id_resource_id_key",
    ).on(table.clientId, table.resourceId),
  }),
);

/**
 * A rotating refresh token (SHA-256 digest). A rotated one keeps `revoked`
 * and `rotated_at`; presenting it again is a replay and revokes the grant.
 */
export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The `ai_app_grant` this token belongs to. */
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    revoked: timestamp("revoked", { withTimezone: true, mode: "date" }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true, mode: "date" }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    authTime: timestamp("auth_time", { withTimezone: true, mode: "date" }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => ({
    oauthRefreshTokenTokenUnique: uniqueIndex("oauth_refresh_token_token_key").on(table.token),
    oauthRefreshTokenClientIdx: index("oauth_refresh_token_client_id_idx").on(table.clientId),
    oauthRefreshTokenSessionIdx: index("oauth_refresh_token_session_id_idx").on(table.sessionId),
    oauthRefreshTokenUserIdx: index("oauth_refresh_token_user_id_idx").on(table.userId),
    oauthRefreshTokenReferenceIdx: index("oauth_refresh_token_reference_id_idx").on(
      table.referenceId,
    ),
    oauthRefreshTokenCodeIdx: index("oauth_refresh_token_authorization_code_id_idx").on(
      table.authorizationCodeId,
    ),
  }),
);

/** An opaque access token (SHA-256 digest), audience-bound to the MCP resource. */
export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token"),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** The `ai_app_grant` this token belongs to. */
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    /** RFC 8707 resources the token was issued for. */
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    revoked: timestamp("revoked", { withTimezone: true, mode: "date" }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => ({
    oauthAccessTokenTokenUnique: uniqueIndex("oauth_access_token_token_key").on(table.token),
    oauthAccessTokenClientIdx: index("oauth_access_token_client_id_idx").on(table.clientId),
    oauthAccessTokenSessionIdx: index("oauth_access_token_session_id_idx").on(table.sessionId),
    oauthAccessTokenUserIdx: index("oauth_access_token_user_id_idx").on(table.userId),
    oauthAccessTokenReferenceIdx: index("oauth_access_token_reference_id_idx").on(
      table.referenceId,
    ),
    oauthAccessTokenCodeIdx: index("oauth_access_token_authorization_code_id_idx").on(
      table.authorizationCodeId,
    ),
    oauthAccessTokenRefreshIdx: index("oauth_access_token_refresh_id_idx").on(table.refreshId),
  }),
);

/** The member's approval of one client, pointing at its `ai_app_grant`. */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** The `ai_app_grant` id. */
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    oauthConsentClientIdx: index("oauth_consent_client_id_idx").on(table.clientId),
    oauthConsentUserIdx: index("oauth_consent_user_id_idx").on(table.userId),
    oauthConsentReferenceIdx: index("oauth_consent_reference_id_idx").on(table.referenceId),
  }),
);

/** Single-use `private_key_jwt` assertion ids (replay tombstones). */
export const oauthClientAssertion = pgTable(
  "oauth_client_assertion",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => ({
    oauthClientAssertionExpiresIdx: index("oauth_client_assertion_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);
