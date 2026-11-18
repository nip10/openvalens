/** Shared browser/native transport; the auth client owns cookies and secure storage. */
export type DemoSignInFetch = (
  path: string,
  options: { method: "POST" },
) => Promise<{ error?: { status?: number } | null }>;

export async function signInToDemo(fetcher: DemoSignInFetch) {
  try {
    const { error } = await fetcher("/sign-in/demo", { method: "POST" });
    if (!error) return "signed-in" as const;
    return error.status === 429 ? ("rate-limited" as const) : ("unavailable" as const);
  } catch {
    return "unavailable" as const;
  }
}
