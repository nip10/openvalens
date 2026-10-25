import { describe, expect, test } from "bun:test";

import { renderAccessRequestApprovedEmail } from "./access-request-approved";

const INPUT = {
  requesterName: "Dr. Ada",
  organizationName: "Northwind Clinic",
  loginUrl: "https://app.example/login",
};

describe("renderAccessRequestApprovedEmail", () => {
  test("uses the exact subject", () => {
    expect(renderAccessRequestApprovedEmail(INPUT).subject).toBe(
      "Access approved for Northwind Clinic on OpenValens",
    );
  });

  test("html contains the placeholder values and login link", () => {
    const { html } = renderAccessRequestApprovedEmail(INPUT);

    expect(html).toContain("Dr. Ada");
    expect(html).toContain("Northwind Clinic");
    expect(html).toContain("Open dashboard");
    expect(html).toContain('href="https://app.example/login"');
  });

  test("text contains the placeholder values", () => {
    const { text } = renderAccessRequestApprovedEmail(INPUT);

    expect(text).toContain("Dr. Ada");
    expect(text).toContain("Northwind Clinic");
    expect(text).toContain(INPUT.loginUrl);
  });
});
