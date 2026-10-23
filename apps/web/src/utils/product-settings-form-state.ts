import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useCallback, useLayoutEffect, useReducer, useRef, useState } from "react";

import type {
  ProductLocale,
  ProductSettingsSnapshot,
  ProductSettingsUpdateInput,
  ProductUnits,
} from "@openvalens/api/product-settings-contract";

export type { ProductSettingsSnapshot, ProductSettingsUpdateInput };

export type ProductSettingsSaveError =
  | { code: "CONFLICT" }
  | { code: "UNKNOWN"; message?: MessageDescriptor };

/** Status messages are descriptors (#67); the form renders them with `_()`. */
type SaveStatus =
  | { tag: "idle" }
  | { tag: "saving"; requestId: number }
  | { tag: "success"; requestId: number; message: MessageDescriptor }
  | { tag: "error"; requestId: number; message: MessageDescriptor }
  | { tag: "conflict"; requestId: number; message: MessageDescriptor }
  | { tag: "stale"; message: MessageDescriptor };

export type ProductSettingsFormModel = {
  ownerId: string;
  baseline: ProductSettingsSnapshot;
  draft: {
    units: ProductUnits;
    locale: ProductLocale;
  };
  status: SaveStatus;
  /**
   * Internal reactive busy marker for the CURRENT in-flight request. Excluded
   * from the public state shape; surfaced only through `isBusy`.
   */
  busyRequestId: number | null;
};

export type ProductSettingsFormAction =
  | { type: "rebase"; snapshot: ProductSettingsSnapshot; ownerId: string }
  | { type: "setUnits"; units: ProductUnits }
  | { type: "setLocale"; locale: ProductLocale }
  | { type: "reset" }
  | { type: "saveStart"; requestId: number }
  | { type: "saveSuccess"; requestId: number; snapshot: ProductSettingsSnapshot }
  | {
      type: "saveError";
      requestId: number;
      error: ProductSettingsSaveError;
    }
  | { type: "applyLatestSnapshot"; requestId: number; snapshot: ProductSettingsSnapshot }
  | { type: "requestStart"; requestId: number }
  | { type: "requestEnd"; requestId: number }
  | { type: "reloadError"; requestId: number };

export const SAVE_SUCCESS_MESSAGE = msg`Saved.`;
export const SAVE_ERROR_MESSAGE = msg`Could not save. Try again.`;
export const CONFLICT_MESSAGE = msg`These settings were changed elsewhere. Reload the latest version, then make your edits again.`;
export const STALE_MESSAGE = msg`A newer version is available. Reload the latest settings to continue.`;
export const RELOAD_ERROR_MESSAGE = msg`Reload failed.`;

function isConflictError(error: unknown): error is { code: "CONFLICT" } {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "CONFLICT"
  );
}

export function createProductSettingsFormState(
  snapshot: ProductSettingsSnapshot,
  ownerId: string,
): ProductSettingsFormModel {
  return {
    ownerId,
    baseline: snapshot,
    draft: {
      units: snapshot.units,
      locale: snapshot.locale,
    },
    status: { tag: "idle" },
    busyRequestId: null,
  };
}

export function reduceProductSettingsForm(
  state: ProductSettingsFormModel,
  action: ProductSettingsFormAction,
): ProductSettingsFormModel {
  switch (action.type) {
    case "rebase": {
      const { ownerId, snapshot } = action;
      // A different owner always gets a fresh, snapshot-derived model — never
      // the previous owner's draft or status.
      if (ownerId !== state.ownerId) {
        return createProductSettingsFormState(snapshot, ownerId);
      }

      const capChanged = snapshot.canEdit !== state.baseline.canEdit;

      // An OLDER snapshot (e.g. a stale query result after our own save bumped
      // the revision) never regresses values/revision, but a capability change
      // still takes effect immediately.
      if (snapshot.revision < state.baseline.revision) {
        if (!capChanged) return state;
        return { ...state, baseline: { ...state.baseline, canEdit: snapshot.canEdit } };
      }

      const baselineUnchanged =
        snapshot.revision === state.baseline.revision &&
        snapshot.units === state.baseline.units &&
        snapshot.locale === state.baseline.locale &&
        snapshot.canEdit === state.baseline.canEdit;
      // A benign identical snapshot is not a change: it never releases a
      // conflict/stale guard.
      if (baselineUnchanged) return state;

      const dirty =
        state.draft.units !== state.baseline.units || state.draft.locale !== state.baseline.locale;

      if (snapshot.revision !== state.baseline.revision) {
        // A genuinely newer revision with no local draft adopts it wholesale.
        if (!dirty) {
          return {
            ...state,
            baseline: snapshot,
            draft: {
              units: snapshot.units,
              locale: snapshot.locale,
            },
            status: { tag: "idle" },
          };
        }
        // Dirty: keep the draft and the saved baseline (its revision is the
        // expectedRevision), flag stale, but honour the fresh capability.
        return {
          ...state,
          baseline: { ...state.baseline, canEdit: snapshot.canEdit },
          status: { tag: "stale", message: STALE_MESSAGE },
        };
      }

      // Same revision: adopt new values only when there is no local draft.
      if (!dirty) {
        return {
          ...state,
          baseline: snapshot,
          draft: {
            units: snapshot.units,
            locale: snapshot.locale,
          },
        };
      }

      return {
        ...state,
        baseline: { ...state.baseline, canEdit: snapshot.canEdit },
      };
    }

    case "setUnits": {
      if (state.status.tag === "saving" || !state.baseline.canEdit) {
        return state;
      }
      return {
        ...state,
        draft: { ...state.draft, units: action.units },
        status: state.status.tag === "success" ? { tag: "idle" } : state.status,
      };
    }

    case "setLocale": {
      if (state.status.tag === "saving" || !state.baseline.canEdit) {
        return state;
      }
      return {
        ...state,
        draft: { ...state.draft, locale: action.locale },
        status: state.status.tag === "success" ? { tag: "idle" } : state.status,
      };
    }

    case "reset": {
      if (state.status.tag === "saving") return state;
      return {
        ...state,
        draft: {
          units: state.baseline.units,
          locale: state.baseline.locale,
        },
        status: { tag: "idle" },
      };
    }

    case "saveStart": {
      if (state.status.tag === "saving") return state;
      return {
        ...state,
        status: { tag: "saving", requestId: action.requestId },
        busyRequestId: action.requestId,
      };
    }

    case "requestStart": {
      return { ...state, busyRequestId: action.requestId };
    }

    case "requestEnd": {
      if (state.busyRequestId !== action.requestId) return state;
      return { ...state, busyRequestId: null };
    }

    case "reloadError": {
      // A reload failure must never release a stale/conflict guard.
      if (state.status.tag === "stale" || state.status.tag === "conflict") return state;
      return {
        ...state,
        status: { tag: "error", requestId: action.requestId, message: RELOAD_ERROR_MESSAGE },
      };
    }

    case "saveSuccess": {
      if (state.status.tag !== "saving" || state.status.requestId !== action.requestId) {
        return state;
      }
      // Never let a stale in-flight response restore edit permission after a
      // fresh cap has been received.
      const nextBaseline: ProductSettingsSnapshot = {
        ...action.snapshot,
        canEdit: state.baseline.canEdit && action.snapshot.canEdit,
      };
      return {
        ownerId: state.ownerId,
        baseline: nextBaseline,
        draft: {
          units: action.snapshot.units,
          locale: action.snapshot.locale,
        },
        status: {
          tag: "success",
          requestId: action.requestId,
          message: SAVE_SUCCESS_MESSAGE,
        },
        busyRequestId: state.busyRequestId,
      };
    }

    case "saveError": {
      if (state.status.tag !== "saving" || state.status.requestId !== action.requestId) {
        return state;
      }
      if (action.error.code === "CONFLICT") {
        return {
          ...state,
          status: {
            tag: "conflict",
            requestId: action.requestId,
            message: CONFLICT_MESSAGE,
          },
        };
      }
      return {
        ...state,
        status: {
          tag: "error",
          requestId: action.requestId,
          message: action.error.message ?? SAVE_ERROR_MESSAGE,
        },
      };
    }

    case "applyLatestSnapshot": {
      // Ignore reload results that are older than the baseline we already have;
      // a non-older revision (or new capability) is accepted.
      if (action.snapshot.revision < state.baseline.revision) {
        return state;
      }
      return createProductSettingsFormState(action.snapshot, state.ownerId);
    }

    default:
      return state;
  }
}

/**
 * Pure owner-filtered render projection. Used during render only: it never
 * mutates a ref or dispatches. On an owner change it returns a fresh,
 * snapshot-derived model so the first render of a new owner never shows the
 * previous owner's draft/status.
 */
export function deriveProductSettingsFormState(
  state: ProductSettingsFormModel,
  snapshot: ProductSettingsSnapshot,
  ownerId: string,
): ProductSettingsFormModel {
  return reduceProductSettingsForm(state, { type: "rebase", snapshot, ownerId });
}

/**
 * Ownership fence shared by every action callback.
 *
 * A callback is only live when the component is mounted (`alive`), the live
 * committed owner still equals the owner captured when the callback was created,
 * and the live ownership epoch still equals the epoch captured at that time. The
 * epoch advances on every ownerId change and on unmount/StrictMode replay, so a
 * callback retained across an A→B→A principal transition (whose captured epoch
 * is stale even though the owner id matches again) no longer authorizes
 * transport.
 */
export function isOwnershipCurrent(input: {
  capturedOwnerId: string;
  capturedEpoch: number;
  liveOwnerId: string | null;
  liveEpoch: number;
  alive: boolean;
}): boolean {
  return (
    input.alive &&
    input.liveOwnerId === input.capturedOwnerId &&
    input.liveEpoch === input.capturedEpoch
  );
}

type ActiveRequest = {
  requestId: number;
  ownerId: string;
  epoch: number;
  kind: "save" | "reload";
};

export type UseProductSettingsFormOptions = {
  ownerId: string;
  snapshot: ProductSettingsSnapshot;
  onSave: (payload: ProductSettingsUpdateInput) => Promise<ProductSettingsSnapshot>;
  onReloadLatest?: () => Promise<ProductSettingsSnapshot>;
};

export type ProductSettingsFormState = Omit<ProductSettingsFormModel, "busyRequestId"> & {
  isChanged: boolean;
  canSave: boolean;
  isBusy: boolean;
  setUnits: (units: ProductUnits) => void;
  setLocale: (locale: ProductLocale) => void;
  reset: () => void;
  reloadLatest: () => Promise<void>;
  save: () => Promise<void>;
};

export function useProductSettingsForm({
  ownerId,
  snapshot,
  onSave,
  onReloadLatest,
}: UseProductSettingsFormOptions): ProductSettingsFormState {
  const [state, dispatch] = useReducer(
    reduceProductSettingsForm,
    { snapshot, ownerId },
    ({ snapshot, ownerId }) => createProductSettingsFormState(snapshot, ownerId),
  );

  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  // Live ownership: set only on commit, never during render.
  const committedOwnerRef = useRef<string | null>(null);
  const aliveRef = useRef(false);
  const epochRef = useRef(0);
  // Render mirror of the live epoch. Advancing it (in the lifecycle cleanup,
  // alongside `epochRef`) forces a re-render so action callbacks capture the
  // current epoch — including after a StrictMode effect replay.
  const [epochState, setEpochState] = useState(0);
  // Latest owned model, updated on commit; request starts read this rather than
  // a captured (possibly stale) closure draft/cap.
  const modelRef = useRef<ProductSettingsFormModel>(state);

  // Pure owner-filtered projection for this render.
  const renderState = deriveProductSettingsFormState(state, snapshot, ownerId);
  // Ownership epoch captured for this render's action callbacks.
  const epochAtRender = epochState;

  // Owner/mount lifecycle: dispose + fence on cleanup; StrictMode replay
  // re-arms liveness. Deps are ownerId only (no snapshot identity).
  useLayoutEffect(() => {
    committedOwnerRef.current = ownerId;
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      epochRef.current += 1;
      setEpochState((value) => value + 1);
      const slot = activeRequestRef.current;
      if (slot && slot.ownerId === ownerId) {
        activeRequestRef.current = null;
      }
    };
  }, [ownerId]);

  // Semantic rebase: primitive deps so an identical snapshot (or a new object
  // identity) does not re-run or release guards.
  useLayoutEffect(() => {
    dispatch({ type: "rebase", snapshot, ownerId });
  }, [ownerId, snapshot.units, snapshot.locale, snapshot.revision, snapshot.canEdit]);

  // Keep the committed owned model current.
  useLayoutEffect(() => {
    modelRef.current = renderState;
  });

  const isSlotLive = useCallback((slot: ActiveRequest): boolean => {
    return (
      activeRequestRef.current === slot &&
      aliveRef.current &&
      epochRef.current === slot.epoch &&
      committedOwnerRef.current === slot.ownerId
    );
  }, []);

  const isLiveOwner = useCallback((): boolean => {
    return isOwnershipCurrent({
      capturedOwnerId: ownerId,
      capturedEpoch: epochAtRender,
      liveOwnerId: committedOwnerRef.current,
      liveEpoch: epochRef.current,
      alive: aliveRef.current,
    });
  }, [ownerId, epochAtRender]);

  const setUnits = useCallback(
    (units: ProductUnits) => {
      if (!isLiveOwner() || !modelRef.current.baseline.canEdit) return;
      dispatch({ type: "setUnits", units });
    },
    [isLiveOwner],
  );

  const setLocale = useCallback(
    (locale: ProductLocale) => {
      if (!isLiveOwner() || !modelRef.current.baseline.canEdit) return;
      dispatch({ type: "setLocale", locale });
    },
    [isLiveOwner],
  );

  const reset = useCallback(() => {
    if (!isLiveOwner() || !modelRef.current.baseline.canEdit) return;
    dispatch({ type: "reset" });
  }, [isLiveOwner]);

  const save = useCallback(async () => {
    if (!isLiveOwner()) return;
    if (activeRequestRef.current !== null) return;

    const model = modelRef.current;
    const isChanged =
      model.draft.units !== model.baseline.units || model.draft.locale !== model.baseline.locale;
    const canSave =
      model.baseline.canEdit &&
      isChanged &&
      model.status.tag !== "saving" &&
      model.status.tag !== "conflict" &&
      model.status.tag !== "stale";
    if (!canSave) return;

    // Acquire the slot synchronously BEFORE dispatch and the request.
    const requestId = ++requestIdRef.current;
    const slot: ActiveRequest = { requestId, ownerId, epoch: epochRef.current, kind: "save" };
    activeRequestRef.current = slot;
    dispatch({ type: "saveStart", requestId });

    try {
      const next = await onSave({
        units: model.draft.units,
        locale: model.draft.locale,
        expectedRevision: model.baseline.revision,
      });
      if (isSlotLive(slot)) dispatch({ type: "saveSuccess", requestId, snapshot: next });
    } catch (error) {
      if (isSlotLive(slot)) {
        const saveError: ProductSettingsSaveError = isConflictError(error)
          ? { code: "CONFLICT" }
          : { code: "UNKNOWN", message: SAVE_ERROR_MESSAGE };
        dispatch({ type: "saveError", requestId, error: saveError });
      }
    } finally {
      if (isSlotLive(slot)) {
        activeRequestRef.current = null;
        dispatch({ type: "requestEnd", requestId });
      }
    }
  }, [isLiveOwner, ownerId, onSave, isSlotLive]);

  const reloadLatest = useCallback(async () => {
    if (!isLiveOwner() || !onReloadLatest) return;
    if (activeRequestRef.current !== null) return;

    const requestId = ++requestIdRef.current;
    const slot: ActiveRequest = { requestId, ownerId, epoch: epochRef.current, kind: "reload" };
    activeRequestRef.current = slot;
    dispatch({ type: "requestStart", requestId });

    try {
      const next = await onReloadLatest();
      if (isSlotLive(slot)) {
        dispatch({ type: "applyLatestSnapshot", requestId, snapshot: next });
      }
    } catch {
      // Consume the error without reading or surfacing its raw message.
      if (isSlotLive(slot)) dispatch({ type: "reloadError", requestId });
    } finally {
      if (isSlotLive(slot)) {
        activeRequestRef.current = null;
        dispatch({ type: "requestEnd", requestId });
      }
    }
  }, [isLiveOwner, ownerId, onReloadLatest, isSlotLive]);

  const isChanged =
    renderState.draft.units !== renderState.baseline.units ||
    renderState.draft.locale !== renderState.baseline.locale;
  const canSave =
    renderState.baseline.canEdit &&
    isChanged &&
    renderState.status.tag !== "saving" &&
    renderState.status.tag !== "conflict" &&
    renderState.status.tag !== "stale";
  const { busyRequestId, ...publicState } = renderState;

  return {
    ...publicState,
    isChanged,
    canSave,
    isBusy: busyRequestId !== null,
    setUnits,
    setLocale,
    reset,
    reloadLatest,
    save,
  };
}
