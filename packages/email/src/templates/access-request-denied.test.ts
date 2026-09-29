import { describe, expect, test } from "bun:test";

import { renderAccessRequestDeniedEmail } from "./access-request-denied";

const INPUT = {
  requesterName: "Dr. Ada",
  organizationName: "Northwind Clinic",
};

describe("renderAccessRequestDeniedEmail", () => {
  test("uses the exact subject", () => {
    expect(renderAccessRequestDeniedEmail(INPUT).subject).toBe(
      "Access request for Northwind Clinic was denied",
    );
  });

  test("html contains the placeholder values", () => {
    const { html } = renderAccessRequestDeniedEmail(INPUT);

    expect(html).toContain("Dr. Ada");
    expect(html).toContain("Northwind Clinic");
    expect(html).toContain("denied");
  });

  test("text contains the placeholder values", () => {
    const { text } = renderAccessRequestDeniedEmail(INPUT);

    expect(text).toContain("Dr. Ada");
    expect(text).toContain("Northwind Clinic");
  });
});
