import { describe, expect, jest, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { AdminInvitationsView, InvitationsList } from "./admin-invitations-view";
import { SharingConfirmDialog } from "./sharing-confirm-dialog";

/** Renders inside an English I18nProvider: the component is translated (#67). */
function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const SAMPLE_INVITATIONS = [
  {
    id: "inv-1",
    email: "one@example.com",
    expiresAt: new Date("2026-01-01T00:00:00Z"),
    consumedAt: null,
    status: "pending" as const,
  },
  {
    id: "inv-2",
    email: "two@example.com",
    expiresAt: new Date("2025-01-01T00:00:00Z"),
    consumedAt: null,
    status: "expired" as const,
  },
  {
    id: "inv-3",
    email: "three@example.com",
    expiresAt: new Date("2026-01-01T00:00:00Z"),
    consumedAt: new Date("2026-01-02T00:00:00Z"),
    status: "consumed" as const,
  },
];

describe("AdminInvitationsView", () => {
  test("granted view shows issue form and invitation list", () => {
    const html = renderToStaticMarkup(
      <AdminInvitationsView
        accessState="granted"
        listState="ready"
        invitations={SAMPLE_INVITATIONS}
      />,
    );

    expect(html).toInclude("Instance invitations");
    expect(html).toInclude("Invite a user");
    expect(html).toInclude("one@example.com");
    expect(html).toInclude("two@example.com");
    expect(html).toInclude("three@example.com");
    expect(html).toInclude("Pending");
    expect(html).toInclude("Expired");
    expect(html).toInclude("Consumed");
    // Revoke only on pending rows.
    expect(html.match(/Revoke/g)?.length).toBeGreaterThanOrEqual(1);
  });

  test("pending invitations show revoke affordance; consumed/expired do not", () => {
    const html = renderToStaticMarkup(
      <AdminInvitationsView
        accessState="granted"
        listState="ready"
        invitations={SAMPLE_INVITATIONS}
      />,
    );

    // Count revoke buttons: should only appear for the single pending item.
    const matches = html.match(/Revoke/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("denied state hides issue form and list", () => {
    const html = renderToStaticMarkup(<AdminInvitationsView accessState="denied" />);

    expect(html).toInclude("Access denied");
    expect(html).not.toInclude("Invite a user");
    expect(html).not.toInclude("one@example.com");
  });

  test("loading state shows skeleton and no list data", () => {
    const html = renderToStaticMarkup(
      <AdminInvitationsView accessState="granted" listState="loading" />,
    );

    expect(html).toInclude('data-slot="skeleton"');
    expect(html).not.toInclude("one@example.com");
  });

  test("issue success shows value-free confirmation, never echoing input", () => {
    const html = renderToStaticMarkup(
      <AdminInvitationsView
        accessState="granted"
        listState="ready"
        invitations={[]}
        issueState="success"
      />,
    );

    expect(html).toInclude("Invitation sent");
    expect(html).not.toInclude("secret");
    expect(html).not.toInclude("bearer");
  });

  test("empty list shows no-invitations copy", () => {
    const html = renderToStaticMarkup(
      <AdminInvitationsView accessState="granted" listState="ready" invitations={[]} />,
    );

    expect(html).toInclude("No invitations yet");
  });
});

type ReactElementLike = { type: unknown; props: Record<string, unknown> };

function findElement(
  node: unknown,
  predicate: (element: ReactElementLike) => boolean,
): ReactElementLike | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const element = node as ReactElementLike;
  if (!element.props || typeof element.props !== "object") return undefined;
  if (predicate(element)) return element;
  return findElement(element.props.children, predicate);
}

/** The element tree InvitationsList returns, captured inside a Lingui provider. */
function listTree(props: Parameters<typeof InvitationsList>[0]): unknown {
  let tree: unknown;
  function Capture() {
    tree = InvitationsList(props);
    return null;
  }
  renderToStaticMarkup(<Capture />);
  return tree;
}

describe("InvitationsList revoke confirm", () => {
  test("asks to confirm, naming the email, before revoking", () => {
    const onRevoke = jest.fn();
    const onRequestRevoke = jest.fn();
    const props = {
      invitations: SAMPLE_INVITATIONS,
      confirmRevoke: null,
      revokingId: null,
      revokeError: null,
      onRequestRevoke,
      onRevoke,
    };

    const idle = findElement(listTree(props), (element) => element.type === SharingConfirmDialog);
    expect(idle?.props.target).toBeNull();

    const confirming = findElement(
      listTree({ ...props, confirmRevoke: "inv-1" }),
      (element) => element.type === SharingConfirmDialog,
    );
    if (!confirming) throw new Error("confirm dialog not found");
    expect(confirming.props.target).toEqual({
      kind: "invitation",
      id: "inv-1",
      email: "one@example.com",
    });
    expect(onRevoke).not.toHaveBeenCalled();

    (confirming.props.onConfirm as (target: unknown) => void)(confirming.props.target);
    expect(onRevoke).toHaveBeenCalledWith("inv-1");
  });
});
