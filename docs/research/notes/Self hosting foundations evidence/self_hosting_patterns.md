# Self-hosting patterns in comparable open-source apps (for openhealth v1)

Retrieved 2026-10-02 unless noted. Sources are official docs, GitHub repos/wikis, and maintainer blog posts. "Inference" bullets are my reasoning, not documented fact. Where a WebFetch summary was the only source, I quote what the page says; where I pulled raw files from GitHub (Paperless-ngx docs, Plausible CE wiki and compose, Immich env docs and compose, Umami source, Cal.diy README, Fasten README), the quotes are verbatim.

Context: openhealth is a TypeScript monorepo (Bun + Hono/oRPC server, React web, Expo mobile, Postgres, Docker Compose, config via varlock `.env.schema`).

## 1. Supported install paths, and which paths projects dropped

### Takeaway
The successful projects treat one Docker Compose file (sometimes with a thin interactive script that writes it) as the only first-class path. Everything else (Unraid, TrueNAS, Synology, Helm, PaaS templates) is labelled "community". At least two projects formally dropped paths because a small share of users generated a large share of the support load: PostHog dropped Kubernetes/Helm in 2023 (3.5% of users), and Home Assistant dropped Core and Supervised in 2025 (2.5% + 3.3% of installs).

### Cited Findings
- **PostHog** ended Kubernetes/Helm self-host support on 2023-02-08. The infra team was "spending an outsized amount of time supporting the 3.5% of users" on Kubernetes. "Hosting PostHog at scale is complex" (Kafka, ClickHouse, Postgres, Redis), debugging needed "expensive engineers on both sides", and instances could be down "for hours or days". It chose to "focus on … PostHog Cloud and the open source Docker Compose deployment." — [PostHog blog: Sunsetting Helm support](https://posthog.com/blog/sunsetting-helm-support-posthog)
- **PostHog today** offers only a "hobby" Docker Compose deployment under MIT, installed with a curl-pipe-bash script (`bin/deploy-hobby`). "We don't offer customer support … for self-hosted instances." Paid features are Cloud-only. Its self-host guide suggests self-hosting fits roughly <300k events/month. — [PostHog self-host docs](https://posthog.com/docs/self-host)
- **Home Assistant** deprecated the Core and Supervised install methods (2.5% and 3.3% of installs). They "generate more issues that are more difficult to solve" and put strain on volunteer support. Warnings started in 2025.6 and support ended in 2025.12 ("issue reports won't be accepted"). Only HA OS and HA Container remain supported. — [HA blog 2025-05-22](https://www.home-assistant.io/blog/2025/05/22/deprecating-core-and-supervised-installation-methods-and-32-bit-systems/)
- **Immich** lists Docker Compose as "recommended". It also lists an install script (labelled "experimental"), Kubernetes, Portainer and one-click cloud options. All-In-One, Unraid, TrueNAS and Synology are explicitly tagged "[Community]". — [Immich Docker Compose install](https://docs.immich.app/install/docker-compose); [Immich requirements](https://docs.immich.app/install/requirements)
- **Paperless-ngx** recommends an "Installation script" for most users: an interactive bash script that "asks a few configuration questions, then creates the required files, pulls the image, starts the containers, and creates your superuser", i.e. it "automates the Docker Compose setup". Docker Compose templates are the medium-effort option. Bare metal is for "advanced users and contributors". Hosted providers are "maintained by the community — check details carefully". — [Paperless-ngx setup.md (raw)](https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/setup.md)
- **Nextcloud AIO** is "The official Nextcloud installation method". A single `docker run` of a "mastercontainer" mounts `/var/run/docker.sock` and creates and manages all other containers (Nextcloud, Postgres, Redis, Caddy/Apache with Let's Encrypt, optional Office/Talk/ClamAV). It exists because traditional setups need "one domain for each service which is much more complex". It also documents Compose, Swarm, Helm, Unraid, Synology and rootless Docker. — [nextcloud/all-in-one README](https://github.com/nextcloud/all-in-one)
- **Plausible CE** is installed by cloning `plausible/community-edition` at a tag and running `docker compose up`. Support is "community supported only": "when you self-host, the work we do for cloud customers becomes your work." It is a "long term release published twice per year". — [Plausible self-hosting](https://plausible.io/docs/self-hosting); [community-edition repo](https://github.com/plausible/community-edition)
- **Supabase** documents only Docker Compose (a Linux quick-start script, or manual setup). The page does not mention official Helm/Kubernetes support. — [Supabase self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- **Umami** lists source, Docker Compose, prebuilt Docker images, and "Kubernetes via HelmForge" (a third-party chart). — [Umami install docs](https://docs.umami.is/docs/install)
- **Actual Budget** officially offers desktop apps, Docker, a server CLI, build-from-source and paid PikaPods/Fly.io hosting. Community guides (Synology, Proxmox, AUR, Home Assistant) carry the warning: "Content contained on external links is not managed or maintained by the Actual Budget team." — [Actual install docs](https://actualbudget.org/docs/install/)
- **Cal.com**: the GitHub repo `calcom/cal.com` now resolves to `calcom/cal.diy` (verified via GitHub API: `full_name: calcom/cal.diy`). The old `cal.com/docs/self-hosting/installation` URL 301-redirects to `cal.diy/installation`. Cal.diy is "a fork of Cal.com with all enterprise/commercial code removed", "100% MIT", "No license key required", and "strictly recommended for personal, non-production use". Commercial self-hosting is "on-prem enterprise access" via sales. Latest releases are v6.2.0 (2026-03-01) and v6.1.16 (2026-02-12). Install options are Docker Compose, manual Node/yarn/Postgres, and one-click Railway/Render/Vercel/Elestio/Azure/GCP. — [Cal.diy README via GitHub API](https://github.com/calcom/cal.diy); [cal.diy/installation](https://cal.diy/installation)
- **Fasten Health OnPrem** (the closest health-domain comparable): the repo is **archived** (GitHub API `archived: true`, last push 2026-02-13; the GitHub UI shows it was archived on 2026-07-18). The README says it "is maintained by the community and is not the same product as Fasten Connect" (the commercial API with "integrations with over 50,000+ healthcare insitutions") and that "Fasten Onprem is not able to import data from healthcare providers directly". It ran as a single Docker container with a self-signed TLS cert generated at first run. — [fastenhealth/fasten-onprem](https://github.com/fastenhealth/fasten-onprem)

### Inferences
- The consistent pattern is one supported path (Compose), optionally an interactive script that generates the Compose and `.env` files, and everything else labelled community. openhealth should do the same: an official `compose.yml` plus `.env`, a pinned image, and a "Community" label on any Coolify/Unraid/TrueNAS templates.
- Dropped paths share a trait: they exposed internals (Kafka/ClickHouse topology for PostHog, the host OS for HA Supervised) that the project then had to debug on users' machines. A Helm chart for openhealth v1 would recreate the PostHog problem.
- Fasten is a cautionary data point for health PHR self-hosting. The direct provider-integration value was kept in the commercial product, and the self-hosted app was archived. Inference: a health app whose self-hosted edition lacks automated data import has struggled to sustain itself.
- The Nextcloud AIO model (a Docker-socket-mounting orchestrator) gives a good user experience but has a security and maintenance cost (docker.sock access). It is too heavy for v1.

### Gaps
- I did not verify PostHog's current hobby RAM figure beyond the docs' "4 vCPU, 16GB RAM, and more than 30GB storage" WebFetch summary.
- I found no official statements from Immich, Mealie or Umami about dropping a specific install path.
- I did not check Coolify, CapRover, Unraid or TrueNAS app catalogs directly. Their entries for these projects appear to be community-maintained per each project's "[Community]" labels, but I did not open the catalogs.

## 2. Configuration: env vars, config file and admin UI; secrets; validation; env reference

### Takeaway
Every project uses environment variables for infrastructure and secrets (DB URL, base URL, secret keys, SMTP), and several add Docker-secrets / `_FILE` support. Runtime product settings (OAuth, SMTP in some apps, feature tuning) live in an admin UI backed by the DB. Immich shows a clean split: if a config file is supplied, UI editing is disabled.

### Cited Findings
- **Immich**: setting `IMMICH_CONFIG_FILE` "will disable the ability to edit other properties from the Immich web UI." — [Immich config file](https://docs.immich.app/install/config-file)
- **Immich** env reference is a categorized table (Docker Compose, General, Workers, Ports, Database, Redis, ML, Prometheus, Secrets) listing variable, description, default, container and worker. Secrets can be read via `CREDENTIALS_DIRECTORY` (systemd credentials or `/run/secrets`) or `_FILE` variants such as `DB_PASSWORD_FILE` and `DB_URL_FILE`. "Additional machine learning parameters can be tuned from the admin UI." — [Immich environment variables (raw md)](https://github.com/immich-app/immich/blob/main/docs/docs/install/environment-variables.md)
- **Immich** `.env` is minimal: `UPLOAD_LOCATION`, `DB_DATA_LOCATION`, `TZ`, `IMMICH_VERSION`, `DB_PASSWORD` ("only A-Za-z0-9 characters"), `DB_USERNAME`, `DB_DATABASE_NAME`. — [Immich Docker Compose install](https://docs.immich.app/install/docker-compose)
- **Plausible CE**: required env is `BASE_URL` and `SECRET_KEY_BASE` ("at least a 64-byte string", `openssl rand -base64 48`). `CONFIG_DIR` (default `/run/secrets`) means that "when a file with the same name as an environment variable exists in this directory, the contents of that file will be used". `TOTP_VAULT_KEY` defaults to a value "derived from `SECRET_KEY_BASE` using PBKDF2". — [Plausible CE README](https://github.com/plausible/community-edition); [Plausible CE wiki Configuration](https://github.com/plausible/community-edition/wiki/Configuration)
- **Actual Budget**: optional `config.json`, with precedence "environment variables (ACTUAL_ prefix) override config.json values, which override defaults". The docs warn "environmental variables do not map 1:1 to keys in the config.json file". — [Actual config docs](https://actualbudget.org/docs/config/)
- **Supabase**: the docs say "you should **never** start your self-hosted Supabase using these defaults". Scripts `generate-keys.sh` and `add-new-auth-keys.sh` generate secrets. Production should "use a secrets manager". Studio is protected by HTTP basic auth via env (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`). Configuration is done in `.env`, not the Studio UI. — [Supabase Docker self-host](https://supabase.com/docs/guides/self-hosting/docker)
- **Cal.diy**: you "must generate secure values for `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`. Using the default `secret` placeholder in production is a security risk." App-store integration keys go in a separate `.env.appStore`. — [Cal.diy README](https://github.com/calcom/cal.diy)
- **Nextcloud AIO** splits config in two. Env vars on the mastercontainer cover infra (`NEXTCLOUD_DATADIR`, `NEXTCLOUD_UPLOAD_LIMIT`, `NEXTCLOUD_MEMORY_LIMIT`, …). A web "AIO interface" covers domain, certificates, optional containers, backup schedule and restore. — [nextcloud/all-in-one](https://github.com/nextcloud/all-in-one)
- **Mealie**: after startup, visit `/admin/site-settings` "to review configuration status and resolve any warnings or errors". This is an in-app configuration health check. — [Mealie installation checklist](https://mealie.io/documentation/getting-started/installation/installation-checklist/)
- **Umami**: the only required env var is `DATABASE_URL`, plus Postgres set to UTC. — [Umami install](https://docs.umami.is/docs/install)
- **Paperless-ngx** documents every setting in `configuration.md` as anchored `PAPERLESS_*` entries (e.g. `PAPERLESS_SECRET_KEY`, `PAPERLESS_ADMIN_USER`). — [Paperless-ngx configuration.md](https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/configuration.md)

### Inferences
- A good split for openhealth: env (validated at boot by the varlock schema) for anything needed before the DB is reachable or anything secret, such as `DATABASE_URL`, `PUBLIC_URL`, `SECRET_KEY`/encryption keys and SMTP credentials. DB-backed admin UI for runtime product settings such as registration mode, OAuth providers and feature toggles. If both exist for a setting, make one authoritative and show it read-only in the other, as Immich does.
- Supporting `_FILE` / `CREDENTIALS_DIRECTORY` for secrets is cheap and expected (Immich, Plausible). It is worth checking whether varlock supports this natively.
- Supabase and Cal.com both had to warn loudly about shipping placeholder secrets. Boot-time validation should refuse known placeholder values and keys that are too short. That is a direct fit for varlock schema validation.
- A single generated env reference page (like the tables from Immich and Paperless) is the norm. Generating it from `.env.schema` keeps it in sync.

### Gaps
- I did not find explicit docs on whether Immich, Plausible or Mealie fail fast on invalid env at boot. I am inferring that from the required-variable sections.
- Mealie's full env list was not fetched in detail.

## 3. Upgrades and DB migrations

### Takeaway
The norm is automatic migrations on container start, an upgrade done with `docker compose pull && docker compose up -d`, images pinned by tag with major-version tags available, breaking changes limited to major versions, and downgrades not supported. Rollback means restoring a backup.

### Cited Findings
- **Immich**: upgrade with `docker compose pull && docker compose up -d`. The `IMMICH_VERSION` env var can pin to e.g. `v2.1.0`, and major meta-tags such as `:v3` "do not include release candidates". "We intend for breaking changes, including those to the API or deployment, to be limited to major version releases." Breaking changes are tracked under a `changelog:breaking-change` discussion label. "Downgrading to an earlier version, even within the same minor version, is not supported." Migrations (e.g. VectorChord reindexing) run automatically at startup and "can take seconds to minutes". — [Immich upgrading](https://docs.immich.app/install/upgrading)
- **Immich** compose defaults to `immich-server:${IMMICH_VERSION:-release}`, and supporting images (Valkey, Postgres with VectorChord) are pinned by digest. — [Immich docker-compose.yml](https://github.com/immich-app/immich/blob/main/docker/docker-compose.yml). (The install page summary said the default is `v3`. The compose file in `main` shows `release`. This is a minor discrepancy.)
- **Plausible CE** runs migrations on every boot via the compose command: `sh -c "/entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh run"`, with the image pinned to `ghcr.io/plausible/community-edition:v3.2.1`. — [community-edition compose.yml](https://github.com/plausible/community-edition/blob/HEAD/compose.yml)
- **Plausible CE** uses "Intended Effort Versioning". Major, minor and patch tags are offered, and "Patch version pinning … Recommended". "Security patches and bug fixes are not backported." Major upgrades "may require additional steps like data migrations" described in release notes. — [Plausible CE wiki Upgrade](https://github.com/plausible/community-edition/wiki/Upgrade)
- **Paperless-ngx**: "Running `docker compose up` will also apply any new database migrations." Since 1.7.1 the image "can now be pinned to a release series … often combined with automatic updaters such as Watchtower … It is still recommended to always review release notes." Exports cannot be imported into a different version because "migrations may change the database layout". Bare metal requires a manual `python3 manage.py migrate`. — [Paperless-ngx administration.md](https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/administration.md)
- **Umami**: "The first time the build is run, it will create all the required database tables" (migrations at build/start). — [Umami install](https://docs.umami.is/docs/install)
- **Cal.diy**: migrations are an explicit step (`yarn workspace @calcom/prisma db-migrate`), and the installation page says "Please make sure to upgrade your database before you build for production." — [Cal.diy README](https://github.com/calcom/cal.diy); [cal.diy/installation](https://cal.diy/installation)
- **Supabase**: an `update.sh` script "updates an existing deployment in place" by pulling the latest `self-hosted/v*` configuration. Individual services can be bumped by tag with `sh run.sh recreate [service]`. — [Supabase Docker self-host](https://supabase.com/docs/guides/self-hosting/docker)
- **Nextcloud AIO**: "Daily backups can be enabled from the AIO interface which also allows updating all containers, Nextcloud and its apps afterwards automatically" (BorgBackup). This couples backup with upgrade. — [nextcloud/all-in-one](https://github.com/nextcloud/all-in-one)
- **PostHog**: "keep your PostHog deployment up-to-date" via the upgrade script, and always back up first. — [PostHog self-host](https://posthog.com/docs/self-host)
- **Plausible**: treat the instance "as infrastructure you maintain, not software you install once". — [Plausible self-hosting](https://plausible.io/docs/self-hosting)

### Inferences
- For openhealth: run forward-only migrations automatically on server start, behind a Postgres advisory lock so multiple replicas are safe. Pin images to an exact semver in the shipped compose and publish `vX` / `vX.Y` tags too. Document "no downgrades; restore from backup", and print the schema version at boot.
- The Nextcloud AIO pattern of "backup then update" is worth copying in lightweight form for PHI: a documented `pg_dump` step, or a `backup` service in the compose, before upgrade instructions.
- Cal.com's explicit migration step is the outlier and adds friction. Apps targeting non-expert self-hosters (Immich, Plausible, Paperless, Umami) all auto-migrate.

### Gaps
- None of the sources described a formal LTS or multi-channel (stable/beta) policy, beyond Immich's release candidates being excluded from major tags and Plausible's twice-yearly CE releases.

## 4. Integrations and adapters: breadth at launch and configuration

### Takeaway
Projects ship a narrow set of integrations configured by env vars. The usual set is SMTP for email (Plausible adds a few Bamboo adapters), one OIDC/OAuth option, and local disk storage. Health-specific "provider integrations" were the hardest part: Fasten kept them out of its self-hosted edition entirely.

### Cited Findings
- **Plausible CE** email defaults to `MAILER_ADAPTER=Bamboo.Mua` (direct SMTP, or a relay via `SMTP_HOST_ADDR`, `SMTP_HOST_PORT`, `SMTP_USER_NAME`, `SMTP_USER_PWD`, `SMTP_HOST_SSL_ENABLED`). Alternatives are Postmark, Mailgun, Mandrill and SendGrid adapters. — [Plausible CE wiki Configuration](https://github.com/plausible/community-edition/wiki/Configuration)
- **Supabase** requires "a production-ready SMTP server" via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_ADMIN_EMAIL`, and recommends AWS SES. — [Supabase Docker self-host](https://supabase.com/docs/guides/self-hosting/docker)
- **Actual Budget** offers `loginMethod` values `password` (default), `openid` and `header`, with `allowedLoginMethods` to restrict them. — [Actual config](https://actualbudget.org/docs/config/)
- **Mealie** supports standard credentials plus LDAP and OpenID Connect, and SMTP for email. — [Mealie installation checklist](https://mealie.io/documentation/getting-started/installation/installation-checklist/)
- **Supabase self-host** disables Logs & Analytics by default "to reduce the memory footprint". Enabling it takes `sh run.sh config add logs`. — [Supabase Docker self-host](https://supabase.com/docs/guides/self-hosting/docker)
- **Cal.diy** removed enterprise integrations (Teams, Organizations, Insights, Workflows, SSO/SAML). Third-party app keys are configured in `.env.appStore`. — [Cal.diy README](https://github.com/calcom/cal.diy)
- **Fasten OnPrem**: "does not integrate with EHRs directly … You can only use this application to manually enter data, or upload FHIR Bundles". Provider connectivity (50,000+ institutions) is a commercial product. — [fasten-onprem README](https://github.com/fastenhealth/fasten-onprem)
- **Home Assistant** is the counterexample of a large pluggable integration ecosystem. It needs an analytics tier ("Usage Analytics: Integration names …") to know which integrations to maintain. — [HA analytics integration](https://www.home-assistant.io/integrations/analytics/)

### Inferences
- A v1 adapter set for openhealth: email via SMTP only (any provider such as Resend, SES or Postmark offers SMTP, so no provider-specific adapters are needed). Auth via local password plus optionally one generic OIDC. Storage via a local volume, with S3-compatible as an optional later addition. One interface per capability with one or two implementations. More adapters can wait until there is usage evidence.
- Plausible's five mail adapters are a legacy of the Elixir Bamboo library, not a deliberate expansion. SMTP-first covers all of them.
- The health data source integrations (FHIR, wearables) are where cost concentrates. Fasten's history suggests scoping self-hosted v1 to file import and on-device/companion ingestion, not server-side provider OAuth that needs per-provider app registration.

### Gaps
- I did not verify Immich's OAuth/SMTP settings location (admin UI vs env) from primary docs in this pass. From prior knowledge both are admin-UI settings, but that is unverified.
- I found no quantified "over-abstraction cost" postmortem from these projects. The Fasten split and the PostHog/HA path removals are the closest evidence.

## 5. Minimum resources and first-run admin bootstrap

### Takeaway
"First user to register becomes admin" (Immich, Home Assistant owner, Plausible, Paperless web prompt) is the dominant bootstrap. Env-seeded admins (Paperless `PAPERLESS_ADMIN_USER`) cover headless/k8s cases. Default credentials (Umami `admin/umami`, Mealie `changeme@example.com/MyPassword`) still exist but are the weaker pattern. Registration after bootstrap is closed or invite-only by default (Plausible `DISABLE_REGISTRATION=invite_only`).

### Cited Findings
- **Immich**: "The first user to register becomes the admin user." Further users are created by the admin under Administration > Users. — [Immich post-install](https://docs.immich.app/install/post-install)
- **Immich minimums**: "Minimum 6GB, recommended 8GB" RAM and "Minimum 2 cores, recommended 4 cores". The ML container needs x86-64-v2. "Non-Linux OSes tend to provide a poor Docker experience and are strongly discouraged." — [Immich requirements](https://docs.immich.app/install/requirements)
- **Home Assistant** onboarding creates the owner: "This account is an administrator account. It will always be able to change everything." "There is no way to recover the owner credentials." — [HA onboarding](https://www.home-assistant.io/getting-started/onboarding/)
- **Plausible CE**: open `BASE_URL` to create the initial user. `DISABLE_REGISTRATION` defaults to `invite_only` (values: `true`, `false`, `invite_only`). `ENABLE_EMAIL_VERIFICATION` defaults to `false`. Minimum "at least 2 GB of RAM", and the CPU must support SSE 4.2 or NEON (because of ClickHouse). — [Plausible CE README](https://github.com/plausible/community-edition); [wiki Configuration](https://github.com/plausible/community-edition/wiki/Configuration)
- **Paperless-ngx**: "When you first access the web interface you will be prompted to create a superuser account." Alternatively `PAPERLESS_ADMIN_USER` / `PAPERLESS_ADMIN_PASSWORD` "automatically creates a superuser … at start … useful … such as Kubernetes or AWS ECS". This "will not change an existing [super]user's password, nor will it recreate a user that already exists". Docs suggest using a non-superuser account for daily use. — [Paperless-ngx setup.md](https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/setup.md); [configuration.md](https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/configuration.md)
- **Umami**: default login is username `admin`, password `umami`. — [Umami install](https://docs.umami.is/docs/install)
- **Mealie**: default credentials `changeme@example.com` / `MyPassword`. — [Mealie installation checklist](https://mealie.io/documentation/getting-started/installation/installation-checklist/)
- **Supabase**: at least 4GB RAM, 2 cores and 40GB SSD; recommended 8GB+, 4+ cores, 80GB+. — [Supabase Docker self-host](https://supabase.com/docs/guides/self-hosting/docker)
- **PostHog hobby**: "4 vCPU, 16GB RAM, and more than 30GB storage". — [PostHog self-host](https://posthog.com/docs/self-host)
- **Mealie**: "not supported on 32bit ARM systems". It suggests SQLite for 1–20 users and Postgres for many concurrent users. — [Mealie installation checklist](https://mealie.io/documentation/getting-started/installation/installation-checklist/)
- **Fasten OnPrem** required account creation on first visit, and its production compose generated a self-signed CA (`rootCA.pem`) that users must trust. — [fasten-onprem README](https://github.com/fastenhealth/fasten-onprem)

### Inferences
- For a PHI app, the first-user-becomes-admin bootstrap has a race: anyone who reaches the URL before the owner claims it. Mitigations: a one-time setup token printed to server logs (an inference; I did not find this documented in the sources above), or env-seeded admin as in Paperless. After bootstrap, registration should default to closed or invite-only, as in Plausible.
- Default credentials (Umami, Mealie) are inappropriate for PHI.
- A Bun + Postgres stack without ClickHouse or ML could credibly claim a ~1–2GB RAM minimum. Plausible's 2GB with ClickHouse is the closest reference point. This is an estimate to verify by measurement.

### Gaps
- No primary-source RAM minimums were found for Umami, Actual or Paperless in this pass.

## 6. Telemetry and analytics in self-hosted builds

### Takeaway
Norms vary. Home Assistant is strictly opt-in with tiered, published aggregates. Umami phones home by default unless `DISABLE_TELEMETRY` is set. Immich's `IMMICH_TELEMETRY_*` variables are local Prometheus/OpenTelemetry metrics, not phone-home. For a health app, the defensible norm is the Home Assistant one: off by default, explicit, tiered, and changeable in the UI.

### Cited Findings
- **Home Assistant**: "Sharing analytics is completely optional. Nothing is sent from your installation unless you explicitly opt in." There are four independent tiers (Basic, Usage, Statistics, Diagnostics via Sentry). "Only aggregated and anonymized totals are made publicly available … The raw per-installation payloads are never published." Settings are changeable at Settings > System > Analytics. — [HA analytics](https://www.home-assistant.io/integrations/analytics/). Onboarding: "Sharing is disabled by default. However, we would like to encourage you to share some of this data." — [HA onboarding](https://www.home-assistant.io/getting-started/onboarding/)
- **Umami** source: the telemetry script route returns `/* telemetry disabled */` only if `NODE_ENV !== 'production' || DISABLE_TELEMETRY || PRIVATE_MODE`. Otherwise it injects a 0×0 image pixel to `TELEMETRY_PIXEL?v=CURRENT_VERSION`. This means it is on by default in production and is an opt-out. — [umami src/app/api/scripts/telemetry/route.ts](https://github.com/umami-software/umami/blob/master/src/app/api/scripts/telemetry/route.ts)
- **Immich**: `IMMICH_TELEMETRY_INCLUDE` / `IMMICH_TELEMETRY_EXCLUDE` sit under the "Prometheus" section ("Collect these telemetries. List of host, api, io, repo, job"), are empty by default, and control locally exposed metrics. — [Immich environment variables](https://github.com/immich-app/immich/blob/main/docs/docs/install/environment-variables.md)
- **Supabase** self-host turns off its Logs & Analytics stack by default for resource reasons, not privacy. — [Supabase Docker self-host](https://supabase.com/docs/guides/self-hosting/docker)

### Inferences
- openhealth should separate local observability (Prometheus/OTel, opt-in via env, like Immich) from phone-home usage telemetry. Phone-home should be off by default, opt-in in the admin UI, tiered and documented, with nothing PHI-adjacent. Version-update checks are best disclosed and given their own toggle.

### Gaps
- I could not retrieve Immich's privacy policy content (the page rendered without body text), so I could not confirm whether the server performs a phone-home version check by default. (Prior knowledge says Immich has an admin-toggleable "version check" against GitHub releases. This is unverified here.)
- Not checked: Paperless `PAPERLESS_ENABLE_UPDATE_CHECK` semantics, Cal.diy `CALCOM_TELEMETRY_DISABLE`, PostHog hobby telemetry.

## 7. Mobile apps connecting to a self-hosted server: URL entry, TLS, push

### Takeaway
Mobile apps for self-hosted servers ask the user to enter a server URL at login (Immich: "Users log in with their server endpoint URL"). Push is the hard part. FCM and APNs credentials belong to the app publisher, so self-hosted servers cannot push directly. Projects run a relay or proxy that they operate: Nextcloud's push proxy with end-to-end encryption, ntfy's poll_request forwarding with only a message ID, or Home Assistant's FCM relay with content not E2E-encrypted and 500/day/device rate limits. With Expo, the same applies: the publisher's Expo project owns the FCM/APNs credentials.

### Cited Findings
- **Immich mobile**: the app is available on App Store, Play Store and GitHub, and "Users log in with their server endpoint URL." — [Immich post-install](https://docs.immich.app/install/post-install)
- **Nextcloud push proxy**: the keys "can not be shipped with the Nextcloud server as otherwise everyone would have our developer key and could manipulate releases or push to any random Nextcloud device." FCM/APNs "are not made for something like a federated project like Nextcloud and still assume there is a single entity behind them". The proxy (`push-notifications.nextcloud.com`) stores only "user public key", "device identifier" and "push token". The server encrypts content "with `device public key`" and signs it "with the `user private key`", so the proxy never sees plaintext. — [nextcloud/notifications docs/push-v2.md](https://github.com/nextcloud/notifications/blob/master/docs/push-v2.md)
- **ntfy (iOS)**: "iOS heavily restricts background processing, which sadly makes it impossible to implement instant push notifications without a central server." Self-hosted servers set `upstream-base-url` to ntfy.sh and forward `poll_request` messages containing only the message ID. The device then fetches the content from the self-hosted server. On Android, delivery can be instant via WebSocket/HTTP or UnifiedPush without Firebase, or via FCM with a custom APK build. — [ntfy config docs](https://docs.ntfy.sh/config/)
- **Home Assistant companion**: "the app uses Google's Firebase cloud messaging service". Limit is "500 push notifications per day per device". "The contents of the notifications are not encrypted on the Firebase cloud messaging service, thus could be processed by Google." iOS users can opt out of Firebase, which stops notifications. — [HA companion notification details](https://companion.home-assistant.io/docs/notifications/notification-details/)
- **Expo push service**: by default "you can send a notification to your users by sending their Expo Push Token" with no access token. Optional "enhanced push security" can require an access token from the EAS dashboard (`UNAUTHORIZED` otherwise). Expo "handles sending push notifications off to FCM and APNs". — [Expo: sending notifications](https://docs.expo.dev/push-notifications/sending-notifications/)
- **Fasten OnPrem** served HTTPS by default with a self-signed certificate and required users to install the generated `rootCA.pem` on devices. — [fasten-onprem README](https://github.com/fastenhealth/fasten-onprem)

### Inferences
- If openhealth's Expo app is published by the project, self-hosted servers have three options: (a) call Expo's push API with device tokens, which works by default but conflicts with enabling enhanced security unless the project issues a token to every self-hoster, and sends notification content through Expo/FCM/APNs; (b) a project-operated relay like Nextcloud's that carries only encrypted payloads or IDs, as in ntfy's poll_request; (c) no remote push in v1, using local notifications scheduled on-device plus fetch-on-open or background fetch. For PHI, option (b)'s "ID-only / E2E-encrypted payload" is the established pattern. Option (c) is the narrowest v1.
- Never put health content in push payloads. Send an opaque ID or "you have a new item" and let the app fetch over its authenticated TLS connection. This follows the design of both Nextcloud and ntfy.
- iOS ATS and Android cleartext defaults effectively require HTTPS with a publicly trusted cert for mobile. Fasten's self-signed-CA approach adds friction. Recommend reverse proxy plus Let's Encrypt (Caddy in compose, as in Nextcloud AIO), or Tailscale/Cloudflare Tunnel documentation. (ATS behaviour is from platform knowledge, not fetched here.)
- The mobile app should validate the server on URL entry (a health/version endpoint that returns the API version), so the app can warn about version skew. This is an inference; Immich's server-version-mismatch banner is prior knowledge, unverified here.

### Gaps
- I did not fetch primary docs on how the Immich mobile app handles push. To my knowledge Immich has no remote push, but that is unverified.
- I did not verify UnifiedPush spec details or Nextcloud's UnifiedPush/ntfy support beyond the ntfy docs.
- I did not fetch Apple ATS or Android network security config primary docs.
