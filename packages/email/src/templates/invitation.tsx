import { renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

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

export function renderInvitationEmail(
  input: InvitationEmailInput,
  options: EmailRenderOptions = {},
): RenderedInvitationEmail {
  const subject = `${input.inviterName} invited you to ${input.organizationName} on ${APP_NAME}`;
  const expiryLine =
    input.expiresInDays === 1
      ? "This invitation expires in 1 day."
      : `This invitation expires in ${input.expiresInDays} days.`;

  const bodyLines = [
    `${input.inviterName} invited you to join ${input.organizationName} on ${APP_NAME}.`,
    `You have been invited with the ${input.role} role.`,
    expiryLine,
    "If you were not expecting this invitation, you can ignore this email.",
  ];

  const layout = renderLayout(
    {
      title: "You are invited",
      preheader: `${input.inviterName} invited you to join ${input.organizationName}.`,
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      ctaLabel: "Accept invitation",
      ctaUrl: input.acceptUrl,
      footerText: `This invitation was sent by ${APP_NAME}.`,
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
