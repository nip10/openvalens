export interface RestTimerState {
  deadline: number | null;
  exerciseKey: string | null;
  notificationId: string | null;
  notificationMarker?: string | null;
}

export const EMPTY_REST_TIMER: RestTimerState = {
  deadline: null,
  exerciseKey: null,
  notificationId: null,
  notificationMarker: null,
};

export function startRestTimer(
  state: RestTimerState,
  exerciseKey: string,
  seconds: number,
  now: number,
): RestTimerState {
  return {
    deadline: now + Math.min(3600, Math.max(0, Number.isFinite(seconds) ? seconds : 0)) * 1000,
    exerciseKey,
    notificationId: null,
    notificationMarker: null,
  };
}

export function adjustRestTimer(
  state: RestTimerState,
  seconds: number,
  now: number,
): RestTimerState {
  if (state.deadline === null) return state;
  const deadline = Math.min(now + 3_600_000, Math.max(now, state.deadline + seconds * 1000));
  return deadline <= now ? EMPTY_REST_TIMER : { ...state, deadline };
}

export function remainingRestSeconds(state: RestTimerState, now: number): number {
  return state.deadline === null ? 0 : Math.max(0, Math.ceil((state.deadline - now) / 1000));
}

export function restoreRestTimer(state: RestTimerState, now: number): RestTimerState {
  return state.deadline === null || state.deadline <= now ? EMPTY_REST_TIMER : state;
}
