import { describe, expect, test } from "bun:test";

import { renderAccessRequestApprovedEmail } from "./access-request-approved";
import { renderAccessRequestDeniedEmail } from "./access-request-denied";
import { renderAccessRequestSubmittedEmail } from "./access-request-submitted";
import { renderInvitationReminderEmail } from "./invitation-reminder";
import { renderInvitationRevokedEmail } from "./invitation-revoked";
import { renderInvitationEmail } from "./invitation";
import { renderLayout } from "./layout";
import { renderMagicLinkEmail } from "./magic-link";

type Rendered = { subject: string; html: string; text: string };
type Renderer = (input: never, options?: { organizationName?: string }) => Rendered;

const ORG = "Northwind Clinic";
const URL = "https://app.example/action?token=abc123&org=org_1";

const CASES: Array<{ name: string; render: Renderer; input: unknown }> = [
  {
    name: "invitation",
    render: renderInvitationEmail as unknown as Renderer,
    input: {
      inviterName: "Dr. Ada",
      organizationName: ORG,
      acceptUrl: URL,
      expiresInDays: 2,
      role: "collaborator",
    },
  },
  {
    name: "invitation-reminder",
    render: renderInvitationReminderEmail as unknown as Renderer,
    input: {
      inviterName: "Dr. Ada",
      organizationName: ORG,
      acceptUrl: URL,
      expiresInDays: 2,
      role: "collaborator",
    },
  },
  {
    name: "invitation-revoked",
    render: renderInvitationRevokedEmail as unknown as Renderer,
    input: { inviterName: "Dr. Ada", organizationName: ORG },
  },
  {
    name: "magic-link",
    render: renderMagicLinkEmail as unknown as Renderer,
    input: { url: URL, expiresInMinutes: 10 },
  },
  {
    name: "access-request-approved",
    render: renderAccessRequestApprovedEmail as unknown as Renderer,
    input: { requesterName: "Dr. Ada", organizationName: ORG, loginUrl: URL },
  },
  {
    name: "access-request-submitted",
    render: renderAccessRequestSubmittedEmail as unknown as Renderer,
    input: { requesterName: "Dr. Ada", organizationName: ORG, reviewUrl: URL },
  },
  {
    name: "access-request-denied",
    render: renderAccessRequestDeniedEmail as unknown as Renderer,
    input: { requesterName: "Dr. Ada", organizationName: ORG },
  },
];

describe("template render options (organizationName)", () => {
  for (const { name, render, input } of CASES) {
    test(`${name}: default options render byte-identically to explicit OpenValens`, () => {
      const fallback = render(input as never);
      const explicit = render(input as never, { organizationName: "OpenValens" });

      expect(explicit.html).toBe(fallback.html);
      expect(explicit.text).toBe(fallback.text);
      expect(explicit.subject).toBe(fallback.subject);
    });

    test(`${name}: custom names change only the organization header, body stays identical`, () => {
      const fallback = render(input as never);
      const alpha = render(input as never, { organizationName: "Alpha" });
      const beta = render(input as never, { organizationName: "Beta" });

      expect(alpha.html).not.toBe(beta.html);
      expect(alpha.html.split("Alpha").join("OpenValens")).toBe(fallback.html);
      expect(beta.html.split("Beta").join("OpenValens")).toBe(fallback.html);
      // Subject and text body carry the input organization, not the branding.
      expect(alpha.subject).toBe(fallback.subject);
      expect(alpha.text).toBe(fallback.text);
    });
  }

  test("escapes the organization name in the header", () => {
    const rendered = renderInvitationEmail(CASES[0]?.input as never, {
      organizationName: "<Alpha & Co>",
    });

    expect(rendered.html).toContain("&lt;Alpha &amp; Co&gt;");
    expect(rendered.html).not.toContain("<Alpha & Co>");
  });

  test("renderLayout defaults its footer copy to OpenValens and honours an explicit name", () => {
    const base = {
      title: "Title",
      bodyHtml: "<p>body</p>",
      bodyText: "body",
    };

    const fallback = renderLayout(base);
    expect(fallback.text).toContain("This is an automated message from OpenValens.");

    const custom = renderLayout(base, { organizationName: "Alpha" });
    expect(custom.text).toContain("This is an automated message from Alpha.");
    expect(custom.html).toContain(">Alpha</p>");
  });
});
