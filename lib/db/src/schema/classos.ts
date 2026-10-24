import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, real, serial, text, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type PracticeQuestionRecord = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  sourceName: string;
  sourceExcerpt: string;
  materialId?: number;
  sourcePage?: number;
  topic: string;
};

export const schoolsTable = pgTable("classos_schools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One active school per account. Null tenant columns below quarantine legacy demo data.
export const membershipsTable = pgTable("classos_memberships", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schoolsTable.id),
  userId: text("user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<"admin" | "teacher" | "student">().notNull(),
});

export const classMembershipsTable = pgTable("classos_class_memberships", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => membershipsTable.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
}, (table) => [uniqueIndex("classos_roster_unique").on(table.memberId, table.classId)]);

export const invitationsTable = pgTable("classos_invitations", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schoolsTable.id),
  issuerId: integer("issuer_id").notNull().references(() => membershipsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<"teacher" | "student">().notNull(),
  classIds: jsonb("class_ids").$type<number[]>().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const curriculumEntriesTable = pgTable("classos_curriculum_entries", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").references(() => schoolsTable.id),
  subject: text("subject").notNull(),
  grade: text("grade").notNull(),
  unit: text("unit").notNull(),
  chapter: text("chapter").notNull(),
  topic: text("topic").notNull(),
  standard: text("standard").notNull().default("School standard"),
});

export const classesTable = pgTable("classos_classes", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").references(() => schoolsTable.id),
  name: text("name").notNull(),
  grade: text("grade").notNull(),
  subject: text("subject").notNull(),
  teacherName: text("teacher_name").notNull(),
  studentCount: integer("student_count").notNull().default(0),
  masteryAverage: real("mastery_average").notNull().default(0),
});

export const classMaterialsTable = pgTable("classos_materials", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").references(() => classesTable.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").references(() => schoolsTable.id),
  uploadId: integer("upload_id"),
  extractionStatus: text("extraction_status").notNull().default("ready"),
  extractionError: text("extraction_error"),
  pages: jsonb("pages").$type<{ page: number; text: string; label: string }[]>().notNull().default([]),
  title: text("title").notNull(),
  sourceName: text("source_name").notNull(),
  topic: text("topic").notNull(),
  sourceText: text("source_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Bytes stay in private App Storage. Only metadata and extracted text live here.
export const uploadsTable = pgTable("classos_uploads", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schoolsTable.id),
  classId: integer("class_id").references(() => classesTable.id, { onDelete: "cascade" }),
  assignmentId: integer("assignment_id").references(() => assignmentsTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  purpose: text("purpose").$type<"source" | "submission">().notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull().unique(),
  status: text("status").notNull().default("uploading"),
  originalAvailable: integer("original_available").notNull().default(0),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  error: text("error"),
  pages: jsonb("pages").$type<{ page: number; text: string; label: string }[]>().notNull().default([]),
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
  studentUserId: text("student_user_id"),
  answers: jsonb("answers").$type<number[]>().notNull(),
  score: integer("score").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  attachmentId: integer("attachment_id").references(() => uploadsTable.id),
  reviewStatus: text("review_status").notNull().default("auto"),
  teacherFeedback: text("teacher_feedback"),
  reviewedBy: text("reviewed_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("classos_submission_once").on(table.assignmentId, table.studentUserId)]);

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
