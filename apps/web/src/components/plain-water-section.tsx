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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PlainWaterDayView } from "@/components/plain-water-day-view";
import {
  createPlainWaterController,
  plainWaterDayKey,
  plainWaterPreferencesKey,
  type PlainWaterControllerState,
  type PlainWaterOperation,
  type PlainWaterOwner,
  type PlainWaterTransport,
} from "@/components/plain-water-controller";
import { createPlainWaterFormLifecycle } from "@/components/plain-water-form-lifecycle";
import { orpc } from "@/utils/orpc";

type ChangePatch = { quantity?: number; unit?: WaterUnit; observedAt?: string; timeZone?: string };
type Conflict = {
  kind: "add" | "change" | "delete";
  entryId: number | null;
  patch?: ChangePatch;
  server: { revision: number; quantityMl: number | null; deleted: boolean };
};
type Controller = ReturnType<typeof createPlainWaterController>;

/** Online-only web writes are held in memory for acknowledgement-loss retries; navigation/reload loses that retry state. */
export function PlainWaterSection({
  localDate,
  timeZone,
  hideNumbers,
  announce,
  trustedScope,
}: {
  localDate: string;
  timeZone: string;
  hideNumbers: boolean;
  announce: (text: string) => void;
  trustedScope: string | null;
}) {
  const queryClient = useQueryClient();
  const [unit, setUnit] = useState<WaterUnit>("ml");
  const [formError, setFormError] = useState<string | null>(null);
  const [settingsBusyOwner, setSettingsBusyOwner] = useState<string | null>(null);
  const [controllerView, setControllerView] = useState<{
    ownerKey: string;
    state: PlainWaterControllerState;
  }>({ ownerKey: "", state: { status: "idle" } });
  const controllerRef = useRef<Controller | null>(null);
  const formLifecycleRef = useRef<{
    controller: Controller;
    lifecycle: ReturnType<typeof createPlainWaterFormLifecycle>;
  } | null>(null);
  const [resolvedIntentGeneration, setResolvedIntentGeneration] = useState<number | null>(null);
  const ownerKeyRef = useRef("");
  const generationRef = useRef(0);
  const owner: PlainWaterOwner = { scope: trustedScope, date: localDate, timeZone };
  const ownerKey = JSON.stringify([trustedScope, localDate, timeZone]);
  ownerKeyRef.current = ownerKey;
  const dayKey = plainWaterDayKey(owner);
  const preferencesKey = plainWaterPreferencesKey(owner);

  const dayOptions = orpc.plainWater.getDay.queryOptions({ input: { date: localDate, timeZone } });
  const preferenceOptions = orpc.plainWater.getPreferences.queryOptions({ input: {} });
  const dayQuery = useQuery({ ...dayOptions, queryKey: dayKey, enabled: trustedScope !== null });
  const preferencesQuery = useQuery({
    ...preferenceOptions,
    queryKey: preferencesKey,
    enabled: trustedScope !== null,
  });
  const add = useMutation(orpc.plainWater.add.mutationOptions());
  const change = useMutation(orpc.plainWater.change.mutationOptions());
  const remove = useMutation(orpc.plainWater.delete.mutationOptions());
  const preferences = useMutation(orpc.plainWater.updatePreferences.mutationOptions());

  const transportRef = useRef<PlainWaterTransport>(async () => {
    throw new Error("Plain-water transport is not ready.");
  });
  transportRef.current = async (operation: PlainWaterOperation) => {
    if (operation.kind === "add") {
      const result = await add.mutateAsync(operation.payload);
      return result.outcome === "conflict"
        ? {
            outcome: "conflict",
            server: {
              revision: result.entry.revision,
              quantityMl: result.entry.quantityMl,
              deleted: result.entry.deleted,
            },
          }
        : { outcome: result.outcome };
    }
    if (operation.kind === "change") {
      const result = await change.mutateAsync(operation.payload);
      return result.outcome === "conflict"
        ? {
            outcome: "conflict",
            server: {
              revision: result.entry.revision,
              quantityMl: result.entry.quantityMl,
              deleted: result.entry.deleted,
            },
          }
        : { outcome: result.outcome };
    }
    const result = await remove.mutateAsync(operation.payload);
    return result.outcome === "conflict"
      ? {
          outcome: "conflict",
          server: {
            revision: result.entry.revision,
            quantityMl: result.entry.quantityMl,
            deleted: result.entry.deleted,
          },
        }
      : { outcome: result.outcome };
  };

  const refresh = useCallback(() => {
    if (trustedScope === null || ownerKeyRef.current !== ownerKey) return;
    void queryClient.invalidateQueries({ queryKey: dayKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: preferencesKey, exact: true });
  }, [dayKey, ownerKey, preferencesKey, queryClient, trustedScope]);

  const onControllerState = useCallback(
    (instance: Controller, generation: number, next: PlainWaterControllerState) => {
      if (
        controllerRef.current !== instance ||
        generationRef.current !== generation ||
        ownerKeyRef.current !== ownerKey
      )
        return;
      setControllerView({ ownerKey, state: next });
      const formLifecycle = formLifecycleRef.current;
      if (
        next.status === "complete" &&
        formLifecycle?.controller === instance &&
        formLifecycle.lifecycle.observeControllerState(next)
      ) {
        setResolvedIntentGeneration(formLifecycle.lifecycle.resolvedGeneration);
      }
      if (next.status === "busy") {
        setFormError(null);
        return;
      }
      if (next.status === "complete") {
        announce(
          next.operation.kind === "add"
            ? WATER_COPY.saved
            : next.operation.kind === "change"
              ? WATER_COPY.changed
              : WATER_COPY.deleted,
        );
        refresh();
        return;
      }
      if (next.status === "conflict") {
        announce(WATER_COPY.conflictTitle);
        refresh();
        return;
      }
      if (next.status === "uncertain") {
        setFormError(WATER_COPY.networkError);
        announce(WATER_COPY.networkError);
        toast.error(WATER_COPY.networkError, {
          action: { label: "Refresh diary", onClick: refresh },
        });
      }
    },
    [announce, ownerKey, refresh],
  );

  // Each setup gets a new controller. Cleanup is irreversible; StrictMode's
  // setup/cleanup/setup sequence can never reactivate the disposed instance.
  useEffect(() => {
    const generation = ++generationRef.current;
    const formLifecycle = createPlainWaterFormLifecycle();
    const controller = createPlainWaterController({
      owner,
      createId: newClientMutationId,
      send: (operation) => transportRef.current(operation),
      onState: (next) => onControllerState(controller, generation, next),
    });
    controllerRef.current = controller;
    formLifecycleRef.current = { controller, lifecycle: formLifecycle };
    setControllerView({ ownerKey, state: controller.state });
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (formLifecycleRef.current?.controller === controller) formLifecycleRef.current = null;
      generationRef.current += 1;
      controller.dispose();
    };
    // ownerKey is the full trusted scope/day/zone identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  const controllerState =
    controllerView.ownerKey === ownerKey ? controllerView.state : { status: "idle" as const };
  const activeController =
    controllerRef.current?.owner.scope === trustedScope &&
    controllerRef.current?.owner.date === localDate &&
    controllerRef.current?.owner.timeZone === timeZone
      ? controllerRef.current
      : null;
  const busy: "add" | "edit" | "delete" | "settings" | null =
    trustedScope === null
      ? "settings"
      : controllerState.status === "busy"
        ? controllerState.operation.kind === "add"
          ? "add"
          : controllerState.operation.kind === "change"
            ? "edit"
            : "delete"
        : settingsBusyOwner === ownerKey
          ? "settings"
          : null;

  const view = useMemo(
    () => (dayQuery.data ? buildWaterDayView(dayQuery.data, [], hideNumbers) : null),
    [dayQuery.data, hideNumbers],
  );
  const enabled =
    trustedScope !== null
      ? preferencesQuery.isError
        ? null
        : (preferencesQuery.data?.enabled ?? dayQuery.data?.enabled ?? null)
      : null;

  const ownerIsLive = (generation: number) =>
    trustedScope !== null &&
    ownerKeyRef.current === ownerKey &&
    generationRef.current === generation;
  const settingsWrite = async (write: () => Promise<unknown>, success: string) => {
    if (!activeController || trustedScope === null) return false;
    const generation = generationRef.current;
    setFormError(null);
    setSettingsBusyOwner(ownerKey);
    try {
      await write();
      if (!ownerIsLive(generation)) return false;
      announce(success);
      refresh();
      return true;
    } catch {
      if (!ownerIsLive(generation)) return false;
      setFormError(WATER_COPY.settingsError);
      announce(WATER_COPY.settingsError);
      toast.error(WATER_COPY.settingsError, {
        action: { label: "Refresh diary", onClick: refresh },
      });
      refresh();
      return false;
    } finally {
      if (ownerIsLive(generation)) setSettingsBusyOwner(null);
    }
  };

  const publishResolvedForm = (
    lifecycle: ReturnType<typeof createPlainWaterFormLifecycle>,
    generation: number,
  ) => {
    if (lifecycle.resolvedGeneration === generation) setResolvedIntentGeneration(generation);
  };

  const onAdd = async (
    input: { quantity: number; unit: WaterUnit; observedAt: string },
    generation?: number,
  ) => {
    const lifecycleOwner = formLifecycleRef.current;
    if (!activeController || !lifecycleOwner || trustedScope === null || generation === undefined)
      return false;
    const ownerGeneration = generationRef.current;
    const result = await lifecycleOwner.lifecycle.submit(activeController, generation, {
      kind: "add",
      payload: { ...input, timeZone },
    });
    if (ownerIsLive(ownerGeneration) && lifecycleOwner.controller === activeController)
      publishResolvedForm(lifecycleOwner.lifecycle, generation);
    return result.status === "complete";
  };
  const onChange = async (
    entryId: number,
    revision: number,
    patch: ChangePatch,
    generation?: number,
  ) => {
    const lifecycleOwner = formLifecycleRef.current;
    if (!activeController || !lifecycleOwner || trustedScope === null || generation === undefined)
      return false;
    const ownerGeneration = generationRef.current;
    const result = await lifecycleOwner.lifecycle.submit(activeController, generation, {
      kind: "change",
      payload: { id: entryId, expectedRevision: revision, ...patch },
    });
    if (ownerIsLive(ownerGeneration) && lifecycleOwner.controller === activeController)
      publishResolvedForm(lifecycleOwner.lifecycle, generation);
    return result.status === "complete";
  };
  const onDelete = (entryId: number, revision: number) => {
    if (!activeController || trustedScope === null) return;
    void activeController.submit({
      kind: "delete",
      payload: { id: entryId, expectedRevision: revision },
    });
  };

  const conflict: Conflict | null =
    controllerState.status === "conflict"
      ? {
          kind: controllerState.operation.kind,
          entryId:
            controllerState.operation.kind === "add" ? null : controllerState.operation.payload.id,
          ...(controllerState.operation.kind === "change"
            ? {
                patch: {
                  quantity: controllerState.operation.payload.quantity,
                  unit: controllerState.operation.payload.unit,
                  observedAt: controllerState.operation.payload.observedAt,
                  timeZone: controllerState.operation.payload.timeZone,
                },
              }
            : {}),
          server: controllerState.server,
        }
      : null;

  const keepMine = () => {
    if (!activeController || controllerState.status !== "conflict") return;
    const formLifecycle = formLifecycleRef.current;
    if (!formLifecycle || formLifecycle.controller !== activeController) return;
    const ownerGeneration = generationRef.current;
    void formLifecycle.lifecycle.rebase(activeController).then((result) => {
      if (!ownerIsLive(ownerGeneration) || result.status !== "complete") return;
      const resolved = formLifecycle.lifecycle.resolvedGeneration;
      if (resolved !== null) setResolvedIntentGeneration(resolved);
    });
  };
  const keepOther = () => {
    const ownerGeneration = generationRef.current;
    const formLifecycle = formLifecycleRef.current;
    if (
      !ownerIsLive(ownerGeneration) ||
      !activeController ||
      !formLifecycle ||
      formLifecycle.controller !== activeController
    )
      return;
    if (!formLifecycle.lifecycle.keepOther(activeController)) return;
    const resolved = formLifecycle.lifecycle.resolvedGeneration;
    if (resolved !== null) setResolvedIntentGeneration(resolved);
    refresh();
  };
  const retryMutation = () => {
    if (!activeController || controllerState.status !== "uncertain") return;
    const formLifecycle = formLifecycleRef.current;
    if (!formLifecycle || formLifecycle.controller !== activeController) return;
    const ownerGeneration = generationRef.current;
    void formLifecycle.lifecycle.retry(activeController).then((result) => {
      if (!ownerIsLive(ownerGeneration) || result.status !== "complete") return;
      const resolved = formLifecycle.lifecycle.resolvedGeneration;
      if (resolved !== null) setResolvedIntentGeneration(resolved);
    });
  };

  const mineText = (active: Conflict) => {
    if (active.kind === "delete") return "remove the entry.";
    if (active.patch?.quantity !== undefined && active.patch.unit !== undefined)
      return `${formatWaterAmount(waterQuantityMl(active.patch.quantity, active.patch.unit), unit, hideNumbers)}.`;
    if (active.patch?.observedAt)
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
            : `${WATER_COPY.conflictOther}: ${formatWaterAmount(conflict.server.quantityMl, unit, hideNumbers)}.`}
        </p>
        <p className="text-muted-foreground">
          {WATER_COPY.conflictMine}: {mineText(conflict)}
        </p>
        <div className="flex flex-wrap gap-2">
          {conflict.kind !== "add" && !conflict.server.deleted ? (
            <Button size="sm" onClick={keepMine} disabled={busy !== null}>
              {WATER_COPY.keepMine}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={keepOther}>
            {WATER_COPY.keepOther}
          </Button>
        </div>
      </div>
    );
  const uncertainRetry =
    controllerState.status === "uncertain" ? (
      <div className="flex items-center gap-2" role="alert">
        <span>{WATER_COPY.networkError}</span>
        <Button size="sm" variant="outline" onClick={retryMutation} disabled={busy !== null}>
          {WATER_COPY.retry}
        </Button>
      </div>
    ) : null;

  return (
    <PlainWaterDayView
      key={`${trustedScope ?? "none"}:${localDate}:${timeZone}`}
      view={view}
      load={
        trustedScope === null
          ? "error"
          : dayQuery.isPending
            ? "loading"
            : dayQuery.isError
              ? "error"
              : "ready"
      }
      enabled={enabled}
      hideNumbers={hideNumbers}
      unit={unit}
      onUnitChange={setUnit}
      localDate={localDate}
      timeZone={timeZone}
      busy={busy}
      formError={formError}
      onRetry={refresh}
      onToggleEnabled={(next) => {
        void settingsWrite(
          () => preferences.mutateAsync({ enabled: next }),
          next ? WATER_COPY.turnedOn : WATER_COPY.turnedOff,
        );
      }}
      onSaveGoal={(personalGoalMl) =>
        settingsWrite(
          () =>
            preferences.mutateAsync(
              personalGoalMl === null
                ? { personalGoal: null }
                : { personalGoal: personalGoalMl, personalGoalUnit: "ml" },
            ),
          personalGoalMl === null ? WATER_COPY.goalCleared : WATER_COPY.goalSaved,
        )
      }
      onAdd={onAdd}
      onChange={onChange}
      onDelete={onDelete}
      resolvedIntentGeneration={resolvedIntentGeneration}
      aboveList={
        <>
          {uncertainRetry}
          {conflictCard}
        </>
      }
    />
  );
}
