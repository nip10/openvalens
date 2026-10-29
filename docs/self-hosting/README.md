# Self-hosting OpenValens

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-25

These pages describe how to run your own OpenValens instance with the one
supported install: the Docker Compose stack in `deploy/`, driven by
`deploy/setup.sh`. Every command in them was checked against the scripts and
code of this version; where something was only partly verified, the page says
so.

> **Version.** No release has been tagged yet. Version 0.1.0 is the
> pre-release state of `main`, and these docs describe it. The version is the
> `version` field of the root `package.json`; CI checks that every page here
> states it.

> **Keep the backup key off the server.** The stack takes encrypted backups of
> the database and stored files daily and before every upgrade, but they are
> encrypted with `deploy/secrets/backup/age-identity` and kept on the same
> host. Read [Backups](backup.md) before you store real health data.

## Guides

| Page                                                | Covers                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| [Install](install.md)                               | Requirements, `deploy/setup.sh install`, first administrator, verifying. |
| [Configuration](configuration.md)                   | `deploy/.env`, optional providers, product settings, scheduled jobs.     |
| [Food catalogs](food-catalogs.md)                   | Importing USDA and Open Food Facts data for food search and barcodes.    |
| [Upgrading](upgrading.md)                           | `deploy/setup.sh upgrade`, failures, rolling back.                       |
| [Backups](backup.md)                                | Encrypted daily backups, the backup key, verify, restore, new host.      |
| [Email](email.md)                                   | Resend setup (the only email transport).                                 |
| [Single sign-on (OIDC)](oidc.md)                    | One optional OIDC provider: invite-only, explicit account connection.    |
| [Google and Apple sign-in](google-apple-sign-in.md) | Continue with Google and Apple; sign-up only on OpenValens Cloud.        |
| [Security model and reporting](security.md)         | What the stack protects, what you must, how to report a vulnerability.   |
| [Privacy and data rights](privacy.md)               | Where data lives, export and "delete everything".                        |
| [Licensing and trademark](licensing.md)             | AGPL obligations, app-store permission, use of the name.                 |
| [Connecting the mobile app](mobile-app.md)          | The store app on your server; building your own is optional.             |

## Reference

- [Environment reference](../reference/env.md) — every variable the server,
  web app, mobile app and database tooling accept, generated from the
  `.env.schema` files; CI fails if it drifts.
- [docs/deployment.md](../deployment.md) — platform (Coolify/Dokploy)
  deployments, readiness, cron and logging details, instance admission.
- [docs/integrations.md](../integrations.md) — the optional provider adapters.
- [docs/ai-providers.md](../ai-providers.md) — AI provider selection (Anthropic or
  OpenAI-compatible) and its settings.
- [docs/security-csp.md](../security-csp.md) — the content security policy.

## Not covered yet

- Signed, published container images; installs build from source (#129).
- A docs website. These Markdown pages come first; a site follows once they
  have been verified on a real install.
