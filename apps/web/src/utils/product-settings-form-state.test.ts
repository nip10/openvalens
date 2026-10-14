import { describe, expect, test } from "bun:test";

import type { ProductSettingsSnapshot } from "@openvalens/api/product-settings-contract";

import {
  createProductSettingsFormState,
  deriveProductSettingsFormState,
  isOwnershipCurrent,
  reduceProductSettingsForm,
  type ProductSettingsFormAction,
} from "./product-settings-form-state";

function snapshot(overrides?: Partial<ProductSettingsSnapshot>): ProductSettingsSnapshot {
  return {
    units: "metric",
    locale: "en-US",
    revision: 1,
    canEdit: true,
    ...overrides,
  };
}

function dispatchAll(
  initial: ReturnType<typeof createProductSettingsFormState>,
  actions: ProductSettingsFormAction[],
) {
  return actions.reduce(reduceProductSettingsForm, initial);
}

describe("product-settings form state", () => {
  test("initial state mirrors the snapshot and owner", () => {
    const state = createProductSettingsFormState(snapshot(), "owner-a");
    expect(state.ownerId).toBe("owner-a");
    expect(state.baseline).toEqual(snapshot());
    expect(state.draft).toEqual({ units: "metric", locale: "en-US" });
    expect(state.status.tag).toBe("idle");
  });

  test("changing owner resets draft to the new snapshot", () => {
    const state = dispatchAll(createProductSettingsFormState(snapshot(), "owner-a"), [
      { type: "setUnits", units: "imperial" },
      { type: "setLocale", locale: "en-GB" },
      { type: "rebase", snapshot: snapshot({ revision: 3, canEdit: false }), ownerId: "owner-b" },
    ]);

    expect(state.ownerId).toBe("owner-b");
    expect(state.baseline.canEdit).toBe(false);
    expect(state.draft).toEqual({ units: "metric", locale: "en-US" });
    expect(state.status.tag).toBe("idle");
  });

  test("edits are local until saved", () => {
    const state = dispatchAll(createProductSettingsFormState(snapshot(), "owner-a"), [
      { type: "setUnits", units: "imperial" },
      { type: "setLocale", locale: "en-CA" },
    ]);

    expect(state.draft).toEqual({ units: "imperial", locale: "en-CA" });
    expect(state.baseline).toEqual(snapshot());
  });

  test("reset discards local edits", () => {
    const state = dispatchAll(createProductSettingsFormState(snapshot(), "owner-a"), [
      { type: "setUnits", units: "imperial" },
      { type: "reset" },
    ]);

    expect(state.draft).toEqual({ units: "metric", locale: "en-US" });
  });

  test("canEdit change takes effect immediately, even with a dirty draft", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "rebase", snapshot: snapshot({ revision: 1, canEdit: false }), ownerId: "owner-a" },
      ],
    );

    expect(state.baseline.canEdit).toBe(false);
    expect(state.draft.units).toBe("imperial");
    expect(state.status.tag).toBe("idle");
  });

  test("external revision bump with a dirty draft signals stale without overwriting", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        {
          type: "rebase",
          snapshot: snapshot({ revision: 2, units: "metric" }),
          ownerId: "owner-a",
        },
      ],
    );

    expect(state.status.tag).toBe("stale");
    expect(state.draft.units).toBe("imperial");
    expect(state.baseline.revision).toBe(1);
  });

  test("external revision bump with a clean draft adopts the new snapshot", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        {
          type: "rebase",
          snapshot: snapshot({ revision: 2, locale: "en-GB" }),
          ownerId: "owner-a",
        },
      ],
    );

    expect(state.status.tag).toBe("idle");
    expect(state.baseline.locale).toBe("en-GB");
    expect(state.draft.locale).toBe("en-GB");
  });

  test("save success rebases to the returned snapshot", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "saveStart", requestId: 1 },
        {
          type: "saveSuccess",
          requestId: 1,
          snapshot: snapshot({ revision: 2, units: "imperial" }),
        },
      ],
    );

    expect(state.status.tag).toBe("success");
    expect(state.baseline.revision).toBe(2);
    expect(state.baseline.units).toBe("imperial");
    expect(state.draft.units).toBe("imperial");
  });

  test("in-flight success cannot restore edit permission after a fresh cap false", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1, canEdit: false }), "owner-a"),
      [
        { type: "saveStart", requestId: 1 },
        {
          type: "saveSuccess",
          requestId: 1,
          snapshot: snapshot({ revision: 2, canEdit: true }),
        },
      ],
    );

    expect(state.baseline.canEdit).toBe(false);
    expect(state.baseline.revision).toBe(2);
  });

  test("duplicate save start while already saving is ignored", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "saveStart", requestId: 1 },
        { type: "saveStart", requestId: 2 },
        {
          type: "saveSuccess",
          requestId: 1,
          snapshot: snapshot({ revision: 2, units: "imperial" }),
        },
      ],
    );

    expect(state.status.tag).toBe("success");
    expect(state.baseline.revision).toBe(2);
  });

  test("save conflict preserves unsaved draft and shows reload option", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "saveStart", requestId: 5 },
        { type: "saveError", requestId: 5, error: { code: "CONFLICT" } },
      ],
    );

    expect(state.status.tag).toBe("conflict");
    expect(state.draft.units).toBe("imperial");
    expect(state.baseline.revision).toBe(1);
  });

  test("generic save error keeps draft editable", () => {
    const state = dispatchAll(createProductSettingsFormState(snapshot(), "owner-a"), [
      { type: "setLocale", locale: "en-GB" },
      { type: "saveStart", requestId: 3 },
      { type: "saveError", requestId: 3, error: { code: "UNKNOWN" } },
    ]);

    expect(state.status.tag).toBe("error");
    expect(state.draft.locale).toBe("en-GB");
  });

  test("apply latest snapshot resets state when the revision is current or newer", () => {
    const next = snapshot({ revision: 4, locale: "en-CA" });
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setLocale", locale: "en-GB" },
        { type: "saveStart", requestId: 1 },
        { type: "saveError", requestId: 1, error: { code: "CONFLICT" } },
        { type: "applyLatestSnapshot", requestId: 1, snapshot: next },
      ],
    );

    expect(state.status.tag).toBe("idle");
    expect(state.baseline).toEqual(next);
    expect(state.draft).toEqual({ units: "metric", locale: "en-CA" });
  });

  test("stale reload result older than baseline is ignored", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 5 }), "owner-a"),
      [
        {
          type: "applyLatestSnapshot",
          requestId: 1,
          snapshot: snapshot({ revision: 3, locale: "en-GB" }),
        },
      ],
    );

    expect(state.baseline.revision).toBe(5);
    expect(state.baseline.locale).toBe("en-US");
  });

  test("edits are blocked when canEdit is false", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ canEdit: false }), "owner-a"),
      [{ type: "setUnits", units: "imperial" }],
    );

    expect(state.draft.units).toBe("metric");
  });

  test("edits while saving are ignored", () => {
    const state = dispatchAll(createProductSettingsFormState(snapshot(), "owner-a"), [
      { type: "saveStart", requestId: 1 },
      { type: "setUnits", units: "imperial" },
    ]);

    expect(state.draft.units).toBe("metric");
    expect(state.status.tag).toBe("saving");
  });
});

describe("product-settings form state — ownership and rebase invariants", () => {
  test("derive returns a fresh snapshot-derived model for a new owner (never the old draft/status)", () => {
    const oldState = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "saveStart", requestId: 1 },
        { type: "saveError", requestId: 1, error: { code: "CONFLICT" } },
      ],
    );

    const derived = deriveProductSettingsFormState(
      oldState,
      snapshot({ revision: 4, units: "metric", locale: "en-CA", canEdit: false }),
      "owner-b",
    );

    expect(derived.ownerId).toBe("owner-b");
    expect(derived.draft).toEqual({ units: "metric", locale: "en-CA" });
    expect(derived.baseline.revision).toBe(4);
    expect(derived.baseline.canEdit).toBe(false);
    expect(derived.status.tag).toBe("idle");
    expect(derived.busyRequestId).toBeNull();
  });

  test("an OLDER snapshot is ignored for values/revision but a capability change still applies", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 2 }), "owner-a"),
      [
        {
          type: "rebase",
          snapshot: snapshot({ revision: 1, units: "imperial", locale: "en-GB", canEdit: false }),
          ownerId: "owner-a",
        },
      ],
    );

    expect(state.baseline.revision).toBe(2);
    expect(state.baseline.units).toBe("metric");
    expect(state.baseline.canEdit).toBe(false);
  });

  test("an identical snapshot does not release a conflict guard", () => {
    const conflict = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 2 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "saveStart", requestId: 1 },
        { type: "saveError", requestId: 1, error: { code: "CONFLICT" } },
      ],
    );
    const after = reduceProductSettingsForm(conflict, {
      type: "rebase",
      snapshot: snapshot({ revision: 2 }),
      ownerId: "owner-a",
    });

    expect(after).toBe(conflict);
    expect(after.status.tag).toBe("conflict");
  });

  test("derive returns the SAME state object for a semantically identical snapshot (no slot disturbance)", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [{ type: "setUnits", units: "imperial" }],
    );

    const derived = deriveProductSettingsFormState(state, snapshot({ revision: 1 }), "owner-a");
    expect(derived).toBe(state);
  });

  test("newer revision with a dirty draft keeps the draft, flags stale and honours cap false", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1, canEdit: true }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        {
          type: "rebase",
          snapshot: snapshot({ revision: 2, locale: "en-GB", canEdit: false }),
          ownerId: "owner-a",
        },
      ],
    );

    expect(state.status.tag).toBe("stale");
    expect(state.draft.units).toBe("imperial");
    expect(state.baseline.revision).toBe(1);
    expect(state.baseline.canEdit).toBe(false);
  });

  test("a successful owned next revision survives a temporarily-old prop snapshot", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "saveStart", requestId: 1 },
        {
          type: "saveSuccess",
          requestId: 1,
          snapshot: snapshot({ revision: 2, units: "imperial" }),
        },
        {
          type: "rebase",
          snapshot: snapshot({ revision: 1, units: "metric" }),
          ownerId: "owner-a",
        },
      ],
    );

    expect(state.baseline.revision).toBe(2);
    expect(state.baseline.units).toBe("imperial");
  });

  test("reloadError preserves a stale guard and uses a finite message otherwise", () => {
    const stale = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "rebase", snapshot: snapshot({ revision: 2 }), ownerId: "owner-a" },
        { type: "reloadError", requestId: 9 },
      ],
    );
    expect(stale.status.tag).toBe("stale");

    const idle = dispatchAll(createProductSettingsFormState(snapshot({ revision: 1 }), "owner-a"), [
      { type: "reloadError", requestId: 9 },
    ]);
    expect(idle.status).toEqual({ tag: "error", requestId: 9, message: "Reload failed." });
  });

  test("requestStart/requestEnd drive a reactive busy marker scoped to the current request", () => {
    const started = dispatchAll(createProductSettingsFormState(snapshot(), "owner-a"), [
      { type: "requestStart", requestId: 7 },
    ]);
    expect(started.busyRequestId).toBe(7);

    const ended = reduceProductSettingsForm(started, { type: "requestEnd", requestId: 8 });
    expect(ended.busyRequestId).toBe(7);

    const cleared = reduceProductSettingsForm(started, { type: "requestEnd", requestId: 7 });
    expect(cleared.busyRequestId).toBeNull();
  });

  test("saveStart marks busy and a fresh cap false still blocks edits with a dirty draft", () => {
    const saving = dispatchAll(createProductSettingsFormState(snapshot(), "owner-a"), [
      { type: "saveStart", requestId: 3 },
    ]);
    expect(saving.busyRequestId).toBe(3);

    const blocked = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1, canEdit: true }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "rebase", snapshot: snapshot({ revision: 1, canEdit: false }), ownerId: "owner-a" },
        { type: "setLocale", locale: "en-GB" },
      ],
    );
    expect(blocked.baseline.canEdit).toBe(false);
    expect(blocked.draft.units).toBe("imperial");
    expect(blocked.draft.locale).toBe("en-US");
  });

  test("applyLatestSnapshot accepts a non-older revision and a new capability", () => {
    const state = dispatchAll(
      createProductSettingsFormState(snapshot({ revision: 1, canEdit: true }), "owner-a"),
      [
        { type: "setUnits", units: "imperial" },
        { type: "saveStart", requestId: 1 },
        { type: "saveError", requestId: 1, error: { code: "CONFLICT" } },
        {
          type: "applyLatestSnapshot",
          requestId: 1,
          snapshot: snapshot({ revision: 1, locale: "en-GB", canEdit: false }),
        },
      ],
    );

    expect(state.status.tag).toBe("idle");
    expect(state.baseline.canEdit).toBe(false);
    expect(state.draft.locale).toBe("en-GB");
  });
});

describe("ownership fence — stale callback across A→B→A", () => {
  test("a callback captured during the first A tenure is not live after the owner returns to A, while the current tenure works", () => {
    // First A tenure: captured owner and epoch match the live ones.
    expect(
      isOwnershipCurrent({
        capturedOwnerId: "owner-a",
        capturedEpoch: 0,
        liveOwnerId: "owner-a",
        liveEpoch: 0,
        alive: true,
      }),
    ).toBe(true);

    // A→B→A: the owner id matches again but the live epoch has advanced twice,
    // so a callback retained from the first A tenure must not authorize
    // transport (it would revive a stale captured state).
    expect(
      isOwnershipCurrent({
        capturedOwnerId: "owner-a",
        capturedEpoch: 0,
        liveOwnerId: "owner-a",
        liveEpoch: 2,
        alive: true,
      }),
    ).toBe(false);

    // The current (second) A tenure's callback captures the live epoch and works.
    expect(
      isOwnershipCurrent({
        capturedOwnerId: "owner-a",
        capturedEpoch: 2,
        liveOwnerId: "owner-a",
        liveEpoch: 2,
        alive: true,
      }),
    ).toBe(true);

    // An A→B callback is still fenced by the owner id.
    expect(
      isOwnershipCurrent({
        capturedOwnerId: "owner-a",
        capturedEpoch: 0,
        liveOwnerId: "owner-b",
        liveEpoch: 1,
        alive: true,
      }),
    ).toBe(false);

    // Unmount (or StrictMode replay cleanup) fences every retained callback.
    expect(
      isOwnershipCurrent({
        capturedOwnerId: "owner-a",
        capturedEpoch: 2,
        liveOwnerId: "owner-a",
        liveEpoch: 2,
        alive: false,
      }),
    ).toBe(false);
  });
});
