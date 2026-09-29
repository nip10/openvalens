import { describe, expect, test } from "bun:test";

import { renderInvitationEmail } from "./invitation";

const INPUT = {
  inviterName: "Dr. Ada",
  organizationName: "Northwind Clinic",
  acceptUrl: "https://app.example/accept-invitation?invitation=inv_1&org=org_1",
  expiresInDays: 2,
  role: "collaborator",
};

describe("renderInvitationEmail", () => {
  test("uses the exact subject", () => {
    expect(renderInvitationEmail(INPUT).subject).toBe(
      "Dr. Ada invited you to Northwind Clinic on Health",
    );
  });

  test("html contains the inviter, organization, role, and accept link", () => {
    const { html } = renderInvitationEmail(INPUT);

    expect(html).toContain("Dr. Ada");
    expect(html).toContain("Northwind Clinic");
    expect(html).toContain("collaborator");
    expect(html).toContain("Accept invitation");
    expect(html).toContain(
      'href="https://app.example/accept-invitation?invitation=inv_1&amp;org=org_1"',
    );
  });

  test("text contains the placeholder values", () => {
    const { text } = renderInvitationEmail(INPUT);

    expect(text).toContain("Dr. Ada");
    expect(text).toContain("Northwind Clinic");
    expect(text).toContain("collaborator");
    expect(text).toContain(INPUT.acceptUrl);
  });

  test("singularises the expiry copy for one day", () => {
    const { text } = renderInvitationEmail({ ...INPUT, expiresInDays: 1 });

    expect(text).toContain("expires in 1 day.");
  });
});
