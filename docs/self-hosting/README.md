# Self-hosting OpenValens

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

These pages describe how to run your own OpenValens instance with the one
supported install: the Docker Compose stack in `deploy/`, driven by
`deploy/setup.sh`. Every command in them was checked against the scripts and
code of this version; where something was only partly verified, the page says
so.

> **Version.** No release has been tagged yet. Version 0.1.0 is the
> pre-release state of `main`, and these docs describe it. The version is the
> `version` field of the root `package.json`; CI checks that every page here
> states it.

> **Backups are not finished.** 0.1.0 takes a plain, unencrypted `pg_dump`
> before each migration and nothing else. Encrypted, scheduled, off-host
> backups and a tested restore are Issue #64. Read [Backups](backup.md) before
> you store real health data.

## Guides

| Page                                        | Covers                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| [Install](install.md)                       | Requirements, `deploy/setup.sh install`, first administrator, verifying. |
| [Configuration](configuration.md)           | `deploy/.env`, optional providers, product settings, scheduled jobs.     |
| [Upgrading](upgrading.md)                   | `deploy/setup.sh upgrade`, failures, rolling back.                       |
| [Backups](backup.md)                        | The pre-migrate dump, its limits, an interim manual restore.             |
| [Email](email.md)                           | Resend setup (the only email transport).                                 |
| [Security model and reporting](security.md) | What the stack protects, what you must, how to report a vulnerability.   |
| [Privacy and data rights](privacy.md)       | Where data lives, export and "delete everything".                        |
| [Licensing and trademark](licensing.md)     | AGPL obligations, app-store permission, use of the name.                 |
| [Connecting the mobile app](mobile-app.md)  | Building the app for your server.                                        |

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

- Encrypted, scheduled backups and a tested restore (#64).
- File storage on local disk or S3-compatible services (#62).
- Signed, published container images; installs build from source (#129).
- Sign-in with an external identity provider (#65).
- Resource minimums measured on a reference VPS.
- A docs website. These Markdown pages come first; a site follows once they
  have been verified on a real install.
