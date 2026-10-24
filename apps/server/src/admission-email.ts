import { msg } from "@lingui/core/macro";
import type { DeliverInvitation, DeliverVerification } from "@openvalens/auth/admission";
import type { EmailService } from "@openvalens/email";
import {
  localeForEmail,
  localeForInvitee,
  serverI18n,
  type MessageLocales,
} from "@openvalens/i18n/server";

/**
 * Admission email (Issue #63), in the recipient's language (Issue #231).
 *
 * The verification code / invitation bearer appear in the message body only
 * (never a URL, never logged), and the template names are deliberately outside
 * the audit-BCC allow-list so credentials are never BCC'd. A dry-run send is
 * treated as a generic delivery failure — never a claimed delivery.
 *
 * Language:
 * - verification: the language the person is using the app in (sent by the
 *   `/setup` and `/join` pages), else their account's saved language, else
 *   English. The person may have no account yet.
 * - invitation: the recipient's saved language when they already have an
 *   account, else the issuing administrator's.
 *
 * Issue #243 — the invitation also links to this instance's web `/join` page
 * (from `CORS_ORIGIN`), where the token is pasted. The token is deliberately
 * not put in that link: a URL ends up in browser history, proxy and server
 * logs and referrers, so the bearer stays in the body only.
 */

/** `scheme://host[:port]` of the web app, or `null` when it cannot be parsed. */
function joinUrlFrom(webOrigin: string | undefined): string | null {
  if (!webOrigin) return null;
  try {
    return `${new URL(webOrigin).origin}/join`;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createAdmissionEmailDelivery(deps: {
  email: Pick<EmailService, "sendEmail">;
  locales: MessageLocales;
  /** The web app origin (`CORS_ORIGIN`); absent or unparseable omits the link. */
  webOrigin?: string;
}): { deliverVerification: DeliverVerification; deliverInvitation: DeliverInvitation } {
  const { email, locales } = deps;
  const joinUrl = joinUrlFrom(deps.webOrigin);

  const deliverVerification: DeliverVerification = async ({
    email: recipient,
    verificationCode,
    locale: requested,
  }) => {
    const i18n = serverI18n(requested ?? (await localeForEmail(locales, recipient)));
    const codeLine = (code: string) => i18n._(msg`Your verification code is ${code}.`);
    const expiryLine = i18n._(msg`It expires in 10 minutes.`);
    const result = await email.sendEmail({
      to: recipient,
      subject: i18n._(msg`Verify your email for OpenValens`),
      text: `${codeLine(verificationCode)} ${expiryLine}`,
      html: `<p>${codeLine(`<strong>${escapeHtml(verificationCode)}</strong>`)}</p><p>${expiryLine}</p>`,
      templateName: "admission-verification",
      tags: ["admission-verification"],
    });

    if (result.dryRun) {
      throw new Error("Admission verification email was not delivered.");
    }
  };

  const deliverInvitation: DeliverInvitation = async ({
    email: recipient,
    invitationToken,
    inviterUserId,
  }) => {
    const i18n = serverI18n(await localeForInvitee(locales, recipient, inviterUserId));
    const invitedLine = i18n._(msg`You have been invited to OpenValens.`);
    const tokenLine = (token: string) => i18n._(msg`Your invitation token is ${token}.`);
    const joinLine = (url: string) =>
      i18n._(msg`To create your account, open ${url} and paste the token.`);
    const joinText = joinUrl ? ` ${joinLine(joinUrl)}` : "";
    const joinHtml = joinUrl
      ? `<p>${joinLine(`<a href="${escapeHtml(joinUrl)}">${escapeHtml(joinUrl)}</a>`)}</p>`
      : "";
    const result = await email.sendEmail({
      to: recipient,
      subject: i18n._(msg`You’re invited to OpenValens`),
      text: `${invitedLine} ${tokenLine(invitationToken)}${joinText}`,
      html: `<p>${invitedLine}</p><p>${tokenLine(`<strong>${escapeHtml(invitationToken)}</strong>`)}</p>${joinHtml}`,
      templateName: "admission-invitation",
      tags: ["admission-invitation"],
    });

    if (result.dryRun) {
      throw new Error("Admission invitation email was not delivered.");
    }
  };

  return { deliverVerification, deliverInvitation };
}
