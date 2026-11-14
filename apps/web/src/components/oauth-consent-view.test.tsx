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
  consentVersion: "mcp-v2",
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
    expect(html).toContain("Consent mcp-v2");
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

  test("write scopes are listed apart and start unticked even when the app asks", () => {
    const html = render({
      request: {
        ...REQUEST,
        scopes: [
          ...REQUEST.scopes,
          { scope: "water:write", required: false, requestedByApp: true },
          { scope: "vitals:write", required: false, requestedByApp: false },
        ],
      },
    });
    expect(html).toContain("What the app may add");
    expect(html).toContain("Add water");
    expect(html).toContain("Add vitals");
    expect(html).not.toContain("cannot change your records");
    for (const scope of ["water:write", "vitals:write"]) {
      expect(checkbox(html, scope)).not.toContain("checked");
    }
  });

  test("allows approving only after agreeing, in a workspace the member may connect", () => {
    expect(render()).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(render({ agreed: true })).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(render({ agreed: true, organizationId: "org-shared" })).toMatch(
      /<button[^>]*type="submit"[^>]*disabled/,
    );
    expect(render()).toContain("only the owner can connect apps");
  });

  test("Connect stays disabled until the unticked health-data box is ticked (#518)", () => {
    const connect = (html: string) =>
      html.match(/<button[^>]*data-testid="oauth-connect"[^>]*>/)?.[0] ?? "";
    const html = render();
    const box = html.match(/<input[^>]*data-testid="oauth-consent"[^>]*>/)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).not.toContain("checked");
    expect(connect(html)).toContain('disabled=""');
    expect(html).toContain("I want to send this health data to Claude");
    expect(connect(render({ agreed: true }))).not.toContain('disabled=""');
    expect(render({ agreed: true })).toContain(">Connect<");
  });

  test("discloses the third party, its own terms, the purpose and what disconnecting does", () => {
    const html = render();
    expect(html).toContain(
      "Claude is a third-party app, which can be an AI service. OpenValens doesn&#x27;t run it and has no agreement with it. Once it has your data, its own terms and privacy policy apply, which may let it store your data or use it to train models.",
    );
    expect(html).toContain(
      "Shared only so the app can help you with your own health and fitness. Never used for advertising and never sold.",
    );
    expect(html).toContain(
      "Disconnecting stops new reads at once but doesn&#x27;t delete what the app already has.",
    );
  });

  test("the scope wording names the phone data the chosen scopes reach", () => {
    const base = render();
    expect(base).toContain(
      "This includes data synced from Apple Health or Health Connect: steps, heart rate, sleep, weight, body composition and workouts.",
    );
    expect(base).not.toContain("mindfulness and daily mood");
    const request = {
      ...REQUEST,
      scopes: [
        ...REQUEST.scopes,
        { scope: "trackers:read", required: false, requestedByApp: true },
      ],
    };
    // Requested but not ticked: still only the base scope's phone data.
    expect(render({ request })).not.toContain("workouts, mindfulness and daily mood.");
    expect(render({ request, selectedScopes: ["trackers:read"] })).toContain(
      "workouts, mindfulness and daily mood.",
    );
  });

  test("explains a request that cannot be used", () => {
    const html = render({ status: "error", request: null, errorMessage: "Expired." });
    expect(html).toContain("This connection request cannot be used");
    expect(html).toContain("Expired.");
  });
});
