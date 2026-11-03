import type {
  DeliverInvitation,
  DeliverSignUp,
  DeliverVerification,
} from "@openvalens/auth/admission";
import type { EmailService } from "@openvalens/email";
import { localeForEmail, localeForInvitee, type MessageLocales } from "@openvalens/i18n/server";
import { renderAdmissionVerificationEmail } from "@openvalens/email/templates/admission-verification";
import { renderAdmissionInvitationEmail as renderInvite } from "@openvalens/email/templates/admission-invitation";
import { renderExistingPublicSignUpEmail as renderExistingSignUp } from "@openvalens/email/templates/public-sign-up-existing";
import { renderPublicSignUpEmail as renderNewSignUp } from "@openvalens/email/templates/public-sign-up";

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

/** `<web origin><path>`, or `null` when the origin cannot be parsed. */
function webUrlFrom(webOrigin: string | undefined, path: string): string | null {
  if (!webOrigin) return null;
  try {
    return `${new URL(webOrigin).origin}${path}`;
  } catch {
    return null;
  }
}

export function createAdmissionEmailDelivery(deps: {
  email: Pick<EmailService, "sendEmail"> & Partial<Pick<EmailService, "organizationName">>;
  locales: MessageLocales;
  /** The web app origin (`CORS_ORIGIN`); absent or unparseable omits the link. */
  webOrigin?: string;
}): { deliverVerification: DeliverVerification; deliverInvitation: DeliverInvitation } {
  const { email, locales } = deps;
  const joinUrl = webUrlFrom(deps.webOrigin, "/join");

  const deliverVerification: DeliverVerification = async ({
    email: recipient,
    verificationCode,
    locale: requested,
  }) => {
    const locale = requested ?? (await localeForEmail(locales, recipient));
    const message = await renderAdmissionVerificationEmail(verificationCode, {
      locale,
      organizationName: email.organizationName,
    });
    const result = await email.sendEmail({
      to: recipient,
      ...message,
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
    const locale = await localeForInvitee(locales, recipient, inviterUserId);
    const message = await renderInvite(
      { token: invitationToken, joinUrl },
      {
        locale,
        organizationName: email.organizationName,
      },
    );
    const result = await email.sendEmail({
      to: recipient,
      ...message,
      templateName: "admission-invitation",
      tags: ["admission-invitation"],
    });

    if (result.dryRun) {
      throw new Error("Admission invitation email was not delivered.");
    }
  };

  return { deliverVerification, deliverInvitation };
}

/**
 * Issue #294 — Cloud sign-up email, in the language the person is using the
 * app in (else English; there is no account yet to read a saved language from).
 *
 * - `new`: the single-use link that creates the account. Like a magic link,
 *   the URL itself is the credential: it is never logged, and the template
 *   name is outside the audit-BCC allow-list.
 * - `existing`: the address already has an account. No link that could create
 *   anything, just a pointer to sign in. Sending *something* in both cases is
 *   what keeps the sign-up response from revealing whether an email is known.
 */
export function createSignUpEmailDelivery(deps: {
  email: Pick<EmailService, "sendEmail"> & Partial<Pick<EmailService, "organizationName">>;
  /** The web app origin (`CORS_ORIGIN`), for the sign-in pointer. */
  webOrigin?: string;
}): DeliverSignUp {
  const loginUrl = webUrlFrom(deps.webOrigin, "/login");

  return async (input) => {
    const options = { locale: input.locale ?? "en", organizationName: deps.email.organizationName };
    const message =
      input.kind === "new"
        ? await renderNewSignUp({ url: input.url }, options)
        : await renderExistingSignUp({ loginUrl }, options);
    const result = await deps.email.sendEmail({
      to: input.email,
      ...message,
      tags: [message.templateName],
    });
    if (result.dryRun) {
      throw new Error("Sign-up email was not delivered.");
    }
  };
}
