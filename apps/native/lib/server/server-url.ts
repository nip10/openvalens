import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";

import { ENV } from "@/src/env";

import { normalizeServerAddress } from "./server-address";

/**
 * Issue #295 — the one runtime server address. The auth client, the oRPC
 * link, magic-link verification and media URLs all read it from here, so a
 * store build can connect to OpenValens Cloud or to any self-hosted instance.
 *
 * A build with `EXPO_PUBLIC_SERVER_URL` set is locked to that server: nothing
 * is read from or written to storage, and the app never asks.
 */

const SERVER_URL_KEY = "openvalens.server-url.v1";

export type ServerState =
  | { status: "loading" }
  | { status: "unset" }
  | { status: "set"; url: string; locked: boolean };

function lockedServerUrl(): string | null {
  const raw = ENV.EXPO_PUBLIC_SERVER_URL;
  if (!raw) return null;
  // The build-time value is trusted as given, so a development build may
  // point at plain-HTTP localhost; it is still reduced to an origin.
  const normalized = normalizeServerAddress(raw, { allowLocalHttp: true });
  if (normalized.ok) return normalized.url;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const LOCKED_URL = lockedServerUrl();

let state: ServerState = LOCKED_URL
  ? { status: "set", url: LOCKED_URL, locked: true }
  : { status: "loading" };
let loading: Promise<ServerState> | null = null;
const listeners = new Set<() => void>();

function setState(next: ServerState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ServerState {
  return state;
}

/** Whether this build is locked to one server. */
export function isServerLocked(): boolean {
  return LOCKED_URL !== null;
}

/** Reads the saved address once per app run (also from a headless background task). */
export function loadServer(): Promise<ServerState> {
  if (state.status !== "loading") return Promise.resolve(state);
  loading ??= (async () => {
    let saved: string | null;
    try {
      saved = await SecureStore.getItemAsync(SERVER_URL_KEY);
    } catch {
      // Unreadable (for example a locked keychain during a background run)
      // is not the same as unset: stay loading and let the caller retry,
      // rather than asking for a server while another one's session is kept.
      loading = null;
      return state;
    }
    const normalized = saved ? normalizeServerAddress(saved, { allowLocalHttp: __DEV__ }) : null;
    if (state.status === "loading") {
      setState(
        normalized?.ok
          ? { status: "set", url: normalized.url, locked: false }
          : { status: "unset" },
      );
    }
    loading = null;
    return state;
  })();
  return loading;
}

/** The chosen origin, or `null` before one is chosen or loaded. */
export function getServerUrl(): string | null {
  return state.status === "set" ? state.url : null;
}

/** The chosen origin; waits for the saved address and fails when there is none. */
export async function requireServerUrl(): Promise<string> {
  const current = await loadServer();
  if (current.status !== "set") throw new Error("No server is chosen on this phone.");
  return current.url;
}

/** Saves a checked, normalised origin and switches the app to it. */
export async function saveServerUrl(url: string): Promise<void> {
  if (LOCKED_URL) throw new Error("This build is locked to one server.");
  await SecureStore.setItemAsync(SERVER_URL_KEY, url);
  if ((await SecureStore.getItemAsync(SERVER_URL_KEY)) !== url) {
    throw new Error("The server address could not be saved.");
  }
  setState({ status: "set", url, locked: false });
}

/** Forgets the chosen server, so the app asks again. */
export async function forgetServerUrl(): Promise<void> {
  if (LOCKED_URL) throw new Error("This build is locked to one server.");
  await SecureStore.deleteItemAsync(SERVER_URL_KEY);
  setState({ status: "unset" });
}

/** The current server state for rendering; starts loading on first use. */
export function useServer(): ServerState {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (current.status !== "loading") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const attempt = () => {
      void loadServer().then((next) => {
        if (!cancelled && next.status === "loading") timer = setTimeout(attempt, 1_000);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [current.status]);
  return current;
}
