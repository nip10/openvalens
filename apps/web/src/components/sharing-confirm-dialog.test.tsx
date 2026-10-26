import { describe, expect, jest, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@openvalens/ui/components/alert-dialog";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SharingConfirmDialog,
  type SharingConfirmDialogProps,
  type SharingConfirmTarget,
} from "./sharing-confirm-dialog";

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

function text(node: unknown): string {
  return renderToStaticMarkup(<I18nProvider i18n={englishI18n}>{node as ReactNode}</I18nProvider>);
}

function tree(props: SharingConfirmDialogProps) {
  const element = SharingConfirmDialog(props);
  const part = (type: unknown) => {
    const found = findElement(element, (candidate) => candidate.type === type);
    if (!found) throw new Error("element not found");
    return found;
  };
  return { element, part };
}

const MEMBER: SharingConfirmTarget = { kind: "member", userId: "u-2", name: "Ana Silva" };
const INVITATION: SharingConfirmTarget = {
  kind: "invitation",
  id: "inv-1",
  email: "rui@example.com",
};

describe("SharingConfirmDialog", () => {
  test("is closed when nothing waits for confirmation", () => {
    const { part } = tree({ target: null, onConfirm: () => {}, onCancel: () => {} });
    expect(part(AlertDialog).props.open).toBe(false);
  });

  test("names the member being removed and confirms with a destructive Remove", () => {
    const onConfirm = jest.fn();
    const { part } = tree({ target: MEMBER, onConfirm, onCancel: () => {} });

    expect(part(AlertDialog).props.open).toBe(true);
    expect(text(part(AlertDialogTitle).props.children)).toBe("Remove Ana Silva?");
    expect(text(part(AlertDialogDescription).props.children)).toInclude("lose access");

    const action = part(AlertDialogAction);
    expect(action.props.variant).toBe("destructive");
    expect(text(action.props.children)).toBe("Remove");
    (action.props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledWith(MEMBER);
  });

  test("names the invitation being revoked and confirms with a destructive Revoke", () => {
    const onConfirm = jest.fn();
    const { part } = tree({ target: INVITATION, onConfirm, onCancel: () => {} });

    expect(text(part(AlertDialogTitle).props.children)).toBe(
      "Revoke the invitation for rui@example.com?",
    );
    const action = part(AlertDialogAction);
    expect(action.props.variant).toBe("destructive");
    expect(text(action.props.children)).toBe("Revoke");
    (action.props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledWith(INVITATION);
  });

  test("closing the dialog cancels without confirming", () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { part } = tree({ target: MEMBER, onConfirm, onCancel });

    (part(AlertDialog).props.onOpenChange as (open: boolean) => void)(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
