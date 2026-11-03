import { msg } from "@lingui/core/macro";
import { Link, Section, Text } from "react-email";
import { emailI18n, emailStyles, renderLayout, type EmailRenderOptions } from "./layout";

export async function renderAdmissionInvitationEmail(
  input: { token: string; joinUrl?: string | null },
  options: EmailRenderOptions = {},
) {
  const i18n = emailI18n(options);
  const token = input.token;
  const invited = i18n._(msg`You have been invited to OpenValens.`);
  const tokenLine = i18n._(msg`Your invitation token is ${token}.`);
  const joinLine = (url: string) =>
    i18n._(msg`To create your account, open ${url} and paste the token.`);
  const bodyText = `${invited} ${tokenLine}${input.joinUrl ? ` ${joinLine(input.joinUrl)}` : ""}`;
  const subject = i18n._(msg`You’re invited to OpenValens`);
  const layout = await renderLayout(
    {
      title: subject,
      preheader: invited,
      bodyHtml: (
        <Section>
          <Text style={emailStyles.paragraph}>{invited}</Text>
          <Text style={emailStyles.paragraph}>{tokenLine}</Text>
          {input.joinUrl ? (
            <Text style={emailStyles.paragraph}>
              <Link href={input.joinUrl} style={emailStyles.link}>
                {joinLine(input.joinUrl)}
              </Link>
            </Text>
          ) : null}
        </Section>
      ),
      bodyText,
      hideFooter: true,
    },
    options,
  );
  return { subject, ...layout };
}
