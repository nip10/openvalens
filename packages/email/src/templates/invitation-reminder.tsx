import { renderLayout, renderParagraphs } from "./layout";

const APP_NAME = "Health";

export type InvitationReminderEmailInput = {
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
  expiresInDays: number;
  role: string;
};

export type RenderedInvitationReminderEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderInvitationReminderEmail(
  input: InvitationReminderEmailInput,
): RenderedInvitationReminderEmail {
  const subject = `Reminder: join ${input.organizationName} on ${APP_NAME}`;
  const expiryLine =
    input.expiresInDays === 1
      ? "This invitation expires in 1 day."
      : `This invitation expires in ${input.expiresInDays} days.`;

  const bodyLines = [
    `You still have a pending invitation from ${input.inviterName} to join ${input.organizationName}.`,
    `You were invited with the ${input.role} role.`,
    expiryLine,
    "If you no longer need access, you can ignore this message.",
  ];

  const layout = renderLayout({
    title: "Invitation reminder",
    preheader: `You still have a pending invitation to ${input.organizationName}.`,
    bodyHtml: renderParagraphs(bodyLines),
    bodyText: bodyLines.join("\n\n"),
    ctaLabel: "Accept invitation",
    ctaUrl: input.acceptUrl,
    footerText: `This reminder was sent by ${APP_NAME}.`,
  });

  return { subject, html: layout.html, text: layout.text };
}
