import { accessAuditTable, db, invitationsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Identity, Member } from "./access";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Event = typeof accessAuditTable.$inferInsert;
type Actor = Identity & { role: Member["role"] };

// Only explicit, typed snapshots go here. Never pass a request body, invitation
// row, token/hash or session object to the audit store.
export async function auditAccess(tx: Transaction, actor: Actor,
  event: Pick<Event, "schoolId" | "action" | "targetType" | "targetId" | "targetLabel"> &
    Partial<Pick<Event, "targetRole" | "beforeClassIds" | "afterClassIds" | "reason">>) {
  await tx.insert(accessAuditTable).values({
    actorUserId: actor.userId, actorName: actor.name, actorEmail: actor.email, actorRole: actor.role,
    schoolId: event.schoolId, action: event.action, targetType: event.targetType,
    targetId: event.targetId, targetLabel: event.targetLabel, targetRole: event.targetRole,
    beforeClassIds: event.beforeClassIds, afterClassIds: event.afterClassIds, reason: event.reason ?? "direct",
  });
}

export async function revokeIssuedInvitations(tx: Transaction, actor: Actor, member: Member,
  reason: "roster_change" | "member_removal" | "administrator_handover") {
  const rows = await tx.update(invitationsTable).set({ revokedAt: new Date() })
    .where(and(eq(invitationsTable.schoolId, member.schoolId), eq(invitationsTable.issuerId, member.id),
      isNull(invitationsTable.acceptedAt), isNull(invitationsTable.revokedAt))).returning();
  for (const row of rows) await auditAccess(tx, actor, {
    schoolId: member.schoolId, action: "invitation.revoked", targetType: "invitation",
    targetId: row.id, targetLabel: row.email, targetRole: row.role, beforeClassIds: row.classIds, reason,
  });
}
