import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { MyInvitationsView, type MyInvitationsViewProps } from "./my-invitations-view";

function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const NOW = Date.parse("2026-10-24T12:00:00Z");

const PENDING = {
  id: "inv-1",
  email: "me@example.test",
  role: "member",
  organizationId: "org-1",
  organizationName: "Acme Health",
  status: "pending",
  expiresAt: "2026-10-26T12:00:00Z",
  createdAt: "2026-10-24T11:00:00Z",
};

function props(overrides: Partial<MyInvitationsViewProps> = {}): MyInvitationsViewProps {
  return {
    sessionEmail: "me@example.test",
    listState: "ready",
    invitations: [PENDING],
    message: null,
    busy: null,
    now: NOW,
    onAccept: () => {},
    onDecline: () => {},
    onRetry: () => {},
    ...overrides,
  };
}

describe("MyInvitationsView (Issue #243)", () => {
  test("a pending invitation shows the workspace, role and accept/decline", () => {
    const html = renderToStaticMarkup(<MyInvitationsView {...props()} />);
    expect(html).toInclude("Your invitations · 1");
    expect(html).toInclude("Acme Health");
    expect(html).toInclude("member");
    expect(html).toInclude("Accept");
    expect(html).toInclude("Decline");
  });

  test("an expired invitation cannot be acted on", () => {
    const html = renderToStaticMarkup(
      <MyInvitationsView
        {...props({ invitations: [{ ...PENDING, expiresAt: "2026-10-23T12:00:00Z" }] })}
      />,
    );
    expect(html).toInclude("This invitation has expired.");
    expect(html).not.toInclude(">Accept<");
  });

  test("an invitation for another email is not actionable", () => {
    const html = renderToStaticMarkup(
      <MyInvitationsView
        {...props({ invitations: [{ ...PENDING, email: "other@example.test" }] })}
      />,
    );
    expect(html).toInclude("This invitation was sent to a different email address.");
  });

  test("empty, loading and error states", () => {
    expect(renderToStaticMarkup(<MyInvitationsView {...props({ invitations: [] })} />)).toInclude(
      "You have no pending workspace invitations.",
    );
    expect(
      renderToStaticMarkup(<MyInvitationsView {...props({ listState: "error" })} />),
    ).toInclude("Could not load invitations.");
    expect(
      renderToStaticMarkup(<MyInvitationsView {...props({ listState: "loading" })} />),
    ).not.toInclude("Acme Health");
  });

  test("a running accept disables both actions and shows progress", () => {
    const html = renderToStaticMarkup(
      <MyInvitationsView {...props({ busy: { id: "inv-1", action: "accept" } })} />,
    );
    expect(html).toInclude("Accepting…");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
