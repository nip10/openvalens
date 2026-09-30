export const INGESTION_JOB_STATES = ["queued", "running", "succeeded", "failed"] as const;

export const INGESTION_BATCH_STATES = ["processing", "completed", "failed"] as const;

export const INGESTION_REPLAY_TAG = "replayed" as const;

export type IngestionJobState = (typeof INGESTION_JOB_STATES)[number];

export type IngestionBatchState = (typeof INGESTION_BATCH_STATES)[number];

export type IngestionReplayTag = typeof INGESTION_REPLAY_TAG;

const ALLOWED_JOB_TRANSITIONS: Readonly<Record<IngestionJobState, readonly IngestionJobState[]>> = {
  queued: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

const ALLOWED_BATCH_TRANSITIONS: Readonly<
  Record<IngestionBatchState, readonly IngestionBatchState[]>
> = {
  processing: ["completed", "failed"],
  completed: [],
  failed: [],
};

function isIngestionJobState(value: string): value is IngestionJobState {
  return (INGESTION_JOB_STATES as readonly string[]).includes(value);
}

function isIngestionBatchState(value: string): value is IngestionBatchState {
  return (INGESTION_BATCH_STATES as readonly string[]).includes(value);
}

export function parseIngestionJobState(value: string): IngestionJobState | null {
  return isIngestionJobState(value) ? value : null;
}

export function parseIngestionBatchState(value: string): IngestionBatchState | null {
  return isIngestionBatchState(value) ? value : null;
}

export function transitionJobState(
  currentState: IngestionJobState,
  nextState: IngestionJobState,
): IngestionJobState {
  if (currentState === nextState) {
    return nextState;
  }

  const allowedNextStates = ALLOWED_JOB_TRANSITIONS[currentState];
  if (!allowedNextStates.includes(nextState)) {
    throw new Error(`invalid ingestion job transition: ${currentState} -> ${nextState}`);
  }

  return nextState;
}

export function transitionBatchState(
  currentState: IngestionBatchState,
  nextState: IngestionBatchState,
): IngestionBatchState {
  if (currentState === nextState) {
    return nextState;
  }

  const allowedNextStates = ALLOWED_BATCH_TRANSITIONS[currentState];
  if (!allowedNextStates.includes(nextState)) {
    throw new Error(`invalid ingestion batch transition: ${currentState} -> ${nextState}`);
  }

  return nextState;
}

export function transitionJobStateFromInput(
  currentState: string,
  nextState: string,
): IngestionJobState {
  const parsedCurrentState = parseIngestionJobState(currentState);
  const parsedNextState = parseIngestionJobState(nextState);
  if (!parsedCurrentState || !parsedNextState) {
    throw new Error(`invalid ingestion job transition: ${currentState} -> ${nextState}`);
  }

  return transitionJobState(parsedCurrentState, parsedNextState);
}

export function transitionBatchStateFromInput(
  currentState: string,
  nextState: string,
): IngestionBatchState {
  const parsedCurrentState = parseIngestionBatchState(currentState);
  const parsedNextState = parseIngestionBatchState(nextState);
  if (!parsedCurrentState || !parsedNextState) {
    throw new Error(`invalid ingestion batch transition: ${currentState} -> ${nextState}`);
  }

  return transitionBatchState(parsedCurrentState, parsedNextState);
}
