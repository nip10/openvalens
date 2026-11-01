import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * Sign-in with a code (the app store review account). The server answers a
 * wrong code, an email that cannot use a code, and the feature being off with
 * the same refusal, so the screen shows one generic message for all of them.
 */
export const CODE_SIGN_IN_PATH = "/sign-in/review-code";

export type CodeSignInFetch = (
  path: string,
  options: { method: "POST"; body: { email: string; code: string } },
) => Promise<{ error?: { status?: number } | null }>;

export type CodeSignInOutcome = "signed-in" | "refused" | "rate-limited";

export async function signInWithCode(
  fetcher: CodeSignInFetch,
  input: { email: string; code: string },
): Promise<CodeSignInOutcome> {
  try {
    const { error } = await fetcher(CODE_SIGN_IN_PATH, {
      method: "POST",
      body: { email: input.email.trim(), code: input.code.trim() },
    });
    if (!error) return "signed-in";
    return error.status === 429 ? "rate-limited" : "refused";
  } catch {
    return "refused";
  }
}

/** The message for a failed attempt. Render it with `_()`. */
export function codeSignInErrorMessage(outcome: Exclude<CodeSignInOutcome, "signed-in">) {
  const messages: Record<typeof outcome, MessageDescriptor> = {
    refused: msg`That email and code do not match.`,
    "rate-limited": msg`Too many attempts. Wait a moment, then try again.`,
  };
  return messages[outcome];
}
