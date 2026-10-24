import { msg } from "@lingui/core/macro";

import { emailI18n, renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "Health";

export type InvitationRevokedEmailInput = {
  inviterName: string;
  organizationName: string;
};

export type RenderedInvitationRevokedEmail = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Workspace invitation revoked, in the recipient's language (#231). The
 * inviter and workspace names are user values and are not translated.
 */
export function renderInvitationRevokedEmail(
  input: InvitationRevokedEmailInput,
  options: EmailRenderOptions = {},
): RenderedInvitationRevokedEmail {
  const i18n = emailI18n(options);
  const { inviterName, organizationName } = input;
  const appName = APP_NAME;

  const subject = i18n._(msg`Your invitation to ${organizationName} has been revoked`);
  const bodyLines = [
    i18n._(
      msg`Your invitation from ${inviterName} to join ${organizationName} has been revoked and can no longer be used.`,
    ),
    i18n._(msg`If you still need access, contact your administrator.`),
  ];

  const layout = renderLayout(
    {
      title: i18n._(msg`Invitation revoked`),
      preheader: i18n._(msg`Your invitation to ${organizationName} is no longer active.`),
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      footerText: i18n._(msg`This is an automated update from ${appName}.`),
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
