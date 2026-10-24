import { describe, expect, jest, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import type { WearableConnectionLike } from "@openvalens/api/presenters/wearables";
import { wearableCallbackNotice } from "@openvalens/api/presenters/wearables";
import { englishI18n } from "@openvalens/i18n/testing";
import { AlertDialogAction } from "@openvalens/ui/components/alert-dialog";
import { Button } from "@openvalens/ui/components/button";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { WearableDevicesView, type WearableDevicesViewProps } from "./wearable-devices-view";

/** Renders inside an English I18nProvider: the component is translated (#67). */
function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

function row(overrides: Partial<WearableConnectionLike> = {}): WearableConnectionLike {
  return {
    provider: "oura",
    displayName: "Oura",
    status: "not_connected",
    lastSyncedAt: null,
    lastErrorCode: null,
    quarantinedRecordCount: 0,
    termsUrl: "https://example.test/terms",
    ...overrides,
  };
}

function makeProps(overrides: Partial<WearableDevicesViewProps> = {}): WearableDevicesViewProps {
  return {
    status: "ready",
    providers: [],
    notice: null,
    busyProvider: null,
    actionError: null,
    syncRequestedFor: null,
    confirm: null,
    onConfirmChange: () => {},
    onRetry: () => {},
    onConnect: () => {},
    onSyncNow: () => {},
    onDisconnect: () => {},
    onResolveQuarantine: () => {},
    ...overrides,
  };
}

type ReactElementLike = { type: unknown; props: Record<string, unknown> };

/** Depth-first search through the element tree, rendering function components it meets. */
function findAll(
  node: unknown,
  predicate: (element: ReactElementLike) => boolean,
): ReactElementLike[] {
  const found: ReactElementLike[] = [];
  const visit = (current: unknown) => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (!current || typeof current !== "object") return;
    const element = current as ReactElementLike;
    if (!element.props || typeof element.props !== "object") return;
    if (predicate(element)) found.push(element);
    visit(element.props.children);
  };
  visit(node);
  return found;
}

/** The tree WearableDevicesView returns plus each ProviderCard's, captured during a real render. */
function viewTree(props: WearableDevicesViewProps): unknown[] {
  const trees: unknown[] = [];
  function Capture() {
    const tree = WearableDevicesView(props);
    trees.push(tree);
    for (const card of findAll(
      tree,
      (element) => typeof element.type === "function" && "row" in element.props,
    ))
      trees.push((card.type as (p: unknown) => unknown)(card.props));
    return null;
  }
  renderToStaticMarkup(<Capture />);
  return trees;
}

/** Buttons whose rendered label is exactly `label`. */
function buttons(props: WearableDevicesViewProps, label: string) {
  return viewTree(props).flatMap((tree) =>
    findAll(
      tree,
      (element) =>
        element.type === Button &&
        renderToStaticMarkup(<>{element.props.children as ReactElement}</>) === label,
    ),
  );
}

describe("WearableDevicesView", () => {
  test("explains when the server has no vendor configured", () => {
    const html = renderToStaticMarkup(<WearableDevicesView {...makeProps()} />);
    expect(html).toInclude("No cloud devices are available on this server");
    expect(html).not.toInclude("Connect</button>");
  });

  test("lists only the vendors it is given, with status and what each sends", () => {
    const html = renderToStaticMarkup(
      <WearableDevicesView
        {...makeProps({
          providers: [
            row(),
            row({
              provider: "whoop",
              displayName: "WHOOP",
              status: "active",
              lastSyncedAt: "2026-10-20T06:00:00.000Z",
            }),
          ],
        })}
      />,
    );
    expect(html).toInclude("Oura");
    expect(html).toInclude("WHOOP");
    expect(html).not.toInclude("Polar");
    expect(html).toInclude("Not connected");
    expect(html).toInclude("Connected");
    expect(html).toInclude("Recovery score, overnight HRV");
    expect(html).toInclude(`Last synced ${new Date("2026-10-20T06:00:00.000Z").toLocaleString()}`);
    expect(html).toInclude("Sync now");
    expect(html).toInclude("Disconnect");
  });

  test("shows the callback notice", () => {
    const ok = renderToStaticMarkup(
      <WearableDevicesView
        {...makeProps({ notice: wearableCallbackNotice("connected", "Oura") })}
      />,
    );
    expect(ok).toInclude("Oura is connected");
    const denied = renderToStaticMarkup(
      <WearableDevicesView {...makeProps({ notice: wearableCallbackNotice("denied", "Oura") })} />,
    );
    expect(denied).toInclude("access was not granted");
  });

  test("shows the reconnect hint for a broken grant", () => {
    const html = renderToStaticMarkup(
      <WearableDevicesView
        {...makeProps({
          providers: [
            row({ status: "reconnect_needed", lastErrorCode: "reauthorization_required" }),
          ],
        })}
      />,
    );
    expect(html).toInclude("Reconnect needed");
    expect(html).toInclude("Connect again to resume syncing");
    expect(html).toInclude("Reconnect");
  });

  test("quarantine: shows the held-back count; keep resolves directly, delete asks first", () => {
    const onResolveQuarantine = jest.fn();
    const onConfirmChange = jest.fn();
    const props = makeProps({
      providers: [
        row({ status: "quarantined", quarantinedRecordCount: 12, lastErrorCode: "deauthorized" }),
      ],
      onResolveQuarantine,
      onConfirmChange,
    });
    const html = renderToStaticMarkup(<WearableDevicesView {...props} />);
    expect(html).toInclude("12 records are hidden");

    (buttons(props, "Keep records")[0]!.props.onClick as () => void)();
    expect(onResolveQuarantine).toHaveBeenCalledWith("oura", "keep");

    (buttons(props, "Delete records")[0]!.props.onClick as () => void)();
    expect(onConfirmChange).toHaveBeenCalledWith({ kind: "deleteQuarantined", provider: "oura" });
    expect(onResolveQuarantine).toHaveBeenCalledTimes(1);
  });

  test("connect and sync now call back with the provider", () => {
    const onConnect = jest.fn();
    const onSyncNow = jest.fn();
    const props = makeProps({
      providers: [row(), row({ provider: "polar", displayName: "Polar", status: "active" })],
      onConnect,
      onSyncNow,
    });
    (buttons(props, "Connect")[0]!.props.onClick as () => void)();
    expect(onConnect).toHaveBeenCalledWith("oura");
    (buttons(props, "Sync now")[0]!.props.onClick as () => void)();
    expect(onSyncNow).toHaveBeenCalledWith("polar");
  });

  test("disconnect dialog offers keep and delete, passing deleteData", () => {
    const onDisconnect = jest.fn();
    const props = makeProps({
      providers: [row({ status: "active" })],
      confirm: { kind: "disconnect", provider: "oura" },
      onDisconnect,
    });
    const actions = viewTree(props).flatMap((tree) =>
      findAll(tree, (element) => element.type === AlertDialogAction),
    );
    const keep = actions.find((action) => action.props["data-choice"] === "keep");
    const remove = actions.find((action) => action.props["data-choice"] === "delete");
    expect(remove?.props.variant).toBe("destructive");
    (keep!.props.onClick as () => void)();
    (remove!.props.onClick as () => void)();
    expect(onDisconnect.mock.calls).toEqual([
      ["oura", false],
      ["oura", true],
    ]);
  });

  test("shows a retry on load failure", () => {
    const html = renderToStaticMarkup(<WearableDevicesView {...makeProps({ status: "error" })} />);
    expect(html).toInclude("Could not load your devices.");
    expect(html).toInclude("Retry");
  });
});
