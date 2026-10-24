import { count, eq } from "drizzle-orm";
import {
  accessPolicyTable,
  classMembersTable,
  classMaterialsTable,
  classesTable,
  curriculumEntriesTable,
  db,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";

const DEMO_STUDENTS = ["Aarav Mehta", "Diya Nair", "Kabir Singh"];

function emailFor(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "")}@northstar.demo`;
}

/** Fills an empty database with a small synthetic school so a fresh local run is usable. */
async function seedDemoSchool(): Promise<void> {
  const [{ total }] = await db.select({ total: count() }).from(classesTable);
  if (total > 0) return;
  const rooms = await db
    .insert(classesTable)
    .values([
      { name: "Grade 10 Mathematics", grade: "Grade 10", subject: "Mathematics", teacherName: "Meera Iyer", studentCount: 3 },
      { name: "Grade 9 Science", grade: "Grade 9", subject: "Science", teacherName: "Rahul Verma", studentCount: 3 },
    ])
    .returning();
  await db.insert(curriculumEntriesTable).values([
    { subject: "Mathematics", grade: "Grade 10", unit: "Algebra", chapter: "Quadratic Equations", topic: "Solving by factorisation" },
    { subject: "Science", grade: "Grade 9", unit: "Matter", chapter: "States of Matter", topic: "Changes of state" },
  ]);
  await db.insert(classMaterialsTable).values([
    {
      classId: rooms[0].id,
      title: "Quadratic equations notes",
      sourceName: "Teacher notes",
      topic: "Solving by factorisation",
      sourceText:
        "A quadratic equation has the form ax^2 + bx + c = 0. To solve by factorisation, split the middle term so that two numbers multiply to ac and add to b. Then set each factor equal to zero.",
    },
    {
      classId: rooms[1].id,
      title: "States of matter notes",
      sourceName: "Teacher notes",
      topic: "Changes of state",
      sourceText:
        "Melting is the change from solid to liquid and happens at the melting point. Boiling is the change from liquid to gas. Heat energy is absorbed during a change of state without a rise in temperature.",
    },
    {
      scope: "school",
      visibility: "ai_only",
      grade: "Grade 10",
      subject: "Mathematics",
      title: "School formula sheet",
      sourceName: "Department reference",
      topic: "Quadratic formula",
      sourceText:
        "For ax^2 + bx + c = 0 the roots are x = (-b plus or minus the square root of (b^2 - 4ac)) divided by 2a. The discriminant b^2 - 4ac decides the number of real roots.",
    },
  ]);
}

/** Seeds the demo school once: policy row, an admin, teachers per class, and students. Idempotent. */
export async function seedDemoUsers(): Promise<void> {
  await db.insert(accessPolicyTable).values({ id: 1 }).onConflictDoNothing();
  await seedDemoSchool();

  const [{ total }] = await db.select({ total: count() }).from(usersTable);
  if (total > 0) return;

  const [admin] = await db
    .insert(usersTable)
    .values({ name: "Priya Sharma (Admin)", email: emailFor("priya sharma admin"), role: "admin" })
    .returning();
  const students = await db
    .insert(usersTable)
    .values(DEMO_STUDENTS.map((name) => ({ name, email: emailFor(name), role: "student" })))
    .returning();

  const classes = await db.select().from(classesTable);
  const teacherIds = new Map<string, number>();
  for (const room of classes) {
    let teacherId = teacherIds.get(room.teacherName);
    if (teacherId === undefined) {
      const [teacher] = await db
        .insert(usersTable)
        .values({ name: room.teacherName, email: emailFor(room.teacherName), role: "teacher" })
        .onConflictDoNothing()
        .returning();
      const resolved =
        teacher ??
        (await db.select().from(usersTable).where(eq(usersTable.email, emailFor(room.teacherName))))[0];
      teacherId = resolved.id;
      teacherIds.set(room.teacherName, teacherId);
    }
    await db
      .insert(classMembersTable)
      .values([
        { userId: teacherId, classId: room.id },
        ...students.map((student) => ({ userId: student.id, classId: room.id })),
      ])
      .onConflictDoNothing();
  }
  logger.info({ admin: admin.email, teachers: teacherIds.size, students: students.length }, "Seeded demo users");
}
