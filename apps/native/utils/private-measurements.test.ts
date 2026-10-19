import { describe, expect, jest, test } from "bun:test";

import {
  makeMeasurementPayload,
  bindPrivateMeasurementActions,
  nextKindDraft,
  nextUnitDraft,
  privateMeasurementKeys,
  privateMeasurementScreenState,
} from "./private-measurements";

describe("native private measurement screen adapter", () => {
  test("scopes both queries by active organization and authenticated user", () => {
    const a = privateMeasurementKeys({ userId: "user-a", organizationId: "org-a" });
    const b = privateMeasurementKeys({ userId: "user-b", organizationId: "org-a" });
    const c = privateMeasurementKeys({ userId: "user-a", organizationId: "org-b" });
    expect(a.preference).not.toEqual(b.preference);
    expect(a.list).not.toEqual(b.list);
    expect(a.preference).not.toEqual(c.preference);
    expect(a.list).not.toEqual(c.list);
  });

  test("unknown identity and pending preference stay loading and expose no saved number", () => {
    const state = privateMeasurementScreenState({
      subject: null,
      preference: { pending: true, error: false },
      history: { pending: true, error: false },
      refetchPreference: jest.fn(),
      refetchHistory: jest.fn(),
    });
    expect(state.access).toBe("loading");
    expect(state.keys).toBeNull();
    expect(state.storedValue()).toBeNull();
  });

  test("off, preference failure, history loading/error/empty/ready bind to screen states", () => {
    const base = {
      subject: { userId: "u", organizationId: "o" },
      refetchPreference: jest.fn(),
      refetchHistory: jest.fn(),
    };
    expect(
      privateMeasurementScreenState({
        ...base,
        preference: { pending: false, error: false, enabled: false },
        history: { pending: false, error: false },
      }).access,
    ).toBe("disabled");
    expect(
      privateMeasurementScreenState({
        ...base,
        preference: { pending: false, error: true },
        history: { pending: false, error: false },
      }).access,
    ).toBe("error");
    expect(
      privateMeasurementScreenState({
        ...base,
        preference: { pending: false, error: false, enabled: true },
        history: { pending: true, error: false },
      }).history,
    ).toBe("loading");
    expect(
      privateMeasurementScreenState({
        ...base,
        preference: { pending: false, error: false, enabled: true },
        history: { pending: false, error: true },
      }).history,
    ).toBe("error");
    expect(
      privateMeasurementScreenState({
        ...base,
        preference: { pending: false, error: false, enabled: true },
        history: { pending: false, error: false, count: 0 },
      }).history,
    ).toBe("empty");
    expect(
      privateMeasurementScreenState({
        ...base,
        preference: { pending: false, error: false, enabled: true },
        history: { pending: false, error: false, count: 1 },
      }).history,
    ).toBe("ready");
  });

  test("keeps preference and delete mutation failures attached to usable recovery", () => {
    const retryPreference = jest.fn();
    const retryHistory = jest.fn();
    const state = privateMeasurementScreenState({
      subject: { userId: "u", organizationId: "o" },
      preference: { pending: false, error: false, enabled: true },
      history: { pending: false, error: false, count: 1 },
      refetchPreference: retryPreference,
      refetchHistory: retryHistory,
      preferenceMutation: { error: true },
      deleteMutation: { error: true, pending: false, failedId: "entry-a" },
    });
    expect(state.preferenceMutationError).toBe(true);
    expect(state.deleteFailureFor).toBe("entry-a");
    state.retryPreference();
    state.retryHistory();
    expect(retryPreference).toHaveBeenCalledTimes(1);
    expect(retryHistory).toHaveBeenCalledTimes(1);
  });

  test("binds opt-in, turn-off, create, update, delete, and rejects action failures", async () => {
    const setPreference = jest.fn(async (enabled: boolean) => ({ enabled }));
    const create = jest.fn(async (value: unknown) => value);
    const update = jest.fn(async (id: string, value: unknown) => ({ id, value }));
    const deleteEntry = jest.fn(async (id: string) => ({ deleted: id }));
    const actions = bindPrivateMeasurementActions({
      setPreference,
      create,
      update,
      delete: deleteEntry,
    });
    const payload = makeMeasurementPayload({
      kind: "weight",
      unit: "kg",
      value: "62",
      measuredAtLocal: "2026-10-18T10:30",
    });
    if (!payload) throw new Error("expected valid synthetic payload");
    await actions.setPreference(true);
    await actions.setPreference(false);
    await actions.save(null, payload);
    await actions.save("entry-a", payload);
    await actions.delete("entry-a");
    expect(setPreference.mock.calls.map(([enabled]) => enabled)).toEqual([true, false]);
    expect(create).toHaveBeenCalledWith(payload);
    expect(update).toHaveBeenCalledWith("entry-a", payload);
    expect(deleteEntry).toHaveBeenCalledWith("entry-a");
    const rejected = bindPrivateMeasurementActions({
      setPreference: async () => {
        throw new Error("offline");
      },
      create: async () => payload,
      update: async () => payload,
      delete: async () => ({ deleted: true }),
    });
    await expect(rejected.setPreference(false)).rejects.toThrow("offline");
  });

  test("kind and unit changes clear draft and terminate edit mode", () => {
    expect(nextKindDraft("waist")).toEqual({
      kind: "waist",
      unit: "cm",
      value: "",
      editingId: null,
    });
    expect(nextUnitDraft("lb")).toEqual({ unit: "lb", value: "", editingId: null });
  });

  test("rejects impossible observed local time without normalization", () => {
    const base = {
      kind: "weight" as const,
      unit: "kg",
      value: "62",
      measuredAtLocal: "2026-10-18T10:30",
    };
    expect(makeMeasurementPayload(base)).not.toBeNull();
    expect(makeMeasurementPayload({ ...base, measuredAtLocal: "2026-02-31T10:30" })).toBeNull();
    expect(makeMeasurementPayload({ ...base, unit: "cm" })).toBeNull();
  });
});
