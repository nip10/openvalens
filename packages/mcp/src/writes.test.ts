import { describe, expect, test } from "bun:test";

import { GRANTABLE_SCOPES, isWriteScope, WRITE_SCOPES } from "./scopes";
import { MCP_TOOLS, toolsForScopes } from "./tools";
import { entryKeyOf, sourceLabel, WRITE_DOMAIN_KINDS, writeFingerprint } from "./writes";

describe("AI app writes (M2a, M2b, M2c)", () => {
  test("a request has one fingerprint whatever its key order, and it holds no values", () => {
    const a = writeFingerprint("water.log", [
      { at: "2026-11-14T08:00:00Z", amount: 250, unit: "ml" },
    ]);
    const b = writeFingerprint("water.log", [
      { unit: "ml", amount: 250, at: "2026-11-14T08:00:00Z" },
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(
      writeFingerprint("body.log", [{ at: "2026-11-14T08:00:00Z", amount: 250, unit: "ml" }]),
    ).not.toBe(a);
    expect(
      writeFingerprint("water.log", [{ at: "2026-11-14T08:00:00Z", amount: 251, unit: "ml" }]),
    ).not.toBe(a);
  });

  test("an entry key is stable per grant, mutation id and position", () => {
    expect(entryKeyOf("g", "m", 0)).toBe(entryKeyOf("g", "m", 0));
    expect(entryKeyOf("g", "m", 0)).not.toBe(entryKeyOf("g", "m", 1));
    expect(entryKeyOf("g", "m", 0)).not.toBe(entryKeyOf("h", "m", 0));
    expect(entryKeyOf("g", "m", 0)).not.toContain("g");
  });

  test("entries are labelled with the app's name", () => {
    expect(sourceLabel("Claude")).toBe("via Claude");
  });

  test("every write tool is behind a grantable write scope of its own domain", () => {
    const writeTools = MCP_TOOLS.filter((tool) => tool.write);
    expect(writeTools.map((tool) => tool.name).sort()).toEqual([
      "body.delete",
      "body.log",
      "food.delete",
      "food.log",
      "labs.delete",
      "labs.log",
      "pain.delete",
      "pain.log",
      "sleep.delete",
      "sleep.log",
      "supplements.deleteTaken",
      "supplements.logTaken",
      "trackers.delete",
      "trackers.log",
      "vitals.delete",
      "vitals.log",
      "water.delete",
      "water.log",
      "workouts.delete",
      "workouts.log",
    ]);
    for (const tool of writeTools) {
      expect(isWriteScope(tool.scope)).toBe(true);
      expect((GRANTABLE_SCOPES as readonly string[]).includes(tool.scope)).toBe(true);
      expect(tool.scope.split(":")[0]).toBe(tool.name.split(".")[0]);
      expect(tool.input.safeParse({ entries: [] }).success).toBe(false);
    }
    for (const domain of Object.keys(WRITE_DOMAIN_KINDS))
      expect(WRITE_SCOPES).toContain(`${domain}:write` as never);
  });

  test("write tools are listed only with their scope and when the server offers writing", () => {
    const scopes = ["records:read", "water:write"];
    expect(toolsForScopes(scopes).some((tool) => tool.write)).toBe(false);
    const names = toolsForScopes(scopes, { writes: true })
      .filter((tool) => tool.write)
      .map((tool) => tool.name);
    expect(names.sort()).toEqual(["water.delete", "water.log"]);
  });

  test("a mutation id is required and every entry needs a time with an offset", () => {
    const log = MCP_TOOLS.find((tool) => tool.name === "water.log")!;
    expect(
      log.input.safeParse({ entries: [{ at: "2026-11-14T08:00:00Z", amount: 1, unit: "l" }] })
        .success,
    ).toBe(false);
    expect(
      log.input.safeParse({
        mutationId: "m-1",
        entries: [{ at: "2026-11-14T08:00:00", amount: 1, unit: "l" }],
      }).success,
    ).toBe(false);
    expect(
      log.input.safeParse({
        mutationId: "m-1",
        entries: [{ at: "2026-11-14T08:00:00+01:00", amount: 1, unit: "l" }],
      }).success,
    ).toBe(true);
  });

  test("M2b inputs: a bare workout session is fine, exercises need a catalog id at run time", () => {
    const log = MCP_TOOLS.find((tool) => tool.name === "workouts.log")!;
    expect(
      log.input.safeParse({
        mutationId: "m-1",
        entries: [{ date: "2026-11-14", type: "running", durationMinutes: 30, effort: 6 }],
      }).success,
    ).toBe(true);
    expect(
      log.input.safeParse({
        mutationId: "m-1",
        entries: [{ date: "2026-11-14", type: "yoga" }],
      }).success,
    ).toBe(false);
    expect(log.description).toContain("exercises.search");
  });

  test("M2c inputs: a meal is a description or items; a lab result needs a marker and a unit", () => {
    const food = MCP_TOOLS.find((tool) => tool.name === "food.log")!;
    const at = "2026-11-14T08:00:00+00:00";
    expect(
      food.input.safeParse({ mutationId: "m-1", entries: [{ at, description: "two eggs" }] })
        .success,
    ).toBe(true);
    expect(
      food.input.safeParse({
        mutationId: "m-1",
        entries: [{ at, items: [{ food: "toast", quantity: "half", unit: "slice" }] }],
      }).success,
    ).toBe(true);
    // Not both, and not neither.
    expect(
      food.input.safeParse({
        mutationId: "m-1",
        entries: [{ at, description: "toast", items: [{ food: "toast" }] }],
      }).success,
    ).toBe(false);
    expect(food.input.safeParse({ mutationId: "m-1", entries: [{ at }] }).success).toBe(false);
    // No nutrient values.
    expect(
      food.input.safeParse({
        mutationId: "m-1",
        entries: [{ at, items: [{ food: "toast", kcal: 80 }] }],
      }).success,
    ).toBe(false);
    expect(food.description).toContain("pending_review");

    const labs = MCP_TOOLS.find((tool) => tool.name === "labs.log")!;
    expect(
      labs.input.safeParse({
        mutationId: "m-1",
        entries: [
          {
            at,
            marker: "ferritin",
            value: 45,
            unit: "ng/mL",
            referenceRange: { low: 30, high: 400 },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      labs.input.safeParse({
        mutationId: "m-1",
        entries: [{ at, marker: "ferritin", value: 45 }],
      }).success,
    ).toBe(false);
    expect(
      labs.input.safeParse({
        mutationId: "m-1",
        entries: [{ at, marker: "ferritin", value: 45, unit: "ng/mL", referenceRange: {} }],
      }).success,
    ).toBe(false);
    expect(labs.description).toContain("accepted units");
  });

  test("M2b inputs: sleep, tracker and pain entries", () => {
    const sleep = MCP_TOOLS.find((tool) => tool.name === "sleep.log")!;
    expect(
      sleep.input.safeParse({
        mutationId: "m-1",
        entries: [{ startAt: "2026-11-13T23:00:00+00:00", endAt: "2026-11-14T07:00:00+00:00" }],
      }).success,
    ).toBe(true);
    const tracker = MCP_TOOLS.find((tool) => tool.name === "trackers.log")!;
    expect(
      tracker.input.safeParse({
        mutationId: "m-1",
        entries: [{ at: "2026-11-14T08:00:00Z", trackerId: crypto.randomUUID(), value: true }],
      }).success,
    ).toBe(true);
    const pain = MCP_TOOLS.find((tool) => tool.name === "pain.log")!;
    expect(
      pain.input.safeParse({
        mutationId: "m-1",
        entries: [{ at: "2026-11-14T08:00:00Z", region: "joint.knee_left", rating: 4 }],
      }).success,
    ).toBe(true);
    expect(
      pain.input.safeParse({
        mutationId: "m-1",
        entries: [{ at: "2026-11-14T08:00:00Z", region: "joint.elbow_middle", rating: 4 }],
      }).success,
    ).toBe(false);
    expect(
      pain.input.safeParse({
        mutationId: "m-1",
        entries: [{ at: "2026-11-14T08:00:00Z", region: "joint.knee_left", rating: 11 }],
      }).success,
    ).toBe(false);
  });
});
