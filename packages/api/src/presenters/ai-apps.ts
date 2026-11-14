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
  /** Entries this grant wrote that are still recorded as its own (M2). */
  entryCount?: number;
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
  // Write scopes (M2): each lets the app add entries in one domain and delete
  // the entries it added there, never anything else.
  "water:write": {
    title: msg`Add water`,
    detail: msg`Log plain water you drank. The app can delete only the entries it added.`,
  },
  "body:write": {
    title: msg`Add weight and body composition`,
    detail: msg`Log weight, body fat, muscle, bone and body water. The app can delete only the entries it added.`,
  },
  "vitals:write": {
    title: msg`Add vitals`,
    detail: msg`Log blood pressure, heart rate, resting heart rate, blood oxygen and respiratory rate. The app can delete only the entries it added.`,
  },
  "supplements:write": {
    title: msg`Add supplements taken`,
    detail: msg`Log that you took one of your supplements. The app can delete only the entries it added.`,
  },
  "workouts:write": {
    title: msg`Add workouts`,
    detail: msg`Log workout sessions with exercises from the exercise catalog. The app can delete only the workouts it added.`,
  },
  "sleep:write": {
    title: msg`Add sleep`,
    detail: msg`Log nights of sleep, like your own sleep entries. A device night always counts first. The app can delete only the nights it added.`,
  },
  "trackers:write": {
    title: msg`Add to custom trackers`,
    detail: msg`Log entries in your own trackers that have "Coach and connected AI apps can read this" on. The app can delete only the entries it added.`,
  },
  "pain:write": {
    title: msg`Add to pain log`,
    detail: msg`Log pain ratings by body region, only while "Coach and connected AI apps can read my pain log" is on. The app can delete only the entries it added.`,
  },
};

/** Whether a scope lets the app add entries (M2) rather than read. */
export function isAiAppWriteScope(scope: string): boolean {
  return scope.endsWith(":write");
}

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
  read_only: msg({ message: "Read-only", context: "ai app call" }),
  limit_reached: msg({ message: "Daily limit reached", context: "ai app call" }),
  error: msg({ message: "Failed", context: "ai app call" }),
};

/** A usage record's status in words; unknown statuses fall back to "Failed". */
export function aiAppCallStatusLabel(status: string): MessageDescriptor {
  return CALL_STATUS[status] ?? CALL_STATUS.error!;
}

/** Pill tone for a usage record's status. */
export function aiAppCallTone(status: string): "good" | "warn" | "bad" {
  if (status === "ok") return "good";
  if (
    status === "insufficient_scope" ||
    status === "invalid_input" ||
    status === "read_only" ||
    status === "limit_reached"
  )
    return "warn";
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

/** "via Claude": how entries an AI app wrote are labelled. */
export const AI_APP_SOURCE_LABEL = msg({
  message: "via {name}",
  comment: "Source of an entry a connected AI app wrote; {name} is the app's or key's name.",
});

/** The timeline filter that shows only what one grant wrote. */
export function aiAppTimelineSource(grantId: string): string {
  return `ai_app:${grantId}`;
}

/** The Claude Code command that adds this server with a personal key. */
export function claudeCodeKeyCommand(mcpUrl: string, key: string): string {
  return `claude mcp add --transport http openvalens ${mcpUrl} --header "Authorization: Bearer ${key}"`;
}

/** The Claude Code command that adds this server and signs in with OAuth. */
export function claudeCodeOAuthCommand(mcpUrl: string): string {
  return `claude mcp add --transport http openvalens ${mcpUrl}`;
}
