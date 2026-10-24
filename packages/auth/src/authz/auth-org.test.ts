import { afterEach, describe, expect, test } from "bun:test";

import {
  AUTH_ORG_STORE_KIND,
  createDrizzleAuthOrgStore,
  ensureActiveOrganization,
  personalWorkspaceSlug,
  slugifyUserId,
  withActiveOrganization,
  type AuthOrgMember,
  type AuthOrgStore,
  type AuthOrgUser,
  type CreateAuthMemberInput,
  type CreateAuthOnboardingStateInput,
  type CreateAuthOrganizationInput,
  type WriteAuthAuditLogInput,
} from "./auth-org";

type InMemoryAuthOrgStoreOptions = {
  generateId?: () => string;
};

type StoredOrganization = {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
};

type StoredMembership = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
};

type StoredOnboardingState = {
  organizationId: string;
  currentStep: string;
};

type StoredAuditEntry = {
  organizationId: string;
  actorUserId: string;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  afterJson: unknown;
};

type InMemoryAuthOrgStoreState = {
  users: Map<string, AuthOrgUser>;
  memberships: StoredMembership[];
  organizations: Map<string, StoredOrganization>;
  onboardingStates: Map<string, StoredOnboardingState>;
  auditEntries: StoredAuditEntry[];
};

function createInMemoryAuthOrgStore(options: InMemoryAuthOrgStoreOptions = {}): AuthOrgStore & {
  state(): InMemoryAuthOrgStoreState;
  seedUser(record: AuthOrgUser): void;
} {
  const state: InMemoryAuthOrgStoreState = {
    users: new Map(),
    memberships: [],
    organizations: new Map(),
    onboardingStates: new Map(),
    auditEntries: [],
  };

  let idCounter = 0;
  const generateId =
    options.generateId ??
    (() => {
      idCounter += 1;
      return `id-${idCounter}`;
    });

  return {
    kind: AUTH_ORG_STORE_KIND,

    state() {
      return state;
    },

    seedUser(record) {
      state.users.set(record.id, record);
    },

    async findUserById(userId) {
      return state.users.get(userId) ?? null;
    },

    async findFirstMembershipByUser(userId) {
      const match = state.memberships.find((m) => m.userId === userId);
      if (!match) {
        return null;
      }
      const member: AuthOrgMember = {
        id: match.id,
        organizationId: match.organizationId,
        userId: match.userId,
        role: match.role,
      };
      return member;
    },

    async createOrganization(input: CreateAuthOrganizationInput) {
      state.organizations.set(input.id, {
        id: input.id,
        name: input.name,
        slug: input.slug,
        metadata: input.metadata,
      });
    },

    async createMember(input: CreateAuthMemberInput) {
      state.memberships.push({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
      });
    },

    async createOnboardingState(input: CreateAuthOnboardingStateInput) {
      state.onboardingStates.set(input.organizationId, {
        organizationId: input.organizationId,
        currentStep: input.currentStep,
      });
    },

    async writeAuditLog(input: WriteAuthAuditLogInput) {
      state.auditEntries.push({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        afterJson: input.afterJson ?? null,
      });
    },

    // Suppress unused-var for generateId (used by callers via options).
    ...({} as { _generateId?: () => string }),
    // Expose id generator so tests can drive deterministic ids.
    get generateId() {
      return generateId;
    },
  } as AuthOrgStore & {
    state(): InMemoryAuthOrgStoreState;
    seedUser(record: AuthOrgUser): void;
  };
}

afterEach(() => {
  // No globals to reset — each test builds its own store.
});

describe("slugifyUserId", () => {
  test("lowercases and replaces non-alphanumerics", () => {
    expect(slugifyUserId("User ABC.123")).toBe("user-abc-123");
  });

  test("falls back to 'user' when no characters remain", () => {
    expect(slugifyUserId("!!!")).toBe("user");
  });
});

describe("personalWorkspaceSlug", () => {
  test("prefixes the slugified user id with 'personal-'", () => {
    expect(personalWorkspaceSlug("User_42")).toBe("personal-user-42");
  });
});

describe("ensureActiveOrganization", () => {
  test("creates a personal workspace on first call", async () => {
    const store = createInMemoryAuthOrgStore();
    store.seedUser({
      id: "user-1",
      name: "Alice",
      email: "[email protected]",
    });

    const result = await ensureActiveOrganization("user-1", store);

    expect(result.created).toBe(true);
    expect(result.role).toBe("owner");

    const state = store.state();
    expect(state.organizations.size).toBe(1);
    const org = [...state.organizations.values()][0]!;
    expect(org.slug).toBe("personal-user-1");
    expect(org.name).toBe("Alice's personal workspace");
    expect(org.metadata).toEqual({ personal: true });

    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]).toMatchObject({
      organizationId: org.id,
      userId: "user-1",
      role: "owner",
    });

    expect(state.onboardingStates.get(org.id)).toEqual({
      organizationId: org.id,
      currentStep: "pending",
    });

    expect(state.auditEntries).toHaveLength(1);
    expect(state.auditEntries[0]).toMatchObject({
      actorUserId: "user-1",
      eventType: "ORG_AUTO_CREATED",
      targetType: "organization",
      targetId: org.id,
    });
  });

  test("returns the existing membership on subsequent calls (idempotent)", async () => {
    const store = createInMemoryAuthOrgStore();
    store.seedUser({
      id: "user-2",
      name: "Bob",
      email: "[email protected]",
    });

    const first = await ensureActiveOrganization("user-2", store);
    const second = await ensureActiveOrganization("user-2", store);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.organizationId).toBe(first.organizationId);
    expect(second.role).toBe("owner");

    expect(store.state().organizations.size).toBe(1);
    expect(store.state().auditEntries).toHaveLength(1);
  });

  test("two users get distinct personal workspaces", async () => {
    const store = createInMemoryAuthOrgStore();
    store.seedUser({ id: "alice", name: "Alice", email: "[email protected]" });
    store.seedUser({ id: "bob", name: "Bob", email: "[email protected]" });

    const a = await ensureActiveOrganization("alice", store);
    const b = await ensureActiveOrganization("bob", store);

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.organizationId).not.toBe(b.organizationId);

    const orgs = [...store.state().organizations.values()];
    expect(orgs.map((org) => org.slug).sort()).toEqual(["personal-alice", "personal-bob"]);
  });

  test("throws when the user does not exist", async () => {
    const store = createInMemoryAuthOrgStore();

    await expect(ensureActiveOrganization("ghost", store)).rejects.toThrow(
      /user ghost was not found/i,
    );
  });

  test("uses custom id generator when provided", async () => {
    const ids = ["org-fixed", "member-fixed"];
    let i = 0;
    const store = createInMemoryAuthOrgStore();
    store.seedUser({ id: "u", name: "U", email: "[email protected]" });

    const result = await ensureActiveOrganization("u", store, {
      generateId: () => ids[i++] ?? `fallback-${i}`,
    });

    expect(result.organizationId).toBe("org-fixed");
    expect(store.state().memberships[0]?.id).toBe("member-fixed");
  });

  test("falls back to email local part when name is whitespace-only", async () => {
    const store = createInMemoryAuthOrgStore();
    store.seedUser({
      id: "anon",
      name: " ",
      email: "carol@example.test",
    });

    await ensureActiveOrganization("anon", store);

    const org = [...store.state().organizations.values()][0]!;
    expect(org.name).toBe("carol's personal workspace");
  });

  test("falls back to 'Personal' when both name and email local part are empty", async () => {
    const store = createInMemoryAuthOrgStore();
    store.seedUser({
      id: "anon",
      name: "  ",
      email: "@example.test",
    });

    await ensureActiveOrganization("anon", store);

    const org = [...store.state().organizations.values()][0]!;
    expect(org.name).toBe("Personal's personal workspace");
  });
});

describe("createDrizzleAuthOrgStore", () => {
  test("returns a store with the expected kind discriminator", () => {
    const db = {} as Parameters<typeof createDrizzleAuthOrgStore>[0];
    const store = createDrizzleAuthOrgStore(db);

    expect(store.kind).toBe(AUTH_ORG_STORE_KIND);
    expect(typeof store.findUserById).toBe("function");
    expect(typeof store.findFirstMembershipByUser).toBe("function");
    expect(typeof store.createOrganization).toBe("function");
    expect(typeof store.createMember).toBe("function");
    expect(typeof store.createOnboardingState).toBe("function");
    expect(typeof store.writeAuditLog).toBe("function");
  });
});

describe("withActiveOrganization", () => {
  test("activates the user's existing workspace", async () => {
    const store = createInMemoryAuthOrgStore();
    store.seedUser({ id: "user-1", name: "Ana", email: "ana@example.test" });
    await store.createMember({
      id: "m-1",
      organizationId: "org-1",
      userId: "user-1",
      role: "member",
    });

    const session = await withActiveOrganization({ id: "s-1", userId: "user-1" }, store);

    expect(session).toEqual({ id: "s-1", userId: "user-1", activeOrganizationId: "org-1" });
    expect(store.state().organizations.size).toBe(0);
  });

  test("creates the personal workspace for a user without one", async () => {
    const store = createInMemoryAuthOrgStore();
    store.seedUser({ id: "user-2", name: null, email: "bo@example.test" });

    const session = await withActiveOrganization(
      { id: "s-2", userId: "user-2", activeOrganizationId: null },
      store,
    );

    expect(session.activeOrganizationId).toBe(store.state().memberships[0]!.organizationId);
  });

  test("keeps a workspace the session already names", async () => {
    const store = createInMemoryAuthOrgStore();
    const session = { id: "s-3", userId: "user-3", activeOrganizationId: "org-chosen" };
    expect(await withActiveOrganization(session, store)).toEqual(session);
    expect(store.state().memberships).toHaveLength(0);
  });
});
