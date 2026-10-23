import { msg, plural } from "@lingui/core/macro";

import { emailI18n, renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "Health";

export type InvitationEmailInput = {
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
  expiresInDays: number;
  role: string;
};

export type RenderedInvitationEmail = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Workspace invitation, in the recipient's language (#231). The inviter name,
 * workspace name and role are user or system values and are not translated.
 */
export function renderInvitationEmail(
  input: InvitationEmailInput,
  options: EmailRenderOptions = {},
): RenderedInvitationEmail {
  const i18n = emailI18n(options);
  const { inviterName, organizationName, role } = input;
  const appName = APP_NAME;
  const days = input.expiresInDays;

  const subject = i18n._(msg`${inviterName} invited you to ${organizationName} on ${appName}`);
  const expiryLine = i18n._(
    msg`${plural(days, {
      one: "This invitation expires in # day.",
      other: "This invitation expires in # days.",
    })}`,
  );

  const bodyLines = [
    i18n._(msg`${inviterName} invited you to join ${organizationName} on ${appName}.`),
    i18n._(msg`You have been invited with the ${role} role.`),
    expiryLine,
    i18n._(msg`If you were not expecting this invitation, you can ignore this email.`),
  ];

  const layout = renderLayout(
    {
      title: i18n._(msg`You are invited`),
      preheader: i18n._(msg`${inviterName} invited you to join ${organizationName}.`),
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      ctaLabel: i18n._(msg`Accept invitation`),
      ctaUrl: input.acceptUrl,
      footerText: i18n._(msg`This invitation was sent by ${appName}.`),
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
