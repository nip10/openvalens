import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { parseSetCookieHeader } from "better-auth/cookies/utils";

const PENDING_KEY = "openvalens.magic-link.pending.v1";
const COOKIE_KEY = "openvalens_cookie";
const callbackBase = "openvalens:///";
const sessionExpiry = "2040-01-01T00:00:00.000Z";

type FetchHandler = (...args: Parameters<typeof fetch>) => Promise<Response>;
type MagicLinkResponse =
  | { data: { status: boolean }; error: null }
  | { data: null; error: { message: string } };

const secureItems = new Map<string, string>();
const writes: Array<[string, string]> = [];
const sentEmails: Array<{ email: string }> = [];
const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
let notifications = 0;
let magicLinkResult: MagicLinkResponse = { data: { status: true }, error: null };
let magicLinkFailure: Error | null = null;
let storageFailure: "get" | "set" | "delete" | null = null;
let waitForMagicLink: (() => Promise<void>) | null = null;
let fetchHandler: FetchHandler;
let now = 1_900_000_000_000;

const secureStore = {
  async getItemAsync(key: string) {
    if (storageFailure === "get") throw new Error("storage detail must not escape");
    return secureItems.get(key) ?? null;
  },
  async setItemAsync(key: string, value: string) {
    if (storageFailure === "set") throw new Error("storage detail must not escape");
    writes.push([key, value]);
    secureItems.set(key, value);
  },
  async deleteItemAsync(key: string) {
    if (storageFailure === "delete") throw new Error("storage detail must not escape");
    secureItems.delete(key);
  },
};

mock.module("@better-auth/expo/client", () => ({
  normalizeCookieName: (name: string) => name.replace(/:/g, "_"),
  getCookie: (jar: string | null) => {
    if (!jar) return "";
    const parsed = JSON.parse(jar) as Record<string, { value: string }>;
    return Object.entries(parsed)
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join("; ");
  },
  storageAdapter: (storage: typeof secureStore) => storage,
  getSetCookie: (header: string) => {
    const parsed = parseSetCookieHeader(header);
    return JSON.stringify(
      Object.fromEntries(
        [...parsed.entries()].map(([name, cookie]) => [
          name,
          { value: cookie.value, expires: cookie.expires?.toISOString() ?? null },
        ]),
      ),
    );
  },
}));
mock.module("../auth-session-storage", () => ({
  installVerifiedSessionCookie: async (jar: string) => {
    await secureStore.setItemAsync(COOKIE_KEY, jar);
    notifications += 1;
  },
}));
mock.module("expo-constants", () => ({ default: { expoConfig: { scheme: "openvalens" } } }));
mock.module("expo-linking", () => ({ createURL: () => callbackBase }));
mock.module("expo-secure-store", () => secureStore);
mock.module("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      magicLink: async ({ email }: { email: string }) => {
        sentEmails.push({ email });
        if (magicLinkFailure) throw magicLinkFailure;
        if (waitForMagicLink) await waitForMagicLink();
        return magicLinkResult;
      },
    },
    $store: { notify: () => (notifications += 1) },
  },
}));
mock.module("@/lib/server/server-url", () => ({
  requireServerUrl: async () => "https://server.example",
}));

const { acceptMagicLinkUrl, cancelPendingMagicLink, requestMagicLink } =
  await import("../magic-link");

function encodedCallback(setCookies: string, extra = ""): string {
  const query = new URLSearchParams({ cookie: setCookies });
  return `${callbackBase}?${query.toString()}${extra}`;
}

function cookie(token = "candidate-token") {
  return `better-auth.session_token=${token}; Path=/; HttpOnly; Secure; SameSite=None`;
}

function verifiedResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      session: { id: "session-1", userId: "user-1", expiresAt: sessionExpiry },
      user: { id: "user-1", email: "person@example.test", emailVerified: true },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function putPending(email = "person@example.test", requestedAt = now) {
  secureItems.set(PENDING_KEY, JSON.stringify({ version: 1, email, requestedAt }));
}

function failWithSessionError(url: string) {
  return expect(acceptMagicLinkUrl(url)).rejects.toThrow(
    "This sign-in link could not be verified. Request a new link and try again.",
  );
}

beforeEach(() => {
  secureItems.clear();
  writes.length = 0;
  sentEmails.length = 0;
  fetchCalls.length = 0;
  notifications = 0;
  magicLinkResult = { data: { status: true }, error: null };
  magicLinkFailure = null;
  storageFailure = null;
  waitForMagicLink = null;
  now = 1_900_000_000_000;
  spyOn(Date, "now").mockImplementation(() => now);
  fetchHandler = mock(async () => verifiedResponse());
  globalThis.fetch = Object.assign(
    (...args: Parameters<typeof fetch>) => {
      fetchCalls.push([args[0], args[1]]);
      return fetchHandler(...args);
    },
    { preconnect: fetch.preconnect },
  );
});

afterEach(() => {
  mock.restore();
});

describe("native magic-link security", () => {
  test("rejects attacker-cookie login CSRF without changing or notifying auth state", async () => {
    putPending("victim@example.test");
    fetchHandler = mock(async () =>
      verifiedResponse({
        user: { id: "attacker", email: "attacker@example.test", emailVerified: true },
      }),
    );

    await failWithSessionError(encodedCallback(cookie("attacker-token")));

    expect(fetchCalls).toHaveLength(1);
    expect(secureItems.has(PENDING_KEY)).toBe(false);
    expect(writes).toEqual([]);
    expect(notifications).toBe(0);
  });

  test("accepts a matching verified account once and persists only its session-token cookie", async () => {
    putPending();

    expect(await acceptMagicLinkUrl(encodedCallback(cookie()))).toBe(true);
    await expect(acceptMagicLinkUrl(encodedCallback(cookie()))).rejects.toThrow();

    expect(fetchCalls).toHaveLength(1);
    expect(JSON.parse(secureItems.get(COOKIE_KEY) ?? "{}")).toEqual({
      "better-auth.session_token": { value: "candidate-token", expires: null },
    });
    expect(notifications).toBe(1);
  });

  test("queries only the fixed endpoint with only the candidate cookie and no ambient credentials", async () => {
    putPending();
    secureItems.set(COOKIE_KEY, '{"existing":"should-not-be-merged"}');

    expect(await acceptMagicLinkUrl(encodedCallback(cookie("new-token")))).toBe(true);

    const [url, init] = fetchCalls[0] ?? [];
    const cookieHeader = new Headers(init?.headers).get("cookie");
    expect(String(url)).toBe(
      "https://server.example/api/auth/get-session?disableCookieCache=true&disableRefresh=true",
    );
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(cookieHeader).toBe("better-auth.session_token=new-token");
    expect(cookieHeader).not.toContain("existing");
  });

  test.each([
    ["null response", async () => new Response("null", { status: 200 })],
    ["malformed response", async () => new Response("not-json", { status: 200 })],
    [
      "unverified account",
      async () =>
        verifiedResponse({
          user: { id: "user-1", email: "person@example.test", emailVerified: false },
        }),
    ],
    [
      "different account id",
      async () =>
        verifiedResponse({
          user: { id: "other", email: "person@example.test", emailVerified: true },
        }),
    ],
    [
      "expired session",
      async () =>
        verifiedResponse({
          session: { id: "session-1", userId: "user-1", expiresAt: "2000-01-01T00:00:00.000Z" },
        }),
    ],
    ["revoked session", async () => new Response("null", { status: 401 })],
    [
      "redirect",
      async () =>
        new Response(null, { status: 302, headers: { location: "https://attacker.test" } }),
    ],
    [
      "network failure",
      async () => {
        throw new Error("secret network detail");
      },
    ],
  ])("rejects %s without auth writes", async (_label, responseFactory) => {
    putPending();
    fetchHandler = mock(responseFactory);

    await failWithSessionError(encodedCallback(cookie()));

    expect(writes).toEqual([]);
    expect(notifications).toBe(0);
  });

  test.each([
    ["legacy timestamp", String(now)],
    ["corrupt JSON", "{"],
    [
      "future request",
      JSON.stringify({ version: 1, email: "person@example.test", requestedAt: now + 1 }),
    ],
    [
      "expired request",
      JSON.stringify({ version: 1, email: "person@example.test", requestedAt: now - 600_001 }),
    ],
  ])("rejects %s pending records before network access", async (_label, record) => {
    secureItems.set(PENDING_KEY, record);

    await failWithSessionError(encodedCallback(cookie()));

    expect(fetchCalls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(notifications).toBe(0);
    expect(secureItems.has(PENDING_KEY)).toBe(false);
  });

  test("ignores unrelated URLs without consuming pending authorization", async () => {
    putPending();

    expect(await acceptMagicLinkUrl("https://attacker.test/?cookie=bad")).toBe(false);
    expect(secureItems.has(PENDING_KEY)).toBe(true);
    expect(fetchCalls).toHaveLength(0);
  });

  test("rejects duplicate cookie parameters and consumes the matching pending request", async () => {
    putPending();
    const duplicate = `${callbackBase}?cookie=${encodeURIComponent(cookie())}&cookie=${encodeURIComponent(cookie("other"))}`;

    await failWithSessionError(duplicate);

    expect(secureItems.has(PENDING_KEY)).toBe(false);
    expect(fetchCalls).toHaveLength(0);
    expect(writes).toEqual([]);
  });

  test.each(["openvalens://wrong-host/?cookie=bad", "openvalens:///wrong-path?cookie=bad"])(
    "ignores a callback at the wrong generated destination: %s",
    async (url) => {
      putPending();

      expect(await acceptMagicLinkUrl(url)).toBe(false);
      expect(secureItems.has(PENDING_KEY)).toBe(true);
      expect(fetchCalls).toHaveLength(0);
    },
  );

  test.each([
    ["missing token", "unrelated=value; Path=/"],
    ["ambiguous token cookies", `${cookie()}, ${cookie("other")}`],
    ["cache cookie", `${cookie()}, better-auth.session_data=cache; Path=/`],
    ["empty token", "better-auth.session_token=; Path=/"],
    ["encoded delimiter", "better-auth.session_token=token%3Badmin%3Dtrue; Path=/"],
    ["encoded whitespace", "better-auth.session_token=token%20value; Path=/"],
    ["encoded percent", "better-auth.session_token=token%25value; Path=/"],
  ])("rejects %s callback cookies", async (_label, setCookies) => {
    putPending();

    await failWithSessionError(encodedCallback(setCookies));

    expect(fetchCalls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(notifications).toBe(0);
  });

  test("accepts a percent-encoded callback containing a valid Base64 session token", async () => {
    putPending();

    expect(await acceptMagicLinkUrl(encodedCallback(cookie("YWJj+/==")))).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(new Headers(fetchCalls[0]?.[1]?.headers).get("cookie")).toBe(
      "better-auth.session_token=YWJj+/==",
    );
  });

  test("consumes a recognized error callback without networking", async () => {
    putPending();

    await failWithSessionError(`${callbackBase}?error=invalid_link`);

    expect(secureItems.has(PENDING_KEY)).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  test("rejects storage failures before verification and never notifies", async () => {
    putPending();
    storageFailure = "delete";

    await failWithSessionError(encodedCallback(cookie()));

    expect(fetchCalls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(notifications).toBe(0);
  });

  test("pending-record read failure never reaches the network", async () => {
    putPending();
    storageFailure = "get";

    await failWithSessionError(encodedCallback(cookie()));

    expect(fetchCalls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(notifications).toBe(0);
  });

  test("rechecks request freshness after the network round trip", async () => {
    putPending();
    fetchHandler = mock(async () => {
      now += 600_001;
      return verifiedResponse();
    });

    await failWithSessionError(encodedCallback(cookie()));

    expect(writes).toEqual([]);
    expect(notifications).toBe(0);
  });

  test("normalizes email and stores a pending request only after a successful send", async () => {
    expect(await requestMagicLink("  Person@Example.Test ")).toEqual({});

    expect(sentEmails).toEqual([{ email: "person@example.test" }]);
    expect(JSON.parse(secureItems.get(PENDING_KEY) ?? "{}")).toEqual({
      version: 1,
      email: "person@example.test",
      requestedAt: now,
    });
  });

  test("failed send leaves no pending authorization and returns a sanitized error", async () => {
    putPending("old@example.test");
    magicLinkResult = { data: null, error: { message: "private provider response" } };

    const result = await requestMagicLink("new@example.test");

    expect(result.error).toBe("Could not send the sign-in link. Please try again.");
    expect(secureItems.has(PENDING_KEY)).toBe(false);
    expect(result.error).not.toContain("private");
  });

  test("request storage failures do not create pending authorization", async () => {
    storageFailure = "set";

    const result = await requestMagicLink("person@example.test");

    expect(result.error).toBe("Could not send the sign-in link. Please try again.");
    expect(secureItems.has(PENDING_KEY)).toBe(false);
  });

  test("callback storage write failure does not notify session state", async () => {
    putPending();
    storageFailure = "set";

    await failWithSessionError(encodedCallback(cookie()));

    expect(fetchCalls).toHaveLength(1);
    expect(notifications).toBe(0);
  });

  test("failed cancellation rejects with a generic error", async () => {
    putPending();
    storageFailure = "delete";

    await expect(cancelPendingMagicLink()).rejects.toThrow(
      "This sign-in link could not be verified. Request a new link and try again.",
    );
  });

  test("serializes concurrent callbacks so only one can consume the pending request", async () => {
    putPending();
    let releaseResponse!: (response: Response) => void;
    let markStarted!: () => void;
    const responseStarted = new Promise<void>((resolve) => (markStarted = resolve));
    const delayedResponse = new Promise<Response>((resolve) => (releaseResponse = resolve));
    fetchHandler = mock(async () => {
      markStarted();
      return delayedResponse;
    });

    const first = acceptMagicLinkUrl(encodedCallback(cookie("first-token")));
    await responseStarted;
    const second = acceptMagicLinkUrl(encodedCallback(cookie("second-token")));
    releaseResponse(verifiedResponse());

    expect(await first).toBe(true);
    await expect(second).rejects.toThrow();
    expect(fetchCalls).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(notifications).toBe(1);
  });

  test("serializes request and cancellation, and recovers the queue after failures", async () => {
    let releaseSend!: () => void;
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => (sendStarted = resolve));
    const release = new Promise<void>((resolve) => (releaseSend = resolve));
    waitForMagicLink = async () => {
      sendStarted();
      await release;
    };

    const request = requestMagicLink("person@example.test");
    await started;
    const cancel = cancelPendingMagicLink();
    releaseSend();
    await request;
    await cancel;
    waitForMagicLink = null;

    expect(secureItems.has(PENDING_KEY)).toBe(false);
    expect(await acceptMagicLinkUrl("https://unrelated.test")).toBe(false);
  });
});
