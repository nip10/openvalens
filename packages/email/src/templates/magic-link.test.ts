import { describe, expect, test } from "bun:test";

import { renderMagicLinkEmail } from "./magic-link";

const URL =
  "https://app.example/api/auth/magic-link/verify?token=abc123&callbackURL=https%3A%2F%2Fapp.example";

describe("renderMagicLinkEmail", () => {
  test("uses the exact subject", () => {
    const email = renderMagicLinkEmail({ url: URL, expiresInMinutes: 10 });

    expect(email.subject).toBe("Sign in to OpenValens");
  });

  test("html contains the sign-in link and expiry copy", () => {
    const email = renderMagicLinkEmail({ url: URL, expiresInMinutes: 10 });

    expect(email.html).toContain("Sign in");
    expect(email.html).toContain("expires in 10 minutes");
    // HTML-escaped ampersand, query string otherwise untouched.
    expect(email.html).toContain(
      'href="https://app.example/api/auth/magic-link/verify?token=abc123&amp;callbackURL=https%3A%2F%2Fapp.example"',
    );
  });

  test("text contains the fallback url and expiry copy", () => {
    const email = renderMagicLinkEmail({ url: URL, expiresInMinutes: 10 });

    expect(email.text).toContain(URL);
    expect(email.text).toContain("expires in 10 minutes");
  });

  test("falls back to the generic expiry copy without a duration", () => {
    const email = renderMagicLinkEmail({ url: URL });

    expect(email.text).toContain("expires soon");
  });

  test("never mangles the server-built query string", () => {
    const email = renderMagicLinkEmail({ url: URL, expiresInMinutes: 10 });

    expect(email.html).not.toContain("%3F");
    expect(email.html).not.toContain("%26");
  });
});
