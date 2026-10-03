import { writeAuditLog, type AuditEventType } from "@openvalens/audit-security";
import { AuthzHttpError, requireOrgMembership } from "@openvalens/auth/authz/guard";
import { invitation, member, user } from "@openvalens/db/schema/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Sharing oRPC surface — Issue #34.
 *
 * Members and invitations for the active org. Members come from Better Auth's
 * `member` table; invitations live alongside. Reads require an active org
 * membership; writes additionally require the caller to be the org owner.
 *
 * No PHI is logged. Org/user are taken exclusively from authz — inputs are
 * `strictObject` so any payload attempt to override `organizationId` or
 * `userId` is rejected with `INVALID_INPUT` at the boundary.
 */
const listInputSchema = z.strictObject({});

const memberShape = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  role: z.string(),
  createdAt: z.string(),
});

const invitationShape = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  inviterId: z.string().nullable(),
  createdAt: z.string(),
});

async function resolveAuthz(honoContext: unknown) {
  try {
    return { authz: await requireOrgMembership(honoContext as never) };
  } catch (error) {
    if (error instanceof AuthzHttpError) {
      throw raiseApiError(error.code, error.message);
    }
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

function ensureOwner(role: string | undefined): void {
  if (role !== "owner") {
    throw raiseApiError("PERMISSION_DENIED", "Only org owners can manage members.");
  }
}

const createInvitationInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["owner", "member"]).default("member"),
});

const revokeInvitationInput = z.strictObject({
  id: z.string().min(1).max(64),
});

const removeMemberInput = z.strictObject({
  userId: z.string().min(1).max(64),
});

async function auditSharing(input: {
  db: Parameters<typeof writeAuditLog>[0]["db"];
  organizationId: string;
  actorUserId: string;
  eventType: "MEMBER_INVITED" | "MEMBER_REMOVED" | "INVITATION_REVOKED";
  targetId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await writeAuditLog({
    db: input.db,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    eventType: input.eventType as unknown as AuditEventType,
    targetType: "org_member",
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

export const sharingRouter = {
  listMembers: protectedProcedure
    .use(validateInput(listInputSchema))
    .input(listInputSchema)
    .output(z.array(memberShape))
    .handler(async ({ context }) => {
      const { authz } = await resolveAuthz(context.honoContext);
      const rows = await context.db
        .select({
          id: member.id,
          userId: member.userId,
          name: user.name,
          email: user.email,
          role: member.role,
          createdAt: member.createdAt,
        })
        .from(member)
        .leftJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, authz.activeOrganizationId))
        .orderBy(desc(member.createdAt));
      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
      }));
    }),

  listInvitations: protectedProcedure
    .use(validateInput(listInputSchema))
    .input(listInputSchema)
    .output(z.array(invitationShape))
    .handler(async ({ context }) => {
      const { authz } = await resolveAuthz(context.honoContext);
      const rows = await context.db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          inviterId: invitation.inviterId,
          createdAt: invitation.createdAt,
        })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, authz.activeOrganizationId),
            inArray(invitation.status, ["pending", "canceled"]),
          ),
        )
        .orderBy(desc(invitation.createdAt));
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        expiresAt: row.expiresAt.toISOString(),
        inviterId: row.inviterId,
        createdAt: row.createdAt.toISOString(),
      }));
    }),

  createInvitation: protectedProcedure
    .use(validateInput(createInvitationInput))
    .input(createInvitationInput)
    .output(invitationShape)
    .handler(async ({ input, context }) => {
      const { authz } = await resolveAuthz(context.honoContext);
      ensureOwner(authz.role);
      const organizationId = authz.activeOrganizationId;
      const inviterId = authz.user.id;
      const expiresAt = new Date(Date.now() + 14 * 86_400_000);
      const id = `${organizationId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const [row] = await context.db
        .insert(invitation)
        .values({
          id,
          organizationId,
          email: input.email,
          role: input.role,
          status: "pending",
          expiresAt,
          inviterId,
        })
        .returning({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          inviterId: invitation.inviterId,
          createdAt: invitation.createdAt,
        });
      if (!row) throw raiseApiError("INTERNAL", "Could not create invitation.");
      await auditSharing({
        db: context.db,
        organizationId,
        actorUserId: inviterId,
        eventType: "MEMBER_INVITED",
        targetId: id,
        metadata: { email: input.email, role: input.role },
      });
      return {
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        expiresAt: row.expiresAt.toISOString(),
        inviterId: row.inviterId,
        createdAt: row.createdAt.toISOString(),
      };
    }),

  revokeInvitation: protectedProcedure
    .use(validateInput(revokeInvitationInput))
    .input(revokeInvitationInput)
    .output(z.object({ revoked: z.boolean() }))
    .handler(async ({ input, context }) => {
      const { authz } = await resolveAuthz(context.honoContext);
      ensureOwner(authz.role);
      const existing = await context.db
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.id, input.id),
            eq(invitation.organizationId, authz.activeOrganizationId),
          ),
        );
      if (existing.length === 0) return { revoked: false };
      await context.db.delete(invitation).where(eq(invitation.id, input.id));
      await auditSharing({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "INVITATION_REVOKED",
        targetId: input.id,
        metadata: {},
      });
      return { revoked: true };
    }),

  removeMember: protectedProcedure
    .use(validateInput(removeMemberInput))
    .input(removeMemberInput)
    .output(z.object({ removed: z.boolean() }))
    .handler(async ({ input, context }) => {
      const { authz } = await resolveAuthz(context.honoContext);
      ensureOwner(authz.role);
      if (input.userId === authz.user.id) {
        throw raiseApiError("INVALID_INPUT", "You cannot remove yourself.");
      }
      const existing = await context.db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.userId, input.userId),
            eq(member.organizationId, authz.activeOrganizationId),
          ),
        );
      if (existing.length === 0) return { removed: false };
      await context.db.delete(member).where(eq(member.userId, input.userId));
      await auditSharing({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "MEMBER_REMOVED",
        targetId: input.userId,
        metadata: {},
      });
      return { removed: true };
    }),

  me: protectedProcedure
    .use(validateInput(listInputSchema))
    .input(listInputSchema)
    .output(z.object({ role: z.string(), userId: z.string() }))
    .handler(async ({ context }) => {
      const { authz } = await resolveAuthz(context.honoContext);
      return { role: authz.role, userId: authz.user.id };
    }),
};
