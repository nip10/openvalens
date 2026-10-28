import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";

type ProgressionLike = {
  reason: string;
  weightKg: number | null;
  reps: number;
  incrementKg?: number;
  failures?: number;
  deloadPercent?: number;
};

type Prescription = { repsMin: number; repsMax: number };

function displayWeight(kg: number, units: "metric" | "imperial"): string {
  const value = units === "imperial" ? kg * 2.2046226218 : kg;
  return value
    .toFixed(2)
    .replace(/\.0+$|(?<=\.[0-9])0$/, "")
    .replace(/\.$/, "");
}

const weightUnit = (units: "metric" | "imperial") => (units === "imperial" ? "lb" : "kg");

/** Plain-language, client-safe explanation of a deterministic progression suggestion. */
export function progressionWhy(
  suggestion: ProgressionLike,
  prescription: Prescription,
  units: "metric" | "imperial",
): MessageDescriptor {
  switch (suggestion.reason) {
    case "rule_disabled":
      return msg`No progression rule is set, so the prescription stays the same.`;
    case "invalid_options":
      return msg`The progression settings are invalid, so the prescription stays the same.`;
    case "no_history":
      return msg`There is no previous session to compare, so the prescription stays the same.`;
    case "incomplete_session":
      return msg`The last session did not include all prescribed sets, so the prescription stays the same.`;
    case "reps_below_target":
      return msg`At least one set was below the target of ${prescription.repsMin} reps, so the load stays the same.`;
    case "load_mismatch":
      return msg`The last session used different loads between sets, so the prescription stays the same.`;
    case "progression_held":
      return msg`The load stays the same because it cannot be increased for this exercise.`;
    case "reps_advanced":
      return msg`Reps increased to ${suggestion.reps} while the load stays the same.`;
    case "double_progression_increased": {
      const increment = displayWeight(suggestion.incrementKg ?? 0, units);
      const unit = weightUnit(units);
      return msg`All sets reached ${prescription.repsMax} reps last time, so add ${increment} ${unit}.`;
    }
    case "linear_progression_increased": {
      const increment = displayWeight(suggestion.incrementKg ?? 0, units);
      const unit = weightUnit(units);
      return msg`The last session was complete, so add ${increment} ${unit}.`;
    }
    case "linear_failure_recorded": {
      const failures = suggestion.failures ?? 0;
      return msg`${plural(failures, { one: "# incomplete session", other: "# incomplete sessions" })} recorded; the load stays the same.`;
    }
    case "linear_deload": {
      const failures = suggestion.failures ?? 0;
      const percent = suggestion.deloadPercent ?? 0;
      return msg`${plural(failures, { one: "# attempted failure", other: "# attempted failures" })} recorded, so reduce the load by ${percent}%.`;
    }
    default:
      return msg`The progression reason is unavailable, so the prescription stays the same.`;
  }
}
