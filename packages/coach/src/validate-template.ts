import { getSeedTemplate } from "./templates";
import type { CoachTemplate, CoachTemplateId, InstructionPreset } from "./types";

/**
 * Template validation (Issue #19).
 *
 * Pure — no DB calls. Runs an inbound template shape through a closed
 * set of rules:
 *
 * 1. `key` must be one of the closed union {@link COACH_TEMPLATE_IDS}.
 *    The runtime catalog only ever stores these; anything else is rejected.
 * 2. `title` and `description` must be non-empty strings.
 * 3. `instructionPreset` must be an object with `objective`, `directives`
 *    (array of non-empty strings), `outputStyle` (non-empty string).
 * 4. The directive list must not contain a "consent bypass" instruction —
 *    the anchor v2 guardrails treat the consent gate as non-overridable
 *    (#13), and templates cannot ask the assistant to skip it.
 * 5. The directive list must not contain embedded PHI markers (no email,
 *    no token-like substrings) — the audit-log redaction layer would
 *    drop them anyway, but we reject earlier so callers don't ship a
 *    template that depends on PII.
 *
 * Templates that fail validation return `{ ok: false, reason }`. The
 * router surfaces this as `INVALID_INPUT` to the caller.
 */

export type ValidateTemplateOk = {
  ok: true;
  template: CoachTemplate;
};

export type ValidateTemplateErr = {
  ok: false;
  reason: string;
};

export type ValidateTemplateResult = ValidateTemplateOk | ValidateTemplateErr;

const FORBIDDEN_PHRASES = [
  "bypass consent",
  "skip consent",
  "ignore consent",
  "ignore consent gate",
  "skip physician",
  "remove polygon disclaimer",
];

const PHI_PATTERNS: Array<{ test: (value: string) => boolean; description: string }> = [
  { test: (value) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value), description: "email" },
  {
    test: (value) => /\b(?:eyJ|sk-|ghp_|gho_|xoxb-|xoxp-)[A-Za-z0-9_-]{8,}/.test(value),
    description: "token-like secret",
  },
];

export function validateTemplate(input: unknown): ValidateTemplateResult {
  if (!isRecord(input)) {
    return { ok: false, reason: "Template must be a plain object." };
  }

  const key = readString(input, "key");
  if (!key) {
    return { ok: false, reason: "Template key is required." };
  }
  if (!isKnownTemplateKey(key)) {
    return {
      ok: false,
      reason: `Template key must be one of: cut, recovery, performance, maintenance.`,
    };
  }
  const seed = getSeedTemplate(key);
  if (!seed) {
    return { ok: false, reason: `Template key '${key}' is not part of the runtime catalog.` };
  }

  // `title` and `description` are required when provided; empty/whitespace
  // values are rejected (callers should omit the key entirely to fall back
  // to the seed). The seed fallback applies only when the field is absent.
  if (hasOwnKey(input, "title")) {
    const title = readString(input, "title");
    if (!title) {
      return { ok: false, reason: "Template title is required." };
    }
  }
  if (hasOwnKey(input, "description")) {
    const description = readString(input, "description");
    if (!description) {
      return { ok: false, reason: "Template description is required." };
    }
  }
  const title = readString(input, "title") ?? seed.title;
  const description = readString(input, "description") ?? seed.description;

  const preset = readPreset(input.instructionPreset);
  if (!preset) {
    return {
      ok: false,
      reason: "instructionPreset must include objective, directives, outputStyle.",
    };
  }

  for (const directive of preset.directives) {
    if (directive.trim().length === 0) {
      return { ok: false, reason: "Template directives must be non-empty strings." };
    }
    const lowered = directive.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lowered.includes(phrase)) {
        return {
          ok: false,
          reason: `Template directive attempts to override the consent / safety gate ("${phrase}").`,
        };
      }
    }
    for (const pattern of PHI_PATTERNS) {
      if (pattern.test(directive)) {
        return {
          ok: false,
          reason: `Template directive contains a forbidden ${pattern.description} marker.`,
        };
      }
    }
  }

  if (preset.outputStyle.trim().length === 0) {
    return { ok: false, reason: "Template outputStyle is required." };
  }

  if (preset.objective.trim().length === 0) {
    return { ok: false, reason: "Template objective is required." };
  }

  return {
    ok: true,
    template: {
      key,
      title,
      description,
      instructionPreset: preset,
      isActive: readBoolean(input, "isActive") ?? seed.isActive,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (typeof value === "boolean") return value;
  return undefined;
}

function readPreset(value: unknown): InstructionPreset | null {
  if (!isRecord(value)) return null;
  const objective = readString(value, "objective");
  const outputStyle = readString(value, "outputStyle");
  const directivesRaw = value.directives;
  if (!Array.isArray(directivesRaw)) return null;
  if (directivesRaw.length === 0) return null;
  const directives = directivesRaw.map((item) => (typeof item === "string" ? item : null));
  if (directives.some((d) => d === null)) return null;
  if (!objective || !outputStyle) return null;
  return { objective, directives: directives as string[], outputStyle };
}

function isKnownTemplateKey(value: string): value is CoachTemplateId {
  return (
    value === "cut" || value === "recovery" || value === "performance" || value === "maintenance"
  );
}
