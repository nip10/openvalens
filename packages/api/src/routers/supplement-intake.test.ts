import { describe, expect, it } from "bun:test";

import { supplementIntakeRouter } from "./supplement-intake";

describe("supplementIntakeRouter contract", () => {
  it("exposes list/create/update/delete and no schedule-as-intake operations", () => {
    expect(Object.keys(supplementIntakeRouter).sort()).toEqual([
      "create",
      "delete",
      "list",
      "update",
    ]);
  });
});
