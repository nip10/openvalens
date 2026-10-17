import { z } from "zod";

/**
 * `nutritionEnergy.*` wire contract (Issue #76). Imports only `zod` so web
 * and native can share it. Inputs are strict: unknown keys — including any
 * `organizationId`, `userId` or client-computed numbers — are rejected. The
 * member always comes from the session and every number is computed on the
 * server from their own records.
 *
 * The estimate is experimental (`experimental: true` on every response) and
 * fully transparent: window, per-day intake use, weight trend inputs,
 * formula, the cited energy-density constant and an arithmetic uncertainty
 * range. `status: "no_estimate"` lists every unmet requirement in `reasons`;
 * `status: "adults_only"` means nothing was read or computed.
 *
 * Proposals are separate from the estimate. They are created only on the
 * member's request and change the energy target only through
 * `acceptProposal`; `dismissProposal` leaves it unchanged.
 */

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Window end: the member's own local date (normally today). */
export const energyEstimateInput = z.strictObject({ to: localDate });
export type EnergyEstimateInput = z.infer<typeof energyEstimateInput>;

export const NO_ESTIMATE_REASONS = [
  "not_enough_complete_days",
  "recent_days_incomplete",
  "not_enough_weight_days",
  "weight_trend_unavailable",
  "weight_change_too_short",
  "weight_gap_too_long",
  "weight_trend_method_changed",
  "outside_plausible_range",
] as const;

export const INTAKE_DAY_USES = [
  "used",
  "not_marked_complete",
  "nothing_logged",
  "energy_not_known",
] as const;

const method = z.object({
  id: z.literal("energy_balance"),
  version: z.literal(1),
  windowDays: z.number().int(),
  energyDensityKcalPerKg: z.number(),
  minIntakeDays: z.number().int(),
  maxRecentMissingIntakeDays: z.number().int(),
  minWeightDays: z.number().int(),
  minWeightChangeDays: z.number().int(),
  maxWeightGapDays: z.number().int(),
  weightChangeFloorKg: z.number(),
  plausibleKcalPerDay: z.object({ min: z.number(), max: z.number() }),
  rangeStandardDeviations: z.number(),
  precisionKcal: z.number(),
  weightTrendMethod: z.object({ id: z.string(), version: z.number().int() }),
});

const intakeInput = z.object({
  days: z.array(
    z.object({
      localDate: z.string(),
      use: z.enum(INTAKE_DAY_USES),
      energyKcal: z.number().nullable(),
    }),
  ),
  usedDays: z.number().int(),
  notMarkedCompleteDays: z.number().int(),
  nothingLoggedDays: z.number().int(),
  energyNotKnownDays: z.number().int(),
  recentMissingDays: z.number().int(),
  meanKcal: z.number().nullable(),
  standardDeviationKcal: z.number().nullable(),
});

const weightInput = z.object({
  trendMethod: z.object({ id: z.string(), version: z.number().int() }),
  observedDays: z.number().int(),
  trendDays: z.number().int(),
  longestGapDays: z.number().int(),
  change: z
    .object({ from: z.string(), to: z.string(), days: z.number().int(), kg: z.number() })
    .nullable(),
  ratePerWeekKg: z.number().nullable(),
  residualStandardDeviationKg: z.number().nullable(),
});

const estimateValue = z.object({
  kcalPerDay: z.number(),
  range: z.object({ lowKcal: z.number(), highKcal: z.number() }),
  components: z.object({ meanIntakeKcal: z.number(), weightChangeKcalPerDay: z.number() }),
  uncertainty: z.object({
    intakeStandardErrorKcal: z.number(),
    weightChangeStandardDeviationKg: z.number(),
    combinedStandardDeviationKcal: z.number(),
    rangeStandardDeviations: z.number(),
  }),
});

export const energyEstimate = z.object({
  status: z.enum(["estimated", "no_estimate"]),
  experimental: z.literal(true),
  window: z.object({ from: z.string(), to: z.string(), days: z.number().int() }),
  method,
  formula: z.string(),
  energyDensity: z.object({
    valueKcalPerKg: z.number(),
    label: z.string(),
    sources: z.array(z.string()),
    caveat: z.string(),
  }),
  inputs: z.object({ intake: intakeInput, weight: weightInput, activity: z.literal("not_used") }),
  reasons: z.array(z.enum(NO_ESTIMATE_REASONS)),
  /** Neutral copy for each reason, in the same order. */
  reasonNotes: z.array(z.string()),
  estimate: estimateValue.nullable(),
  notes: z.object({
    experimental: z.string(),
    units: z.string(),
    missing: z.string(),
    activity: z.string(),
    variability: z.string(),
    proposals: z.string(),
  }),
});
export type EnergyEstimateWire = z.infer<typeof energyEstimate>;

/** Withheld for anyone who has not confirmed they are 18 or older (#98). */
export const energyEstimateAdultsOnly = z.object({
  status: z.literal("adults_only"),
  experimental: z.literal(true),
  note: z.string(),
});

/** Turned off after an eating-disorder declaration (#80): nothing was read or computed. */
export const energyEstimateOff = z.object({
  status: z.literal("off"),
  experimental: z.literal(true),
  note: z.string(),
});

export const energyEstimateOutput = z.discriminatedUnion("status", [
  energyEstimate.extend({ status: z.literal("estimated") }),
  energyEstimate.extend({ status: z.literal("no_estimate") }),
  energyEstimateAdultsOnly,
  energyEstimateOff,
]);
export type EnergyEstimateOutput = z.infer<typeof energyEstimateOutput>;

// ─── Proposals ────────────────────────────────────────────────

export const PROPOSAL_STATUSES = ["pending", "accepted", "dismissed", "superseded"] as const;
export const PROPOSAL_DECLINE_REASONS = [
  "adults_only",
  "no_estimate",
  "below_floor",
  "no_change",
  "recently_changed",
  "expired",
  "target_changed",
  "not_pending",
  "suggestions_off",
  "not_suggested_for_profile",
  "needs_body_details",
  "needs_confirmation",
] as const;

/** `deficit` and `gain` only through the nutrition safety policy (#80, `nutrition-safety/v1`). */
export const PROPOSAL_KINDS = ["maintenance", "deficit", "gain"] as const;

export const energyProposal = z.object({
  id: z.number().int(),
  kind: z.enum(PROPOSAL_KINDS),
  status: z.enum(PROPOSAL_STATUSES),
  /** A pending proposal past its expiry can no longer be accepted. */
  expired: z.boolean(),
  estimateKcal: z.number().int(),
  targetKcal: z.number().int(),
  currentTargetKcal: z.number().int().nullable(),
  stepLimited: z.boolean(),
  methodVersion: z.number().int(),
  policyVersion: z.string(),
  window: z.object({ from: z.string(), to: z.string() }),
  /** The full estimate the proposal was made from. */
  estimate: energyEstimate,
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  acceptedGoalId: z.number().int().nullable(),
  /** A pending reduction under a soft gate (65+, GLP-1/GIP): accept needs `confirmed: true`. */
  needsConfirmation: z.boolean(),
  notes: z.array(z.string()),
});
export type EnergyProposalWire = z.infer<typeof energyProposal>;

export const listProposalsInput = z.strictObject({});
export const listProposalsOutput = z.object({ proposals: z.array(energyProposal) });

export const proposeInput = energyEstimateInput;
export const proposeOutput = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("proposed"), proposal: energyProposal, targetId: z.string() }),
  z.object({
    outcome: z.literal("declined"),
    reason: z.enum(PROPOSAL_DECLINE_REASONS),
    note: z.string(),
  }),
]);
export type ProposeOutput = z.infer<typeof proposeOutput>;

export const decideProposalInput = z.strictObject({ proposalId: z.number().int().positive() });

/**
 * Accept: optionally the member's local date the target applies from
 * (defaults to the server's UTC date) and the extra confirmation a soft gate
 * needs. Never a number the server would trust.
 */
export const acceptProposalInput = z.strictObject({
  proposalId: z.number().int().positive(),
  effectiveFrom: localDate.optional(),
  confirmed: z.boolean().optional(),
});

const declined = z.object({
  outcome: z.literal("declined"),
  reason: z.enum(PROPOSAL_DECLINE_REASONS),
  note: z.string(),
  proposal: energyProposal,
  targetId: z.string(),
});

export const acceptProposalOutput = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("accepted"),
    proposal: energyProposal,
    goal: z.object({
      id: z.number().int(),
      nutrient: z.literal("energy_kcal"),
      minAmount: z.number().nullable(),
      maxAmount: z.number().nullable(),
    }),
    targetId: z.string(),
  }),
  declined,
]);
export type AcceptProposalOutput = z.infer<typeof acceptProposalOutput>;

export const dismissProposalOutput = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("dismissed"), proposal: energyProposal, targetId: z.string() }),
  declined,
]);
export type DismissProposalOutput = z.infer<typeof dismissProposalOutput>;
