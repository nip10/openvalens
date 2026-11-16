import { Trans, useLingui } from "@lingui/react/macro";
import type { GoalSummary } from "@openvalens/plans/personal-goals";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { orpc } from "@/utils/orpc";
import { goalDate, parseManualAmount } from "./-goals-ui";

/**
 * A manual goal's check-in (goals#5): the "Check in" on its card, the "+" on
 * Goals and the palette's goal check-in row all open this. `goals` are the
 * goals that take a typed value; `goalId` is the one to start on.
 */
export function GoalCheckinDialog({
  open,
  onOpenChange,
  goals,
  goalId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goals: readonly GoalSummary[];
  goalId: number | null;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const [chosen, setChosen] = useState<number | null>(goalId);
  const [value, setValue] = useState("");
  const [date, setDate] = useState("");
  const [requestId, setRequestId] = useState("");
  const goal = goals.find((item) => item.id === chosen) ?? goals[0] ?? null;
  const today = goal ? goalDate(goal.definition.timeZone, goal.definition.dayCutoff) : "";

  // A fresh form each time it opens, on the goal it was opened for.
  useEffect(() => {
    if (!open) return;
    setChosen(goalId ?? goals[0]?.id ?? null);
    setValue("");
    setDate("");
    setRequestId(globalThis.crypto.randomUUID());
  }, [open, goalId]);

  const save = useMutation(
    orpc.goals.createCheckin.mutationOptions({
      onSuccess: () => {
        onOpenChange(false);
        onSaved();
      },
    }),
  );
  const amount = parseManualAmount(value);
  const unit = goal?.definition.unit ?? null;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? goal.title : <Trans>Check in</Trans>}
      description={<Trans>Record where you are today.</Trans>}
    >
      {goal ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (amount === null || save.isPending) return;
            save.mutate({
              goalId: goal.id,
              date: date || today,
              value: amount,
              clientMutationId: requestId || globalThis.crypto.randomUUID(),
            });
          }}
        >
          {goals.length > 1 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="goal-checkin-goal">
                <Trans>Goal</Trans>
              </Label>
              <select
                id="goal-checkin-goal"
                className="h-10 rounded-xl border border-rule-2 bg-sheet px-3 text-ink"
                value={goal.id}
                onChange={(event) => {
                  setChosen(Number(event.target.value));
                  setRequestId(globalThis.crypto.randomUUID());
                }}
              >
                {goals.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="goal-checkin-value">{unit ? t`Value (${unit})` : t`Value`}</Label>
              <Input
                id="goal-checkin-value"
                type="number"
                step="any"
                inputMode="decimal"
                autoFocus
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (save.isError) setRequestId(globalThis.crypto.randomUUID());
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="goal-checkin-date">
                <Trans>Date</Trans>
              </Label>
              <Input
                id="goal-checkin-date"
                type="date"
                max={today}
                value={date || today}
                onChange={(event) => {
                  setDate(event.target.value);
                  if (save.isError) setRequestId(globalThis.crypto.randomUUID());
                }}
              />
            </div>
          </div>
          {save.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {save.error?.message ?? t`Could not save. Try again.`}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={amount === null || save.isPending}>
              {save.isPending ? t`Saving…` : t`Save check-in`}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-ink-3">
          <Trans>No goal takes a check-in right now.</Trans>
        </p>
      )}
    </FormDialog>
  );
}
