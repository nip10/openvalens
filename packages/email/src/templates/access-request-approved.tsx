import { renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "OpenValens";

export type AccessRequestApprovedEmailInput = {
  requesterName: string;
  organizationName: string;
  loginUrl: string;
};

export type RenderedAccessRequestApprovedEmail = {
  subject: string;
  html: string;
  text: string;
};

export async function renderAccessRequestApprovedEmail(
  input: AccessRequestApprovedEmailInput,
  options: EmailRenderOptions = {},
): Promise<RenderedAccessRequestApprovedEmail> {
  const subject = `Access approved for ${input.organizationName} on ${APP_NAME}`;
  const bodyLines = [
    `${input.requesterName}, your access request for ${input.organizationName} has been approved.`,
    "You can now continue in your dashboard.",
  ];

  const layout = await renderLayout(
    {
      title: "Your access request was approved",
      preheader: `You can now access ${input.organizationName}.`,
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      ctaLabel: "Open dashboard",
      ctaUrl: input.loginUrl,
      footerText: `This is an automated update from ${APP_NAME} access controls.`,
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
