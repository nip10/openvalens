import { getWeightTrend } from "@openvalens/body";
import type { Database } from "@openvalens/db";
import {
  createNutritionRepository,
  createNutritionTargetSettings,
  evaluateNutritionSafety,
  goalEffectiveFrom,
  goalEffectiveTo,
  goalsInEffectOn,
  helplinesFor,
  NUTRIENT_COLUMNS,
  NUTRITION_SAFETY_COPY,
  proteinReference,
  type NutrientKey,
  type NutritionGoal,
  type NutritionSafety,
  type NutritionScope,
  type NutritionTargetSettings,
  type ProposalBody,
} from "@openvalens/nutrition";

import type {
  NutritionTargetWire,
  TargetsOverview,
  UpdateSettingsInput,
  UpdateSettingsOutput,
} from "./contracts/nutrition-targets";
import { createWellnessProfileService } from "./wellness-profile";
import { deriveWellnessProfileInputs } from "./wellness-profile-contract";

/**
 * Issue #80 — user-owned nutrition targets, the `nutrition-safety/v1`
 * policy state and hide-numbers mode.
 *
 * Targets are only ever written here on the member's own request (or by the
 * #76 accept, which goes through the same repository). Reading the overview
 * writes nothing. The safety state combines the member's wellness profile
 * (adult confirmation, age range, sex, region; #98) with their self-declared
 * nutrition declarations; nothing is inferred. Every read and write is keyed
 * by the session's organization and user. No value or declaration is logged.
 */

/** A target may start at most one day after the server's UTC date (time zones run ahead). */
const MAX_FUTURE_DAYS = 1;
/** Days of weight history used for the latest trend value. */
const WEIGHT_LOOKBACK_DAYS = 28;

const COLUMN_TO_KEY = new Map<string, NutrientKey>(
  (Object.entries(NUTRIENT_COLUMNS) as [NutrientKey, string][]).map(([key, column]) => [
    column,
    key,
  ]),
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class NutritionTargetsRequestError extends Error {
  readonly code = "INVALID_INPUT";
}

function shiftDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function presentTarget(goal: NutritionGoal): NutritionTargetWire {
  const nutrient = COLUMN_TO_KEY.get(goal.nutrient);
  if (!nutrient) throw new Error("Unknown nutrient column");
  return {
    id: goal.id,
    nutrient,
    minAmount: goal.minAmount,
    maxAmount: goal.maxAmount,
    source: goal.source,
    effectiveFrom: goalEffectiveFrom(goal),
    effectiveTo: goalEffectiveTo(goal),
  };
}

/** Everything the safety policy needs about one member, loaded together. */
export type SafetyContext = {
  adultConfirmed: boolean;
  region: "us" | "uk" | "pt" | null;
  settings: NutritionTargetSettings;
  safety: NutritionSafety;
  body: ProposalBody;
};

/**
 * Loads the member's profile inputs, nutrition settings and (when
 * `readWeight`) their latest weight-trend value, and evaluates the policy.
 */
export async function loadSafetyContext(
  db: Database,
  scope: NutritionScope,
  options: { now: Date; readWeight: boolean },
): Promise<SafetyContext> {
  const today = options.now.toISOString().slice(0, 10);
  const [snapshot, settings, trend] = await Promise.all([
    createWellnessProfileService({ db }).read(scope.userId),
    createNutritionTargetSettings(db).get(scope),
    options.readWeight
      ? getWeightTrend(db, scope, {
          from: shiftDate(today, -(WEIGHT_LOOKBACK_DAYS - 1)),
          to: today,
        })
      : Promise.resolve(null),
  ]);
  const profile = deriveWellnessProfileInputs(snapshot, options.now);
  const ageRange = profile.ageRange.available ? profile.ageRange.value : null;
  let weightKg: number | null = null;
  for (const point of trend?.points ?? []) weightKg = point.trendKg ?? point.observedKg ?? weightKg;
  const safety = evaluateNutritionSafety({
    adultConfirmed: profile.adultConfirmed,
    minAge: ageRange?.minAge ?? null,
    maxAge: ageRange?.maxAge ?? null,
    declarations: settings.declarations,
    hideNumbers: settings.hideNumbers,
  });
  return {
    adultConfirmed: profile.adultConfirmed,
    region: profile.region.available ? profile.region.value : null,
    settings,
    safety,
    body: {
      weightKg,
      heightCm: settings.heightCm,
      sex: profile.sex.available ? profile.sex.value : null,
      minAge: ageRange?.minAge ?? null,
      maxAge: ageRange?.maxAge ?? null,
    },
  };
}

function supportFor(region: SafetyContext["region"]) {
  return { text: NUTRITION_SAFETY_COPY.eatingDisorderDisclosure, helplines: helplinesFor(region) };
}

export function createNutritionTargetsService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const repository = createNutritionRepository(db);
  const settingsStore = createNutritionTargetSettings(db);

  function checkDate(localDate: string): void {
    const latest = shiftDate(now().toISOString().slice(0, 10), MAX_FUTURE_DAYS);
    if (localDate > latest)
      throw new NutritionTargetsRequestError("The date must not be in the future");
  }

  return {
    /** Settings, safety state, active targets, the targets on `localDate` and references. Writes nothing. */
    async overview(
      scope: NutritionScope,
      input: { localDate: string },
      options: { readWeight: boolean },
    ): Promise<TargetsOverview> {
      const context = await loadSafetyContext(db, scope, {
        now: now(),
        readWeight: options.readWeight,
      });
      const energyOff = context.safety.energyTargets === "off";
      const visible = (goal: NutritionGoal) => !(energyOff && goal.nutrient.startsWith("energy_"));
      const history = await repository.listGoalHistory(scope);
      const active = history.filter((goal) => goal.archivedAt === null && visible(goal));
      const notes: string[] = [];
      if (energyOff) notes.push(NUTRITION_SAFETY_COPY.energyTargetsOff);
      else if (context.safety.reductionSuggestions === "off" && context.adultConfirmed)
        notes.push(NUTRITION_SAFETY_COPY.reductionsOff);
      return {
        settings: context.settings,
        safety: context.safety,
        targets: active.map(presentTarget),
        targetsOn: {
          localDate: input.localDate,
          targets: goalsInEffectOn(history, input.localDate).filter(visible).map(presentTarget),
        },
        proteinReference: proteinReference({
          weightKg: context.body.weightKg,
          adultConfirmed: context.adultConfirmed,
          maxAge: context.body.maxAge,
          active: context.settings.activeProtein,
          kidneyCap: context.safety.proteinCapped,
        }),
        support: context.settings.declarations.includes("eating_disorder")
          ? supportFor(context.region)
          : null,
        notes,
      };
    },

    /** The member's own target, from `effectiveFrom`; replaces the active one for that nutrient. */
    async setTarget(
      scope: NutritionScope,
      input: {
        nutrient: NutrientKey;
        minAmount?: number | null;
        maxAmount?: number | null;
        effectiveFrom: string;
      },
    ): Promise<NutritionTargetWire> {
      checkDate(input.effectiveFrom);
      if (input.nutrient === "energyKcal" || input.nutrient === "energyKj") {
        const settings = await settingsStore.get(scope);
        if (settings.declarations.includes("eating_disorder"))
          throw new NutritionTargetsRequestError(NUTRITION_SAFETY_COPY.energyTargetsOff);
      }
      const goal = await repository.setGoal(scope, {
        nutrient: input.nutrient,
        minAmount: input.minAmount ?? null,
        maxAmount: input.maxAmount ?? null,
        source: "entered",
        effectiveFrom: input.effectiveFrom,
      });
      return presentTarget(goal);
    },

    /** Ends the member's active target for one nutrient from `effectiveTo` (exclusive). */
    async clearTarget(
      scope: NutritionScope,
      input: { nutrient: NutrientKey; effectiveTo: string },
    ): Promise<boolean> {
      checkDate(input.effectiveTo);
      return repository.clearGoal(scope, input.nutrient, input.effectiveTo);
    },

    /**
     * Updates settings with optimistic concurrency. Removing an
     * eating-disorder answer needs `confirmClearEatingDisorder` and is never
     * prompted; newly declaring one returns the disclosure with helplines.
     */
    async updateSettings(
      scope: NutritionScope,
      input: UpdateSettingsInput,
    ): Promise<DistributiveOmit<UpdateSettingsOutput, "targetId">> {
      const { expectedRevision, confirmClearEatingDisorder, ...patch } = input;
      if (patch.declarations) {
        const current = await settingsStore.get(scope);
        if (
          current.declarations.includes("eating_disorder") &&
          !patch.declarations.includes("eating_disorder") &&
          confirmClearEatingDisorder !== true
        )
          return {
            outcome: "confirmation_required",
            settings: current,
            note: NUTRITION_SAFETY_COPY.clearEatingDisorderConfirm,
          };
      }
      const result = await settingsStore.update(scope, patch, expectedRevision);
      if (result.outcome === "conflict") return { outcome: "conflict", settings: result.settings };
      const context = await loadSafetyContext(db, scope, { now: now(), readWeight: false });
      const newlyDeclared =
        result.settings.declarations.includes("eating_disorder") &&
        !result.previous.declarations.includes("eating_disorder");
      return {
        outcome: "updated",
        settings: result.settings,
        safety: context.safety,
        disclosure: newlyDeclared ? supportFor(context.region) : null,
      };
    },
  };
}

export type NutritionTargetsService = ReturnType<typeof createNutritionTargetsService>;
