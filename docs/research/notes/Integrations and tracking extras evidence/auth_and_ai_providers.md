# External login (OIDC) and multi-provider AI for openhealth — evidence notes

Research date: 2026-10-02. All web pages were fetched on that date unless noted. Vendor docs change often, so re-check anything marked "verify before release".

## Q1. Better Auth generic OIDC support: genericOAuth vs SSO plugin, discovery, PKCE, Expo native sign-in

### Takeaway

Better Auth's `genericOAuth` plugin covers the v1 decision of one env-configured OIDC provider. It needs only `providerId`, `clientId`/`clientSecret` and a `discoveryUrl`. PKCE is on by default, ID tokens are verified via `jwks_uri`, and `disableSignUp`/`disableImplicitSignUp` are available to enforce invite-only registration. The `@better-auth/sso` plugin is the heavier choice. It is built for runtime, DB-registered, per-organization OIDC/SAML and is more than v1 needs. Expo native sign-in uses the system browser via `expo-web-browser`, then a deep link back to the app scheme, which must be listed in `trustedOrigins`.

### Cited Findings

- genericOAuth needs `providerId`, `clientId`, and either `discoveryUrl` or explicit `authorizationUrl`/`tokenUrl`/`userInfoUrl`. `discoveryUrl` fetches the OIDC configuration, and when the configuration includes a `jwks_uri` "the plugin verifies ID tokens before trusting claims." — [Better Auth: Generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth)
- `pkce` defaults to `true` ("required by OAuth 2.1"). Disable it only if a provider rejects it. — [Better Auth: Generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth)
- `disableSignUp` means "only existing users can authenticate". `disableImplicitSignUp` turns off automatic account creation during sign-in, so sign-up has to be requested explicitly. `overrideUserInfo` (default `false`) re-syncs the profile on every sign-in. `mapProfileToUser` maps claims onto user fields but "cannot set account identity". A `user.validateUserInfo` callback can reject OAuth users before account creation or sign-in. — [Better Auth: Generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth)
- The SSO plugin (`@better-auth/sso`) supports OIDC, OAuth2 and SAML 2.0. Providers can be registered at runtime with `registerSSOProvider` (stored in the DB) or statically with `defaultSSO`. It runs OIDC discovery at registration time, offers domain verification (a verified domain enables automatic linking), and provides organization provisioning with a `getRole` callback and `provisionUser`/`provisionUserOnEveryLogin`. The docs position genericOAuth for "simpler" integrations and SSO for enterprise/multi-tenant use. The SSO plugin "does not follow redirects for server-side OIDC requests", so configure canonical URLs. — [Better Auth: SSO](https://www.better-auth.com/docs/plugins/sso)
- Expo flow: the app sets `scheme` in `app.json`, and the server adds `"myapp://"` to `trustedOrigins`. In development, `exp://` wildcards such as `"exp://**"` work. A relative `callbackURL` is converted to a deep link, the browser is opened with `expo-web-browser`, and cookies are kept in `expo-secure-store` through `expoClient`. "On native platforms, social sign-in doesn't auto-navigate; you must handle navigation manually." — [Better Auth: Expo integration](https://www.better-auth.com/docs/integrations/expo)
- Comparable prior art: Immich mobile uses the custom-scheme redirect `app.immich:///oauth-callback`. For IdPs that reject custom schemes, it also ships an HTTPS "mobile redirect override" route (`/api/oauth/mobile-redirect`) that forwards to the scheme. — [Immich OAuth docs](https://docs.immich.app/administration/oauth/)

### Inferences

- For a self-hosted app with one provider defined in env, use `genericOAuth` with a single entry built from env (`OIDC_ISSUER`/`OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, an optional display name). This matches the "no YAML config" decision. The SSO plugin's DB-registered providers would bring in an admin UI and per-org provider state that v1 does not need.
- The self-hoster's IdP (Authelia, Authentik, Keycloak, Pocket ID and similar) has to allow the server callback URL. With Better Auth's Expo flow, the IdP redirects to the server's callback, not to the app scheme. The server then redirects to the `trustedOrigins` deep link. That should avoid Immich's "IdP rejects custom scheme" problem, but this has not been verified for genericOAuth specifically (see Gaps).
- Ticket #65 should require ID-token verification (discovery with `jwks_uri`) and leave PKCE at its default.

### Gaps

- No Better Auth doc confirms that `authClient.signIn.oauth2(...)` (the genericOAuth client method) gets the same automatic deep-link conversion in Expo as `signIn.social`. The Expo page shows only `signIn.social`. Verify with a spike.
- I did not confirm whether genericOAuth checks `iss` (RFC 9207 / the `requireIssuerValidation` option the brief mentioned). The fetched doc did not mention it.

## Q2. Account-linking risks (email-based linking, email_verified, nOAuth) and Better Auth accountLinking options

### Takeaway

Linking by email is the main account-takeover vector. Two rules make it safer: key OIDC identities on `iss`+`sub`, never on email, and only link implicitly when the IdP asserts `email_verified: true` and the local account's email is also verified. Better Auth versions before 1.6.11 did not check the local side. Several 2026 Better Auth advisories (OAuth implicit linking, magic-link pre-account hijacking) mean v1 must pin a patched version. For openhealth, the safest v1 setting is `disableImplicitLinking: true`, or no `trustedProviders`, combined with explicit "link OIDC" from a signed-in session.

### Cited Findings

- Better Auth `accountLinking` options include `enabled` (default true), `trustedProviders` ("Use this with caution as it may increase the risk of account takeover"), `allowDifferentEmails`, `updateUserInfoOnLink` (email and verification status never change), `allowUnlinkingAll`, and `disableImplicitLinking`. With `disableImplicitLinking`, a same-email OAuth sign-in returns `account_not_linked`. By default, implicit linking requires a provider-verified email or a trusted provider. Signed-in users can always link manually with `linkSocial()`. — [Better Auth: Users & Accounts](https://www.better-auth.com/docs/concepts/users-accounts)
- GHSA-g38m-r43w-p2q7 / CVE-2026-53516 ("pre-account hijacking via OAuth implicit linking (nOAuth-class)"), published 2026-05-31, high severity, affects better-auth < 1.6.11. Before the fix, implicit linking was allowed whenever the provider asserted `email_verified: true`, even if the local user row was unverified. It required emailAndPassword enabled plus an OAuth/SSO provider. The 1.6.11 fix refuses to link onto a local account whose `emailVerified` is false. — [GitHub Advisory](https://github.com/advisories/GHSA-g38m-r43w-p2q7); [upstream advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-g38m-r43w-p2q7)
- GHSA-qq9h-g4jm-xgf3, published 2026-06-26, high severity (CVSS 8.3): pre-account hijacking through magic-link or email-OTP sign-in. It affects 1.1.3–1.6.21 and 1.7.0-beta.0–beta.9, and is patched in 1.6.22 and 1.7.0-beta.10. It requires magic-link/OTP plus open email/password registration. — [GitHub Advisory](https://github.com/advisories/GHSA-qq9h-g4jm-xgf3)
- A third-party issue tracker cites another critical magic-link takeover, GHSA-965c-763c-88jm, with "upgrade to 1.7.7" as the fix. I did not read the primary advisory. — [jezweb/vite-flare-starter #157](https://github.com/jezweb/vite-flare-starter/issues/157)
- nOAuth (Descope + Microsoft, disclosed 2023-06-20): Azure AD's `email` claim was mutable and unverified, and apps that used it as an identifier or merged accounts on it could be taken over. Mitigations: use `sub` as the identifier, don't merge on unverified email, verify ownership (for example by magic link) before merging, and use Entra's `xms_edov` / `RemoveUnverifiedEmailClaim`. — [Descope: nOAuth](https://www.descope.com/blog/post/noauth)
- Nextcloud user_oidc hashes provider id + user id to keep identities unique across providers. Its `soft_auto_provision` (on by default) attaches an OIDC login to an existing user from another backend. — [nextcloud/user_oidc](https://github.com/nextcloud/user_oidc)
- Grafana warns that email is required for Generic OAuth sign-up/login. — [Grafana Generic OAuth](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/generic-oauth/)

### Inferences

- openhealth currently has emailAndPassword disabled, so the specific OAuth-linking CVE precondition is not met. The magic-link plus OIDC combination still makes email the join key, so the general class of risk remains. Ticket #65 should (a) pin better-auth >= the latest patched release (at least 1.6.22 / 1.7.7 based on the advisories above; check the current advisory list at implementation time), (b) set `disableImplicitLinking: true` or leave `trustedProviders` empty, and (c) provide an explicit "Connect OIDC" action in account settings that uses `linkSocial` / `oauth2.link` from an authenticated session.
- For a single self-hoster-controlled IdP, it is reasonable to add the provider to `trustedProviders` as an opt-in env flag (for example `OIDC_TRUST_EMAIL=true`), off by default. The self-hoster then takes on the risk that their IdP lets users edit their own email.
- PHI raises the cost of a takeover, so the conservative default is justified.

### Gaps

- I did not fetch the full list of Better Auth advisories. Check https://github.com/better-auth/better-auth/security/advisories before pinning a version.
- No OWASP page was fetched. The OWASP OAuth cheat sheet guidance is not cited here.

## Q3. Invite-only registration vs OIDC auto-registration and role mapping in comparable OSS apps

### Takeaway

Most comparable self-hosted apps provide an "OIDC sign-up allowed" toggle, and several turn it on by default. Many also map admin from a claim or group. To keep openhealth's first-user-then-invite-only rule, OIDC should not create accounts by default (`disableSignUp: true`). It should only sign in users who already exist or were invited, matched by email at invite acceptance and then bound by `sub`. Auto-registration can be an opt-in env flag. Role mapping from claims is unnecessary for v1 and is risky with PHI.

### Cited Findings

- Immich: `autoRegister` defaults to true. The role claim (default `immich_role`, values `user`/`admin`) is applied only at user creation and not re-synced. An email is required for auto-registration. — [Immich OAuth docs](https://docs.immich.app/administration/oauth/)
- Grafana Generic OAuth: `allow_sign_up` defaults to `true` ("Only existing Grafana users can log in ... if set to false"). Roles come from `role_attribute_path` (JMESPath). `role_attribute_strict` (default false) denies login when no role is extracted. `allow_assign_grafana_admin` defaults to false. `skip_org_role_sync` turns off role sync. `use_pkce` defaults to `false`. — [Grafana docs](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/generic-oauth/)
- Gitea: `ENABLE_AUTO_REGISTRATION` creates accounts on first SSO login. `ACCOUNT_LINKING=auto` links to an existing account with the same username/email. Admin and restricted flags come from `--group-claim-name`/`--admin-group`/`--restricted-group`. Known complaint: ACCOUNT_LINKING depends on ENABLE_AUTO_REGISTRATION, so you cannot have linking without open registration. — [Gitea authentication docs](https://docs.gitea.com/administration/authentication/); [go-gitea/gitea #27709](https://github.com/go-gitea/gitea/issues/27709)
- Mealie: env vars `OIDC_AUTH_ENABLED`, `OIDC_SIGNUP_ENABLED`, `OIDC_AUTO_REDIRECT`, `OIDC_ADMIN_GROUP` (members of the group become admins). This was seen in a community discussion, not in Mealie's own docs page. — [mealie discussion #3334](https://github.com/mealie-recipes/mealie/discussions/3334)
- Paperless-ngx uses django-allauth. `PAPERLESS_SOCIALACCOUNT_ALLOW_SIGNUPS` controls whether unknown social accounts create users, and `PAPERLESS_SOCIAL_AUTO_SIGNUP` skips the signup form. — [paperless-ngx PR #5190](https://github.com/paperless-ngx/paperless-ngx/pull/5190); [Authentik integration guide](https://integrations.goauthentik.io/documentation/paperless-ngx/)
- Nextcloud user_oidc: `auto_provision` is on by default and can be turned off in config.php. It supports group provisioning and whitelisting groups by regex. — [nextcloud/user_oidc](https://github.com/nextcloud/user_oidc)
- Better Auth equivalent: `disableSignUp` / `disableImplicitSignUp` on the genericOAuth provider, plus `user.validateUserInfo` to reject users. — [Better Auth: Generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth)

### Inferences

- Proposed v1 behaviour for #65:
  - `OIDC_ALLOW_SIGNUP=false` by default, mapping to `disableSignUp: true`.
  - An invited user can accept the invite with OIDC. The invite token proves intent, and the `sub` binding is stored on acceptance.
  - The first-user bootstrap remains a local (magic-link) account, so a misconfigured IdP cannot become the instance owner.
- Do not map the admin/owner role from IdP claims in v1. Immich and Grafana both treat role sync as an advanced feature with careful defaults, and for a PHI app the org owner role should be granted inside the app.
- Following Mealie, Immich and Grafana, an `OIDC_AUTO_REDIRECT` / "OIDC-only login" toggle would be a reasonable later addition. It is not needed for v1.

### Gaps

- I did not read Mealie's official docs page or Paperless's official configuration page directly. The env var names come from community and PR sources.

## Q4. Apple App Store Guideline 4.8 and a self-hoster-configured OIDC login in the iOS app

### Takeaway

Guideline 4.8 lists third-party or social login services (Google, Facebook and similar). A generic OIDC endpoint run by the self-hoster against their own server is arguably the app's own account system or an enterprise/existing-account sign-in, both of which are exemptions. Because the app also offers native local (magic-link/passkey) accounts, the risk is low. The text does not say outright that a user-configured OIDC is exempt, so App Review could still challenge it. To reduce that risk, keep local sign-in as a first-class option and never ship preset Google/Facebook buttons.

### Cited Findings

- 4.8 text: apps that use "a third-party or social login service (such as Facebook Login, Google Sign-In, Log in with X, Sign In with LinkedIn, Login with Amazon, or WeChat Login) to set up or authenticate the user's primary account" must also offer an equivalent login service that limits data to name and email, allows email to be kept private, and does not track for advertising without consent. — [App Review Guidelines 4.8](https://developer.apple.com/app-store/review/guidelines/)
- Exemptions include: "Your app exclusively uses your company's own account setup and sign-in systems"; "Your app is an education, enterprise, or business app that requires the user to sign in with an existing education or enterprise account"; government/eID; and "a client for a specific third-party service" where users sign in to that service directly. — [App Review Guidelines 4.8](https://developer.apple.com/app-store/review/guidelines/)
- The page showed no last-updated date. The 4.8 text as fetched on 2026-10-02 no longer names "Sign in with Apple" explicitly. It describes the required features of the alternative login instead. — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

### Inferences

- Under a client-for-your-own-server model, the "primary account" is the account on the user's own openhealth instance. Its default sign-in is magic link or passkey, which openhealth controls itself. OIDC is optional and is configured by the server owner against their own IdP, so it fits "company's own account system" or "existing enterprise account" better than "social login".
- The risky case is a self-hoster pointing OIDC at Google. The app still never hard-codes a social provider, and local sign-in is always available, which meets the "equivalent option" in spirit (email-only, no ad tracking). This is a judgment call. Write the review notes for App Review accordingly.
- If App Review objects anyway, the fallback is to add Sign in with Apple through Better Auth's `apple` social provider. This would clash with the "one generic OIDC" v1 decision.

### Gaps

- I found no Apple statement or precedent specific to "user-configurable self-hosted OIDC". Immich, Nextcloud and Home Assistant iOS apps all ship OIDC/server login in the App Store, but I found no primary-source review correspondence. Treat this as a residual risk.

## Q5. Passkeys in Better Auth as a v1 complement to magic link

### Takeaway

Passkeys are a mature, separately packaged Better Auth plugin built on SimpleWebAuthn. It supports conditional UI, passkey-first signup, and Expo. As a second factor-free sign-in method next to magic link, it is a reasonable v1 addition, especially for mobile. It needs a stable `rpID` (domain), and native iOS/Android passkeys need associated-domain / asset-links setup on the self-hoster's domain. That is a deployment burden for self-hosters, so passkeys could ship as web-first in v1.

### Cited Findings

- Package `@better-auth/passkey`, "powered by SimpleWebAuthn". Config is `rpID`, `rpName`, `origin`. It supports registration without an existing session (`registration.requireSession: false`, with a `resolveUser` callback) and conditional UI (`autocomplete="webauthn"` plus `signIn.passkey({ autoFill: true })`). Expo is supported, but `cookiePrefix` must match `webAuthnChallengeCookie` (default `better-auth-passkey`). — [Better Auth: Passkey](https://www.better-auth.com/docs/plugins/passkey); [Better Auth: Expo](https://www.better-auth.com/docs/integrations/expo)

### Inferences

- With invite-only registration, keep `requireSession: true`, so passkeys are added only after a magic-link or OIDC sign-in. Passkey-first signup would bypass invites.
- Native app passkeys bind to the RP ID domain. Each self-hosted instance has a different domain, but the App Store build has a fixed associated-domains entitlement. Native platform passkeys in the shared app binary therefore probably cannot work for arbitrary self-hosted domains. A web/browser-session passkey flow (via the auth browser session) may still work. This is unverified and should be a spike.

### Gaps

- No primary source confirms how Better Auth's Expo passkey support handles the associated-domains requirement for arbitrary self-hosted domains.

## Q6. AI SDK provider choice for "any OpenAI-compatible endpoint" (Ollama, LM Studio, vLLM, llama.cpp)

### Takeaway

Use `@ai-sdk/openai-compatible` (`createOpenAICompatible({ name, baseURL, apiKey, supportsStructuredOutputs })`) for the generic endpoint. `@ai-sdk/openai` defaults to the Responses API since AI SDK 5, and most local servers implement only Chat Completions well. Ollama, vLLM and llama.cpp all expose `/v1/chat/completions` with tools, but tool calling is opt-in or flag-dependent on vLLM and llama.cpp, and reliability depends on the model and template. Structured output should fall back to prompt plus Zod validation.

### Cited Findings

- `createOpenAICompatible` options: `name`, `baseURL`, `apiKey` (sent as Bearer), `headers`, `queryParams`, `fetch`, `supportsStructuredOutputs`, `includeUsage`, `supportsMultiPartToolContent`, `metadataExtractor`. With `supportsStructuredOutputs`, JSON-schema output is used, and `strictJsonSchema` defaults to true. Documented providers include LM Studio, NIM, Heroku and others. Ollama, vLLM and llama.cpp are not listed on that page. — [AI SDK: OpenAI Compatible Providers](https://ai-sdk.dev/providers/openai-compatible-providers)
- `@ai-sdk/openai`: "Since AI SDK 5, the OpenAI responses API is called by default (unless you specify e.g. 'openai.chat')". `baseURL` defaults to `OPENAI_BASE_URL` and then `https://api.openai.com/v1`. For compatible servers without the Responses API, use `openai.chat()` or the openai-compatible package. — [AI SDK: OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
- Community Ollama providers exist: `ollama-ai-provider-v2` and `ai-sdk-ollama`, the latter built on the official client and advertising tool calling and reasoning support. — [AI SDK: Ollama community providers](https://ai-sdk.dev/providers/community-providers/ollama)
- Ollama OpenAI compatibility: `/v1/chat/completions`, `/v1/completions`, `/v1/models`, `/v1/embeddings`, `/v1/responses` (non-stateful). Chat supports streaming, JSON mode, vision (base64), tools and reasoning control. Unsupported: logprobs, `tool_choice`, logit bias. An API key is required by clients but ignored locally. — [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- Ollama structured outputs: `format` accepts a JSON schema and is also available via OpenAI-compatible `response_format`. Recommended: temperature 0, put the schema in the prompt, validate with Zod/Pydantic. "Ollama's Cloud currently does not support structured outputs." — [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- vLLM needs `--enable-auto-tool-choice` plus `--tool-call-parser <hermes|mistral|llama3_json|...>`. `tool_choice="required"` or a named function guarantees "a validly-parsable function call — not a high-quality one". With `auto`, arguments "may occasionally be malformed" unless strict/structural enforcement is on. — [vLLM tool calling](https://docs.vllm.ai/en/latest/features/tool_calling.html)
- llama.cpp `llama-server` needs `--jinja` for function calling. It has native handlers for Llama 3.x, Hermes, Qwen 2.5, Mistral Nemo, DeepSeek R1 and others, with a less efficient generic fallback. It warns that aggressive KV-cache quantization degrades tool calling. — [llama.cpp function-calling.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)

### Inferences

- Env shape for #59: `AI_PROVIDER=anthropic|openai-compatible`, `AI_BASE_URL`, `AI_API_KEY` (optional for local), `AI_MODEL`, `AI_SUPPORTS_STRUCTURED_OUTPUTS` (default false for compatible endpoints). Add a startup or "test connection" check that calls `/v1/models`.
- Don't depend on `tool_choice` with Ollama, which does not support it. Design features so that tool calling is optional and structured output is validated with Zod, with a retry or a "could not parse" result that never invents data.
- A real OpenAI key also works through openai-compatible with `baseURL=https://api.openai.com/v1`. Only add `@ai-sdk/openai` if Responses-API-only features are needed.

### Gaps

- I did not verify LM Studio's and the llama.cpp server's support for `response_format: json_schema` against their primary docs in this pass.

## Q7. Small local models for tool calling and structured output (2026) and hardware

### Takeaway

Only secondary aggregator benchmarks are available. They consistently name the Qwen3 / Qwen 3.6 and Gemma 4 families (roughly 8–32B) as the most reliable local tool-callers, at around 16–24 GB of VRAM for the 27–32B class. Because these rankings change monthly and come from low-authority sources, document a "tested with" list and do not hardcode model ids.

### Cited Findings (secondary sources; low authority, not independently verified)

- Qwen3 (8b–32b) is reported as the most stable for tool calling, with the fewest dropped calls. Gemma 4 27B is reported at ~95% well-formed calls on 16 GB VRAM. Reported MCP-workflow figures: Gemma 4 27B ~95%, GLM-4.7 32B ~94%, Qwen3 32B ~93%, Llama 3.3 70B ~97%. Gemma 4 (9b, 26b) is reported at ~90% valid tool_calls among 8–10B models. — search summary across [morphllm.com](https://www.morphllm.com/best-ollama-models), [insiderllm.com](https://insiderllm.com/guides/function-calling-local-llms/), [promptquorum.com](https://www.promptquorum.com/power-local-llm/best-local-models-tool-calling-2026), [webscraft.org](https://webscraft.org/blog/yaku-model-ollama-obrati-dlya-agenta-z-tool-calling-porivnyannya-i-benchmarki?lang=en). The pages themselves were not fetched, and the figures come from search snippets.
- Qwen 3.6 has native tool calling via the `qwen3_coder` parser in vLLM/SGLang, and Ollama runs it as of mid-2026 (secondary source as above).

### Inferences

- Recommendation for #59: publish a `docs/ai/tested-models.md` matrix (model, quant, VRAM, server, tool calling pass/fail, structured output pass/fail, date tested) filled by an in-repo eval script run against the app's real prompts and schemas. Ship no default local model id. Require `AI_MODEL` to be set when the provider is openai-compatible.
- Structured extraction from lab reports is the critical path. A small-model failure there could silently corrupt health data, so local-model output should always go through schema validation and a user review step.

### Gaps

- I found no primary benchmark such as the Berkeley Function Calling Leaderboard (BFCL), fetched and dated for October 2026. Check BFCL (gorilla.cs.berkeley.edu) for an authoritative ranking.
- Hardware guidance is anecdotal (16–24 GB VRAM for 27–32B at Q4).

## Q8. PHI and privacy: Anthropic and OpenAI retention and training, ZDR, consent copy, GDPR Article 9

### Takeaway

Neither Anthropic nor OpenAI trains on API data by default. Both keep API inputs and outputs for about 30 days by default, longer for policy enforcement or legal holds. Zero-data-retention is available only by separate agreement. OpenAI offers a HIPAA BAA for eligible endpoints. Health data is GDPR Art. 9 special-category data, and the consent route is "explicit consent ... for one or more specified purposes". Consent copy should therefore name the configured provider and endpoint host, the purposes, and the data categories sent.

### Cited Findings

- Anthropic: "By default, we will not use your inputs or outputs from our commercial products to train our models" (unless the customer opts in via feedback). — [Anthropic privacy: training](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)
- Anthropic API data is "automatically removed within 30 days". Exceptions: features the customer controls such as the Files API, custom agreements, Usage Policy enforcement (flagged content kept up to 2 years, classifier scores up to 7 years), and legal requirements. Feedback is kept for 5 years. Zero-retention is available by custom arrangement. — [Anthropic privacy: retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- OpenAI: API data "is not used to train or improve OpenAI models (unless you explicitly opt in)". Abuse-monitoring logs are "retained for up to 30 days". ZDR and Modified Abuse Monitoring require "prior approval by OpenAI" through sales. A BAA (Healthcare Addendum) covers eligible endpoints, but "Web Search ... is not HIPAA eligible". Data residency is available in several regions, including Europe. — [OpenAI: Your data](https://developers.openai.com/api/docs/guides/your-data)
- GDPR Art. 9(1) prohibits processing of "data concerning health", and Art. 9(2)(a) allows it with "explicit consent ... for one or more specified purposes". — [GDPR Art. 9](https://gdpr-info.eu/art-9-gdpr/)

### Inferences

- Consent copy should be generated from config. For example: "AI features send [data categories: lab values, medication names, free-text notes — never name/email/DOB] to **{provider display name}** at **{host from AI_BASE_URL}** for: {purposes}. {If Anthropic/OpenAI: the provider may keep requests up to ~30 days and does not train on them by default under its API terms.} {If localhost/private IP: data stays on your network.}"
- Changing the provider or base URL should invalidate prior consent and ask again, because consent is "for specified purposes" and the recipient has changed.
- A single user self-hosting for themselves may fall under the GDPR household exemption (Art. 2(2)(c)). That was not verified in this pass. Once the instance hosts invited family members, explicit consent and PHI minimization still matter, so build for the strict case.
- AI off by default is consistent with all of the above.

### Gaps

- I did not confirm whether Anthropic currently offers a HIPAA BAA or public ZDR terms for API customers. The fetched page says only "custom data handling arrangements". Check the Anthropic Trust Center or Commercial Terms.
- I did not fetch EDPB guidance on LLM processing of special-category data.

## Q9. Current Anthropic model ids (is "claude-sonnet-4-20250514" outdated?)

### Takeaway

Yes, and it is worse than outdated. `claude-sonnet-4-20250514` was deprecated on 2026-04-14 and **retired on 2026-06-15**, so requests to it now fail. Anthropic's listed replacement is `claude-sonnet-4-6`, but the current lineup (2026-10-02) is Sonnet 5.5 (`claude-sonnet-5-5`), Opus 5.5, Fable 5.1, and Haiku 4.5 (`claude-haiku-4-5-20251001`, retirement "not sooner than October 15, 2026"). The default should move to `claude-sonnet-5-5` and be overridable via env.

### Cited Findings

- Current models: Claude Fable 5.1 `claude-fable-5-1` ($10/$50 per MTok), Claude Opus 5.5 `claude-opus-5-5` ($4/$20), Claude Sonnet 5.5 `claude-sonnet-5-5` ($2/$10, 1M context, retirement not sooner than 2027-09-28), Claude Haiku 4.5 `claude-haiku-4-5-20251001`, alias `claude-haiku-4-5` ($1/$5, 200K context). "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on." — [Anthropic models overview](https://platform.claude.com/docs/en/docs/about-claude/models/overview)
- `claude-sonnet-4-20250514`: Retired, deprecated 2026-04-14, retired 2026-06-15, recommended replacement `claude-sonnet-4-6`. `claude-sonnet-4-5-20250929`: deprecated 2026-09-30, retiring 2026-11-30. — [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- `temperature`/`top_p`/`top_k` return 400 when set to non-default values on Claude 4.7 and later models. — [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)

### Inferences

- #59 should change the default to `claude-sonnet-5-5`, read `AI_MODEL` from env, and remove any non-default `temperature` the code sets, because it will 400 on 5.x models.
- Haiku 4.5's retirement window opens 2026-10-15. Don't pick it as a long-lived default.
- The bundled `@ai-sdk/anthropic` version must accept these model ids and the adaptive-thinking/effort parameters. Check the package version at implementation time.

### Gaps

- I did not confirm the minimum `@ai-sdk/anthropic` version that supports the Claude 5.x ids and the `effort` parameter.
