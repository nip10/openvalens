import { msg } from "@lingui/core/macro";
import { Link, Section, Text } from "react-email";
import { emailI18n, emailStyles, renderLayout, type EmailRenderOptions } from "./layout";

export async function renderPublicSignUpEmail(
  input: { url: string },
  options: EmailRenderOptions = {},
) {
  const i18n = emailI18n(options);
  const intro = i18n._(msg`Confirm your email to create your OpenValens account.`);
  const action = i18n._(msg`Create my account`);
  const expiry = i18n._(msg`The link expires in 1 hour and works once.`);
  const ignore = i18n._(
    msg`If you didn’t ask to create an account, ignore this email. No account is created unless the link is used.`,
  );
  const subject = i18n._(msg`Create your OpenValens account`);
  const layout = await renderLayout(
    {
      title: subject,
      preheader: intro,
      bodyHtml: (
        <Section>
          <Text style={emailStyles.paragraph}>{intro}</Text>
          <Text style={emailStyles.paragraph}>
            <Link href={input.url} style={emailStyles.link}>
              {action}
            </Link>
          </Text>
          <Text style={emailStyles.paragraph}>{expiry}</Text>
          <Text style={emailStyles.paragraph}>{ignore}</Text>
        </Section>
      ),
      bodyText: `${intro}\n\n${action}: ${input.url}\n\n${expiry}\n\n${ignore}`,
      hideFooter: true,
    },
    options,
  );
  return { subject, ...layout, templateName: "public-sign-up" as const };
}
