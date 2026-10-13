import "@/testing/varlock-test-setup";

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { ENV } from "../env";

import {
  bootstrapSession,
  ensureActiveOrganization,
  type BootstrapSessionClient,
} from "./session-bootstrap";

describe("ensureActiveOrganization", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls existing endpoint with credentials include and returns result", async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ created: true, organizationId: "org-1", role: "owner" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await ensureActiveOrganization();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/ensure-active-organization$/),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(result).toEqual({ created: true, organizationId: "org-1", role: "owner" });
  });

  test("throws finite copy on 401", async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(ensureActiveOrganization()).rejects.toThrow("Sign in again to continue.");
  });

  test("throws finite copy on unknown api error", async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "internal secret detail" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(ensureActiveOrganization()).rejects.toThrow(
      "Could not prepare your workspace. Please try again.",
    );
  });

  test("uses ENV.VITE_SERVER_URL as the request base", async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ created: true, organizationId: "org-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await ensureActiveOrganization();

    const [calledUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(calledUrl.startsWith(ENV.VITE_SERVER_URL)).toBe(true);
  });
});

function makeClient(
  overrides: Partial<BootstrapSessionClient> & {
    activeOrganizationId?: string | null;
  } = {},
): BootstrapSessionClient {
  const activeOrganizationId = overrides.activeOrganizationId ?? null;
  return {
    getSession: jest.fn(async () => ({
      data: {
        session: { activeOrganizationId },
        user: { id: "user-1" },
      },
      error: null,
    })),
    organization: {
      setActive: jest.fn(async () => ({ error: null })),
    },
    ...overrides,
  };
}

describe("bootstrapSession", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("skips ensure when session already has active organization", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(new Response("{}")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = makeClient({ activeOrganizationId: "org-existing" });

    const result = await bootstrapSession(client);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.organization.setActive).not.toHaveBeenCalled();
    expect(result.session.activeOrganizationId).toBe("org-existing");
  });

  test("creates personal workspace and activates it for new login/no org", async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ created: true, organizationId: "org-new", role: "owner" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    let activeOrg: string | null = null;
    const client = makeClient({
      activeOrganizationId: null,
      getSession: jest.fn(async () => ({
        data: { session: { activeOrganizationId: activeOrg }, user: { id: "user-1" } },
        error: null,
      })),
      organization: {
        setActive: jest.fn(async ({ organizationId }: { organizationId: string }) => {
          activeOrg = organizationId;
          return { error: null };
        }),
      },
    });

    const result = await bootstrapSession(client);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(client.organization.setActive).toHaveBeenCalledWith({ organizationId: "org-new" });
    expect(result.session.activeOrganizationId).toBe("org-new");
  });

  test("activates existing membership when session has no active org", async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ created: false, organizationId: "org-existing", role: "owner" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    let activeOrg: string | null = null;
    const client = makeClient({
      activeOrganizationId: null,
      getSession: jest.fn(async () => ({
        data: { session: { activeOrganizationId: activeOrg }, user: { id: "user-1" } },
        error: null,
      })),
      organization: {
        setActive: jest.fn(async ({ organizationId }: { organizationId: string }) => {
          activeOrg = organizationId;
          return { error: null };
        }),
      },
    });

    await bootstrapSession(client);

    expect(client.organization.setActive).toHaveBeenCalledWith({ organizationId: "org-existing" });
  });

  test("throws retryable error when setActive fails", async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ created: true, organizationId: "org-new" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const client = makeClient({
      activeOrganizationId: null,
      organization: {
        setActive: jest.fn(async () => ({ error: new Error("no permission") })),
      },
    });

    await expect(bootstrapSession(client)).rejects.toThrow(
      "Could not activate your workspace. Please try again.",
    );
  });

  test("throws non-retryable error when unauthenticated", async () => {
    const client = makeClient({ getSession: jest.fn(async () => ({ data: null, error: null })) });

    await expect(bootstrapSession(client)).rejects.toThrow("Sign in again to continue.");
  });
});
