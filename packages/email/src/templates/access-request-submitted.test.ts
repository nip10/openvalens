import { describe, expect, test } from "bun:test";

import { renderAccessRequestSubmittedEmail } from "./access-request-submitted";

const INPUT = {
  requesterName: "Dr. Ada",
  organizationName: "Northwind Clinic",
  reviewUrl: "https://app.example/access-requests/req_1?tab=pending",
};

describe("renderAccessRequestSubmittedEmail", () => {
  test("uses the exact subject", () => {
    expect(renderAccessRequestSubmittedEmail(INPUT).subject).toBe(
      "Dr. Ada requested access to Northwind Clinic",
    );
  });

  test("html contains the placeholder values and review link", () => {
    const { html } = renderAccessRequestSubmittedEmail(INPUT);

    expect(html).toContain("Dr. Ada");
    expect(html).toContain("Northwind Clinic");
    expect(html).toContain("Review request");
    expect(html).toContain('href="https://app.example/access-requests/req_1?tab=pending"');
  });

  test("text contains the placeholder values", () => {
    const { text } = renderAccessRequestSubmittedEmail(INPUT);

    expect(text).toContain("Dr. Ada");
    expect(text).toContain("Northwind Clinic");
    expect(text).toContain(INPUT.reviewUrl);
  });
});
