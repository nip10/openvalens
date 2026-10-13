import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  adminAccessQueryKey,
  adminConfigurationQueryKey,
  type AdminConfigurationEntry,
} from "@/utils/admin-settings-keys";

import { AdminSettingsView } from "./admin-settings-view";

function render(view: React.ReactElement) {
  return renderToStaticMarkup(view);
}

function makeEntries(count: number): AdminConfigurationEntry[] {
  const entries: AdminConfigurationEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      key: `ENV_KEY_${i}`,
      configured: i % 2 === 0,
      sensitive: i % 3 === 0,
    });
  }
  return entries;
}

describe("AdminSettingsView", () => {
  test("admin sees all configuration keys with configured and sensitive badges", () => {
    const entries = makeEntries(20);
    const html = render(
      <AdminSettingsView accessState="granted" configState="ready" entries={entries} />,
    );

    expect(html).toInclude("Instance configuration");
    expect(html).toInclude("Administration");
    expect(html).toInclude("Environment configuration");

    for (const entry of entries) {
      expect(html).toInclude(entry.key);
    }

    expect(html).toInclude("Configured");
    expect(html).toInclude("Not set");
    expect(html).toInclude("Sensitive");

    // No raw values or copy controls should appear.
    expect(html).not.toInclude("value=");
    expect(html).not.toInclude("copy");
    expect(html).not.toInclude("secret");
  });

  test("ignores unexpected extra fields on entries", () => {
    const entries = [
      {
        key: "PUBLIC_KEY",
        configured: true,
        sensitive: false,
        value: "should-not-render",
        rawUrl: "https://example.com/secret",
      },
    ] as unknown as AdminConfigurationEntry[];

    const html = render(
      <AdminSettingsView accessState="granted" configState="ready" entries={entries} />,
    );

    expect(html).toInclude("PUBLIC_KEY");
    expect(html).not.toInclude("should-not-render");
    expect(html).not.toInclude("https://example.com/secret");
  });

  test("ordinary user is denied and sees no keys", () => {
    const html = render(<AdminSettingsView accessState="denied" />);

    expect(html).toInclude("Access denied");
    expect(html).toInclude("You do not have access to instance administration");
    expect(html).not.toInclude("Environment configuration");
    expect(html).not.toInclude("ENV_KEY");
  });

  test("loading access shows skeleton and no keys", () => {
    const html = render(<AdminSettingsView accessState="loading" />);

    expect(html).toInclude("Environment configuration");
    expect(html).not.toInclude("ENV_KEY");
    expect(html).not.toInclude("Access denied");
  });

  test("access error shows retry and no keys", () => {
    const html = render(<AdminSettingsView accessState="error" onRetryAccess={() => {}} />);

    expect(html).toInclude("Could not verify admin access");
    expect(html).toInclude("Retry");
    expect(html).not.toInclude("ENV_KEY");

    const button = html.match(/<button[^>]*>Retry<\/button>/);
    expect(button).not.toBeNull();
  });

  test("config loading with granted access shows skeleton and no keys", () => {
    const html = render(<AdminSettingsView accessState="granted" configState="loading" />);

    expect(html).toInclude("Environment configuration");
    expect(html).not.toInclude("ENV_KEY");
  });

  test("config fetching with cached entries hides stale inventory", () => {
    const entries = makeEntries(20);
    const html = render(
      <AdminSettingsView accessState="granted" configState="loading" entries={entries} />,
    );

    expect(html).toInclude("Environment configuration");
    expect(html).not.toInclude("ENV_KEY_0");
  });

  test("config error with granted access shows retry and no keys", () => {
    const html = render(
      <AdminSettingsView accessState="granted" configState="error" onRetryConfig={() => {}} />,
    );

    expect(html).toInclude("Could not load instance configuration");
    expect(html).toInclude("Retry");
    expect(html).not.toInclude("ENV_KEY");
  });

  test("config permission denied shows denied card and no keys", () => {
    const entries = makeEntries(20);
    const html = render(
      <AdminSettingsView accessState="granted" configState="denied" entries={entries} />,
    );

    expect(html).toInclude("Access denied");
    expect(html).toInclude("You do not have access to instance administration");
    expect(html).not.toInclude("ENV_KEY_0");
  });

  test("ready with empty entries shows empty message", () => {
    const html = render(
      <AdminSettingsView accessState="granted" configState="ready" entries={[]} />,
    );

    expect(html).toInclude("No configuration keys reported");
  });

  test("denied state never leaks cached inventory keys", () => {
    const entries = makeEntries(20);
    const html = render(
      <AdminSettingsView accessState="denied" configState="ready" entries={entries} />,
    );

    expect(html).toInclude("Access denied");
    expect(html).not.toInclude("Environment configuration");
    expect(html).not.toInclude("ENV_KEY_0");
  });
});

describe("admin-settings query keys", () => {
  test("access query key is scoped to the signed-in user id", () => {
    expect(adminAccessQueryKey("user-a")).toEqual(["admin-settings", "access", "user-a"]);
    expect(adminAccessQueryKey("user-b")).toEqual(["admin-settings", "access", "user-b"]);
    expect(adminAccessQueryKey("user-a")).not.toEqual(adminAccessQueryKey("user-b"));
  });

  test("configuration query key is scoped to the signed-in user id", () => {
    expect(adminConfigurationQueryKey("user-a")).toEqual([
      "admin-settings",
      "configuration",
      "user-a",
    ]);
    expect(adminConfigurationQueryKey("user-b")).toEqual([
      "admin-settings",
      "configuration",
      "user-b",
    ]);
    expect(adminConfigurationQueryKey("user-a")).not.toEqual(adminConfigurationQueryKey("user-b"));
  });
});
