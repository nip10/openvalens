import { describe, expect, test } from "bun:test";

import { applyAiAppIdentities } from "./ai-app-sources";
import type { TimelineEvent } from "./types";

const OAUTH = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";

function item(refs: TimelineEvent["sourceRefs"]): TimelineEvent {
  return {
    kind: "event",
    id: "plain_water_entry:1",
    at: "2026-11-14T08:00:00.000Z",
    domain: "water",
    title: "Plain water",
    summary: "250 ml",
    severity: "none",
    confidence: "high",
    reviewState: "unreviewed",
    sourceRefs: refs,
    provenanceRefs: [],
    relatedRefs: [],
    canonical: {},
  } as TimelineEvent;
}

function aiRef(grantId: string, label: string) {
  return { type: "ai_app", label, id: `ai_app:${grantId}`, provider: "ai_app" };
}

/** Issue #507 — "via <app>" sources carry the grant as it is now. */
describe("applyAiAppIdentities", () => {
  test("sets the live label, kind and host; a key never gets a host", () => {
    const items = [
      item([aiRef(OAUTH, "Old name"), { type: "manual", label: "manual", provider: "manual" }]),
      item([aiRef(KEY, "My script")]),
    ];
    applyAiAppIdentities(items, [
      { id: OAUTH, kind: "oauth", label: "Claude", host: "claude.ai" },
      { id: KEY, kind: "personal_key", label: "My script", host: "ignored.example" },
    ]);
    expect(items[0]!.sourceRefs[0]).toMatchObject({
      label: "Claude",
      app: { kind: "oauth", host: "claude.ai" },
    });
    expect(items[0]!.sourceRefs[1]).toEqual({
      type: "manual",
      label: "manual",
      provider: "manual",
    });
    expect(items[1]!.sourceRefs[0]!.app).toEqual({ kind: "personal_key", host: null });
  });

  test("a source whose grant is gone keeps its label and gets no identity", () => {
    const items = [item([aiRef(GONE, "OpenValens")])];
    applyAiAppIdentities(items, []);
    expect(items[0]!.sourceRefs[0]!.label).toBe("OpenValens");
    expect(items[0]!.sourceRefs[0]!.app).toBeUndefined();
  });

  test("ignores refs that are not a grant's", () => {
    const items = [item([{ type: "ai_app", label: "x", id: "ai_app:not-a-uuid" }])];
    applyAiAppIdentities(items, [{ id: "not-a-uuid", kind: "oauth", label: "y", host: "h" }]);
    expect(items[0]!.sourceRefs[0]).toEqual({
      type: "ai_app",
      label: "x",
      id: "ai_app:not-a-uuid",
    });
  });
});
