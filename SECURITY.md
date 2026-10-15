# Security policy

OpenValens stores personal health data, so we treat security reports as a
priority.

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through GitHub:
**Security tab → "Report a vulnerability"** on this repository. Only the
maintainers can see the report.

Include what you found, how to reproduce it, and the impact you expect. Please
avoid accessing other people's data; use your own test instance.

## What to expect

OpenValens is maintained by a small team, so these are targets, not
guarantees:

- Acknowledgement within 7 days.
- An assessment and plan within 30 days.
- Coordinated disclosure once a fix is released; we credit reporters who want
  to be credited.

## Supported versions

Security fixes go into the latest release on `main`. Self-hosters should keep
their instance up to date.

## Scope notes for self-hosters

You are responsible for your deployment: keep Postgres off the public network
(the supported install in `deploy/` never publishes it; the development
`docker-compose.yml` binds it to localhost), use strong generated secrets,
enable HTTPS, and take backups. The
[self-hosting security model](docs/self-hosting/security.md) lists what the
supported install does for you and what remains your responsibility.
