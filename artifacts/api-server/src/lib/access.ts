import { eq, ne } from "drizzle-orm";
import {
  classMaterialsTable,
  classesTable,
  db,
  type ClassMaterial,
  type User,
} from "@workspace/db";
import { canAccessClass } from "./auth";

type ClassRow = typeof classesTable.$inferSelect;

function same(a: string | null, b: string): boolean {
  return a === null || a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Class-scope items of the class plus school-scope items that apply to its grade and subject. */
async function applicableMaterials(room: ClassRow): Promise<ClassMaterial[]> {
  const rows = await db
    .select()
    .from(classMaterialsTable)
    .where(ne(classMaterialsTable.status, "archived"));
  return rows.filter((row) =>
    row.scope === "school"
      ? same(row.grade, room.grade) && same(row.subject, room.subject)
      : row.classId === room.id,
  );
}

/** What this user is allowed to read for a class (see docs/rbac-design.md section 4). */
export async function readableMaterials(user: User, room: ClassRow): Promise<ClassMaterial[]> {
  const rows = await applicableMaterials(room);
  if (user.role === "admin") return rows;
  if (user.role === "teacher") {
    return rows.filter((row) => row.scope === "class" || row.status === "published");
  }
  return rows.filter((row) => row.status === "published" && row.visibility === "students");
}

/** Sources the AI may ground on. Students and the tutor never see drafts or teacher-only items. */
export async function groundingMaterials(
  room: ClassRow,
  options: { includeTeacherOnly?: boolean } = {},
): Promise<ClassMaterial[]> {
  const rows = await applicableMaterials(room);
  return rows.filter(
    (row) =>
      row.status === "published" &&
      (row.visibility === "students" ||
        row.visibility === "ai_only" ||
        (options.includeTeacherOnly === true && row.visibility === "teachers")),
  );
}

export async function getClass(classId: number): Promise<ClassRow | undefined> {
  const [room] = await db.select().from(classesTable).where(eq(classesTable.id, classId));
  return room;
}

export async function ownsMaterial(user: User, material: ClassMaterial): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role !== "teacher" || material.scope !== "class" || material.classId === null) {
    return false;
  }
  return canAccessClass(user, material.classId);
}

