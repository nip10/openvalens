import { msg } from "@lingui/core/macro";
import { Section, Text } from "react-email";
import { emailI18n, emailStyles, renderLayout, type EmailRenderOptions } from "./layout";

export async function renderAdmissionVerificationEmail(
  code: string,
  options: EmailRenderOptions = {},
) {
  const i18n = emailI18n(options);
  const codeLine = i18n._(msg`Your verification code is ${code}.`);
  const expiry = i18n._(msg`It expires in 10 minutes.`);
  const subject = i18n._(msg`Verify your email for OpenValens`);
  const layout = await renderLayout(
    {
      title: subject,
      preheader: codeLine,
      bodyHtml: (
        <Section>
          <Text style={emailStyles.paragraph}>{codeLine}</Text>
          <Text style={emailStyles.paragraph}>{expiry}</Text>
        </Section>
      ),
      bodyText: `${codeLine} ${expiry}`,
      hideFooter: true,
    },
    options,
  );
  return { subject, ...layout };
}
