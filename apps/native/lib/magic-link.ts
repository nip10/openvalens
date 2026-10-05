import { getSetCookie } from "@better-auth/expo/client";
import { parseSetCookieHeader, splitSetCookieHeader } from "better-auth/cookies/utils";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

import { authClient } from "@/lib/auth-client";
import { installVerifiedSessionCookie } from "@/lib/auth-session-storage";
import { ENV } from "@/src/env";

const PENDING_KEY = "openvalens.magic-link.pending.v1";
const PENDING_WINDOW_MS = 10 * 60 * 1000;
const GENERIC_CALLBACK_ERROR =
  "This sign-in link could not be verified. Request a new link and try again.";
const GENERIC_REQUEST_ERROR = "Could not send the sign-in link. Please try again.";

type PendingMagicLink = {
  version: 1;
  email: string;
  requestedAt: number;
};

type VerifiedSession = {
  session: { id: string; userId: string; expiresAt: string };
  user: { id: string; email: string; emailVerified: boolean };
};

let operationQueue: Promise<void> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parsePending(raw: string | null): PendingMagicLink | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const pending = value as Partial<PendingMagicLink>;
    if (
      pending.version !== 1 ||
      typeof pending.email !== "string" ||
      pending.email.length === 0 ||
      pending.email !== normalizeEmail(pending.email) ||
      typeof pending.requestedAt !== "number" ||
      !Number.isSafeInteger(pending.requestedAt)
    ) {
      return null;
    }
    return pending as PendingMagicLink;
  } catch {
    return null;
  }
}

function pendingIsFresh(pending: PendingMagicLink, now: number): boolean {
  const age = now - pending.requestedAt;
  return age >= 0 && age <= PENDING_WINDOW_MS;
}

async function deletePendingItem(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_KEY);
  if ((await SecureStore.getItemAsync(PENDING_KEY)) !== null) {
    throw new Error(GENERIC_CALLBACK_ERROR);
  }
}

function isCallbackDestination(candidateUrl: URL): boolean {
  try {
    const expected = new URL(Linking.createURL("/"));
    return (
      candidateUrl.protocol === expected.protocol &&
      candidateUrl.hostname === expected.hostname &&
      candidateUrl.port === expected.port &&
      candidateUrl.pathname === expected.pathname &&
      candidateUrl.username === "" &&
      candidateUrl.password === "" &&
      candidateUrl.hash === ""
    );
  } catch {
    return false;
  }
}

function candidateSessionCookie(raw: string): { name: string; value: string; jar: string } | null {
  const pieces = splitSetCookieHeader(raw);
  if (pieces.length !== 1) return null;
  const parsed = parseSetCookieHeader(raw);
  if (parsed.size !== 1) return null;
  const [name, cookie] = [...parsed.entries()][0] ?? [];
  if (
    !name ||
    !cookie ||
    (name !== "better-auth.session_token" && name !== "__Secure-better-auth.session_token") ||
    typeof cookie.value !== "string" ||
    cookie.value.length === 0 ||
    cookie.value.length > 1024 ||
    !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(cookie.value) ||
    (cookie["max-age"] !== undefined && cookie["max-age"] <= 0) ||
    (cookie.expires instanceof Date && cookie.expires.getTime() <= Date.now())
  ) {
    return null;
  }
  const jar = getSetCookie(pieces[0] ?? "");
  try {
    const stored: unknown = JSON.parse(jar);
    if (
      !stored ||
      typeof stored !== "object" ||
      Object.keys(stored).length !== 1 ||
      !(name in stored)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return { name, value: cookie.value, jar };
}

function isVerifiedSession(value: unknown): value is VerifiedSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VerifiedSession>;
  return (
    !!candidate.session &&
    typeof candidate.session.id === "string" &&
    candidate.session.id.length > 0 &&
    typeof candidate.session.userId === "string" &&
    candidate.session.userId.length > 0 &&
    typeof candidate.session.expiresAt === "string" &&
    Number.isFinite(Date.parse(candidate.session.expiresAt)) &&
    !!candidate.user &&
    typeof candidate.user.id === "string" &&
    candidate.user.id.length > 0 &&
    typeof candidate.user.email === "string" &&
    candidate.user.emailVerified === true
  );
}

async function verifyCandidateSession(cookie: {
  name: string;
  value: string;
}): Promise<VerifiedSession | null> {
  const endpoint = new URL(
    "/api/auth/get-session?disableCookieCache=true&disableRefresh=true",
    ENV.EXPO_PUBLIC_SERVER_URL,
  );
  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: { Cookie: `${cookie.name}=${cookie.value}`, Accept: "application/json" },
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok || response.redirected) return null;
  const body: unknown = await response.json();
  if (!isVerifiedSession(body)) return null;
  if (body.session.userId !== body.user.id || body.session.expiresAt.length === 0) return null;
  if (Date.parse(body.session.expiresAt) <= Date.now()) return null;
  return body;
}

/** Request a link and remember which account is allowed to complete it. */
export function requestMagicLink(email: string): Promise<{ error?: string }> {
  return serialize(async () => {
    const normalizedEmail = normalizeEmail(email);
    try {
      // Remove any earlier request before initiating a new send. A failed send
      // must never leave stale authorization to install an unrelated session.
      await deletePendingItem();
      const result = await authClient.signIn.magicLink({
        email: normalizedEmail,
        callbackURL: "/",
        errorCallbackURL: "/?signin=failed",
      });
      if (result.error) return { error: GENERIC_REQUEST_ERROR };

      const pending: PendingMagicLink = {
        version: 1,
        email: normalizedEmail,
        requestedAt: Date.now(),
      };
      const serialized = JSON.stringify(pending);
      await SecureStore.setItemAsync(PENDING_KEY, serialized);
      if ((await SecureStore.getItemAsync(PENDING_KEY)) !== serialized) {
        await deletePendingItem();
        return { error: GENERIC_REQUEST_ERROR };
      }
      return {};
    } catch {
      try {
        await deletePendingItem();
      } catch {
        // Surface only the same credential-free error regardless of storage or network failure.
      }
      return { error: GENERIC_REQUEST_ERROR };
    }
  });
}

/** Clear a pending request when the user opts to cancel sign-in. */
export function cancelPendingMagicLink(): Promise<void> {
  return serialize(async () => {
    try {
      await deletePendingItem();
    } catch {
      throw new Error(GENERIC_CALLBACK_ERROR);
    }
  });
}

/** Verify a native magic-link callback against the account that requested it. */
export function acceptMagicLinkUrl(url: string): Promise<boolean> {
  return serialize(async () => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return false;
    }
    if (!isCallbackDestination(parsedUrl)) return false;

    const params = parsedUrl.searchParams;
    const cookies = params.getAll("cookie");
    const errors = params.getAll("error");
    const descriptions = params.getAll("error_description");
    if (cookies.length === 0 && errors.length === 0 && descriptions.length === 0) return false;

    try {
      const rawPending = await SecureStore.getItemAsync(PENDING_KEY);
      // Consume before network verification, so retries and concurrent callback
      // delivery cannot replay the same authorization.
      await deletePendingItem();
      const pending = parsePending(rawPending);
      const requestedAt = pending?.requestedAt;
      if (!pending || requestedAt === undefined || !pendingIsFresh(pending, Date.now())) {
        throw new Error(GENERIC_CALLBACK_ERROR);
      }
      if (cookies.length > 1 || errors.length > 1 || descriptions.length > 1) {
        throw new Error(GENERIC_CALLBACK_ERROR);
      }
      if (errors.length > 0 || descriptions.length > 0 || cookies.length !== 1) {
        throw new Error(GENERIC_CALLBACK_ERROR);
      }

      const candidate = candidateSessionCookie(cookies[0] ?? "");
      if (!candidate) throw new Error(GENERIC_CALLBACK_ERROR);
      const session = await verifyCandidateSession(candidate);
      if (!session || normalizeEmail(session.user.email) !== pending.email) {
        throw new Error(GENERIC_CALLBACK_ERROR);
      }
      if (!pendingIsFresh(pending, Date.now())) throw new Error(GENERIC_CALLBACK_ERROR);

      await installVerifiedSessionCookie(candidate.jar);
      return true;
    } catch {
      throw new Error(GENERIC_CALLBACK_ERROR);
    }
  });
}
