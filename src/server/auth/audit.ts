import "server-only";

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { auditRecordData, type AuditEvent } from "@/server/audit/service";

/*
 * Authentication events (sign-in, sign-out, failed sign-in, password
 * changes). They belong to a user account, not to one organization, so each
 * event is recorded in every organization the user is a member of: that is
 * where administrators can review their members' account activity. A failed
 * sign-in for an address with no account, or for a user without
 * organizations, is only logged (without the address).
 *
 * Called from Better Auth hooks (src/server/auth/auth.ts) with the user
 * resolved by Better Auth itself, never from request data. Recording is best
 * effort: the sign-in or sign-out has already happened, so a failure here is
 * logged instead of turning a completed authentication into an error.
 */

type AuthAuditEvent = Omit<AuditEvent, "resourceId"> & {
  action:
    | "auth.login"
    | "auth.logout"
    | "auth.login_failed"
    | "auth.verification_failed"
    | "auth.password_changed"
    | "auth.password_change_failed"
    | "auth.password_reset";
};

/**
 * @param userId The account the event is about.
 * @param actorUserId The authenticated user who acted (null for a failed sign-in).
 */
export async function recordAuthEvent(
  userId: string,
  actorUserId: string | null,
  event: AuthAuditEvent,
): Promise<void> {
  try {
    const db = getDb();
    const memberships = await db.membership.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    if (memberships.length === 0) return;
    await db.auditLog.createMany({
      data: memberships.map(({ organizationId }) =>
        auditRecordData({ organizationId, actorUserId }, { ...event, resourceId: userId }),
      ),
    });
  } catch (error) {
    logger.error("Could not record authentication audit event", {
      action: event.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A failed sign-in or email verification: recorded for the account it
 * targeted, if that account exists.
 */
export async function recordFailedSignIn(
  email: unknown,
  metadata: Record<string, unknown>,
  action: "auth.login_failed" | "auth.verification_failed" = "auth.login_failed",
) {
  if (typeof email !== "string" || email.length === 0 || email.length > 320) return;
  const normalized = email.trim().toLowerCase();
  let user: { id: string } | null = null;
  try {
    user = await getDb().user.findUnique({ where: { email: normalized }, select: { id: true } });
  } catch (error) {
    logger.error("Could not look up the account of a failed sign-in", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!user) {
    logger.info("Failed sign-in for an unknown account", { reason: metadata.reason });
    return;
  }
  await recordAuthEvent(user.id, null, {
    action,
    metadata: { ...metadata, email: normalized },
  });
}
