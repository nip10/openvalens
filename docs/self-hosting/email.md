# Email

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

OpenValens sends email through **[Resend](https://resend.com) only**. There is
no SMTP option and no other email provider (Issue #61); a test in
`packages/email` guards this.

## Why you need it

Email is how people get in. Without working email:

- the first administrator cannot finish `/setup` — the verification code is
  sent by email, and the server refuses to complete admission when email is
  only a dry run;
- invited people cannot join (`/join` uses an emailed invitation token and
  verification code);
- nobody can sign in, because sign-in uses an emailed magic link.

OpenValens also emails workspace invitations, access-request updates and
daily reminders (for people who choose email reminders).

## Set up Resend

1. Create a Resend account and **verify the domain** you send from (Resend
   gives you the DNS records to add).
2. Create an API key with sending access.
3. Give the key to the installer. Interactively, `deploy/setup.sh install`
   asks for it with a hidden prompt. Headless, put it in a private file and
   pass its path:

   ```bash
   RESEND_API_KEY_SOURCE=/root/resend-key deploy/setup.sh install --non-interactive
   ```

   (with the other variables from [Install](install.md#headless-install)).

The key is stored in `deploy/secrets/server/RESEND_API_KEY` and read through
`RESEND_API_KEY_FILE`; it is never printed or logged.

### Adding the key after installing

If you skipped the key, write it to `deploy/secrets/server/RESEND_API_KEY`
(mode `0444`, the same way as the
[optional provider keys](configuration.md#optional-providers)) and re-run
`deploy/setup.sh install`. The re-run reuses your settings and secrets, sets
`RESEND_API_KEY_FILE` and restarts the stack. It also rewrites `deploy/.env`
([what that means](configuration.md#applying-a-change)).

## Settings

| Setting               | Where                     | Notes                                                                       |
| --------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `EMAIL_FROM`          | `deploy/.env`             | `Name <address>` or a bare address on your verified domain.                 |
| `RESEND_API_KEY_FILE` | `deploy/.env` (automatic) | Set by `install` when the key file exists.                                  |
| `EMAIL_DRY_RUN`       | `deploy/.env` (optional)  | `true` logs messages instead of sending them. The stack default is `false`. |

`EMAIL_REPLY_TO` and `EMAIL_AUDIT_BCC` exist in the
[environment reference](../reference/env.md) but are not passed through by the
Compose stack ([why](configuration.md#what-the-stack-does-not-expose)).

## Check it

The readiness probe reports the email state without revealing the key:

```bash
curl -fsS -X POST https://<domain>/api-reference/health/readiness \
  -H 'Content-Type: application/json' -d '{}'
```

| `checks.integrations.email.state` | Meaning                                                         |
| --------------------------------- | --------------------------------------------------------------- |
| `configured`                      | A key is present and dry-run is off: email is handed to Resend. |
| `dry-run`                         | No key, or `EMAIL_DRY_RUN=true`: messages are logged, not sent. |

`configured` shows that a key is set, not that Resend accepts it. The real test
is the `/setup` verification code arriving.

## When email fails

Failed sends are logged as `email.send.failed` with a value-free
`errorCategory` (`auth`, `rejected`, `rate_limited`, `provider_unavailable`,
`timeout`, `network` or `unknown`); the key, recipient address and message
body are never logged. Read the server log with:

```bash
docker compose -f deploy/compose.yml logs server | grep email.send
```

The category table and what to do about each one are in
[deployment.md](../deployment.md#6-health-readiness). An `auth` failure almost
always means a wrong key or a sender address outside your verified domain.
