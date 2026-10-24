import type { Database } from "@openvalens/db";
import {
  accessAuditLog,
  member,
  onboardingState,
  organization,
  user,
} from "@openvalens/db/schema/auth";
import { asc, eq } from "drizzle-orm";

export type AuthOrgUser = {
  id: string;
  name: string | null;
  email: string;
};

export type AuthOrgMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
};

export type CreateAuthOrganizationInput = {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
};

export type CreateAuthMemberInput = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
};

export type CreateAuthOnboardingStateInput = {
  organizationId: string;
  currentStep: string;
};

export type WriteAuthAuditLogInput = {
  organizationId: string;
  actorUserId: string;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  afterJson?: unknown;
};

export const AUTH_ORG_STORE_KIND = "auth-org-store";

/**
 * Persistence seam for `ensureActiveOrganization`.
 *
 * Production uses the Drizzle-backed store; tests inject an in-memory store so
 * the bootstrap logic can be exercised without a live Postgres.
 */
export type AuthOrgStore = {
  readonly kind: typeof AUTH_ORG_STORE_KIND;
  findUserById(userId: string): Promise<AuthOrgUser | null>;
  findFirstMembershipByUser(userId: string): Promise<AuthOrgMember | null>;
  createOrganization(input: CreateAuthOrganizationInput): Promise<void>;
  createMember(input: CreateAuthMemberInput): Promise<void>;
  createOnboardingState(input: CreateAuthOnboardingStateInput): Promise<void>;
  writeAuditLog(input: WriteAuthAuditLogInput): Promise<void>;
};

export type EnsureActiveOrganizationResult = {
  organizationId: string;
  role: string;
  created: boolean;
};

export type EnsureActiveOrganizationOptions = {
  generateId?: () => string;
};

const ORG_AUTO_CREATED_EVENT = "ORG_AUTO_CREATED";
const PERSONAL_ORG_ONBOARDING_STEP = "pending";

function isAuthOrgStore(value: unknown): value is AuthOrgStore {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === AUTH_ORG_STORE_KIND
  );
}

export function createDrizzleAuthOrgStore(db: Database): AuthOrgStore {
  return {
    kind: AUTH_ORG_STORE_KIND,

    async findUserById(userId) {
      const rows = await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      return rows[0] ?? null;
    },

    async findFirstMembershipByUser(userId) {
      const rows = await db
        .select({
          id: member.id,
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
        })
        .from(member)
        .where(eq(member.userId, userId))
        .orderBy(asc(member.createdAt))
        .limit(1);

      return rows[0] ?? null;
    },

    async createOrganization(input) {
      await db.insert(organization).values({
        id: input.id,
        name: input.name,
        slug: input.slug,
        metadata: input.metadata,
      });
    },

    async createMember(input) {
      await db.insert(member).values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
      });
    },

    async createOnboardingState(input) {
      await db.insert(onboardingState).values({
        organizationId: input.organizationId,
        currentStep: input.currentStep,
      });
    },

    async writeAuditLog(input) {
      await db.insert(accessAuditLog).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        afterJson: input.afterJson ?? null,
      });
    },
  };
}

export function slugifyUserId(userId: string): string {
  const slug = userId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "user";
}

export function personalWorkspaceSlug(userId: string): string {
  return `personal-${slugifyUserId(userId)}`;
}

function personalWorkspaceName(record: AuthOrgUser): string {
  const displayName = record.name?.trim() || record.email.split("@")[0]?.trim() || "Personal";
  return `${displayName}'s personal workspace`;
}

function resolveStore(source: Database | AuthOrgStore): AuthOrgStore {
  return isAuthOrgStore(source) ? source : createDrizzleAuthOrgStore(source);
}

/**
 * Ensures a signed-in user belongs to at least one organization.
 *
 * - If the user already has a membership → returns it unchanged (idempotent;
 *   no extra writes).
 * - Otherwise → creates a personal workspace, inserts the user as `owner`,
 *   writes an `onboarding_state` row (`currentStep: "pending"`) and records
 *   an `ORG_AUTO_CREATED` entry in `access_audit_log`.
 *
 * The second argument may be a Drizzle `Database` (production) or an
 * `AuthOrgStore` (tests). Concurrent first calls race on the unique
 * `organization.slug` constraint; the loser re-reads and returns the winner.
 */
export async function ensureActiveOrganization(
  userId: string,
  source: Database | AuthOrgStore,
  options: EnsureActiveOrganizationOptions = {},
): Promise<EnsureActiveOrganizationResult> {
  const store = resolveStore(source);
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  const existing = await store.findFirstMembershipByUser(userId);
  if (existing) {
    return {
      organizationId: existing.organizationId,
      role: existing.role,
      created: false,
    };
  }

  const userRecord = await store.findUserById(userId);
  if (!userRecord) {
    throw new Error(`Cannot bootstrap organization: user ${userId} was not found.`);
  }

  const organizationId = generateId();
  const memberId = generateId();
  const slug = personalWorkspaceSlug(userId);
  const name = personalWorkspaceName(userRecord);

  try {
    await store.createOrganization({
      id: organizationId,
      name,
      slug,
      metadata: { personal: true },
    });
    await store.createMember({
      id: memberId,
      organizationId,
      userId,
      role: "owner",
    });
    await store.createOnboardingState({
      organizationId,
      currentStep: PERSONAL_ORG_ONBOARDING_STEP,
    });
    await store.writeAuditLog({
      organizationId,
      actorUserId: userId,
      eventType: ORG_AUTO_CREATED_EVENT,
      targetType: "organization",
      targetId: organizationId,
      afterJson: { slug, role: "owner", personal: true },
    });
  } catch (error) {
    // Race condition: a concurrent request created the workspace first.
    const winner = await store.findFirstMembershipByUser(userId);
    if (winner) {
      return {
        organizationId: winner.organizationId,
        role: winner.role,
        created: false,
      };
    }

    throw error;
  }

  return {
    organizationId,
    role: "owner",
    created: true,
  };
}

/**
 * Body of the Better Auth `session.create.before` hook: every new session
 * starts in a workspace. Without this only the web app selected one (through
 * `/api/auth/ensure-active-organization`), so a session from the mobile app or
 * an OIDC sign-in had no `activeOrganizationId` and every tenant-scoped call
 * was refused. A session that already names a workspace is left alone.
 */
export async function withActiveOrganization<
  S extends { userId: string; activeOrganizationId?: string | null },
>(session: S, source: Database | AuthOrgStore): Promise<S> {
  if (session.activeOrganizationId) return session;
  const { organizationId } = await ensureActiveOrganization(session.userId, source);
  return { ...session, activeOrganizationId: organizationId };
}
