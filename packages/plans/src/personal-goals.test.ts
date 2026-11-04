import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { createPersonalGoalRepository } from "./personal-goals";

describe("personal goals repository boundary", () => {
  test("requires both authenticated organization and user scope", () => {
    expect(() => createPersonalGoalRepository({} as Database, "", "user-1")).toThrow();
    expect(() => createPersonalGoalRepository({} as Database, "org-1", "")).toThrow();
  });
});
