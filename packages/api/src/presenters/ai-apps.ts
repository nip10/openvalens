/**
 * Connected AI apps, presented for web and mobile (Issue #439). Pure
 * TypeScript, safe for the app bundles. Labels are message descriptors the
 * apps render with Lingui; scope strings, tool names and key prefixes are
 * identifiers and stay as the server sends them.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/** The shape `aiApps.listGrants` returns per grant. */
export type AiAppGrantLike = {
  id: string;
  kind: "personal_key" | "oauth";
  label: string;
  scopes: string[];
  consentVersion: string;
  status: "active" | "revoked" | "expired";
  displayPrefix: string | null;
  clientIdHost: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

/** The shape `aiApps.recentActivity` returns per call. */
export type AiAppCallLike = {
  grantId: string;
  tool: string;
  transport: "mcp" | "rest";
  status: string;
  rowCount: number | null;
  createdAt: string;
};

/** Where the member-facing help pages live (one per client). */
export const AI_APPS_HELP_BASE_URL =
  "https://github.com/nip10/openvalens/blob/main/docs/help/ai-apps";

export const AI_APPS_HELP_PAGES = [
  { id: "claude-ai", file: "claude-ai.md", name: "claude.ai" },
  { id: "claude-desktop", file: "claude-desktop.md", name: "Claude Desktop" },
  { id: "claude-code", file: "claude-code.md", name: "Claude Code" },
  { id: "cursor", file: "cursor.md", name: "Cursor" },
  { id: "chatgpt", file: "chatgpt.md", name: "ChatGPT" },
  { id: "local", file: "local-model.md", name: null },
] as const;

export function aiAppsHelpUrl(file?: string): string {
  return file ? `${AI_APPS_HELP_BASE_URL}/${file}` : `${AI_APPS_HELP_BASE_URL}/README.md`;
}

const SCOPES: Record<string, { title: MessageDescriptor; detail: MessageDescriptor }> = {
  "records:read": {
    title: msg`Your records`,
    detail: msg`Labs, sleep, workouts, vitals, weight and body composition, supplements and goals. Always included.`,
  },
  "nutrition:read": {
    title: msg`Nutrition`,
    detail: msg`Your food diary and nutrient totals.`,
  },
  "private_body:read": {
    title: msg`Private body measurements`,
    detail: msg`Measurements you keep private.`,
  },
  "notes:read": {
    title: msg`Notes`,
    detail: msg`Free-text notes on your workouts, labs and other entries.`,
  },
  "trackers:read": {
    title: msg`Custom trackers`,
    detail: msg`Trackers you made, except those with "Coach and connected AI apps can read this" off.`,
  },
  "pain:read": {
    title: msg`Pain log`,
    detail: msg`Your pain ratings by body region, only while "Coach and connected AI apps can read my pain log" is on.`,
  },
};

/** A scope's short name, or `null` for a scope this app does not know yet. */
export function aiAppScopeTitle(scope: string): MessageDescriptor | null {
  return SCOPES[scope]?.title ?? null;
}

/** One line on what a scope lets the app read, or `null` when unknown. */
export function aiAppScopeDetail(scope: string): MessageDescriptor | null {
  return SCOPES[scope]?.detail ?? null;
}

const GRANT_STATUS: Record<AiAppGrantLike["status"], MessageDescriptor> = {
  active: msg({ message: "Active", context: "ai app" }),
  revoked: msg({ message: "Revoked", context: "ai app" }),
  expired: msg({ message: "Expired", context: "ai app" }),
};

export function aiAppGrantStatusLabel(status: AiAppGrantLike["status"]): MessageDescriptor {
  return GRANT_STATUS[status];
}

const CALL_STATUS: Record<string, MessageDescriptor> = {
  ok: msg({ message: "Answered", context: "ai app call" }),
  insufficient_scope: msg({ message: "Not allowed", context: "ai app call" }),
  invalid_input: msg({ message: "Bad request", context: "ai app call" }),
  error: msg({ message: "Failed", context: "ai app call" }),
};

/** A usage record's status in words; unknown statuses fall back to "Failed". */
export function aiAppCallStatusLabel(status: string): MessageDescriptor {
  return CALL_STATUS[status] ?? CALL_STATUS.error!;
}

/** Pill tone for a usage record's status. */
export function aiAppCallTone(status: string): "good" | "warn" | "bad" {
  if (status === "ok") return "good";
  if (status === "insufficient_scope" || status === "invalid_input") return "warn";
  return "bad";
}

const EXPIRY: Record<string, MessageDescriptor> = {
  "30": msg`30 days`,
  "90": msg`90 days`,
  "365": msg`1 year`,
  never: msg`Never`,
};

/** An expiry choice (`30`, `90`, `365` or `null` for never) in words. */
export function aiAppExpiryLabel(days: number | null): MessageDescriptor {
  if (days === null) return EXPIRY.never!;
  return EXPIRY[String(days)] ?? msg`${days} days`;
}

/** Active grants of one kind first, then the rest (revoked or expired), newest first. */
export function splitGrants(
  grants: readonly AiAppGrantLike[],
  kind: AiAppGrantLike["kind"],
): { active: AiAppGrantLike[]; inactive: AiAppGrantLike[] } {
  const ofKind = grants.filter((grant) => grant.kind === kind);
  return {
    active: ofKind.filter((grant) => grant.status === "active"),
    inactive: ofKind.filter((grant) => grant.status !== "active"),
  };
}

/** The Claude Code command that adds this server with a personal key. */
export function claudeCodeKeyCommand(mcpUrl: string, key: string): string {
  return `claude mcp add --transport http openvalens ${mcpUrl} --header "Authorization: Bearer ${key}"`;
}

/** The Claude Code command that adds this server and signs in with OAuth. */
export function claudeCodeOAuthCommand(mcpUrl: string): string {
  return `claude mcp add --transport http openvalens ${mcpUrl}`;
}
