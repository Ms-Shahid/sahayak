import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, real, serial, text, timestamp, date } from "drizzle-orm/pg-core";
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
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
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
