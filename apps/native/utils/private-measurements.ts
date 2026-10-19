export const PRIVATE_KINDS = [
  "weight",
  "waist",
  "hip",
  "neck",
  "chest",
  "upper_arm",
  "thigh",
] as const;
export type PrivateKind = (typeof PRIVATE_KINDS)[number];
export const PRIVATE_LABELS: Record<PrivateKind, string> = {
  weight: "Weight",
  waist: "Waist",
  hip: "Hip",
  neck: "Neck",
  chest: "Chest",
  upper_arm: "Upper arm",
  thigh: "Thigh",
};
export type PrivateSubject = { userId: string; organizationId: string };
export type PrivateMeasurementPayload = NonNullable<ReturnType<typeof makeMeasurementPayload>>;

export function bindPrivateMeasurementActions<TPreference, TRecord, TDelete>(api: {
  setPreference: (enabled: boolean) => Promise<TPreference>;
  create: (value: PrivateMeasurementPayload) => Promise<TRecord>;
  update: (id: string, value: PrivateMeasurementPayload) => Promise<TRecord>;
  delete: (id: string) => Promise<TDelete>;
}) {
  return {
    setPreference: (enabled: boolean) => api.setPreference(enabled),
    save: (id: string | null, value: PrivateMeasurementPayload) =>
      id ? api.update(id, value) : api.create(value),
    delete: (id: string) => api.delete(id),
  };
}

export function privateMeasurementKeys(subject: PrivateSubject) {
  const scope = [subject.organizationId, subject.userId] as const;
  return {
    preference: ["privateBody", "preference", ...scope] as const,
    list: ["privateBody", "list", ...scope] as const,
  };
}

export function unitsFor(kind: PrivateKind): readonly [string, string] {
  return kind === "weight" ? ["kg", "lb"] : ["cm", "in"];
}

export function nextKindDraft(kind: PrivateKind) {
  return { kind, unit: kind === "weight" ? "kg" : "cm", value: "", editingId: null } as const;
}
export function nextUnitDraft(unit: string) {
  return { unit, value: "", editingId: null } as const;
}

export function makeMeasurementPayload(input: {
  kind: PrivateKind;
  unit: string;
  value: string;
  measuredAtLocal: string;
}) {
  const value = Number(input.value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.measuredAtLocal);
  const date = new Date(input.measuredAtLocal);
  const validTime = Boolean(
    match &&
    Number.isFinite(date.getTime()) &&
    date.getFullYear() === Number(match[1]) &&
    date.getMonth() + 1 === Number(match[2]) &&
    date.getDate() === Number(match[3]) &&
    date.getHours() === Number(match[4]) &&
    date.getMinutes() === Number(match[5]),
  );
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1000 ||
    !validTime ||
    !(unitsFor(input.kind) as readonly string[]).includes(input.unit)
  )
    return null;
  return {
    kind: input.kind,
    unit: input.unit as "kg" | "lb" | "cm" | "in",
    value,
    measuredAt: date.toISOString(),
  };
}

export function privateMeasurementAccessState(input: {
  identityKnown: boolean;
  preferencePending: boolean;
  preferenceError: boolean;
  enabled?: boolean;
}) {
  if (!input.identityKnown || input.preferencePending) return "loading" as const;
  if (input.preferenceError) return "error" as const;
  return input.enabled === true ? ("enabled" as const) : ("disabled" as const);
}

export function privateMeasurementHistoryState(input: {
  pending: boolean;
  error: boolean;
  count?: number;
}) {
  if (input.pending) return "loading" as const;
  if (input.error) return "error" as const;
  return (input.count ?? 0) > 0 ? ("ready" as const) : ("empty" as const);
}

/** The UI's decision and callbacks are tested as one adapter, then consumed directly by the screen. */
export function privateMeasurementScreenState(input: {
  subject: PrivateSubject | null;
  preference: { pending: boolean; error: boolean; enabled?: boolean };
  history: { pending: boolean; error: boolean; count?: number };
  refetchPreference: () => void;
  refetchHistory: () => void;
  preferenceMutation?: { pending?: boolean; error?: boolean };
  saveMutation?: { pending?: boolean; error?: boolean };
  deleteMutation?: { pending?: boolean; error?: boolean; failedId?: string | null };
}) {
  const keys = input.subject ? privateMeasurementKeys(input.subject) : null;
  const access = privateMeasurementAccessState({
    identityKnown: Boolean(input.subject?.userId && input.subject?.organizationId),
    preferencePending: input.preference.pending,
    preferenceError: input.preference.error,
    enabled: input.preference.enabled,
  });
  const history = privateMeasurementHistoryState(input.history);
  return {
    keys,
    access,
    history,
    storedValue: () => null,
    retryPreference: input.refetchPreference,
    retryHistory: input.refetchHistory,
    preferenceMutationError: input.preferenceMutation?.error ?? false,
    saveMutationError: input.saveMutation?.error ?? false,
    deleteFailureFor: input.deleteMutation?.error ? (input.deleteMutation.failedId ?? null) : null,
    deletePending: input.deleteMutation?.pending ?? false,
  };
}
