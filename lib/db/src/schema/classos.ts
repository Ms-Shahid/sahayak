import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, date } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type PracticeQuestionRecord = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  sourceName: string;
  sourceExcerpt: string;
  topic: string;
};

export const curriculumEntriesTable = pgTable("classos_curriculum_entries", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  grade: text("grade").notNull(),
  unit: text("unit").notNull(),
  chapter: text("chapter").notNull(),
  topic: text("topic").notNull(),
  standard: text("standard").notNull().default("School standard"),
});

export const classesTable = pgTable("classos_classes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  grade: text("grade").notNull(),
  subject: text("subject").notNull(),
  teacherName: text("teacher_name").notNull(),
  studentCount: integer("student_count").notNull().default(24),
  masteryAverage: real("mastery_average").notNull().default(0),
});

export const classMaterialsTable = pgTable("classos_materials", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").references(() => classesTable.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("class"),
  visibility: text("visibility").notNull().default("students"),
  status: text("status").notNull().default("published"),
  uploadedBy: integer("uploaded_by"),
  grade: text("grade"),
  subject: text("subject"),
  title: text("title").notNull(),
  sourceName: text("source_name").notNull(),
  topic: text("topic").notNull(),
  sourceText: text("source_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assignmentsTable = pgTable("classos_assignments", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("published"),
  questions: jsonb("questions").$type<PracticeQuestionRecord[]>().notNull(),
});

export const submissionsTable = pgTable("classos_submissions", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  studentName: text("student_name").notNull(),
  answers: jsonb("answers").$type<number[]>().notNull(),
  score: integer("score").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersTable = pgTable("classos_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
});

export const classMembersTable = pgTable(
  "classos_class_members",
  {
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.classId] })],
);

export const accessPolicyTable = pgTable("classos_access_policy", {
  id: integer("id").primaryKey(),
  tier1DefaultVisibility: text("tier1_default_visibility").notNull().default("ai_only"),
  classUploadDefaultStatus: text("class_upload_default_status").notNull().default("published"),
});

export const auditLogTable = pgTable("classos_audit_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id"),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ROLES = ["admin", "teacher", "student"] as const;
export type Role = (typeof ROLES)[number];
export const MATERIAL_VISIBILITIES = ["teachers", "students", "ai_only"] as const;
export const MATERIAL_STATUSES = ["draft", "published", "archived"] as const;
export type User = typeof usersTable.$inferSelect;

export const insertCurriculumEntrySchema = createInsertSchema(curriculumEntriesTable).omit({ id: true });
export const insertClassSchema = createInsertSchema(classesTable).omit({ id: true });
export const insertClassMaterialSchema = createInsertSchema(classMaterialsTable).omit({ id: true, createdAt: true });
export const insertAssignmentSchema = createInsertSchema(assignmentsTable).omit({ id: true });
export const insertSubmissionSchema = createInsertSchema(submissionsTable).omit({ id: true, submittedAt: true });

export type InsertCurriculumEntry = z.infer<typeof insertCurriculumEntrySchema>;
export type CurriculumEntry = typeof curriculumEntriesTable.$inferSelect;
export type InsertClass = z.infer<typeof insertClassSchema>;
export type ClassRecord = typeof classesTable.$inferSelect;
export type InsertClassMaterial = z.infer<typeof insertClassMaterialSchema>;
export type ClassMaterial = typeof classMaterialsTable.$inferSelect;
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type AssignmentRecord = typeof assignmentsTable.$inferSelect;
export type InsertSubmission = z.infer<typeof insertSubmissionSchema>;
export type SubmissionRecord = typeof submissionsTable.$inferSelect;
