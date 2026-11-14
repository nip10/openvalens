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
  consentVersion: "mcp-v1",
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
  test("empty lists explain what this is in plain words", () => {
    const html = render(<AiAppsView {...viewProps()} />);
    expect(html).toInclude("No apps connected yet");
    expect(html).toInclude("No personal keys");
    expect(html).toInclude("answer questions about your sleep, training and labs");
    expect(html).toInclude("Create key");
    // Help pages for every client, and the server address.
    expect(html).toInclude("docs/help/ai-apps/claude-ai.md");
    expect(html).toInclude("docs/help/ai-apps/local-model.md");
    expect(html).toInclude("https://health.example/api/mcp");
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
    expect(html).toInclude('aria-label="Revoke Claude"');
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
    expect(html).not.toInclude('aria-label="Revoke Claude Code"');
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

  test("without OAuth on the server, connections point to personal keys", () => {
    const html = render(
      <AiAppsView {...viewProps({ status: { ...STATUS, oauthEnabled: false } })} />,
    );
    expect(html).toInclude("Use a personal key instead.");
    expect(html).not.toInclude("Claude Code, signing in from the app");
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
    consentVersion: "mcp-v1",
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
    expect(ready).toInclude("consent mcp-v1");
    expect(ready).toInclude("separate from Coach AI consent");
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
