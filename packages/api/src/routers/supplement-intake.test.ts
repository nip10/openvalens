import { describe, expect, it } from "bun:test";

import { supplementIntakeRouter } from "./supplement-intake";

describe("supplementIntakeRouter contract", () => {
  it("exposes list/logged/create/update/delete and no schedule-as-intake operations", () => {
    // `logged` (preventive-care#8) only reads the member's own supplement names;
    // it never turns a schedule into an intake record.
    expect(Object.keys(supplementIntakeRouter).sort()).toEqual([
      "create",
      "delete",
      "list",
      "logged",
      "update",
    ]);
  });
});
