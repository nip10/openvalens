import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

export type RoutineExercise = {
  key: string;
  exerciseId: number | null;
  name: string;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  targetWeightKg: number | null;
  restSeconds: number;
  progression:
    | { kind: "none" }
    | { kind: "double"; incrementKg: number }
    | { kind: "linear"; incrementKg: number; deloadPercent: number; failureThreshold: number };
};

export type WorkoutRoutineExerciseEditorProps = {
  exercise: RoutineExercise;
  index: number;
  total: number;
  units: "metric" | "imperial";
  onChange: (exercise: RoutineExercise) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

const LB_PER_KG = 2.2046226218;
const shownWeight = (kg: number, units: "metric" | "imperial") =>
  units === "metric" ? kg : kg * LB_PER_KG;

export function WorkoutRoutineExerciseEditor({
  exercise,
  index,
  total,
  units,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: WorkoutRoutineExerciseEditorProps) {
  const { t } = useLingui();
  const id = useId();
  const [weightText, setWeightText] = useState(
    exercise.targetWeightKg == null ? "" : String(shownWeight(exercise.targetWeightKg, units)),
  );
  const [incrementText, setIncrementText] = useState(() =>
    exercise.progression.kind === "none"
      ? "2.5"
      : String(shownWeight(exercise.progression.incrementKg, units)),
  );
  const [weightFocused, setWeightFocused] = useState(false);
  const [incrementFocused, setIncrementFocused] = useState(false);
  useEffect(() => {
    if (!weightFocused)
      setWeightText(
        exercise.targetWeightKg == null ? "" : String(shownWeight(exercise.targetWeightKg, units)),
      );
  }, [exercise.targetWeightKg, units, weightFocused]);
  useEffect(() => {
    if (!incrementFocused)
      setIncrementText(
        exercise.progression.kind === "none"
          ? "2.5"
          : String(shownWeight(exercise.progression.incrementKg, units)),
      );
  }, [exercise.progression, units, incrementFocused]);

  const field = (name: string) => `${id}-${name}`;
  const set = (patch: Partial<RoutineExercise>) => onChange({ ...exercise, ...patch });
  const setProgressionKind = (kind: "none" | "double" | "linear") => {
    const current = exercise.progression;
    const incrementKg =
      current.kind === "none" ? (units === "metric" ? 2.5 : 5 / LB_PER_KG) : current.incrementKg;
    set({
      progression:
        kind === "none"
          ? { kind }
          : kind === "double"
            ? { kind, incrementKg }
            : {
                kind,
                incrementKg,
                deloadPercent: current.kind === "linear" ? current.deloadPercent : 10,
                failureThreshold: current.kind === "linear" ? current.failureThreshold : 3,
              },
    });
  };

  return (
    <Card className="gap-4 border border-line bg-paper/80 py-4 shadow-sm">
      <CardHeader className="flex grid-cols-[1fr_auto] items-center gap-3 px-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
            <Trans>Exercise {index + 1}</Trans>
          </p>
          <CardTitle className="truncate">{exercise.name}</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t`Move ${exercise.name} up`}
            disabled={index <= 0}
            onClick={onMoveUp}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t`Move ${exercise.name} down`}
            disabled={index >= total - 1}
            onClick={onMoveDown}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t`Remove ${exercise.name}`}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor={field("sets")}>
              <Trans>Sets</Trans>
            </Label>
            <Input
              id={field("sets")}
              aria-label={t`${exercise.name} sets`}
              type="number"
              min="1"
              max="20"
              step="1"
              value={exercise.targetSets}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isInteger(n) && n >= 1 && n <= 20) set({ targetSets: n });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={field("reps-min")}>
              <Trans>Minimum reps</Trans>
            </Label>
            <Input
              id={field("reps-min")}
              aria-label={t`${exercise.name} minimum reps`}
              type="number"
              min="1"
              max="1000"
              step="1"
              value={exercise.repsMin}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isInteger(n) && n >= 1 && n <= 1000) set({ repsMin: n });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={field("reps-max")}>
              <Trans>Maximum reps</Trans>
            </Label>
            <Input
              id={field("reps-max")}
              aria-label={t`${exercise.name} maximum reps`}
              type="number"
              min="1"
              max="1000"
              step="1"
              value={exercise.repsMax}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isInteger(n) && n >= 1 && n <= 1000) set({ repsMax: n });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={field("rest")}>
              <Trans>Rest (seconds)</Trans>
            </Label>
            <Input
              id={field("rest")}
              aria-label={t`${exercise.name} rest in seconds`}
              type="number"
              min="0"
              max="3600"
              step="1"
              value={exercise.restSeconds}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isInteger(n) && n >= 0 && n <= 3600) set({ restSeconds: n });
              }}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={field("weight")}>
              <Trans>Target weight ({units === "metric" ? "kg" : "lb"})</Trans>
            </Label>
            <Input
              id={field("weight")}
              aria-label={t`${exercise.name} target weight in ${units === "metric" ? "kilograms" : "pounds"}`}
              type="text"
              inputMode="decimal"
              placeholder={t`Optional`}
              value={weightText}
              onFocus={() => setWeightFocused(true)}
              onBlur={() => {
                setWeightFocused(false);
              }}
              onChange={(e) => {
                const raw = e.target.value;
                setWeightText(raw);
                if (raw === "") {
                  set({ targetWeightKg: null });
                  return;
                }
                if (/^\d+(\.\d*)?$/.test(raw)) {
                  const value = Number(raw);
                  if (
                    Number.isFinite(value) &&
                    value >= 0 &&
                    value <= (units === "metric" ? 1000 : 2204.62)
                  )
                    set({ targetWeightKg: units === "metric" ? value : value / LB_PER_KG });
                }
              }}
            />
            <p className="text-xs text-ink-3">
              <Trans>Leave blank for bodyweight or unspecified.</Trans>
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={field("progression")}>
              <Trans>Progression</Trans>
            </Label>
            <select
              id={field("progression")}
              aria-label={t`${exercise.name} progression`}
              className="h-10 rounded-xl border border-line bg-paper px-3 text-sm text-ink"
              value={exercise.progression.kind}
              onChange={(e) => setProgressionKind(e.target.value as "none" | "double" | "linear")}
            >
              <option value="none">{t`None`}</option>
              <option value="double">{t`Double progression`}</option>
              <option value="linear">{t`Linear progression`}</option>
            </select>
          </div>
        </div>
        {exercise.progression.kind !== "none" ? (
          <div className="grid gap-3 rounded-xl border border-line bg-paper-2/50 p-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={field("increment")}>
                <Trans>Weight increment ({units === "metric" ? "kg" : "lb"})</Trans>
              </Label>
              <Input
                id={field("increment")}
                aria-label={t`${exercise.name} progression weight increment`}
                type="text"
                inputMode="decimal"
                value={incrementText}
                onFocus={() => setIncrementFocused(true)}
                onBlur={() => setIncrementFocused(false)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setIncrementText(raw);
                  if (/^\d+(\.\d*)?$/.test(raw)) {
                    const n = Number(raw);
                    const progression = exercise.progression;
                    if (
                      Number.isFinite(n) &&
                      n > 0 &&
                      n <= 100 &&
                      (progression.kind === "double" || progression.kind === "linear")
                    )
                      set({
                        progression: {
                          ...progression,
                          incrementKg: units === "metric" ? n : n / LB_PER_KG,
                        },
                      });
                  }
                }}
              />
            </div>
            {exercise.progression.kind === "linear" ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor={field("deload")}>
                    <Trans>Deload (%)</Trans>
                  </Label>
                  <Input
                    id={field("deload")}
                    aria-label={t`${exercise.name} deload percent`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={exercise.progression.deloadPercent}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      const progression = exercise.progression;
                      if (Number.isFinite(n) && n >= 0 && n <= 100 && progression.kind === "linear")
                        set({ progression: { ...progression, deloadPercent: n } });
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={field("failures")}>
                    <Trans>Failures before deload</Trans>
                  </Label>
                  <Input
                    id={field("failures")}
                    aria-label={t`${exercise.name} failures before deload`}
                    type="number"
                    min="1"
                    max="20"
                    step="1"
                    value={exercise.progression.failureThreshold}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      const progression = exercise.progression;
                      if (Number.isInteger(n) && n >= 1 && n <= 20 && progression.kind === "linear")
                        set({ progression: { ...progression, failureThreshold: n } });
                    }}
                  />
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
