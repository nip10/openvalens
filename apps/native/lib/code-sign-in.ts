/**
 * Sign-in with a code (the app store review account), kept free of Expo
 * imports so it can be tested. The server answers a wrong code, an email that
 * cannot use a code, and the feature being off with the same refusal, so the
 * screen shows one generic message for all of them. On success the Expo auth
 * client stores the session cookie from the response, like any sign-in.
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
      body: { email: input.email.trim().toLowerCase(), code: input.code.trim() },
    });
    if (!error) return "signed-in";
    return error.status === 429 ? "rate-limited" : "refused";
  } catch {
    return "refused";
  }
}
