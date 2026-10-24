import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { adminHandoversTable as handovers, db, membershipsTable, classMembershipsTable } from "@workspace/db";
import { CreateHandoverBody, CreateHandoverResponse, AcceptHandoverBody, AcceptHandoverResponse,
  GetHandoversResponse, RevokeHandoverParams } from "@workspace/api-zod";
import { AccessError, account, requireIdentity, requireMembership, requireRole } from "../lib/access";
import { accessTransaction } from "../lib/access-transaction";
import { auditAccess, revokeIssuedInvitations } from "../lib/access-audit";

const router = Router();
router.use("/handovers", requireIdentity, requireMembership);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const pending = and(isNull(handovers.acceptedAt), isNull(handovers.revokedAt));
function view(row: typeof handovers.$inferSelect) {
  return { id: row.id, recipientEmail: row.recipientEmail, expiresAt: row.expiresAt.toISOString(),
    status: row.revokedAt ? "revoked" : row.acceptedAt ? "accepted" : row.expiresAt <= new Date() ? "expired" : "pending" };
}
router.get("/handovers", requireRole("admin"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(handovers).where(eq(handovers.schoolId, res.locals.member.schoolId)).orderBy(desc(handovers.id));
  res.json(GetHandoversResponse.parse(rows.map(view)));
});
router.post("/handovers", requireRole("admin"), async (req, res): Promise<void> => {
  const input = CreateHandoverBody.parse(req.body);
  const actor = res.locals.member;
  const token = randomBytes(32).toString("hex");
  const row = await accessTransaction(actor, async tx => {
    const [recipient] = await tx.select().from(membershipsTable).where(and(
      eq(membershipsTable.id, input.recipientId), eq(membershipsTable.schoolId, actor.schoolId)));
    if (!recipient || recipient.role !== "teacher") throw new AccessError(400, "Choose an existing teacher in this school.");
    await tx.update(handovers).set({ revokedAt: new Date() }).where(and(eq(handovers.schoolId, actor.schoolId), pending));
    const [created] = await tx.insert(handovers).values({
      schoolId: actor.schoolId, issuerId: actor.id, recipientId: recipient.id,
      recipientUserId: recipient.userId, recipientEmail: recipient.email,
      tokenHash: hash(token), expiresAt: new Date(Date.now() + 86400000),
    }).returning();
    await auditAccess(tx, actor, { schoolId: actor.schoolId, action: "handover.created",
      targetType: "member", targetId: recipient.id, targetLabel: recipient.email, targetRole: "teacher" });
    return created;
  });
  res.status(201).json(CreateHandoverResponse.parse({ handover: view(row), token }));
});
router.delete("/handovers/:handoverId", requireRole("admin"), async (req, res): Promise<void> => {
  const { handoverId } = RevokeHandoverParams.parse(req.params);
  await accessTransaction(res.locals.member, async tx => {
    const [row] = await tx.update(handovers).set({ revokedAt: new Date() }).where(and(
      eq(handovers.id, handoverId), eq(handovers.schoolId, res.locals.member.schoolId), pending)).returning();
    if (!row) throw new AccessError(404, "Pending handover not found.");
    await auditAccess(tx, res.locals.member, { schoolId: row.schoolId, action: "handover.revoked",
      targetType: "member", targetId: row.recipientId, targetLabel: row.recipientEmail });
  });
  res.sendStatus(204);
});
router.post("/handovers/accept", requireRole("teacher"), async (req, res): Promise<void> => {
  const { token } = AcceptHandoverBody.parse(req.body);
  const actor = res.locals.member;
  const identity = res.locals.identity;
  await accessTransaction(actor, async tx => {
    const [row] = await tx.select().from(handovers).where(and(eq(handovers.tokenHash, hash(token)),
      eq(handovers.schoolId, actor.schoolId), eq(handovers.recipientId, actor.id),
      eq(handovers.recipientUserId, identity.userId), eq(handovers.recipientEmail, identity.email), pending)).for("update");
    if (!row || row.expiresAt <= new Date()) throw new AccessError(400, "Handover is invalid, expired, revoked, already used, or intended for another account.");
    const [issuer] = await tx.select().from(membershipsTable).where(eq(membershipsTable.id, row.issuerId)).for("update");
    if (!issuer || issuer.role !== "admin" || issuer.schoolId !== actor.schoolId) throw new AccessError(400, "The issuing administrator no longer has authority.");
    // All changes and audit writes commit together, or none do.
    await tx.update(membershipsTable).set({ role: "admin" }).where(eq(membershipsTable.id, actor.id));
    await tx.update(membershipsTable).set({ role: "teacher" }).where(eq(membershipsTable.id, issuer.id));
    const roster = await tx.delete(classMembershipsTable).where(eq(classMembershipsTable.memberId, issuer.id)).returning();
    await revokeIssuedInvitations(tx, actor, issuer, "administrator_handover");
    await revokeIssuedInvitations(tx, actor, actor, "administrator_handover");
    await tx.update(handovers).set({ acceptedAt: new Date() }).where(eq(handovers.id, row.id));
    await tx.update(handovers).set({ revokedAt: new Date() }).where(and(eq(handovers.schoolId, actor.schoolId), pending));
    await auditAccess(tx, actor, { schoolId: actor.schoolId, action: "handover.accepted",
      targetType: "member", targetId: issuer.id, targetLabel: issuer.email, targetRole: "teacher",
      beforeClassIds: roster.map(r => r.classId), afterClassIds: [], reason: "administrator_handover" });
  });
  res.json(AcceptHandoverResponse.parse(await account(identity)));
});
export default router;
