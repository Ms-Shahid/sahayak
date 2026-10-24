import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, inArray } from "drizzle-orm";
import type { RequestHandler } from "express";
import { classMembershipsTable, classesTable, db, membershipsTable, schoolsTable } from "@workspace/db";

export type Member = typeof membershipsTable.$inferSelect;
export type Identity = { userId: string; email: string; name: string };
declare global {
  namespace Express {
    interface Locals {
      identity: Identity;
      member: Member;
      classIds: number[];
    }
  }
}

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Never trust roles, names, school IDs or email addresses supplied by the browser.
export const requireIdentity: RequestHandler = async (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Cross-site requests are not allowed." }); return;
    }
    if (["POST", "PATCH"].includes(req.method) && !req.is("application/json")) {
      res.status(415).json({ error: "Send JSON requests." }); return;
    }
  }
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in to continue." }); return; }
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find((item) =>
    item.id === user.primaryEmailAddressId && item.verification?.status === "verified");
  if (!email) { res.status(403).json({ error: "Verify your primary email address before continuing." }); return; }
  res.locals.identity = {
    userId, email: email.emailAddress.toLowerCase(),
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || email.emailAddress,
  };
  res.setHeader("Cache-Control", "no-store");
  next();
};

export async function memberFor(userId: string) {
  const [member] = await db.select().from(membershipsTable).where(eq(membershipsTable.userId, userId));
  return member;
}

export async function memberClassIds(member: Member) {
  if (member.role === "admin") {
    return (await db.select({ id: classesTable.id }).from(classesTable)
      .where(eq(classesTable.schoolId, member.schoolId))).map((row) => row.id);
  }
  return (await db.select({ id: classesTable.id }).from(classMembershipsTable)
    .innerJoin(classesTable, eq(classesTable.id, classMembershipsTable.classId))
    .where(and(eq(classMembershipsTable.memberId, member.id), eq(classesTable.schoolId, member.schoolId))))
    .map((row) => row.id);
}

export const requireMembership: RequestHandler = async (_req, res, next) => {
  const member = await memberFor(res.locals.identity.userId);
  if (!member) { res.status(403).json({ error: "Enroll a school or accept an invitation first." }); return; }
  res.locals.member = member;
  res.locals.classIds = await memberClassIds(member);
  next();
};

export function requireRole(...roles: Member["role"][]): RequestHandler {
  return (_req, res, next) => {
    if (!roles.includes(res.locals.member.role)) { res.status(403).json({ error: "You do not have permission for this action." }); return; }
    next();
  };
}

export function assertClass(classIds: number[], id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || !classIds.includes(id)) {
    throw new AccessError(404, "Class not found.");
  }
}

export async function validateSchoolClasses(schoolId: number, ids: number[]) {
  const rows = await db.select({ id: classesTable.id }).from(classesTable)
    .where(and(eq(classesTable.schoolId, schoolId), inArray(classesTable.id, ids.length ? ids : [-1])));
  if (rows.length !== ids.length) throw new AccessError(404, "One or more classes were not found.");
}

export async function serializeMember(member: Member) {
  return { id: member.id, schoolId: member.schoolId, role: member.role,
    name: member.name, email: member.email, classIds: await memberClassIds(member) };
}

export async function account(identity: Identity) {
  const member = await memberFor(identity.userId);
  if (!member) return identity;
  const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, member.schoolId));
  return { ...identity, schoolName: school.name, membership: await serializeMember(member) };
}
