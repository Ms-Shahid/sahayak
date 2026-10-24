import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { classesTable, membershipsTable, type PracticeQuestionRecord } from "./classos";

export const learningPreferencesTable = pgTable("classos_learning_preferences", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => membershipsTable.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  pace: text("pace").$type<"relaxed" | "steady" | "challenge">().notNull().default("steady"),
}, (t) => [uniqueIndex("classos_learning_preferences_unique").on(t.memberId, t.classId)]);

export type SessionQuestion = PracticeQuestionRecord & { assignmentId: number };
export const learningSessionsTable = pgTable("classos_learning_sessions", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => membershipsTable.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  mode: text("mode").$type<"practice" | "puzzle">().notNull(),
  topic: text("topic").notNull(),
  pace: text("pace").$type<"relaxed" | "steady" | "challenge">().notNull(),
  questions: jsonb("questions").$type<SessionQuestion[]>().notNull(),
  answers: jsonb("answers").$type<number[]>(),
  score: integer("score"),
  xpEarned: integer("xp_earned").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

// Points and event identity are always derived on the server; unique keys prevent replay farming.
export const xpEventsTable = pgTable("classos_xp_events", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => membershipsTable.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"attendance" | "practice" | "quiz" | "assignment">().notNull(),
  sourceKey: text("source_key").notNull(),
  points: integer("points").notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("classos_xp_event_unique").on(t.memberId, t.classId, t.kind, t.sourceKey)]);

export const insertLearningPreferenceSchema = createInsertSchema(learningPreferencesTable).omit({ id: true });
export const insertLearningSessionSchema = createInsertSchema(learningSessionsTable).omit({ id: true, createdAt: true });
export const insertXpEventSchema = createInsertSchema(xpEventsTable).omit({ id: true, earnedAt: true });
export type LearningSession = typeof learningSessionsTable.$inferSelect;
