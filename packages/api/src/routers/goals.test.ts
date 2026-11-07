import { describe, expect, test } from "bun:test";
import { appRouter } from "./index";

describe("canonical goals API", () => {
  test("is registered as a top-level router with the complete mutation surface", () => {
    expect(appRouter.goals).toBeDefined();
    expect(Object.keys(appRouter.goals).sort()).toEqual([
      "assignLegacy",
      "configureLegacy",
      "create",
      "createCheckin",
      "delete",
      "deleteCheckin",
      "detail",
      "list",
      "listNeedsConfiguration",
      "listUnassignedLegacy",
      "setStatus",
      "update",
      "updateCheckin",
    ]);
  });
});
