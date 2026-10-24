import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { Router } from "express";
import {
  AcceptInvitationBody, CreateInvitationBody, EnrollSchoolBody,
  UpdateMemberClassesBody, GetAccountResponse, GetMembersResponse,
  GetInvitationsResponse, CreateInvitationResponse, UpdateMemberClassesResponse, GetAccessHistoryResponse,
} from "@workspace/api-zod";
import { accessAuditTable, classesTable, classMembershipsTable, db, invitationsTable, membershipsTable, schoolsTable } from "@workspace/db";
import { auditAccess, revokeIssuedInvitations } from "../lib/access-audit";
import {
  AccessError, account, assertClass, memberFor, requireIdentity,
  requireMembership, requireRole, serializeMember, validateSchoolClasses,
} from "../lib/access";

const router = Router();
router.use((req, _res, next) => {
  if (!/^\/(account|enrollment|invitations|members|access-history)(\/|$)/.test(req.path)) { next("router"); return; }
  next();
});
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function invitationView(row: typeof invitationsTable.$inferSelect) {
  return { id: row.id, email: row.email, role: row.role, classIds: row.classIds,
    expiresAt: row.expiresAt.toISOString(),
    status: row.revokedAt ? "revoked" : row.acceptedAt ? "accepted" : row.expiresAt <= new Date() ? "expired" : "pending" };
}
function idParam(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AccessError(400, "Invalid identifier.");
  return id;
}

router.use(requireIdentity);
router.get("/account", async (_req, res) => {
  res.json(GetAccountResponse.parse(await account(res.locals.identity)));
});
router.post("/enrollment", async (req, res) => {
  const input = EnrollSchoolBody.parse(req.body);
  if (input.schoolName.trim().length < 2) throw new AccessError(400, "Enter a school name.");
  const identity = res.locals.identity;
  if (await memberFor(identity.userId)) throw new AccessError(409, "This account already belongs to a school.");
  await db.transaction(async (tx) => {
    const [school] = await tx.insert(schoolsTable).values({ name: input.schoolName.trim() }).returning();
    await tx.insert(membershipsTable).values({ ...identity, schoolId: school.id, role: "admin" });
    await auditAccess(tx, { ...identity, role: "admin" }, {
      schoolId: school.id, action: "school.enrolled", targetType: "school", targetId: school.id, targetLabel: school.name,
    });
  });
  res.status(201).json(GetAccountResponse.parse(await account(identity)));
});
router.post("/invitations/accept", async (req, res) => {
  const { token } = AcceptInvitationBody.parse(req.body);
  const identity = res.locals.identity;
  await db.transaction(async (tx) => {
    // The guarded UPDATE is the claim: concurrent accept/revoke cannot reuse this token.
    const [invite] = await tx.update(invitationsTable).set({ acceptedAt: new Date() })
      .where(and(eq(invitationsTable.tokenHash, hash(token)), eq(invitationsTable.email, identity.email),
        isNull(invitationsTable.acceptedAt), isNull(invitationsTable.revokedAt), gt(invitationsTable.expiresAt, new Date())))
      .returning();
    if (!invite) throw new AccessError(400, "Invitation is invalid, expired, revoked, already used, or addressed to another email.");
    const [issuer] = await tx.select().from(membershipsTable).where(eq(membershipsTable.id, invite.issuerId)).for("share");
    if (!issuer || issuer.schoolId !== invite.schoolId || issuer.role === "student") throw new AccessError(400, "Invitation issuer no longer has access.");
    const [existing] = await tx.select().from(membershipsTable).where(eq(membershipsTable.userId, identity.userId)).for("update");
    if (existing && (existing.schoolId !== invite.schoolId || existing.role !== invite.role)) {
      throw new AccessError(409, "This account already has a different school or role.");
    }
    const rooms = await tx.select().from(classesTable).where(and(eq(classesTable.schoolId, invite.schoolId),
      inArray(classesTable.id, invite.classIds)));
    if (rooms.length !== invite.classIds.length) throw new AccessError(400, "Invited classes are no longer available.");
    if (issuer.role === "teacher") {
      const owned = await tx.select().from(classMembershipsTable).where(eq(classMembershipsTable.memberId, issuer.id)).for("share");
      if (invite.role !== "student" || invite.classIds.some((id) => !owned.some((row) => row.classId === id))) {
        throw new AccessError(400, "Invitation issuer no longer has class access.");
      }
    }
    const member = existing ?? (await tx.insert(membershipsTable)
      .values({ ...identity, schoolId: invite.schoolId, role: invite.role }).returning())[0];
    const added = await tx.insert(classMembershipsTable).values(invite.classIds.map((classId) => ({ classId, memberId: member.id })))
      .onConflictDoNothing().returning();
    const actor = { ...identity, role: member.role };
    await auditAccess(tx, actor, { schoolId: invite.schoolId, action: "invitation.accepted",
      targetType: "invitation", targetId: invite.id, targetLabel: invite.email, targetRole: invite.role,
      afterClassIds: invite.classIds, reason: "invitation_acceptance" });
    if (!existing) await auditAccess(tx, actor, { schoolId: member.schoolId, action: "member.joined",
      targetType: "member", targetId: member.id, targetLabel: member.email, targetRole: member.role,
      reason: "invitation_acceptance" });
    if (added.length) {
      const after = await tx.select().from(classMembershipsTable).where(eq(classMembershipsTable.memberId, member.id));
      await auditAccess(tx, actor, { schoolId: member.schoolId, action: "roster.updated",
        targetType: "member", targetId: member.id, targetLabel: member.email, targetRole: member.role,
        beforeClassIds: after.filter(row => !added.some(a => a.classId === row.classId)).map(row => row.classId),
        afterClassIds: after.map(row => row.classId), reason: "invitation_acceptance" });
    }
  });
  res.json(GetAccountResponse.parse(await account(identity)));
});
router.use(requireMembership);
router.get("/access-history", requireRole("admin"), async (req, res) => {
  const before = req.query.before === undefined ? undefined : idParam(req.query.before);
  const rows = await db.select().from(accessAuditTable)
    .where(and(eq(accessAuditTable.schoolId, res.locals.member.schoolId),
      before === undefined ? undefined : lt(accessAuditTable.id, before)))
    .orderBy(desc(accessAuditTable.id)).limit(51);
  const events = rows.slice(0, 50);
  res.json(GetAccessHistoryResponse.parse({
    events: events.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > 50 ? events[events.length - 1].id : null,
  }));
});
router.get("/invitations", requireRole("admin", "teacher"), async (_req, res) => {
  const member = res.locals.member;
  const rows = await db.select().from(invitationsTable).where(and(eq(invitationsTable.schoolId, member.schoolId),
    member.role === "teacher" ? eq(invitationsTable.issuerId, member.id) : undefined));
  res.json(GetInvitationsResponse.parse(rows.map(invitationView)));
});
router.post("/invitations", requireRole("admin", "teacher"), async (req, res) => {
  const input = CreateInvitationBody.parse(req.body);
  const member = res.locals.member;
  const classIds = [...new Set(input.classIds)];
  if (!classIds.length) throw new AccessError(400, "Choose at least one class.");
  await validateSchoolClasses(member.schoolId, classIds);
  if (member.role === "teacher") {
    if (input.role !== "student") throw new AccessError(403, "Only school administrators can invite teachers.");
    for (const id of classIds) assertClass(res.locals.classIds, id);
  }
  const token = randomBytes(32).toString("hex");
  const row = await db.transaction(async tx => {
    // Serialize with roster changes/removal so an invalidated issuer cannot
    // create a fresh pending invitation after automatic revocation.
    const [issuer] = await tx.select().from(membershipsTable).where(eq(membershipsTable.id, member.id)).for("share");
    if (!issuer) throw new AccessError(403, "School access has been removed.");
    if (issuer.role === "teacher") {
      const roster = await tx.select().from(classMembershipsTable).where(eq(classMembershipsTable.memberId, issuer.id));
      if (classIds.some(id => !roster.some(r => r.classId === id))) throw new AccessError(403, "Class access has changed.");
    }
    const [created] = await tx.insert(invitationsTable).values({
      schoolId: member.schoolId, issuerId: member.id, email: input.email.toLowerCase().trim(),
      role: input.role, classIds, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000),
    }).returning();
    await auditAccess(tx, member, { schoolId: member.schoolId, action: "invitation.created",
      targetType: "invitation", targetId: created.id, targetLabel: created.email,
      targetRole: created.role, afterClassIds: classIds });
    return created;
  });
  res.status(201).json(CreateInvitationResponse.parse({ invitation: invitationView(row), token }));
});
router.delete("/invitations/:invitationId", requireRole("admin", "teacher"), async (req, res) => {
  const member = res.locals.member;
  await db.transaction(async tx => {
    const rows = await tx.update(invitationsTable).set({ revokedAt: new Date() })
      .where(and(eq(invitationsTable.id, idParam(req.params.invitationId)), eq(invitationsTable.schoolId, member.schoolId),
        member.role === "teacher" ? eq(invitationsTable.issuerId, member.id) : undefined,
        isNull(invitationsTable.acceptedAt), isNull(invitationsTable.revokedAt))).returning();
    if (!rows.length) throw new AccessError(404, "Pending invitation not found.");
    await auditAccess(tx, member, { schoolId: member.schoolId, action: "invitation.revoked",
      targetType: "invitation", targetId: rows[0].id, targetLabel: rows[0].email,
      targetRole: rows[0].role, beforeClassIds: rows[0].classIds });
  });
  res.sendStatus(204);
});
router.get("/members", requireRole("admin"), async (_req, res) => {
  const rows = await db.select().from(membershipsTable).where(eq(membershipsTable.schoolId, res.locals.member.schoolId));
  res.json(GetMembersResponse.parse(await Promise.all(rows.map(serializeMember))));
});
router.patch("/members/:memberId", requireRole("admin"), async (req, res) => {
  const input = UpdateMemberClassesBody.parse(req.body);
  const classIds = [...new Set(input.classIds)];
  await validateSchoolClasses(res.locals.member.schoolId, classIds);
  const member = await db.transaction(async (tx) => {
    const [member] = await tx.select().from(membershipsTable).where(and(eq(membershipsTable.id, idParam(req.params.memberId)),
      eq(membershipsTable.schoolId, res.locals.member.schoolId))).for("update");
    if (!member) throw new AccessError(404, "Member not found.");
    if (member.role === "admin") throw new AccessError(400, "Administrators already have school-wide access.");
    const before = await tx.select().from(classMembershipsTable).where(eq(classMembershipsTable.memberId, member.id));
    if (before.length === classIds.length && before.every(row => classIds.includes(row.classId))) return member;
    await tx.delete(classMembershipsTable).where(eq(classMembershipsTable.memberId, member.id));
    // Invalidate outstanding invitations from this teacher when class access changes.
    await revokeIssuedInvitations(tx, res.locals.member, member, "roster_change");
    if (classIds.length) await tx.insert(classMembershipsTable).values(classIds.map((classId) => ({ memberId: member.id, classId })));
    await auditAccess(tx, res.locals.member, { schoolId: member.schoolId, action: "roster.updated",
      targetType: "member", targetId: member.id, targetLabel: member.email, targetRole: member.role,
      beforeClassIds: before.map(row => row.classId), afterClassIds: classIds });
    return member;
  });
  res.json(UpdateMemberClassesResponse.parse(await serializeMember(member)));
});
router.delete("/members/:memberId", requireRole("admin"), async (req, res) => {
  await db.transaction(async tx => {
    const [member] = await tx.select().from(membershipsTable).where(and(eq(membershipsTable.id, idParam(req.params.memberId)),
      eq(membershipsTable.schoolId, res.locals.member.schoolId))).for("update");
    if (!member) throw new AccessError(404, "Member not found.");
    if (member.role === "admin") throw new AccessError(400, "The school administrator cannot be removed.");
    const before = await tx.select().from(classMembershipsTable).where(eq(classMembershipsTable.memberId, member.id));
    await revokeIssuedInvitations(tx, res.locals.member, member, "member_removal");
    await tx.delete(membershipsTable).where(eq(membershipsTable.id, member.id));
    await auditAccess(tx, res.locals.member, { schoolId: member.schoolId, action: "member.removed",
      targetType: "member", targetId: member.id, targetLabel: member.email, targetRole: member.role,
      beforeClassIds: before.map(row => row.classId) });
  });
  res.sendStatus(204);
});
export default router;
