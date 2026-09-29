import { renderLayout, renderParagraphs } from "./layout";

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

export function renderInvitationRevokedEmail(
  input: InvitationRevokedEmailInput,
): RenderedInvitationRevokedEmail {
  const subject = `Your invitation to ${input.organizationName} has been revoked`;
  const bodyLines = [
    `Your invitation from ${input.inviterName} to join ${input.organizationName} has been revoked and can no longer be used.`,
    "If you still need access, contact your administrator.",
  ];

  const layout = renderLayout({
    title: "Invitation revoked",
    preheader: `Your invitation to ${input.organizationName} is no longer active.`,
    bodyHtml: renderParagraphs(bodyLines),
    bodyText: bodyLines.join("\n\n"),
    footerText: `This is an automated update from ${APP_NAME}.`,
  });

  return { subject, html: layout.html, text: layout.text };
}
