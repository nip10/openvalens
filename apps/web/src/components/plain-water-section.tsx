import { newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import {
  WATER_COPY,
  buildWaterDayView,
  formatObservedClock,
  formatWaterAmount,
  waterQuantityMl,
  type WaterUnit,
} from "@openvalens/api/presenters/plain-water";
import { Button } from "@openvalens/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PlainWaterDayView } from "@/components/plain-water-day-view";
import { orpc } from "@/utils/orpc";

type ChangePatch = {
  quantity?: number;
  unit?: WaterUnit;
  observedAt?: string;
  timeZone?: string;
};

type ServerVersion = { revision: number; quantityMl: number | null; deleted: boolean };

type Conflict =
  | { kind: "change"; entryId: number; patch: ChangePatch; server: ServerVersion }
  | { kind: "delete"; entryId: number; server: ServerVersion };

/**
 * Plain-water section (Issue #83) for the web diary. Web is online-only, like
 * the rest of the web diary: every change goes straight to `plainWater.*`, a
 * network failure leaves saved data untouched and offers a retry, and there is
 * no durable outbox. Enable and goal changes are settings, not queued writes.
 */
export function PlainWaterSection({
  localDate,
  timeZone,
  hideNumbers,
  announce,
}: {
  localDate: string;
  timeZone: string;
  hideNumbers: boolean;
  announce: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [unit, setUnit] = useState<WaterUnit>("ml");
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const dayQuery = useQuery(
    orpc.plainWater.getDay.queryOptions({ input: { date: localDate, timeZone } }),
  );
  const preferencesQuery = useQuery(orpc.plainWater.getPreferences.queryOptions({ input: {} }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.plainWater.key() });

  const view = useMemo(
    () => (dayQuery.data ? buildWaterDayView(dayQuery.data, [], hideNumbers) : null),
    [dayQuery.data, hideNumbers],
  );
  const enabled = preferencesQuery.data?.enabled ?? dayQuery.data?.enabled ?? null;

  // Drafts, editors and conflict revisions belong to one diary day; a new day
  // (or account, via the route key) must never reuse them.
  useEffect(() => {
    setConflict(null);
    setFormError(null);
  }, [localDate]);

  const add = useMutation(orpc.plainWater.add.mutationOptions());
  const change = useMutation(orpc.plainWater.change.mutationOptions());
  const remove = useMutation(orpc.plainWater.delete.mutationOptions());
  const preferences = useMutation(orpc.plainWater.updatePreferences.mutationOptions());

  const busy: "add" | "edit" | "delete" | "settings" | null = add.isPending
    ? "add"
    : change.isPending
      ? "edit"
      : remove.isPending
        ? "delete"
        : preferences.isPending
          ? "settings"
          : null;

  const failure = (error: unknown) => {
    const code = (error as { code?: string })?.code;
    const message = code === "INVALID_INPUT" ? WATER_COPY.rejectedTitle : WATER_COPY.networkError;
    setFormError(message);
    announce(message);
    toast.error(message, {
      action: { label: WATER_COPY.retry, onClick: () => void refresh() },
    });
  };

  const applyChange = async (
    entryId: number,
    expectedRevision: number,
    patch: ChangePatch,
  ): Promise<"saved" | "conflict" | "failed"> => {
    setFormError(null);
    try {
      const result = await change.mutateAsync({
        clientMutationId: newClientMutationId(),
        id: entryId,
        expectedRevision,
        ...patch,
      });
      if (result.outcome === "conflict") {
        // A conflict is not a save: show both versions and let the member pick.
        setConflict({
          kind: "change",
          entryId,
          patch,
          server: {
            revision: result.entry.revision,
            quantityMl: result.entry.quantityMl,
            deleted: result.entry.deleted,
          },
        });
        announce(WATER_COPY.conflictTitle);
        void refresh();
        return "conflict";
      }
      setConflict(null);
      announce(WATER_COPY.changed);
      void refresh();
      return "saved";
    } catch (error) {
      failure(error);
      return "failed";
    }
  };

  const onAdd = async (input: { quantity: number; unit: WaterUnit; observedAt: string }) => {
    setFormError(null);
    try {
      await add.mutateAsync({
        clientMutationId: newClientMutationId(),
        quantity: input.quantity,
        unit: input.unit,
        observedAt: input.observedAt,
        timeZone,
      });
      announce(WATER_COPY.saved);
      void refresh();
      return true;
    } catch (error) {
      failure(error);
      return false;
    }
  };

  const onChange = async (entryId: number, revision: number, patch: ChangePatch) =>
    (await applyChange(entryId, revision, patch)) === "saved";

  const onDelete = (entryId: number, revision: number) => {
    setFormError(null);
    setConflict(null);
    remove.mutate(
      { clientMutationId: newClientMutationId(), id: entryId, expectedRevision: revision },
      {
        onSuccess: (result) => {
          if (result.outcome === "conflict") {
            setConflict({
              kind: "delete",
              entryId,
              server: {
                revision: result.entry.revision,
                quantityMl: result.entry.quantityMl,
                deleted: result.entry.deleted,
              },
            });
            announce(WATER_COPY.conflictTitle);
            void refresh();
            return;
          }
          announce(WATER_COPY.deleted);
          void refresh();
        },
        onError: failure,
      },
    );
  };

  const keepMine = async () => {
    if (!conflict) return;
    if (conflict.kind === "change") {
      await applyChange(conflict.entryId, conflict.server.revision, conflict.patch);
      return;
    }
    setFormError(null);
    remove.mutate(
      {
        clientMutationId: newClientMutationId(),
        id: conflict.entryId,
        expectedRevision: conflict.server.revision,
      },
      {
        onSuccess: (result) => {
          if (result.outcome === "conflict") {
            setConflict({
              kind: "delete",
              entryId: conflict.entryId,
              server: {
                revision: result.entry.revision,
                quantityMl: result.entry.quantityMl,
                deleted: result.entry.deleted,
              },
            });
            announce(WATER_COPY.conflictTitle);
            void refresh();
            return;
          }
          setConflict(null);
          announce(WATER_COPY.deleted);
          void refresh();
        },
        onError: (error) => {
          failure(error);
        },
      },
    );
  };

  const onSaveGoal = async (personalGoalMl: number | null) => {
    setFormError(null);
    try {
      await preferences.mutateAsync(
        personalGoalMl === null
          ? { personalGoal: null }
          : { personalGoal: personalGoalMl, personalGoalUnit: "ml" },
      );
      announce(personalGoalMl === null ? WATER_COPY.goalCleared : WATER_COPY.goalSaved);
      void refresh();
      return true;
    } catch {
      setFormError(WATER_COPY.settingsError);
      announce(WATER_COPY.settingsError);
      toast.error(WATER_COPY.settingsError);
      void refresh();
      return false;
    }
  };

  const onToggleEnabled = (next: boolean) => {
    setFormError(null);
    preferences.mutate(
      { enabled: next },
      {
        onSuccess: () => {
          announce(next ? WATER_COPY.turnedOn : WATER_COPY.turnedOff);
          void refresh();
        },
        onError: () => {
          setFormError(WATER_COPY.settingsError);
          announce(WATER_COPY.settingsError);
          toast.error(WATER_COPY.settingsError);
          void refresh();
        },
      },
    );
  };

  const mineText = (active: Conflict) => {
    if (active.kind === "delete") return "remove the entry.";
    if (active.patch.quantity !== undefined && active.patch.unit !== undefined)
      return `${formatWaterAmount(
        waterQuantityMl(active.patch.quantity, active.patch.unit),
        unit,
        hideNumbers,
      )}.`;
    if (active.patch.observedAt)
      return `${formatObservedClock(active.patch.observedAt, active.patch.timeZone ?? timeZone) ?? "a different time"}.`;
    return "the entry values.";
  };

  const conflictCard =
    conflict === null ? null : (
      <div className="grid gap-2 rounded-md border p-3 text-sm" role="alert">
        <p className="font-medium">{WATER_COPY.conflictTitle}</p>
        <p className="text-muted-foreground">
          {conflict.server.deleted
            ? WATER_COPY.conflictGone
            : `${WATER_COPY.conflictOther}: ${formatWaterAmount(
                conflict.server.quantityMl,
                unit,
                hideNumbers,
              )}.`}
        </p>
        <p className="text-muted-foreground">
          {WATER_COPY.conflictMine}: {mineText(conflict)}
        </p>
        <div className="flex flex-wrap gap-2">
          {conflict.server.deleted ? null : (
            <Button size="sm" onClick={() => void keepMine()} disabled={busy !== null}>
              {WATER_COPY.keepMine}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setConflict(null);
              void refresh();
            }}
          >
            {WATER_COPY.keepOther}
          </Button>
        </div>
      </div>
    );

  return (
    <PlainWaterDayView
      key={localDate}
      view={view}
      load={dayQuery.isPending ? "loading" : dayQuery.isError ? "error" : "ready"}
      enabled={enabled}
      hideNumbers={hideNumbers}
      unit={unit}
      onUnitChange={setUnit}
      localDate={localDate}
      timeZone={timeZone}
      busy={busy}
      formError={formError}
      onRetry={() => {
        void dayQuery.refetch();
        void preferencesQuery.refetch();
      }}
      onToggleEnabled={onToggleEnabled}
      onSaveGoal={onSaveGoal}
      onAdd={onAdd}
      onChange={onChange}
      onDelete={onDelete}
      aboveList={conflictCard}
    />
  );
}
