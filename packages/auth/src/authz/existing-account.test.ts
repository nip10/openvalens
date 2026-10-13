import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";

import {
  canonicalizeExistingAccountEmail,
  findExistingAccount,
  hasExistingAccount,
} from "./existing-account";

/**
 * Existing-account lookup coverage (Issue #63). A tiny fake database records
 * the bound parameter and returns canned rows — no SQL, no network.
 */

function fakeDb(rows: { id: string }[]): { db: Database } {
  const db = {
    execute: async () => ({ rows }),
  } as unknown as Database;
  return { db };
}

describe("canonicalizeExistingAccountEmail", () => {
  test("lower-cases only; never trims, strips dots or plus-tags", () => {
    expect(canonicalizeExistingAccountEmail("User@Example.com")).toBe("user@example.com");
    expect(canonicalizeExistingAccountEmail(" user@example.com ")).toBeNull();
    expect(canonicalizeExistingAccountEmail("a.b+tag@example.com")).toBe("a.b+tag@example.com");
  });

  test("rejects non-strings, empty strings and malformed addresses", () => {
    expect(canonicalizeExistingAccountEmail(undefined)).toBeNull();
    expect(canonicalizeExistingAccountEmail(42)).toBeNull();
    expect(canonicalizeExistingAccountEmail("")).toBeNull();
    expect(canonicalizeExistingAccountEmail("not-an-email")).toBeNull();
  });
});

describe("findExistingAccount", () => {
  test("returns the id for exactly one match", async () => {
    const { db } = fakeDb([{ id: "user-1" }]);
    expect(await findExistingAccount(db, "User@Example.com")).toEqual({ id: "user-1" });
  });

  test("returns null when the address is unknown, malformed or ambiguous", async () => {
    expect(await findExistingAccount(fakeDb([]).db, "nobody@example.com")).toBeNull();
    expect(await findExistingAccount(fakeDb([]).db, "bad")).toBeNull();
    expect(
      await findExistingAccount(fakeDb([{ id: "a" }, { id: "b" }]).db, "dup@example.com"),
    ).toBeNull();
  });

  test("hasExistingAccount is a boolean view", async () => {
    expect(await hasExistingAccount(fakeDb([{ id: "user-1" }]).db, "user@example.com")).toBe(true);
    expect(await hasExistingAccount(fakeDb([]).db, "user@example.com")).toBe(false);
  });
});
