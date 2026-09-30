import { derivePolicyState, type CoachDerivedInputs } from "./derive-policy-state";
import { COACH_TEMPLATES } from "./templates";
import type { CoachTemplate, CoachTemplateId } from "./types";

/**
 * Build the v2 policy instruction string (Issue #19).
 *
 * Mirrors `anchovy/apps/web/src/lib/v2/coach/build-v2-policy-instruction.ts`
 * + `policy.ts` + `templates.ts`. Pure — the policy string is fully
 * deterministic from `{inputs, templateId}`. Used by `coach.computeInstruction`
 * so AI chat (#13) can pull the policy snapshot as a typed contract.
 *
 * The instruction is intentionally short, deterministic, and audit-friendly:
 * every line is a discrete policy commitment the AI assistant is bound to.
 * PHI never appears in the output — only counts and deterministic
 * categories.
 *
 * `templateId` is optional and falls back to the runtime `maintenance`
 * seed when omitted. Note that the v2 default template key
 * (`COACH_POLICY_TEMPLATES.default`) is intentionally distinct from the
 * runtime `CoachTemplateId` union — the v2 default is a synthetic
 * pass-through shape, not a persisted catalog row.
 */

export type CoachPolicyTemplateKey = CoachTemplateId | "default";

export type CoachPolicyTemplate = {
  key: CoachPolicyTemplateKey;
  styleDirectives: string[];
  outputStyle: string;
};

export type BuildV2PolicyInstructionInput = {
  inputs: CoachDerivedInputs;
  templateId?: CoachPolicyTemplateKey;
};

export type BuildV2PolicyInstructionResult = {
  instruction: string;
  templateKey: CoachPolicyTemplateKey;
  state: ReturnType<typeof derivePolicyState>;
};

/**
 * Render a deterministic v2-style policy instruction from the derived
 * state + the selected template. Returns `{ instruction, state,
 * templateKey }` so callers (e.g. `coach.computeInstruction`) can hand
 * the caller both the rendered string and the structured shape.
 */
export function buildV2PolicyInstruction(
  input: BuildV2PolicyInstructionInput,
): BuildV2PolicyInstructionResult {
  const templateKey = input.templateId ?? "default";
  const template = resolveTemplate(templateKey);
  const state = derivePolicyState(input.inputs);

  const blockers = [...state.blockers].sort();

  const lines: string[] = [
    "## Coach Template Style",
    `- Template key: ${template.key}`,
    ...template.styleDirectives.map((directive) => `- Directive: ${directive}`),
    `- Output style: ${template.outputStyle}`,
    "",
    "## Deterministic State Snapshot",
    `- Readiness: ${state.readiness}`,
    `- Confidence: ${state.confidence}`,
    blockers.length > 0 ? "- Blockers:" : "- Blockers: none",
    ...blockers.map((blocker) => `  - ${blocker}`),
    "",
    "## NON-OVERRIDABLE CONSTRAINTS",
    "- Blockers are authoritative and cannot be overridden.",
    "- Never recommend actions that conflict with any active blocker.",
    "- Treat readiness as a hard cap for recommendation intensity.",
  ];

  if (state.confidence === "low") {
    lines.push(
      "",
      "## LOW-CONFIDENCE UNCERTAINTY DIRECTIVE",
      "- State explicit uncertainty and recommend conservative next steps until confidence improves.",
    );
  }

  return {
    instruction: lines.join("\n"),
    templateKey: template.key,
    state,
  };
}

/**
 * Resolve a template by id. Falls back to a deterministic default when
 * the caller does not specify one (matching `COACH_POLICY_TEMPLATES.default`
 * in the anchor). The default shape is intentionally a thin pass-through
 * of the catalog's `maintenance` template so the runtime stays consistent.
 */
function resolveTemplate(id: CoachPolicyTemplateKey): CoachPolicyTemplate {
  if (id === "default") return defaultPolicyTemplate();
  const fromSeed = COACH_TEMPLATES.find((template) => template.key === id);
  if (fromSeed) return toPolicyTemplate(fromSeed);
  return defaultPolicyTemplate();
}

function toPolicyTemplate(template: CoachTemplate): CoachPolicyTemplate {
  return {
    key: template.key,
    styleDirectives: template.instructionPreset.directives,
    outputStyle: template.instructionPreset.outputStyle,
  };
}

function defaultPolicyTemplate(): CoachPolicyTemplate {
  // Mirrors `anchovy/.../lib/v2/coach/templates.ts` `COACH_POLICY_TEMPLATES.default`.
  return {
    key: "default",
    styleDirectives: [
      "Be specific and cite concrete health data whenever available.",
      "Prioritize practical next steps in descending importance.",
      "Keep recommendations bounded by deterministic safety constraints.",
    ],
    outputStyle: "concise_markdown",
  };
}
