import { describe, expect, test } from "bun:test";

import { renderInvitationRevokedEmail } from "./invitation-revoked";

const INPUT = {
  inviterName: "Dr. Ada",
  organizationName: "Northwind Clinic",
};

describe("renderInvitationRevokedEmail", () => {
  test("uses the exact subject", () => {
    expect(renderInvitationRevokedEmail(INPUT).subject).toBe(
      "Your invitation to Northwind Clinic has been revoked",
    );
  });

  test("html contains the placeholder values", () => {
    const { html } = renderInvitationRevokedEmail(INPUT);

    expect(html).toContain("Northwind Clinic");
    expect(html).toContain("Dr. Ada");
    expect(html).toContain("revoked");
  });

  test("text contains the placeholder values", () => {
    const { text } = renderInvitationRevokedEmail(INPUT);

    expect(text).toContain("Northwind Clinic");
    expect(text).toContain("Dr. Ada");
  });
});
