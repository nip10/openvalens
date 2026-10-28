/** Opt-in, deterministic progression suggestions. All loads are canonical kg. */
export type ProgressionRule =
  | { kind: "none" }
  | { kind: "double"; incrementKg: number }
  | { kind: "linear"; incrementKg: number; deloadPercent: number; failureThreshold: number };

export type ProgressionTarget = {
  sets: number;
  minReps: number;
  maxReps: number;
  weightKg: number | null;
};

export type ProgressionPerformance = {
  date: string;
  /** Prescription displayed for this session (including a prior suggestion/override). */
  effectivePrescribedWeightKg?: number | null;
  sets: Array<{ reps: number; weightKg: number | null; completed?: boolean }>;
};

export type ProgressionReason =
  | "rule_disabled"
  | "invalid_options"
  | "no_history"
  | "incomplete_session"
  | "reps_below_target"
  | "load_mismatch"
  | "progression_held"
  | "reps_advanced"
  | "double_progression_increased"
  | "linear_progression_increased"
  | "linear_failure_recorded"
  | "linear_deload";

export type ProgressionSuggestion = {
  weightKg: number | null;
  reps: number;
  reason: ProgressionReason;
  incrementKg?: number;
  failures?: number;
  deloadPercent?: number;
};

const validNumber = (value: number): boolean => Number.isFinite(value);

function validTarget(target: ProgressionTarget): boolean {
  return (
    Number.isInteger(target.sets) &&
    target.sets > 0 &&
    Number.isInteger(target.minReps) &&
    target.minReps > 0 &&
    Number.isInteger(target.maxReps) &&
    target.maxReps >= target.minReps &&
    (target.weightKg === null || (validNumber(target.weightKg) && target.weightKg >= 0))
  );
}

function completeSession(
  session: ProgressionPerformance | undefined,
  target: ProgressionTarget,
): boolean {
  return (
    !!session &&
    session.sets.length === target.sets &&
    session.sets.every(
      (set) => set.completed !== false && Number.isInteger(set.reps) && set.reps >= target.minReps,
    )
  );
}

/**
 * Suggests (never applies) the next prescription from newest-first logged
 * sessions. No mutable progression state is kept: historical prescriptions
 * are carried explicitly when available; actual logged loads are never used
 * to infer an unrecorded prescription.
 */
export function suggestProgression(
  rule: ProgressionRule,
  target: ProgressionTarget,
  history: ReadonlyArray<ProgressionPerformance>,
): ProgressionSuggestion {
  const fallback: ProgressionSuggestion = {
    weightKg: target.weightKg,
    reps: target.minReps,
    reason: "invalid_options",
  };
  if (!validTarget(target)) return fallback;
  if (rule.kind === "none")
    return { weightKg: target.weightKg, reps: target.minReps, reason: "rule_disabled" };
  if (
    !validNumber(rule.incrementKg) ||
    rule.incrementKg < 0 ||
    (rule.kind === "linear" &&
      (!validNumber(rule.deloadPercent) ||
        rule.deloadPercent < 0 ||
        rule.deloadPercent > 100 ||
        !Number.isInteger(rule.failureThreshold) ||
        rule.failureThreshold < 1))
  )
    return fallback;

  const latest = history[0];
  const prescribedWeight =
    latest?.effectivePrescribedWeightKg !== undefined
      ? latest.effectivePrescribedWeightKg
      : target.weightKg;
  const weightKg = prescribedWeight;
  const base = { weightKg, reps: target.minReps };
  if (!latest) return { ...base, reason: "no_history", incrementKg: rule.incrementKg };

  if (rule.kind === "double") {
    const full =
      latest.sets.length === target.sets &&
      latest.sets.every((set) => set.completed !== false && Number.isInteger(set.reps));
    if (!full) return { ...base, reason: "incomplete_session", incrementKg: rule.incrementKg };
    if (latest.sets.some((set) => set.weightKg !== prescribedWeight))
      return { ...base, reason: "load_mismatch", incrementKg: rule.incrementKg };
    if (latest.sets.some((set) => set.reps < target.minReps))
      return { ...base, reason: "reps_below_target", incrementKg: rule.incrementKg };
    if (latest.sets.every((set) => set.reps >= target.maxReps)) {
      // Null load (bodyweight) remains null; never invent a weighted load.
      return {
        weightKg: weightKg === null ? null : weightKg + rule.incrementKg,
        reps: target.minReps,
        reason: weightKg === null ? "progression_held" : "double_progression_increased",
        incrementKg: rule.incrementKg,
      };
    }
    const reps = Math.min(
      target.maxReps,
      Math.max(target.minReps, ...latest.sets.map((set) => set.reps + 1)),
    );
    return { ...base, reps, reason: "reps_advanced", incrementKg: rule.incrementKg };
  }

  let failures = 0;
  for (const session of history) {
    if (completeSession(session, target)) break;
    failures += 1;
  }
  if (failures >= rule.failureThreshold) {
    const sourceLoad = weightKg;
    return {
      weightKg: sourceLoad === null ? null : sourceLoad * (1 - rule.deloadPercent / 100),
      reps: target.minReps,
      reason: "linear_deload",
      failures,
      deloadPercent: rule.deloadPercent,
    };
  }
  if (completeSession(latest, target)) {
    return {
      weightKg: weightKg === null ? null : weightKg + rule.incrementKg,
      reps: target.minReps,
      reason: weightKg === null ? "progression_held" : "linear_progression_increased",
      incrementKg: rule.incrementKg,
      failures,
    };
  }
  return {
    ...base,
    reason: "linear_failure_recorded",
    failures,
    deloadPercent: rule.deloadPercent,
  };
}
