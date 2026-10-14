import { describe, expect, jest, test } from "bun:test";
import { AlertDialogAction } from "@openvalens/ui/components/alert-dialog";
import { Switch } from "@openvalens/ui/components/switch";
import { renderToStaticMarkup } from "react-dom/server";

import { AiConsentCard, type AiConsentCardProps } from "./ai-consent-card";

const GRANTED_AT = "2026-02-03T10:00:00.000Z";

const GRANTED_STATE = {
  granted: true,
  grantedAt: GRANTED_AT,
  revokedAt: null,
  consentVersion: "v1",
};

const REVOKED_STATE = {
  granted: false,
  grantedAt: GRANTED_AT,
  revokedAt: "2026-02-04T10:00:00.000Z",
  consentVersion: "v1",
};

function makeProps(overrides: Partial<AiConsentCardProps> = {}): AiConsentCardProps {
  return {
    status: "ready",
    state: null,
    isPending: false,
    confirmOpen: false,
    onConfirmOpenChange: () => {},
    onRetry: () => {},
    onGrant: () => {},
    onRequestRevoke: () => {},
    onRevoke: () => {},
    ...overrides,
  };
}

type ReactElementLike = { type: unknown; props: Record<string, unknown> };

/** Depth-first search of a React element tree (no DOM, no renderer needed). */
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

describe("AiConsentCard", () => {
  test("renders Not granted when consent is null", () => {
    const html = renderToStaticMarkup(<AiConsentCard {...makeProps({ state: null })} />);

    expect(html).toInclude("AI processing");
    expect(html).toInclude("Not granted");
    expect(html).not.toInclude("Granted on");
    expect(html).toInclude('data-state="unchecked"');
  });

  test("renders Not granted when consent is revoked", () => {
    const html = renderToStaticMarkup(<AiConsentCard {...makeProps({ state: REVOKED_STATE })} />);

    expect(html).toInclude("Not granted");
    expect(html).not.toInclude("Granted on");
    expect(html).toInclude('data-state="unchecked"');
  });

  test("renders Granted on <date> and the consent version when granted", () => {
    const html = renderToStaticMarkup(<AiConsentCard {...makeProps({ state: GRANTED_STATE })} />);

    const expectedDate = new Date(GRANTED_AT).toLocaleDateString();
    expect(html).toInclude(`Granted on ${expectedDate}`);
    expect(html).toInclude("Consent version v1");
    expect(html).not.toInclude("Not granted");
    expect(html).toInclude('data-state="checked"');
  });

  test("shows a skeleton and no switch while the query is pending", () => {
    const html = renderToStaticMarkup(<AiConsentCard {...makeProps({ status: "pending" })} />);

    expect(html).toInclude('data-slot="skeleton"');
    expect(html).not.toInclude("Not granted");
    expect(html).not.toInclude('data-slot="switch"');
  });

  test("shows an inline error with retry when the query fails", () => {
    const html = renderToStaticMarkup(<AiConsentCard {...makeProps({ status: "error" })} />);

    expect(html).toInclude("Could not load AI consent");
    expect(html).toInclude("Retry");
    expect(html).not.toInclude('data-slot="switch"');
  });

  test("flipping the switch on grants without opening the revoke dialog", () => {
    const onGrant = jest.fn();
    const onRequestRevoke = jest.fn();
    const tree = AiConsentCard(makeProps({ state: null, onGrant, onRequestRevoke }));

    const switchElement = findElement(tree, (element) => element.type === Switch);
    if (!switchElement) throw new Error("switch not found");

    (switchElement.props.onCheckedChange as (checked: boolean) => void)(true);

    expect(onGrant).toHaveBeenCalledTimes(1);
    expect(onRequestRevoke).not.toHaveBeenCalled();
  });

  test("flipping the switch off requests revoke confirmation instead of granting", () => {
    const onGrant = jest.fn();
    const onRequestRevoke = jest.fn();
    const tree = AiConsentCard(makeProps({ state: GRANTED_STATE, onGrant, onRequestRevoke }));

    const switchElement = findElement(tree, (element) => element.type === Switch);
    if (!switchElement) throw new Error("switch not found");

    (switchElement.props.onCheckedChange as (checked: boolean) => void)(false);

    expect(onRequestRevoke).toHaveBeenCalledTimes(1);
    expect(onGrant).not.toHaveBeenCalled();
  });

  test("confirming the destructive revoke action calls revoke", () => {
    const onRevoke = jest.fn();
    const tree = AiConsentCard(makeProps({ state: GRANTED_STATE, onRevoke }));

    const actionElement = findElement(tree, (element) => element.type === AlertDialogAction);
    if (!actionElement) throw new Error("revoke action not found");

    expect(actionElement.props.variant).toBe("destructive");
    (actionElement.props.onClick as () => void)();

    expect(onRevoke).toHaveBeenCalledTimes(1);
  });
});
