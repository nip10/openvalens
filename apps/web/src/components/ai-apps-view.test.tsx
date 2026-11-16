import { describe, expect, jest, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import type { AiAppCallLike, AiAppGrantLike } from "@openvalens/api/presenters/ai-apps";
import { englishI18n } from "@openvalens/i18n/testing";
import { Switch } from "@openvalens/ui/components/switch";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { AiAppKeyCreated, AiAppKeyForm, type AiAppKeyFormProps } from "./ai-app-key-form";
import { AiAppsSettingsCard, type AiAppsSettingsCardProps } from "./ai-apps-settings-card";
import { AiAppActivity, AiAppsView, type AiAppsStatus, type AiAppsViewProps } from "./ai-apps-view";

function render(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const STATUS: AiAppsStatus = {
  enabled: true,
  consentVersion: "mcp-v2",
  membersCanConnect: true,
  isOwner: true,
  canCreate: true,
  blockedReason: null,
  baseScope: "records:read",
  optInScopes: ["nutrition:read", "private_body:read", "notes:read"],
  expiryDays: [30, 90, 365, null],
  defaultExpiryDays: 90,
  maxActiveKeys: 10,
  workspaceName: "Ada's records",
  mcpUrl: "https://health.example/api/mcp",
  oauthEnabled: true,
  writeScopes: ["water:write", "body:write", "vitals:write", "supplements:write"],
  writeLimits: { entriesPerCall: 100, entriesPerDay: 1000 },
};

function grant(overrides: Partial<AiAppGrantLike> = {}): AiAppGrantLike {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "personal_key",
    label: "Claude Code",
    scopes: ["records:read"],
    consentVersion: "mcp-v1",
    status: "active",
    displayPrefix: "ov_abc123",
    clientIdHost: null,
    clientHost: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    lastUsedAt: null,
    expiresAt: "2027-01-30T10:00:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}

function viewProps(overrides: Partial<AiAppsViewProps> = {}): AiAppsViewProps {
  return {
    status: STATUS,
    grantsStatus: "ready",
    grants: [],
    onRetry: () => {},
    confirmRevoke: null,
    onConfirmRevokeChange: () => {},
    onRevoke: () => {},
    revokingId: null,
    actionError: null,
    onCreateKey: () => {},
    renderActivity: () => null,
    ...overrides,
  };
}

describe("AiAppsView", () => {
  test("#settings-ai-apps-4: with nothing connected, the how-to leads and one line replaces both empty lists", () => {
    const html = render(<AiAppsView {...viewProps()} />);
    expect(html).toInclude("No apps or keys yet.");
    expect(html).not.toInclude("No apps connected yet");
    expect(html).not.toInclude("No personal keys");
    expect(html).toInclude("Create key");
    expect(html.indexOf("How to connect an app")).toBeLessThan(
      html.indexOf("No apps or keys yet."),
    );
    // Help pages for every client, and the server address.
    expect(html).toInclude("docs/help/ai-apps/claude-ai.md");
    expect(html).toInclude("docs/help/ai-apps/local-model.md");
    expect(html).toInclude("https://health.example/api/mcp");
  });

  test("once something is connected, both lists show and their empty states explain them", () => {
    const html = render(
      <AiAppsView {...viewProps({ grants: [grant({ kind: "oauth", displayPrefix: null })] })} />,
    );
    expect(html).toInclude("No personal keys");
    expect(html).toInclude("answer questions about your sleep, training and labs");
    expect(html).not.toInclude("No apps or keys yet.");
    expect(html.indexOf("Connections")).toBeLessThan(html.indexOf("How to connect an app"));
  });

  test("#settings-ai-apps-1: a 'Pick your app' tab bar swaps the steps", () => {
    const html = render(<AiAppsView {...viewProps()} />);
    expect(html).toInclude("Pick your app");
    expect(html.match(/role="tab"/g)?.length).toBe(6);
    // claude.ai starts selected; every other app's steps are in the page, hidden.
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>claude\.ai</);
    expect(html.match(/aria-selected="false"/g)?.length).toBe(5);
    expect(html.match(/role="tabpanel"/g)?.length).toBe(6);
    expect(html.match(/role="tabpanel"[^>]*hidden=""/g)?.length).toBe(5);
    expect(html).toInclude("open Customize › Connectors");
    expect(html).toInclude("Step-by-step guide");
  });

  test("a connection shows the app as unverified with its client host and Revoke", () => {
    const html = render(
      <AiAppsView
        {...viewProps({
          grants: [
            grant({
              id: "22222222-2222-4222-8222-222222222222",
              kind: "oauth",
              label: "Claude",
              displayPrefix: null,
              clientIdHost: "claude.ai",
              clientHost: "claude.ai",
              scopes: ["nutrition:read", "records:read"],
              expiresAt: null,
            }),
          ],
        })}
      />,
    );
    expect(html).toInclude("Unverified app");
    expect(html).toInclude("claude.ai");
    expect(html).toInclude("Nutrition, Your records");
    expect(html).toInclude("mcp-v1");
    // #507 — the self-declared name always comes with the host.
    expect(html).toInclude(">Claude (claude.ai)</h3>");
    expect(html).toInclude('aria-label="Revoke Claude (claude.ai)"');
  });

  test("a grant that can write lists what it may add, its entries and the delete action", () => {
    const html = render(
      <AiAppsView
        {...viewProps({
          grants: [grant({ scopes: ["records:read", "water:write"], entryCount: 3 })],
          onConfirmDeleteWritesChange: () => {},
          renderTimelineLink: () => <a href="/records/timeline">Show on timeline</a>,
        })}
      />,
    );
    expect(html).toInclude("Can add");
    expect(html).toInclude("Add water");
    expect(html).toInclude("Entries added");
    expect(html).toInclude("Show on timeline");
    expect(html).toInclude("Delete everything this app wrote");
  });

  test("a grant with no entries offers no delete action", () => {
    const html = render(
      <AiAppsView
        {...viewProps({
          grants: [grant({ scopes: ["records:read", "water:write"], entryCount: 0 })],
          onConfirmDeleteWritesChange: () => {},
        })}
      />,
    );
    expect(html).not.toInclude("Delete everything this app wrote");
  });

  test("a key shows its prefix and expiry, never more of the key", () => {
    const html = render(<AiAppsView {...viewProps({ grants: [grant()] })} />);
    expect(html).toInclude("ov_abc123…");
    expect(html).toInclude("Expires");
    expect(html).toInclude("Last used");
    expect(html).toInclude("Never");
  });

  test("revoked and expired grants move behind a closed details", () => {
    const html = render(
      <AiAppsView
        {...viewProps({
          grants: [grant({ status: "revoked", revokedAt: "2026-11-05T10:00:00.000Z" })],
        })}
      />,
    );
    expect(html).toInclude("No personal keys");
    expect(html).toInclude("1 revoked or expired");
    expect(html).not.toInclude('aria-label="Revoke Claude Code (personal key)"');
  });

  test("a member who is not the owner cannot create and is told why", () => {
    const html = render(
      <AiAppsView
        {...viewProps({
          status: { ...STATUS, canCreate: false, blockedReason: "NOT_OWNER", isOwner: false },
          onCreateKey: undefined,
        })}
      />,
    );
    expect(html).toInclude("only the workspace owner can connect AI apps");
    expect(html).not.toInclude("Create key");
  });

  test("the owner's switch being off is explained", () => {
    const html = render(
      <AiAppsView
        {...viewProps({
          status: { ...STATUS, canCreate: false, blockedReason: "WORKSPACE_DISABLED" },
        })}
      />,
    );
    expect(html).toInclude("turned off connecting AI apps");
  });

  test("the key limit disables Create key", () => {
    const keys = Array.from({ length: 10 }, (_, index) =>
      grant({ id: `00000000-0000-4000-8000-00000000000${index}`, label: `Key ${index}` }),
    );
    const html = render(<AiAppsView {...viewProps({ grants: keys })} />);
    expect(html).toInclude("the most allowed");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Create key/);
  });

  test("the server address and the Claude Code command each have a Copy button", () => {
    const html = render(<AiAppsView {...viewProps()} />);
    expect(html).toInclude("Copy address");
    expect(html).toInclude("Copy command");
    // Commands keep their words whole and scroll sideways instead of breaking mid-word.
    expect(html).toMatch(/<code[^>]*whitespace-pre[^>]*data-copy="command"[^>]*>claude mcp add/);
    expect(html).not.toMatch(/<code[^>]*break-all[^>]*data-copy="command"/);
  });

  test("without OAuth on the server, connections point to personal keys", () => {
    const html = render(
      <AiAppsView {...viewProps({ status: { ...STATUS, oauthEnabled: false } })} />,
    );
    expect(html).toInclude("which this server doesn&#x27;t offer");
    expect(html).not.toInclude("claude mcp add");
    // It starts at an app that works with a key.
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Claude Code</);
    const listed = render(
      <AiAppsView
        {...viewProps({
          status: { ...STATUS, oauthEnabled: false },
          grants: [grant()],
        })}
      />,
    );
    expect(listed).toInclude("Use a personal key instead.");
  });
});

describe("AiAppActivity", () => {
  const calls: AiAppCallLike[] = [
    {
      grantId: "g",
      tool: "labs",
      transport: "mcp",
      status: "ok",
      rowCount: 4,
      createdAt: "2026-11-12T10:00:00.000Z",
    },
    {
      grantId: "g",
      tool: "nutritionContext",
      transport: "mcp",
      status: "insufficient_scope",
      rowCount: null,
      createdAt: "2026-11-12T09:00:00.000Z",
    },
  ];

  test("lists tool, time, result and rows in a captioned table", () => {
    const html = render(<AiAppActivity status="ready" calls={calls} onRetry={() => {}} />);
    expect(html).toInclude("<caption");
    expect(html).toInclude("labs");
    expect(html).toInclude("Answered");
    expect(html).toInclude("Not allowed");
    expect(html).toInclude('dateTime="2026-11-12T10:00:00.000Z"');
  });

  test("says when nothing happened in 90 days", () => {
    expect(render(<AiAppActivity status="ready" calls={[]} onRetry={() => {}} />)).toInclude(
      "No requests in the last 90 days.",
    );
  });
});

function formProps(overrides: Partial<AiAppKeyFormProps> = {}): AiAppKeyFormProps {
  return {
    baseScope: "records:read",
    optInScopes: ["nutrition:read", "private_body:read", "notes:read"],
    expiryDays: [30, 90, 365, null],
    consentVersion: "mcp-v2",
    workspaceName: "Ada's records",
    draft: { label: "", scopes: [], expiresInDays: 90, agreed: false },
    onDraftChange: () => {},
    isSubmitting: false,
    error: null,
    onSubmit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

function inputOf(html: string, attribute: string): string {
  return html.match(new RegExp(`<input[^>]*${attribute}[^>]*>`))?.[0] ?? "";
}

function buttonOf(html: string, testId: string): string {
  return html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

describe("AiAppKeyForm", () => {
  test("base read is on and locked; sensitive scopes start unticked; no write scopes", () => {
    const html = render(<AiAppKeyForm {...formProps()} />);
    expect(inputOf(html, 'data-scope="records:read"')).toContain('checked=""');
    expect(inputOf(html, 'data-scope="records:read"')).toContain('disabled=""');
    for (const scope of ["nutrition:read", "private_body:read", "notes:read"]) {
      expect(inputOf(html, `data-scope="${scope}"`)).not.toContain("checked");
    }
    expect(html).not.toInclude(":write");
    expect(html).toInclude("Ada&#x27;s records");
  });

  test("write scopes are offered apart and start unticked", () => {
    const html = render(
      <AiAppKeyForm {...formProps({ writeScopes: ["water:write", "vitals:write"] })} />,
    );
    expect(html).toInclude("What the app may add");
    for (const scope of ["water:write", "vitals:write"]) {
      expect(inputOf(html, `data-scope="${scope}"`)).not.toContain("checked");
      expect(inputOf(html, `data-scope="${scope}"`)).not.toContain('disabled=""');
    }
  });

  test("expiry offers 30, 90, 365 days and never, with 90 chosen", () => {
    const html = render(<AiAppKeyForm {...formProps()} />);
    expect(inputOf(html, 'data-expiry="90"')).toContain('checked=""');
    for (const days of ["30", "365", "null"]) {
      expect(inputOf(html, `data-expiry="${days}"`)).not.toContain("checked");
    }
    expect(html).toInclude("1 year");
    expect(html).toInclude("Never");
  });

  test("creating needs a name and the explicit consent", () => {
    const submit = /<button[^>]*type="submit"[^>]*disabled/;
    expect(render(<AiAppKeyForm {...formProps()} />)).toMatch(submit);
    expect(
      render(
        <AiAppKeyForm
          {...formProps({
            draft: { label: "Cursor", scopes: [], expiresInDays: 90, agreed: false },
          })}
        />,
      ),
    ).toMatch(submit);
    const ready = render(
      <AiAppKeyForm
        {...formProps({ draft: { label: "Cursor", scopes: [], expiresInDays: 90, agreed: true } })}
      />,
    );
    expect(ready).not.toMatch(submit);
    expect(ready).toInclude("Consent mcp-v2");
    expect(ready).toInclude("separate from Coach AI consent");
  });

  test("the disclosure names the key's app and Create key waits for the unticked box (#518)", () => {
    const named = { label: "Cursor", scopes: [], expiresInDays: 90 as const };
    const unticked = render(
      <AiAppKeyForm {...formProps({ draft: { ...named, agreed: false } })} />,
    );
    expect(inputOf(unticked, 'data-testid="ai-app-key-consent"')).not.toContain("checked");
    expect(inputOf(unticked, 'data-testid="ai-app-key-consent"')).toBeTruthy();
    expect(buttonOf(unticked, "ai-app-key-create")).toContain('disabled=""');
    expect(unticked).toInclude(
      "Cursor is a third-party app, which can be an AI service. OpenValens doesn&#x27;t run it and has no agreement with it.",
    );
    expect(unticked).toInclude("may let it store your data or use it to train models");
    expect(unticked).toInclude("Never used for advertising and never sold.");
    expect(unticked).toInclude(
      "Disconnecting stops new reads at once but doesn&#x27;t delete what the app already has.",
    );
    expect(unticked).toInclude("I want to send this health data to Cursor");

    const ticked = render(<AiAppKeyForm {...formProps({ draft: { ...named, agreed: true } })} />);
    expect(buttonOf(ticked, "ai-app-key-create")).not.toContain('disabled=""');
  });

  test("before the key is named, the disclosure speaks of the app it will be used in", () => {
    const html = render(<AiAppKeyForm {...formProps()} />);
    expect(html).toInclude("The app you use this key in is a third-party app");
    expect(html).toInclude("I want to send this health data to the app I use this key in");
  });

  test("the scope wording says which Apple Health / Health Connect data is included", () => {
    const base = render(<AiAppKeyForm {...formProps()} />);
    expect(base).toInclude(
      "This includes data synced from Apple Health or Health Connect: steps, heart rate, sleep, weight, body composition and workouts.",
    );
    const withTrackers = render(
      <AiAppKeyForm
        {...formProps({
          optInScopes: ["nutrition:read", "trackers:read"],
          draft: { label: "", scopes: ["trackers:read"], expiresInDays: 90, agreed: false },
        })}
      />,
    );
    expect(withTrackers).toInclude("workouts, mindfulness and daily mood.");
  });
});

describe("AiAppKeyCreated", () => {
  test("shows the key once with a ready-to-paste Claude Code command", () => {
    const html = render(
      <AiAppKeyCreated
        apiKey="ov_secretvalue"
        label="Cursor"
        mcpUrl="https://health.example/api/mcp"
        onDone={() => {}}
      />,
    );
    expect(html).toInclude("ov_secretvalue");
    expect(html).toInclude("You will not see it again");
    expect(html).toInclude(
      "claude mcp add --transport http openvalens https://health.example/api/mcp --header &quot;Authorization: Bearer ov_secretvalue&quot;",
    );
    expect(html).toInclude("Copy key");
    expect(html).toInclude("Copy command");
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

function settingsSwitch(props: AiAppsSettingsCardProps): ReactElementLike {
  let tree: unknown;
  function Capture() {
    tree = AiAppsSettingsCard(props);
    return null;
  }
  render(<Capture />);
  const found = findElement(tree, (element) => element.type === Switch);
  if (!found) throw new Error("switch not found");
  return found;
}

describe("AiAppsSettingsCard", () => {
  const base: AiAppsSettingsCardProps = {
    setting: { membersCanConnect: true, canManage: true },
    settingStatus: "ready",
    isSaving: false,
    onRetry: () => {},
    onChange: () => {},
  };

  test("the owner can turn members' AI apps off", () => {
    const onChange = jest.fn();
    const control = settingsSwitch({ ...base, onChange });
    expect(control.props.checked).toBe(true);
    expect(control.props.disabled).toBe(false);
    expect(control.props["aria-label"]).toBe("Members can connect AI apps");
    (control.props.onCheckedChange as (checked: boolean) => void)(false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test("other members see it read-only", () => {
    const control = settingsSwitch({
      ...base,
      setting: { membersCanConnect: false, canManage: false },
    });
    expect(control.props.checked).toBe(false);
    expect(control.props.disabled).toBe(true);
  });
});
