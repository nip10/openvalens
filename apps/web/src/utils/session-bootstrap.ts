/**
 * Issue #63 session bootstrap.
 *
 * Newly admitted users have an account but no personal workspace until the
 * server creates one. This module calls the existing Hono endpoint that
 * initializes the workspace, then activates it via the public SDK when the
 * session does not already have an active organization.
 *
 * - Uses ENV.VITE_SERVER_URL so it works in the normal dev split where the web
 *   app and API run on different origins.
 * - Sends cookies with `credentials: "include"`.
 * - Preserves an already-selected workspace; it only activates when the session
 *   has no activeOrganizationId.
 * - Idempotent: repeated calls return the same organization.
 */

import { ENV } from "../env";

export type EnsureActiveOrganizationResult = {
  created: boolean;
  organizationId: string;
  role?: string;
};

export class BootstrapError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BootstrapError";
  }
}

export type BootstrapSessionClient = {
  getSession(): Promise<{
    data: {
      session: {
        activeOrganizationId?: string | null;
      };
      user: { id: string };
    } | null;
    error: unknown;
  }>;
  organization: {
    setActive(input: { organizationId: string }): Promise<{ error: unknown }>;
  };
};

function getEnsureActiveOrganizationUrl(): string {
  const base = ENV.VITE_SERVER_URL;
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/api/auth/ensure-active-organization`;
}

export async function ensureActiveOrganization(): Promise<EnsureActiveOrganizationResult> {
  const response = await fetch(getEnsureActiveOrganizationUrl(), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new BootstrapError(
      body.error === "UNAUTHENTICATED"
        ? "Sign in again to continue."
        : "Could not prepare your workspace. Please try again.",
      response.status >= 500 || response.status === 429,
    );
  }

  return response.json() as Promise<EnsureActiveOrganizationResult>;
}

export async function bootstrapSession(client: BootstrapSessionClient) {
  const first = await client.getSession();
  if (!first.data) {
    throw new BootstrapError("Sign in again to continue.", false);
  }

  // Already have an active workspace — preserve the user's explicit choice.
  if (first.data.session.activeOrganizationId) {
    return first.data;
  }

  const ensure = await ensureActiveOrganization();

  let session = await client.getSession();
  if (!session.data) {
    throw new BootstrapError("Sign in again to continue.", false);
  }

  // The server endpoint only activates the organization when it creates a new
  // one. If the user already has a membership but no active org, activate it
  // explicitly through the SDK.
  if (!session.data.session.activeOrganizationId) {
    const setActive = await client.organization.setActive({
      organizationId: ensure.organizationId,
    });
    if (setActive.error) {
      throw new BootstrapError("Could not activate your workspace. Please try again.", true);
    }
    session = await client.getSession();
    if (!session.data) {
      throw new BootstrapError("Sign in again to continue.", false);
    }
  }

  if (!session.data.session.activeOrganizationId) {
    throw new BootstrapError("Could not activate your workspace. Please try again.", true);
  }

  return session.data;
}
