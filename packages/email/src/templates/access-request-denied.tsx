import { renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "Health";

export type AccessRequestDeniedEmailInput = {
  requesterName: string;
  organizationName: string;
};

export type RenderedAccessRequestDeniedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderAccessRequestDeniedEmail(
  input: AccessRequestDeniedEmailInput,
  options: EmailRenderOptions = {},
): RenderedAccessRequestDeniedEmail {
  const subject = `Access request for ${input.organizationName} was denied`;
  const bodyLines = [
    `${input.requesterName}, your access request for ${input.organizationName} was denied.`,
    "If you believe this decision is incorrect, contact your administrator.",
  ];

  const layout = renderLayout(
    {
      title: "Your access request was denied",
      preheader: `Your request for ${input.organizationName} was not approved.`,
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      footerText: `This is an automated update from ${APP_NAME} access controls.`,
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
