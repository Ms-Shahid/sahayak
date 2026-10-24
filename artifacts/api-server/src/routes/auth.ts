import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetDemoUsersResponse,
  GetMeResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import {
  SESSION_COOKIE,
  audit,
  createSessionToken,
  memberClassIds,
  requireUser,
} from "../lib/auth";

const router: IRouter = Router();

router.get("/auth/demo-users", async (_req, res): Promise<void> => {
  const rows = await db.select().from(usersTable).orderBy(usersTable.role, usersTable.name);
  res.json(GetDemoUsersResponse.parse(rows));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.userId));
  if (!user) {
    res.status(404).json({ error: "Unknown demo user." });
    return;
  }
  res.cookie(SESSION_COOKIE, createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 12,
  });
  await audit(user, "sign_in", `${user.role} signed in`);
  res.json(LoginResponse.parse({ user, classIds: await memberClassIds(user.id) }));
});

router.post("/auth/logout", (_req, res): void => {
  res.clearCookie(SESSION_COOKIE);
  res.json(LogoutResponse.parse({ ok: true }));
});

router.get("/auth/me", requireUser, async (req, res): Promise<void> => {
  const user = req.user!;
  res.json(GetMeResponse.parse({ user, classIds: await memberClassIds(user.id) }));
});

export default router;
