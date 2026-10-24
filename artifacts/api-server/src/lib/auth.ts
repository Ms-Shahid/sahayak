import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  auditLogTable,
  classMembersTable,
  db,
  usersTable,
  type Role,
  type User,
} from "@workspace/db";

export const SESSION_COOKIE = "classos_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function secret(): string {
  return process.env.SESSION_SECRET ?? "classos-dev-only-secret";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function createSessionToken(userId: number): string {
  const value = String(userId);
  return `${value}.${sign(value)}`;
}

function readSessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const [value, signature] = token.split(".");
  if (!value || !signature) return null;
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}

/** Resolves the signed session cookie to a user row on every request. */
export const loadUser: RequestHandler = async (req, _res, next) => {
  try {
    const id = readSessionToken(req.cookies?.[SESSION_COOKIE]);
    if (id !== null) {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
      if (user) req.user = user;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({ error: "Your role does not allow this action." });
      return;
    }
    next();
  };
}

export async function memberClassIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ classId: classMembersTable.classId })
    .from(classMembersTable)
    .where(eq(classMembersTable.userId, userId));
  return rows.map((row) => row.classId);
}

/** Admins reach every class; teachers and students only the classes they are members of. */
export async function canAccessClass(user: User, classId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  const [row] = await db
    .select()
    .from(classMembersTable)
    .where(and(eq(classMembersTable.userId, user.id), eq(classMembersTable.classId, classId)));
  return Boolean(row);
}

/** Sends 403 and returns false when the signed-in user may not use the class. */
export async function guardClass(
  req: Request,
  res: Response,
  classId: number,
  roles: Role[],
): Promise<boolean> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return false;
  }
  if (!roles.includes(user.role as Role) || !(await canAccessClass(user, classId))) {
    res.status(403).json({ error: "You do not have access to this class." });
    return false;
  }
  return true;
}

export async function audit(user: User | undefined, action: string, detail = ""): Promise<void> {
  await db.insert(auditLogTable).values({
    actorId: user?.id ?? null,
    actorName: user?.name ?? "system",
    action,
    detail,
  });
}
