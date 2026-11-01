import { describe, expect, test } from "bun:test";

import {
  CODE_SIGN_IN_PATH,
  codeSignInErrorMessage,
  signInWithCode,
  type CodeSignInFetch,
} from "./code-sign-in";

describe("signInWithCode", () => {
  test("posts the trimmed email and code to the code endpoint", async () => {
    const calls: unknown[] = [];
    const fetcher: CodeSignInFetch = async (path, options) => {
      calls.push([path, options]);
      return { error: null };
    };
    expect(await signInWithCode(fetcher, { email: " a@example.test ", code: " code-123 " })).toBe(
      "signed-in",
    );
    expect(calls).toEqual([
      [CODE_SIGN_IN_PATH, { method: "POST", body: { email: "a@example.test", code: "code-123" } }],
    ]);
  });

  test("every refusal is the same outcome; only the rate limit is told apart", async () => {
    const answer =
      (error: { status?: number } | null): CodeSignInFetch =>
      async () => ({ error });
    const input = { email: "a@example.test", code: "x" };
    expect(await signInWithCode(answer({ status: 401 }), input)).toBe("refused");
    expect(await signInWithCode(answer({ status: 404 }), input)).toBe("refused");
    expect(await signInWithCode(answer({}), input)).toBe("refused");
    expect(await signInWithCode(answer({ status: 429 }), input)).toBe("rate-limited");
    const throws: CodeSignInFetch = async () => {
      throw new Error("offline");
    };
    expect(await signInWithCode(throws, input)).toBe("refused");
  });

  test("messages", () => {
    expect(codeSignInErrorMessage("refused").message).toBe("That email and code do not match.");
    expect(codeSignInErrorMessage("rate-limited").message).toBe(
      "Too many attempts. Wait a moment, then try again.",
    );
  });
});
