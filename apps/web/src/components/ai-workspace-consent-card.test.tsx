import { describe, expect, jest, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { Switch } from "@openvalens/ui/components/switch";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import {
  AiWorkspaceConsentCard,
  type AiWorkspaceConsentCardProps,
} from "./ai-workspace-consent-card";

function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

function makeProps(
  overrides: Partial<AiWorkspaceConsentCardProps> = {},
): AiWorkspaceConsentCardProps {
  return {
    status: "ready",
    state: { enabled: false, canManage: true },
    isPending: false,
    onRetry: () => {},
    onChange: () => {},
    ...overrides,
  };
}

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

function cardTree(props: AiWorkspaceConsentCardProps): unknown {
  let tree: unknown;
  function Capture() {
    tree = AiWorkspaceConsentCard(props);
    return null;
  }
  renderToStaticMarkup(<Capture />);
  return tree;
}

function switchOf(props: AiWorkspaceConsentCardProps): ReactElementLike {
  const found = findElement(cardTree(props), (element) => element.type === Switch);
  if (!found) throw new Error("switch not found");
  return found;
}

describe("AiWorkspaceConsentCard", () => {
  test("explains that the owner allows AI and each person still consents", () => {
    const html = renderToStaticMarkup(<AiWorkspaceConsentCard {...makeProps()} />);
    expect(html).toInclude("AI for this workspace");
    expect(html).toInclude("The workspace owner decides");
    expect(html).toInclude("each person still has to give their own consent");
  });

  test("the owner gets an enabled switch reflecting the state", () => {
    const html = renderToStaticMarkup(
      <AiWorkspaceConsentCard {...makeProps({ state: { enabled: true, canManage: true } })} />,
    );
    expect(html).toInclude("On for this workspace");
    expect(html).toInclude("As the owner, you can change this.");
    expect(html).toInclude('data-state="checked"');
    expect(switchOf(makeProps({ state: { enabled: true, canManage: true } })).props.disabled).toBe(
      false,
    );
  });

  test("other members see the state read-only", () => {
    const html = renderToStaticMarkup(
      <AiWorkspaceConsentCard {...makeProps({ state: { enabled: false, canManage: false } })} />,
    );
    expect(html).toInclude("Off for this workspace");
    expect(html).toInclude("Only the workspace owner can change this.");
    expect(
      switchOf(makeProps({ state: { enabled: false, canManage: false } })).props.disabled,
    ).toBe(true);
  });

  test("flipping the switch reports the new value", () => {
    const onChange = jest.fn();
    const switchElement = switchOf(makeProps({ onChange }));

    (switchElement.props.onCheckedChange as (checked: boolean) => void)(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("shows a skeleton while pending and a retry on error", () => {
    expect(
      renderToStaticMarkup(<AiWorkspaceConsentCard {...makeProps({ status: "pending" })} />),
    ).toInclude('data-slot="skeleton"');
    const error = renderToStaticMarkup(
      <AiWorkspaceConsentCard {...makeProps({ status: "error" })} />,
    );
    expect(error).toInclude("Could not load the workspace AI setting.");
    expect(error).toInclude("Retry");
  });
});
