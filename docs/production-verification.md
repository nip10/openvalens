# Production verification runbook

Last updated: 2026-10-15

This runbook covers Issue #128: real, authorized verification that the enabled
integrations and the authenticated flows work end to end on a deployed
environment, with PHI-safe evidence. It runs **after** a release has been
deployed under [release.md](release.md) (Issue #129). It is a checklist for a
human operator; nothing in the repository runs it automatically.

Boundaries: this adds no provider and performs no production write without
approval. Additional AI providers are v2 (#59).

## Ground rules

- **Approval first.** Each flow below that sends a real email, creates an
  account, or calls Anthropic or Telegram needs a written approval in the
  release issue naming the flow, the environment and the recipient or account.
  Without it, skip the flow and record "not authorized".
- **Secrets stay in private local files.** API keys, the setup token, invitation
  bearers, proof codes, session cookies and `deploy/secrets/*` are typed into
  hidden prompts or read from `chmod 600` files. They are never pasted into
  chat, tickets, screenshots or evidence.
- **Approved recipients only.** Real email goes only to an address the approver
  named, owned by the operator. Never a patient's or third party's address.
- **Synthetic data only.** Test accounts hold no real health data. Do not
  upload real documents, labs or exports, and do not type health details into
  the AI or Telegram flows; use neutral prompts ("Say hello").
- **PHI-safe evidence.** Record outcomes, UTC times, correlation ids, HTTP
  status codes and value-free readiness fields. Mask addresses
  (`o***@example.org`). No message bodies, codes, tokens, cookies, screenshots
  of health data, or AI responses.

## 0. Preflight (no provider calls)

1. The release record from [release.md](release.md) shows the deployed version
   and a passing `verify-readiness.ts` run.
2. Confirm the integration scope that is approved for this environment and
   check that readiness reports exactly that:

   ```bash
   bun scripts/verify-readiness.ts --base-url https://<domain> \
     --expect email=configured:resend,ai=<configured:anthropic|off>,messaging=<configured:telegram|off>
   ```

   `checks.integrations` is value-free (`{ provider, state }`), so the output is
   safe to attach. A family that is `configured` but not approved is a stop:
   remove its key and redeploy before continuing. `configured` means the
   credential is present, **not** that it works; flows 1–4 prove that.

## 1. Resend delivery to an approved recipient

Requires: approval naming the recipient address; `email=configured:resend`.

- [ ] Request a sign-in email for the approved address at `https://<domain>/login`
      (an existing account) or as part of flow 3.
- [ ] The message arrives at the approved inbox from the configured
      `EMAIL_FROM`, not in spam. Record arrival time, not content.
- [ ] Server logs show no `email.send.failed` for that correlation id; if there
      is one, record its `errorCategory` and `errorCode` only
      ([deployment.md §6](deployment.md#6-health-readiness)).
- [ ] Delete the message from the inbox after the flow completes.

## 2. Browser SDK login

Requires: an existing synthetic account for the approved address.

- [ ] Open `https://<domain>/login` in a fresh private browser window, request
      the magic link, open it in the same browser.
- [ ] Landing on the authenticated dashboard; the browser console shows no CSP
      violation and no failed `/api/auth/*` or `/rpc/*` request.
- [ ] Protected RPC works with the session: save the `Cookie` request header
      to a private file and run
      `bun scripts/verify-readiness.ts --base-url https://<domain> --session-cookie-file <file>`;
      `rpc-protected-session` must pass. Then delete the file.
- [ ] Sign out; reloading a protected page returns to login.

## 3. New-account admission (only when authorized)

Requires: a separate approval to create an account, naming the address. On a
fresh installation this is the first administrator; otherwise an invitation.

- [ ] First administrator: read the setup token from
      `deploy/secrets/setup-token` on the host, enter it at `/setup` with the
      approved address, then the emailed proof code. Or invitation: an
      administrator issues a global invitation to the approved address and the
      recipient completes `/join` with the bearer and code from the email body.
- [ ] Completion creates the account (no auto-login); sign in through flow 2.
- [ ] `rpc-anonymous-admission` afterwards reports `setupAvailable=false`.
- [ ] Record the account's role (admin/user) and creation time only.

## 4. Telegram and AI: enabled-only, exact scope

Verify only the families readiness reports as `configured` **and** the
approval lists. A family that is `off` is verified by its `off` state alone; do
not enable it to test it.

AI (`ai=configured:anthropic`):

- [ ] With a synthetic account that has **not** granted AI consent, the coach
      chat is refused (consent gate).
- [ ] As the workspace owner, turn on Settings → AI for this workspace, then
      grant your own consent (Settings → AI processing). Send one neutral
      prompt; a response streams back. Record only success, the model id and
      the correlation id; do not copy the reply.
- [ ] Revoke consent and turn the workspace switch off afterwards.

Telegram (`messaging=configured:telegram`):

- [ ] Register the webhook ([configuration](self-hosting/configuration.md#telegram)).
      From Settings → Telegram, press Connect, then Open in Telegram and Start
      in the operator's own test chat. The bot confirms and the page shows
      Connected. Record success and time only.
- [ ] A webhook call without the secret header is rejected with 401
      (`telegram.webhook.rejected` in the logs).
- [ ] Press Disconnect in Settings → Telegram afterwards.

## 5. Native app: physical smoke waived

A physical-device smoke test of the native app is **waived** for this release.
Record the waiver in the release issue:

```markdown
Native physical smoke: WAIVED for <version> on <date> by <approver>.
Reason: no physical-device verification in this release; native sign-in uses
the same server auth and is assumed, not verified. Follow-up: <issue link>.
```

## Evidence template (PHI-safe)

One block per flow, in the release issue. Leave a flow as "not authorized"
rather than deleting it.

```markdown
### Verification — <flow name> — <environment> — <version>

- Approval: <who, when, link>
- Operator: <name>; window: <UTC start–end>
- Preconditions: readiness integrations <value-free line from verify-readiness>
- Steps performed: <checklist items, ticked>
- Result: PASS | FAIL | NOT AUTHORIZED | WAIVED
- Correlation ids: <ids>
- Recipient / account: <masked address, e.g. o***@example.org>; role <admin|user>
- Failures: <errorCategory / errorCode / HTTP status only>
- Clean-up done: <emails deleted, consent revoked, chat unbound, cookie file deleted>
- PHI/secret review: no tokens, codes, cookies, keys, message bodies, AI output
  or health data in this record — checked by <name>
```
