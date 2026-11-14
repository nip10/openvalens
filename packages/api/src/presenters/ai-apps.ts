/**
 * Connected AI apps, presented for web and mobile (Issue #439). Pure
 * TypeScript, safe for the app bundles. Labels are message descriptors the
 * apps render with Lingui; scope strings, tool names and key prefixes are
 * identifiers and stay as the server sends them.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { isReservedAiAppName } from "@openvalens/auth/mcp-oauth/client-name";

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
  /** The host an OAuth app is shown with next to its label (#507); `null` for a key. */
  clientHost: string | null;
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
    detail: msg`Labs, sleep, workouts, steps, vitals, weight and body composition, supplements and goals, including what your phone syncs from Apple Health or Health Connect. Always included.`,
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
    detail: msg`Trackers you made, including mindful minutes and daily mood synced from Apple Health or Health Connect, except those with "Coach and connected AI apps can read this" off.`,
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
    detail: msg`Log workout sessions with exercises from the exercise catalog. A workout with an exercise that is not in the catalog waits for you to review it. The app can delete only the workouts it added.`,
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
  // M2c: entries in these domains are drafts the member confirms in the app.
  "food:write": {
    title: msg`Suggest meals`,
    detail: msg`Make meal drafts you review in Describe a meal. Nothing goes into your food diary until you pick each food and log it. The app can delete only the drafts it made.`,
  },
  "labs:write": {
    title: msg`Suggest lab results`,
    detail: msg`Add lab results for your own markers, in a unit the marker already uses. Each result waits on the Labs screen until you confirm it. The app can delete only the results it added.`,
  },
};

/**
 * The sentence naming the Apple Health / Health Connect data the chosen read
 * scopes reach, or `null` when they reach none (Issue #518). `records:read`
 * covers steps, heart rate, sleep, weight, body composition and workouts;
 * `trackers:read` covers the trackers the platforms fill (mindful minutes,
 * daily mood). Write scopes never read.
 */
export function aiAppPlatformDataNotice(scopes: readonly string[]): MessageDescriptor | null {
  const records = scopes.includes("records:read");
  const trackers = scopes.includes("trackers:read");
  if (records && trackers) return PLATFORM_DATA.recordsAndTrackers;
  if (records) return PLATFORM_DATA.records;
  if (trackers) return PLATFORM_DATA.trackers;
  return null;
}

const PLATFORM_DATA = {
  records: msg({
    message:
      "This includes data synced from Apple Health or Health Connect: steps, heart rate, sleep, weight, body composition and workouts.",
    comment: "safety",
  }),
  recordsAndTrackers: msg({
    message:
      "This includes data synced from Apple Health or Health Connect: steps, heart rate, sleep, weight, body composition, workouts, mindfulness and daily mood.",
    comment: "safety",
  }),
  trackers: msg({
    message:
      "This includes data synced from Apple Health or Health Connect: mindfulness and daily mood.",
    comment: "safety",
  }),
} as const;

/**
 * The disclosure every AI-app connection shows before consent, and the
 * mobile list shows next to the connections (Issue #518: Apple Review
 * Guidelines 5.1.2(i), DPLA 3.3.3(H), Google Play User Data policy). `{app}`
 * is the app's own name (OAuth) or the key's name.
 */
export const AI_APP_DISCLOSURE = {
  thirdParty: msg({
    message:
      "{app} is a third-party app, which can be an AI service. OpenValens doesn't run it and has no agreement with it. Once it has your data, its own terms and privacy policy apply, which may let it store your data or use it to train models.",
    comment: "safety",
  }),
  /** A personal key before the member has named it. */
  thirdPartyUnnamed: msg({
    message:
      "The app you use this key in is a third-party app, which can be an AI service. OpenValens doesn't run it and has no agreement with it. Once it has your data, its own terms and privacy policy apply, which may let it store your data or use it to train models.",
    comment: "safety",
  }),
  thirdPartyAny: msg({
    message:
      "Connected apps are third-party apps, which can be AI services. OpenValens doesn't run them and has no agreement with them. Once an app has your data, its own terms and privacy policy apply, which may let it store your data or use it to train models.",
    comment: "safety",
  }),
  platformDataAny: msg({
    message:
      "What they read includes data synced from Apple Health or Health Connect: steps, heart rate, sleep, weight, body composition, workouts, mindfulness and daily mood.",
    comment: "safety",
  }),
  purpose: msg({
    message:
      "Shared only so the app can help you with your own health and fitness. Never used for advertising and never sold.",
    comment: "safety",
  }),
  disconnect: msg({
    message: "Disconnecting stops new reads at once but doesn't delete what the app already has.",
    comment: "safety",
  }),
  agree: msg({
    message: "I want to send this health data to {app}",
    comment: "safety",
  }),
  agreeUnnamed: msg({
    message: "I want to send this health data to the app I use this key in",
    comment: "safety",
  }),
} as const;

/** Whether an AI-app draft is a meal, a lab result or a workout (M2c). */
export type AiAppDraftKind = "food" | "lab" | "workout";

/** "Reference range from the report": how a lab result's range from an AI app is labelled. */
export const AI_APP_LAB_RANGE_FROM_REPORT = msg({
  message: "from the report",
  comment:
    "Follows a lab reference range a connected AI app sent with a result, e.g. 'Lab range 30 to 400 ng/mL (from the report)'.",
});

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

/** "via Claude (claude.ai)": how entries an AI app wrote are labelled. */
export const AI_APP_SOURCE_LABEL = msg({
  message: "via {name}",
  comment:
    "Source of an entry a connected AI app wrote; {name} is the app's name with its web address, e.g. 'Claude (claude.ai)', or a personal key's name, e.g. 'My script (personal key)'.",
});

/**
 * Who a connected AI app is (#507): an OAuth app's self-declared name (or a
 * personal key's name, which the member typed) and, for an OAuth app, the
 * host it connected from.
 */
export type AiAppIdentity = {
  kind: AiAppGrantLike["kind"];
  /** `null` when the app gave no name. */
  label: string | null;
  /** `null` for a personal key, or when the server does not know it. */
  host: string | null;
};

const APP_NAME = {
  withHost: msg({
    message: "{name} ({host})",
    comment:
      "A connected AI app: the name it gives itself, then the web address it connected from, e.g. 'Claude (claude.ai)'. Keep both as they are.",
  }),
  unverified: msg({
    message: "{name} (unverified)",
    comment:
      "A connected AI app whose web address is not known: the name it gives itself, which nobody checked.",
  }),
  personalKey: msg({
    message: "{name} (personal key)",
    comment: "A personal API key, by the name the member gave it, e.g. 'My script (personal key)'.",
  }),
  unnamed: msg`An unnamed app`,
} as const;

/** A grant as an {@link AiAppIdentity}. */
export function aiAppGrantIdentity(
  grant: Pick<AiAppGrantLike, "kind" | "label" | "clientHost">,
): AiAppIdentity {
  return { kind: grant.kind, label: grant.label, host: grant.clientHost };
}

/** An AI-app draft's app as an {@link AiAppIdentity}. */
export function aiAppDraftIdentity(draft: {
  appKind: AiAppGrantLike["kind"];
  appName: string;
  appHost: string | null;
}): AiAppIdentity {
  return { kind: draft.appKind, label: draft.appName, host: draft.appHost };
}

/**
 * How a connected AI app is named everywhere (#507). An OAuth app's name is
 * self-declared, so it always comes with its host: "Claude (claude.ai)". A
 * name that reads as "OpenValens" is dropped and the app goes by its host
 * alone, as does an app whose name is its host. Without a host the name is
 * marked "(unverified)". A personal key keeps the name the member typed:
 * "My script (personal key)".
 */
export function aiAppName(app: AiAppIdentity, i18n: I18n): string {
  const label = app.label?.trim() || null;
  if (app.kind === "personal_key") {
    return label
      ? i18n._({ ...APP_NAME.personalKey, values: { name: label } })
      : i18n._(APP_NAME.unnamed);
  }
  const host = app.host?.trim() || null;
  const name =
    label && !isReservedAiAppName(label) && label.toLowerCase() !== host?.toLowerCase()
      ? label
      : null;
  if (name && host) return i18n._({ ...APP_NAME.withHost, values: { name, host } });
  if (host) return host;
  if (name) return i18n._({ ...APP_NAME.unverified, values: { name } });
  return i18n._(APP_NAME.unnamed);
}

/** "via Claude (claude.ai)": the source line of an entry an AI app wrote. */
export function aiAppSourceLabel(app: AiAppIdentity, i18n: I18n): string {
  return i18n._({ ...AI_APP_SOURCE_LABEL, values: { name: aiAppName(app, i18n) } });
}

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
