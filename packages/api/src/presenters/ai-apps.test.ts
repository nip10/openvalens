import { describe, expect, test } from "bun:test";
import { GRANTABLE_SCOPES } from "@openvalens/mcp/scopes";

import { createAppI18n } from "@openvalens/i18n";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  AI_APP_DISCLOSURE,
  AI_APPS_HELP_PAGES,
  aiAppPlatformDataNotice,
  aiAppCallStatusLabel,
  aiAppCallTone,
  aiAppExpiryLabel,
  aiAppDraftIdentity,
  aiAppGrantIdentity,
  aiAppName,
  aiAppScopeTitle,
  aiAppSourceLabel,
  aiAppsHelpUrl,
  isAiAppWriteScope,
  claudeCodeKeyCommand,
  claudeCodeOAuthCommand,
  splitGrants,
  type AiAppGrantLike,
} from "./ai-apps";

const portugueseI18n = createAppI18n("pt-PT");

function grant(id: string, kind: AiAppGrantLike["kind"], status: AiAppGrantLike["status"]) {
  return {
    id,
    kind,
    label: id,
    scopes: ["records:read"],
    consentVersion: "mcp-v1",
    status,
    displayPrefix: null,
    clientIdHost: null,
    clientHost: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  } satisfies AiAppGrantLike;
}

describe("ai apps presenter", () => {
  test("every grantable scope has a label", () => {
    for (const scope of GRANTABLE_SCOPES) expect(aiAppScopeTitle(scope)).not.toBeNull();
    expect(aiAppScopeTitle("water:write")).not.toBeNull();
    expect(aiAppScopeTitle("workouts:write")).not.toBeNull();
    expect(aiAppScopeTitle("food:write")).not.toBeNull();
    expect(aiAppScopeTitle("labs:write")).not.toBeNull();
    expect(aiAppScopeTitle("cycle:read")).toBeNull();
    expect(isAiAppWriteScope("water:write")).toBe(true);
    expect(isAiAppWriteScope("records:read")).toBe(false);
  });

  test("Claude Code commands match the documented syntax", () => {
    expect(claudeCodeKeyCommand("https://h.example/api/mcp", "ov_x")).toBe(
      'claude mcp add --transport http openvalens https://h.example/api/mcp --header "Authorization: Bearer ov_x"',
    );
    expect(claudeCodeOAuthCommand("https://h.example/api/mcp")).toBe(
      "claude mcp add --transport http openvalens https://h.example/api/mcp",
    );
  });

  test("splits active grants from revoked and expired ones per kind", () => {
    const grants = [
      grant("a", "oauth", "active"),
      grant("b", "personal_key", "active"),
      grant("c", "personal_key", "expired"),
      grant("d", "personal_key", "revoked"),
    ];
    const keys = splitGrants(grants, "personal_key");
    expect(keys.active.map((entry) => entry.id)).toEqual(["b"]);
    expect(keys.inactive.map((entry) => entry.id)).toEqual(["c", "d"]);
    expect(splitGrants(grants, "oauth").active.map((entry) => entry.id)).toEqual(["a"]);
  });

  describe("app names (#507)", () => {
    const oauth = (label: string | null, host: string | null) =>
      aiAppName({ kind: "oauth", label, host }, englishI18n);

    test("an OAuth app's self-declared name always comes with its host", () => {
      expect(oauth("Claude", "claude.ai")).toBe("Claude (claude.ai)");
      expect(oauth("Your doctor", "evil.example")).toBe("Your doctor (evil.example)");
      expect(oauth("  Cursor  ", "localhost")).toBe("Cursor (localhost)");
      expect(
        aiAppSourceLabel({ kind: "oauth", label: "Claude", host: "claude.ai" }, englishI18n),
      ).toBe("via Claude (claude.ai)");
    });

    test("a name that reads as OpenValens is dropped for the host", () => {
      for (const name of [
        "OpenValens",
        "openvalens",
        "Open Valens",
        "OPEN-VALENS",
        "Open.Valens!",
        "0penVaIens",
        "OpenVa1ens",
        "Ｏｐｅｎ Ｖａｌｅｎｓ",
        "Öpen Valéns",
        "\u041epenValens",
        "\u039fpen\u03bd\u03b1lens",
        "Openvalens 2",
      ]) {
        expect(oauth(name, "evil.example")).toBe("evil.example");
      }
      expect(oauth("OpenValens", null)).toBe("An unnamed app");
    });

    test("names that only contain OpenValens are kept, with the host", () => {
      expect(oauth("Claude Code (openvalens)", "localhost")).toBe(
        "Claude Code (openvalens) (localhost)",
      );
      expect(oauth("OpenValens helper", "evil.example")).toBe("OpenValens helper (evil.example)");
    });

    test("an app named by its host, or with no name, goes by the host", () => {
      expect(oauth("claude.ai", "claude.ai")).toBe("claude.ai");
      expect(oauth(null, "claude.ai")).toBe("claude.ai");
      expect(oauth("", "claude.ai")).toBe("claude.ai");
    });

    test("without a host the name is marked unverified", () => {
      expect(oauth("Claude", null)).toBe("Claude (unverified)");
      expect(oauth(null, null)).toBe("An unnamed app");
    });

    test("a personal key keeps the member's name and says it is a key", () => {
      expect(aiAppName({ kind: "personal_key", label: "My script", host: null }, englishI18n)).toBe(
        "My script (personal key)",
      );
      // The member named it; even "OpenValens" stays.
      expect(aiAppName({ kind: "personal_key", label: "OpenValens", host: "x" }, englishI18n)).toBe(
        "OpenValens (personal key)",
      );
    });

    test("grants and drafts map to the same identity", () => {
      const connected = { ...grant("Claude", "oauth", "active"), clientHost: "claude.ai" };
      expect(aiAppName(aiAppGrantIdentity(connected), englishI18n)).toBe("Claude (claude.ai)");
      expect(
        aiAppName(
          aiAppDraftIdentity({ appKind: "oauth", appName: "Claude", appHost: "claude.ai" }),
          englishI18n,
        ),
      ).toBe("Claude (claude.ai)");
    });

    test("translates to European Portuguese", () => {
      expect(
        aiAppName({ kind: "personal_key", label: "Script", host: null }, portugueseI18n),
      ).not.toBe("Script (personal key)");
      expect(aiAppName({ kind: "oauth", label: "Claude", host: null }, portugueseI18n)).not.toBe(
        "Claude (unverified)",
      );
    });
  });

  test("call status words and tones; unknown statuses read as failed", () => {
    expect(englishI18n._(aiAppCallStatusLabel("ok"))).toBe("Answered");
    expect(englishI18n._(aiAppCallStatusLabel("something_new"))).toBe("Failed");
    expect(aiAppCallTone("ok")).toBe("good");
    expect(aiAppCallTone("insufficient_scope")).toBe("warn");
    expect(aiAppCallTone("error")).toBe("bad");
  });

  test("expiry choices in words", () => {
    expect(englishI18n._(aiAppExpiryLabel(90))).toBe("90 days");
    expect(englishI18n._(aiAppExpiryLabel(365))).toBe("1 year");
    expect(englishI18n._(aiAppExpiryLabel(null))).toBe("Never");
  });

  test("every help page lives under docs/help/ai-apps", async () => {
    for (const page of AI_APPS_HELP_PAGES) {
      expect(aiAppsHelpUrl(page.file)).toEndWith(`/docs/help/ai-apps/${page.file}`);
      const local = new URL(`../../../../docs/help/ai-apps/${page.file}`, import.meta.url);
      expect(await Bun.file(local).exists()).toBe(true);
    }
    const index = new URL("../../../../docs/help/ai-apps/README.md", import.meta.url);
    expect(await Bun.file(index).exists()).toBe(true);
  });

  test("the phone-data notice follows the read scopes that reach Apple Health / Health Connect data (#518)", () => {
    const notice = (scopes: string[]) => {
      const descriptor = aiAppPlatformDataNotice(scopes);
      return descriptor ? englishI18n._(descriptor) : null;
    };
    expect(notice(["records:read"])).toBe(
      "This includes data synced from Apple Health or Health Connect: steps, heart rate, sleep, weight, body composition and workouts.",
    );
    expect(notice(["records:read", "trackers:read", "nutrition:read"])).toBe(
      "This includes data synced from Apple Health or Health Connect: steps, heart rate, sleep, weight, body composition, workouts, mindfulness and daily mood.",
    );
    expect(notice(["trackers:read"])).toBe(
      "This includes data synced from Apple Health or Health Connect: mindfulness and daily mood.",
    );
    // Opt-ins that hold no phone data, and write scopes, reach none on their own.
    expect(notice(["nutrition:read", "notes:read", "pain:read", "body:write"])).toBeNull();
  });

  test("the disclosure names the app and says it may be an AI service under its own terms", () => {
    const text = englishI18n._({ ...AI_APP_DISCLOSURE.thirdParty, values: { app: "Claude" } });
    expect(text).toStartWith("Claude is a third-party app, which can be an AI service.");
    expect(text).toContain("has no agreement with it");
    expect(text).toContain("use it to train models");
    expect(englishI18n._({ ...AI_APP_DISCLOSURE.agree, values: { app: "Claude" } })).toBe(
      "I want to send this health data to Claude",
    );
    expect(englishI18n._(AI_APP_DISCLOSURE.platformDataAny)).toContain(
      "Apple Health or Health Connect",
    );
  });
});
