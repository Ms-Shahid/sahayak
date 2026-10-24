import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { Router } from "express";
import {
  AcceptInvitationBody, CreateInvitationBody, EnrollSchoolBody,
  UpdateMemberClassesBody, GetAccountResponse, GetMembersResponse,
  GetInvitationsResponse, CreateInvitationResponse, UpdateMemberClassesResponse,
} from "@workspace/api-zod";
import { classesTable, classMembershipsTable, db, invitationsTable, membershipsTable, schoolsTable } from "@workspace/db";
import {
  AccessError, account, assertClass, memberFor, requireIdentity,
  requireMembership, requireRole, serializeMember, validateSchoolClasses,
} from "../lib/access";

const router = Router();
router.use((req, _res, next) => {
  if (!/^\/(account|enrollment|invitations|members)(\/|$)/.test(req.path)) { next("router"); return; }
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
    const [existing] = await tx.select().from(membershipsTable).where(eq(membershipsTable.userId, identity.userId));
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
    await tx.insert(classMembershipsTable).values(invite.classIds.map((classId) => ({ classId, memberId: member.id })))
      .onConflictDoNothing();
  });
  res.json(GetAccountResponse.parse(await account(identity)));
});
router.use(requireMembership);
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
  const [row] = await db.insert(invitationsTable).values({
    schoolId: member.schoolId, issuerId: member.id, email: input.email.toLowerCase().trim(),
    role: input.role, classIds, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000),
  }).returning();
  res.status(201).json(CreateInvitationResponse.parse({ invitation: invitationView(row), token }));
});
router.delete("/invitations/:invitationId", requireRole("admin", "teacher"), async (req, res) => {
  const member = res.locals.member;
  const rows = await db.update(invitationsTable).set({ revokedAt: new Date() })
    .where(and(eq(invitationsTable.id, idParam(req.params.invitationId)), eq(invitationsTable.schoolId, member.schoolId),
      member.role === "teacher" ? eq(invitationsTable.issuerId, member.id) : undefined,
      isNull(invitationsTable.acceptedAt), isNull(invitationsTable.revokedAt))).returning();
  if (!rows.length) throw new AccessError(404, "Pending invitation not found.");
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
  const [member] = await db.select().from(membershipsTable).where(and(eq(membershipsTable.id, idParam(req.params.memberId)),
    eq(membershipsTable.schoolId, res.locals.member.schoolId)));
  if (!member) throw new AccessError(404, "Member not found.");
  if (member.role === "admin") throw new AccessError(400, "Administrators already have school-wide access.");
  await db.transaction(async (tx) => {
    await tx.delete(classMembershipsTable).where(eq(classMembershipsTable.memberId, member.id));
    // Invalidate outstanding invitations from this teacher when class access changes.
    await tx.update(invitationsTable).set({ revokedAt: new Date() }).where(and(eq(invitationsTable.issuerId, member.id),
      isNull(invitationsTable.acceptedAt), isNull(invitationsTable.revokedAt)));
    if (classIds.length) await tx.insert(classMembershipsTable).values(classIds.map((classId) => ({ memberId: member.id, classId })));
  });
  res.json(UpdateMemberClassesResponse.parse(await serializeMember(member)));
});
router.delete("/members/:memberId", requireRole("admin"), async (req, res) => {
  const [member] = await db.select().from(membershipsTable).where(and(eq(membershipsTable.id, idParam(req.params.memberId)),
    eq(membershipsTable.schoolId, res.locals.member.schoolId)));
  if (!member) throw new AccessError(404, "Member not found.");
  if (member.role === "admin") throw new AccessError(400, "The school administrator cannot be removed.");
  await db.delete(membershipsTable).where(eq(membershipsTable.id, member.id));
  res.sendStatus(204);
});
export default router;
