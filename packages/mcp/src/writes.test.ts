import { describe, expect, test } from "bun:test";

import { GRANTABLE_SCOPES, isWriteScope, WRITE_SCOPES } from "./scopes";
import { MCP_TOOLS, toolsForScopes } from "./tools";
import { entryKeyOf, sourceLabel, WRITE_DOMAIN_KINDS, writeFingerprint } from "./writes";

describe("AI app writes (M2a)", () => {
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
      "supplements.deleteTaken",
      "supplements.logTaken",
      "vitals.delete",
      "vitals.log",
      "water.delete",
      "water.log",
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
});
