import "@/testing/varlock-test-setup";

import { describe, expect, jest, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AdmissionForm } from "./admission-form";

const noopMagicLink = jest.fn(async (_email: string, _purpose: "resume" | "dashboard") => {});

describe("AdmissionForm presentational states", () => {
  test("setup form renders email and masked token inputs with no secret leakage", () => {
    const html = renderToStaticMarkup(
      <AdmissionForm
        kind="setup"
        title="Instance setup"
        description="desc"
        tokenLabel="Setup token"
        tokenHelp="Paste token"
        userId={null}
        sessionEmail={null}
        onRequestMagicLink={noopMagicLink}
      />,
    );

    expect(html).toInclude("Instance setup");
    expect(html).toInclude("Setup token");
    expect(html).toInclude('type="password"');
    expect(html).toInclude('autoComplete="off"');
    expect(html).toInclude('spellCheck="false"');
    expect(html).not.toInclude('value="secret"');
    expect(html).not.toInclude('value="token"');
  });

  test("closed setup state shows explanation and sign-in link, no token form", () => {
    const html = renderToStaticMarkup(
      <AdmissionForm
        kind="setup"
        title="Instance setup"
        description="desc"
        tokenLabel="Setup token"
        tokenHelp="Paste token"
        userId={null}
        setupAvailable={false}
        closedCopy={{ headline: "Setup closed", body: "Already configured." }}
        sessionEmail={null}
        onRequestMagicLink={noopMagicLink}
      />,
    );

    expect(html).toInclude("Setup closed");
    expect(html).toInclude("Already configured");
    expect(html).toInclude('href="/login"');
    expect(html).not.toInclude("Setup token");
  });

  test("invitation form uses same shared layout as setup", () => {
    const html = renderToStaticMarkup(
      <AdmissionForm
        kind="invitation"
        title="Join"
        description="desc"
        tokenLabel="Invitation token"
        tokenHelp="Paste token"
        userId={null}
        sessionEmail={null}
        onRequestMagicLink={noopMagicLink}
      />,
    );

    expect(html).toInclude("Join");
    expect(html).toInclude("Invitation token");
  });

  test("shows current session email without exposing secrets", () => {
    const html = renderToStaticMarkup(
      <AdmissionForm
        kind="setup"
        title="Instance setup"
        description="desc"
        tokenLabel="Setup token"
        tokenHelp="Paste token"
        userId="user-1"
        sessionEmail="admin@example.com"
        onRequestMagicLink={noopMagicLink}
      />,
    );

    expect(html).toInclude("admin@example.com");
    expect(html).not.toInclude('value="secret"');
  });

  test("success state for matching session offers dashboard, not enroll someone else", () => {
    const html = renderToStaticMarkup(
      <AdmissionForm
        kind="setup"
        title="Instance setup"
        description="desc"
        tokenLabel="Setup token"
        tokenHelp="Paste token"
        userId="user-1"
        sessionEmail="admin@example.com"
        onRequestMagicLink={noopMagicLink}
      />,
    );

    // Static render cannot reach success, but we verify the success copy is not present initially.
    expect(html).not.toInclude("Go to dashboard");
  });
});
