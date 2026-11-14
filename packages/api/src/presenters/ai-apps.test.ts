import { describe, expect, test } from "bun:test";
import { GRANTABLE_SCOPES } from "@openvalens/mcp/scopes";

import { englishI18n } from "@openvalens/i18n/testing";

import {
  AI_APPS_HELP_PAGES,
  aiAppCallStatusLabel,
  aiAppCallTone,
  aiAppExpiryLabel,
  aiAppScopeTitle,
  aiAppsHelpUrl,
  isAiAppWriteScope,
  claudeCodeKeyCommand,
  claudeCodeOAuthCommand,
  splitGrants,
  type AiAppGrantLike,
} from "./ai-apps";

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
    expect(aiAppScopeTitle("workouts:write")).toBeNull();
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
});
