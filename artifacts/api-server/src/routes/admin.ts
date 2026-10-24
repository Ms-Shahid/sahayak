import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminUserBody,
  CreateAdminUserResponse,
  GetAccessPolicyResponse,
  GetAdminMaterialsResponse,
  GetAdminUsersResponse,
  GetAuditLogResponse,
  GetClassMembersResponse,
  SetClassMemberBody,
  SetClassMemberResponse,
  UpdateAccessPolicyBody,
  UpdateAccessPolicyResponse,
  UpdateAdminUserRoleBody,
  UpdateAdminUserRoleParams,
  UpdateAdminUserRoleResponse,
} from "@workspace/api-zod";
import {
  accessPolicyTable,
  auditLogTable,
  classMaterialsTable,
  classMembersTable,
  classesTable,
  db,
  usersTable,
} from "@workspace/db";
import { audit, requireRole } from "../lib/auth";

const router: IRouter = Router();

router.use("/admin", requireRole("admin"));

router.get("/admin/users", async (_req, res): Promise<void> => {
  const rows = await db.select().from(usersTable).orderBy(usersTable.role, usersTable.name);
  res.json(GetAdminUsersResponse.parse(rows));
});

router.post("/admin/users", async (req, res): Promise<void> => {
  const parsed = CreateAdminUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "A user with this email already exists." });
    return;
  }
  const [row] = await db
    .insert(usersTable)
    .values({ name: parsed.data.name.trim(), email, role: parsed.data.role })
    .returning();
  await audit(req.user, "user_created", `${row.name} as ${row.role}`);
  res.status(201).json(CreateAdminUserResponse.parse(row));
});

router.patch("/admin/users/:userId", async (req, res): Promise<void> => {
  const params = UpdateAdminUserRoleParams.safeParse(req.params);
  const parsed = UpdateAdminUserRoleBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  if (params.data.userId === req.user!.id && parsed.data.role !== "admin") {
    res.status(409).json({ error: "You cannot remove your own admin role." });
    return;
  }
  const [row] = await db
    .update(usersTable)
    .set({ role: parsed.data.role })
    .where(eq(usersTable.id, params.data.userId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  await audit(req.user, "role_changed", `${row.name} is now ${row.role}`);
  res.json(UpdateAdminUserRoleResponse.parse(row));
});

router.get("/admin/members", async (_req, res): Promise<void> => {
  const rows = await db.select().from(classMembersTable);
  res.json(GetClassMembersResponse.parse(rows));
});

router.put("/admin/members", async (req, res): Promise<void> => {
  const parsed = SetClassMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, classId, member } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [room] = await db.select().from(classesTable).where(eq(classesTable.id, classId));
  if (!user || !room) {
    res.status(404).json({ error: "User or class not found." });
    return;
  }
  if (user.role === "admin") {
    res.status(409).json({ error: "Admins already have access to every class." });
    return;
  }
  if (member) {
    await db.insert(classMembersTable).values({ userId, classId }).onConflictDoNothing();
  } else {
    await db
      .delete(classMembersTable)
      .where(and(eq(classMembersTable.userId, userId), eq(classMembersTable.classId, classId)));
  }
  await audit(
    req.user,
    member ? "class_access_granted" : "class_access_removed",
    `${user.name} (${user.role}) ${member ? "added to" : "removed from"} ${room.name}`,
  );
  res.json(SetClassMemberResponse.parse({ ok: true }));
});

router.get("/admin/policy", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(accessPolicyTable).where(eq(accessPolicyTable.id, 1));
  res.json(
    GetAccessPolicyResponse.parse(
      row ?? { tier1DefaultVisibility: "ai_only", classUploadDefaultStatus: "published" },
    ),
  );
});

router.put("/admin/policy", async (req, res): Promise<void> => {
  const parsed = UpdateAccessPolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(accessPolicyTable)
    .values({ id: 1, ...parsed.data })
    .onConflictDoUpdate({ target: accessPolicyTable.id, set: parsed.data })
    .returning();
  await audit(
    req.user,
    "policy_updated",
    `school uploads default to ${row.tier1DefaultVisibility}; teacher uploads default to ${row.classUploadDefaultStatus}`,
  );
  res.json(UpdateAccessPolicyResponse.parse(row));
});

router.get("/admin/materials", async (_req, res): Promise<void> => {
  const rows = await db.select().from(classMaterialsTable).orderBy(desc(classMaterialsTable.createdAt));
  res.json(
    GetAdminMaterialsResponse.parse(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))),
  );
});

router.get("/admin/audit", async (_req, res): Promise<void> => {
  const rows = await db.select().from(auditLogTable).orderBy(desc(auditLogTable.id)).limit(100);
  res.json(GetAuditLogResponse.parse(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))));
});

export default router;
