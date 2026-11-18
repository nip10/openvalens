import { DEMO_ROLE, parseDemoEmail } from "@openvalens/auth/demo";
import { sql, type Database } from "@openvalens/db";
import { member, organization, user } from "@openvalens/db/schema/auth";

import { refreshReviewAccount, type ReviewSeedInput } from "./review";

/** Provisioning is explicit and transactional; never convert an existing real account. */
export async function refreshPublicDemo(
  db: Database,
  input: ReviewSeedInput & { reviewEmail?: string | null },
) {
  const email = parseDemoEmail({
    DEMO_ACCOUNT_EMAIL: input.email,
    REVIEW_ACCOUNT_EMAIL: input.reviewEmail,
  });
  if (!email) throw new Error("Set DEMO_ACCOUNT_EMAIL first.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('openvalens-public-demo'))`);
    const existing = await tx.execute<{ id: string; role: string | null }>(
      sql`select "id", "role" from "user" where lower("email") = ${email} for update`,
    );
    if (existing.rows.length > 1 || (existing.rows[0] && existing.rows[0].role !== DEMO_ROLE))
      throw new Error("Refusing to convert an existing account into a public demo.");
    if (existing.rows.length === 0) {
      const userId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      await tx
        .insert(user)
        .values({ id: userId, name: "Alex Morgan", email, emailVerified: true, role: DEMO_ROLE });
      await tx.insert(organization).values({
        id: organizationId,
        name: "Alex's demo workspace",
        slug: `demo-${organizationId}`,
      });
      await tx
        .insert(member)
        .values({ id: crypto.randomUUID(), userId, organizationId, role: "owner" });
    }
    await tx.execute(sql`delete from "session" where "user_id" in
      (select "id" from "user" where lower("email") = ${email} and "role" = ${DEMO_ROLE})
      and "expires_at" < clock_timestamp()`);
    // Reuse the isolated-workspace guards and atomic refresh. No subscription
    // or legal acceptance is fabricated for this fictional person.
    return refreshReviewAccount(tx as unknown as Database, { ...input, email });
  });
}
