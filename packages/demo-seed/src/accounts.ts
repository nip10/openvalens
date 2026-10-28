import type { Session } from "@openvalens/auth";
import { createAdmissionService } from "@openvalens/auth/admission";
import { ensureActiveOrganization } from "@openvalens/auth/authz/auth-org";
import type { Database } from "@openvalens/db";
import { invitation, member, user } from "@openvalens/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * The synthetic demo people (Issue #301). Names and emails are made up; the
 * addresses use the reserved `example.com` domain, so no mail can ever reach a
 * real inbox.
 */
export const DEMO_PERSON = { name: "Alex Morgan", email: "alex.morgan@example.com" } as const;
export const DEMO_MEMBER = { name: "Sam Rivera", email: "sam.rivera@example.com" } as const;
/** A still-pending admission invitation, so the admin list is not empty. */
export const DEMO_PENDING_INVITE = "jordan.lee@example.com";

export type DemoAccounts = {
  admin: { userId: string; organizationId: string };
  member: { userId: string; organizationId: string };
};

/**
 * Creates the demo accounts through the admission core, exactly as a real
 * instance gets them: a setup token admits the first account as the global
 * administrator, who then invites the second one. The emailed codes and the
 * invitation bearer are captured in memory instead of being sent. Each person
 * then gets their personal workspace from the same bootstrap a first sign-in
 * runs, and Sam joins Alex's workspace the way an accepted invitation does.
 */
export async function createDemoAccounts(db: Database, now: Date): Promise<DemoAccounts> {
  const codes = new Map<string, string>();
  const invitations = new Map<string, string>();
  const admission = createAdmissionService({
    db,
    deliverVerification: async ({ email, verificationCode }) => {
      codes.set(email, verificationCode);
    },
    deliverInvitation: async ({ email, invitationToken }) => {
      invitations.set(email, invitationToken);
    },
  });

  const admit = async (kind: "setup" | "invitation", credential: string, email: string) => {
    const { enrollmentId } = await admission.begin({ kind, credential, email });
    const verificationCode = codes.get(email);
    if (!verificationCode) throw new Error("Demo admission did not issue a code.");
    await admission.complete({ enrollmentId, credential, verificationCode }, null);
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!row) throw new Error("Demo admission did not create the account.");
    // Admission creates nameless accounts; people add their name in the app.
    await db
      .update(user)
      .set({ name: nameFor(email) })
      .where(eq(user.id, row.id));
    return row.id;
  };

  const { token } = await admission.mintSetupToken();
  const adminId = await admit("setup", token, DEMO_PERSON.email);
  const adminSession = {
    user: { id: adminId },
    session: { id: "demo-seed", expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  } as unknown as Session;

  await admission.issueInvitation({ email: DEMO_MEMBER.email }, adminSession);
  const memberToken = invitations.get(DEMO_MEMBER.email);
  if (!memberToken) throw new Error("Demo admission did not issue an invitation.");
  const memberId = await admit("invitation", memberToken, DEMO_MEMBER.email);
  await admission.issueInvitation({ email: DEMO_PENDING_INVITE }, adminSession);

  const adminOrg = await ensureActiveOrganization(adminId, db);
  // Sam's own workspace first: the bootstrap picks the earliest membership.
  const memberOrg = await ensureActiveOrganization(memberId, db);

  // Sharing: Alex invites Sam into Alex's workspace and Sam accepts. Same rows
  // as `sharing.createInvitation` followed by Better Auth's accept.
  const invitationId = `${adminOrg.organizationId}-demo-member`;
  await db.insert(invitation).values({
    id: invitationId,
    organizationId: adminOrg.organizationId,
    email: DEMO_MEMBER.email,
    role: "member",
    status: "accepted",
    expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
    inviterId: adminId,
  });
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: adminOrg.organizationId,
    userId: memberId,
    role: "member",
  });

  return {
    admin: { userId: adminId, organizationId: adminOrg.organizationId },
    member: { userId: memberId, organizationId: memberOrg.organizationId },
  };
}

function nameFor(email: string): string {
  return email === DEMO_PERSON.email ? DEMO_PERSON.name : DEMO_MEMBER.name;
}
