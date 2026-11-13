import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { OAuthConsentView, type OAuthConsentViewProps } from "./oauth-consent-view";

const REQUEST: NonNullable<OAuthConsentViewProps["request"]> = {
  client: {
    name: "Claude",
    clientIdHost: "claude.ai",
    registration: "cimd",
    redirectHost: "claude.ai",
    verified: false,
  },
  scopes: [
    { scope: "records:read", required: true, requestedByApp: true },
    { scope: "nutrition:read", required: false, requestedByApp: true },
    { scope: "private_body:read", required: false, requestedByApp: false },
    { scope: "notes:read", required: false, requestedByApp: false },
  ],
  workspaces: [
    { organizationId: "org-own", name: "Ada's records", allowed: true, reason: null },
    { organizationId: "org-shared", name: "Family", allowed: false, reason: "NOT_OWNER" },
  ],
  activeOrganizationId: "org-own",
  consentVersion: "mcp-v1",
};

function render(overrides: Partial<OAuthConsentViewProps> = {}): string {
  const props: OAuthConsentViewProps = {
    status: "ready",
    request: REQUEST,
    errorMessage: null,
    organizationId: "org-own",
    onOrganizationChange: () => {},
    selectedScopes: [],
    onScopeChange: () => {},
    agreed: false,
    onAgreedChange: () => {},
    isSubmitting: false,
    onApprove: () => {},
    onDeny: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <OAuthConsentView {...props} />
    </I18nProvider>,
  );
}

function checkbox(html: string, scope: string): string {
  return html.match(new RegExp(`<input[^>]*data-scope="${scope}"[^>]*>`))?.[0] ?? "";
}

describe("OAuthConsentView", () => {
  test("labels the app unverified and shows its identity and redirect hosts", () => {
    const html = render();
    expect(html).toContain("Connect Claude to OpenValens?");
    expect(html).toContain("Unverified app");
    expect(html).toContain("claude.ai");
    expect(html).toContain("mcp-v1");
  });

  test("ticks only the required scope; sensitive scopes start off even when requested", () => {
    const html = render();
    expect(checkbox(html, "records:read")).toContain('checked=""');
    expect(checkbox(html, "records:read")).toContain('disabled=""');
    for (const scope of ["nutrition:read", "private_body:read", "notes:read"]) {
      expect(checkbox(html, scope)).not.toContain("checked");
    }
    expect(html).toContain("Requested by the app");
    expect(html).toContain("cannot change your records");
  });

  test("allows approving only after agreeing, in a workspace the member may connect", () => {
    expect(render()).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(render({ agreed: true })).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(render({ agreed: true, organizationId: "org-shared" })).toMatch(
      /<button[^>]*type="submit"[^>]*disabled/,
    );
    expect(render()).toContain("only the owner can connect apps");
  });

  test("explains a request that cannot be used", () => {
    const html = render({ status: "error", request: null, errorMessage: "Expired." });
    expect(html).toContain("This connection request cannot be used");
    expect(html).toContain("Expired.");
  });
});
